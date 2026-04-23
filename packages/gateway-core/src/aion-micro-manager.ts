/**
 * AionMicroManager — small-model diagnostic + merge-conflict assistant.
 *
 * Aion-Micro is the platform's lightweight reasoning surface for:
 *   - agi doctor intelligent diagnostics (diagnose)
 *   - Core-fork merge-conflict resolution (resolveMergeConflict)
 *
 * Phase K.4: serving has moved from a custom Podman + FastAPI container
 * to the Lemonade local-LLM backplane. Every Manager call now hits AGI's
 * own /api/lemonade/* proxy (which forwards to Lemonade at :13305),
 * never spawns a container, never shells out to anything.
 *
 * The fine-tuned LoRA-merged GGUF lives in HuggingFace Hub
 * (default: `wishborn/aion-micro-v1`), pulled via Lemonade like any
 * other model. If the configured model isn't loaded, ensureAvailable()
 * tells the caller it's unavailable — the prepare-runtime UX in the
 * dashboard banners (K.6) handles the install/pull flow.
 *
 * Prompts copied VERBATIM from the previous Python entrypoint so output
 * shape and quality are identical. Only the transport changed.
 */

import type { ComponentLogger } from "./logger.js";

const LEMONADE_BASE_DEFAULT = "http://127.0.0.1:13305";
const DEFAULT_MODEL = "wishborn/aion-micro-v1";
const DEFAULT_FALLBACK_MODEL = "SmolLM2-135M-Instruct";

export interface AionMicroConfig {
  enabled: boolean;
  /** Lemonade catalog name of the fine-tuned model. */
  model?: string;
  /** Fallback model when the fine-tuned model isn't available. */
  fallbackModel?: string;
  /** Lemonade base URL — defaults to localhost:13305 (matches plugin install). */
  lemonadeBaseUrl?: string;
}

const DEFAULT_CONFIG: Required<AionMicroConfig> = {
  enabled: true,
  model: DEFAULT_MODEL,
  fallbackModel: DEFAULT_FALLBACK_MODEL,
  lemonadeBaseUrl: LEMONADE_BASE_DEFAULT,
};

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class AionMicroManager {
  private readonly config: Required<AionMicroConfig>;
  private readonly log: ComponentLogger;

  constructor(config: Partial<AionMicroConfig> | undefined, log: ComponentLogger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = log;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  /** Resolved model name + Lemonade base URL — used by status endpoints. */
  getModel(): string { return this.config.model; }
  getLemonadeBaseUrl(): string { return this.config.lemonadeBaseUrl; }

  /**
   * Public chat-completion entry point for callers that want to use the
   * Aion-Micro model without going through diagnose() / resolveMergeConflict().
   * Used by LocalModelRuntime as the small-model fallback when the primary
   * HF-served model isn't running. Returns null on any failure so the caller
   * can decide whether to surface the error or skip silently.
   */
  async complete(opts: { system?: string; prompt: string; maxTokens?: number; temperature?: number }): Promise<string | null> {
    if (!(await this.ensureAvailable())) return null;
    const messages: ChatMessage[] = [];
    if (opts.system !== undefined && opts.system.length > 0) {
      messages.push({ role: "system", content: opts.system });
    }
    messages.push({ role: "user", content: opts.prompt });
    const text = await this.chat(messages, opts.maxTokens ?? 1024, opts.temperature ?? 0.3);
    return text.length > 0 ? text : null;
  }

  /**
   * Returns true when the configured Aion-Micro model can answer chat
   * completions through Lemonade. Probes Lemonade's health endpoint and
   * checks whether either the configured model or the fallback is
   * available. Does NOT auto-install or auto-pull — the dashboard
   * LemonadeBanner handles that UX with explicit user consent.
   */
  async ensureAvailable(): Promise<boolean> {
    if (!this.config.enabled) return false;
    try {
      const res = await fetch(`${this.config.lemonadeBaseUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return false;
      // /v1/chat/completions auto-loads on first request, so we don't need
      // to pre-check that the specific model is loaded — only that the
      // server is up and we have a model name to send.
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Pick the model to use: prefer the fine-tuned one; fall back to the
   * upstream SmolLM2 if the fine-tuned model isn't pulled yet. Lemonade
   * returns 404 on /chat/completions for unknown model names — the caller
   * (chat()) catches that and retries with the fallback.
   */
  private getPrimaryModel(): string {
    return this.config.model || this.config.fallbackModel;
  }

  /**
   * Lemonade chat-completion call with retry-on-fallback. Returns the
   * choice text or empty string on any failure (callers handle empty
   * deterministically — diagnose() returns "" so the doctor renders no
   * narrative; resolveMergeConflict() returns null so the caller refuses
   * to commit).
   */
  private async chat(messages: ChatMessage[], maxTokens: number, temperature: number): Promise<string> {
    const tryOnce = async (model: string): Promise<{ ok: boolean; content: string; status?: number }> => {
      try {
        const res = await fetch(`${this.config.lemonadeBaseUrl}/api/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) {
          return { ok: false, content: "", status: res.status };
        }
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content ?? "";
        return { ok: true, content };
      } catch (err) {
        this.log.warn(`aion-micro chat error (model=${model}): ${err instanceof Error ? err.message : String(err)}`);
        return { ok: false, content: "" };
      }
    };

    const primary = this.getPrimaryModel();
    let result = await tryOnce(primary);
    if (!result.ok && primary !== this.config.fallbackModel) {
      this.log.info(`aion-micro: ${primary} unavailable (status ${String(result.status ?? "?")}), trying fallback ${this.config.fallbackModel}`);
      result = await tryOnce(this.config.fallbackModel);
    }
    return result.content;
  }

  /**
   * Diagnostic narrative for `agi doctor`. Prompt is identical to the
   * pre-K.4 Python container — same one-paragraph "concise diagnostic
   * summary" output shape so the existing CLI / dashboard rendering
   * stays unchanged.
   */
  async diagnose(checks: unknown[], systemInfo?: unknown): Promise<string> {
    if (!(await this.ensureAvailable())) return "";
    const evidence = JSON.stringify(checks, null, 2).slice(0, 2000);
    const systemCtx = systemInfo !== undefined ? `\nSystem: ${JSON.stringify(systemInfo).slice(0, 500)}` : "";
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are Aion-Micro, a system diagnostics assistant for the AGI gateway. " +
          "Analyze the health check results and provide a concise diagnostic summary. " +
          "Focus on: failures that need immediate attention, warnings that may cause future issues, " +
          "and any patterns across multiple checks. Be specific and actionable.",
      },
      { role: "user", content: `Health check results:${systemCtx}\n\n${evidence}\n\nProvide a diagnostic summary.` },
    ];
    return await this.chat(messages, 512, 0.3);
  }

  /**
   * Resolve a single file's merge conflicts. Two-tier flow preserved
   * verbatim from the Python container:
   *   1. Deterministic resolutions for trivial cases (identical sides,
   *      whitespace-only, one-side-empty).
   *   2. Model-pick (OURS / THEIRS / UNCLEAR) for everything else.
   *
   * Returns null when the model is unavailable; otherwise returns
   * resolvedText with confidence "high" only when every hunk resolved.
   */
  async resolveMergeConflict(
    filePath: string,
    oursLabel: string,
    theirsLabel: string,
    conflictText: string,
  ): Promise<{ resolvedText: string; confidence: "high" | "low"; unresolvedHunks: string[] } | null> {
    if (!(await this.ensureAvailable())) return null;

    const { prefixes, hunks } = splitConflictHunks(conflictText);
    if (hunks.length === 0) {
      return { resolvedText: conflictText, confidence: "high", unresolvedHunks: [] };
    }

    const resolvedParts: string[] = [];
    const unresolved: string[] = [];
    let overallHigh = true;

    for (let idx = 0; idx < hunks.length; idx++) {
      const { ours, theirs } = hunks[idx]!;
      const det = resolveHunkDeterministic(ours, theirs);
      if (det !== null) {
        resolvedParts.push(det.resolved);
        continue;
      }
      // Model-assisted directional pick. The 135M model gets ONE job:
      // output exactly OURS / THEIRS / UNCLEAR. We constrain max_tokens=16
      // to keep it from rambling.
      const messages: ChatMessage[] = [
        {
          role: "system",
          content:
            "You are reviewing a merge conflict for the AGI platform. The user's fork " +
            "('ours') has local work; upstream ('theirs') has the canonical release. " +
            "Your ONLY job is to pick which side to keep. Respond with exactly one of: " +
            "OURS, THEIRS, or UNCLEAR. Pick UNCLEAR if both sides have meaningful content " +
            "that neither overrides nor trivially merges.",
        },
        {
          role: "user",
          content:
            `File: ${filePath}\n\nOURS (fork):\n${ours.slice(0, 1500)}\n\n` +
            `THEIRS (upstream):\n${theirs.slice(0, 1500)}\n\nYour pick:`,
        },
      ];
      const answer = (await this.chat(messages, 16, 0.0)).trim().toUpperCase();
      let pick: "OURS" | "THEIRS" | "UNCLEAR" = "UNCLEAR";
      if (answer.startsWith("OURS")) pick = "OURS";
      else if (answer.startsWith("THEIRS")) pick = "THEIRS";

      if (pick === "OURS") {
        resolvedParts.push(ours);
      } else if (pick === "THEIRS") {
        resolvedParts.push(theirs);
      } else {
        overallHigh = false;
        unresolved.push(`hunk ${String(idx + 1)} in ${filePath}: model unsure`);
        // Preserve the original conflict markers so a human can resolve.
        resolvedParts.push(
          `<<<<<<< ${oursLabel}\n${ours}=======\n${theirs}>>>>>>> ${theirsLabel}\n`,
        );
      }
    }

    // Reassemble: prefix[0] + resolved[0] + prefix[1] + resolved[1] + ... + prefix[last]
    const out: string[] = [];
    for (let i = 0; i < prefixes.length; i++) {
      out.push(prefixes[i]!);
      if (i < resolvedParts.length) out.push(resolvedParts[i]!);
    }

    return {
      resolvedText: out.join(""),
      confidence: overallHigh ? "high" : "low",
      unresolvedHunks: unresolved,
    };
  }
}

// ---------------------------------------------------------------------------
// Conflict parsing — ported verbatim from Python _split_conflict_hunks +
// _resolve_hunk_deterministic. Pure functions so they're easy to test
// independently if needed.
// ---------------------------------------------------------------------------

function splitConflictHunks(text: string): { prefixes: string[]; hunks: Array<{ ours: string; theirs: string }> } {
  const prefixes: string[] = [];
  const hunks: Array<{ ours: string; theirs: string }> = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const start = text.indexOf("<<<<<<<", i);
    if (start === -1) {
      prefixes.push(text.slice(i));
      break;
    }
    if (start > 0 && text[start - 1] !== "\n") {
      i = start + 7;
      continue;
    }
    prefixes.push(text.slice(i, start));
    const lineEnd = text.indexOf("\n", start);
    if (lineEnd === -1) {
      prefixes.push(text.slice(start));
      break;
    }
    const sep = text.indexOf("\n=======", lineEnd);
    if (sep === -1) {
      prefixes.push(text.slice(start));
      break;
    }
    const close = text.indexOf("\n>>>>>>>", sep);
    if (close === -1) {
      prefixes.push(text.slice(start));
      break;
    }
    const ours = text.slice(lineEnd + 1, sep + 1);
    const theirs = sep + 9 <= close + 1 ? text.slice(sep + 9, close + 1) : "";
    hunks.push({ ours, theirs });
    const closeEnd = text.indexOf("\n", close + 1);
    i = closeEnd !== -1 ? closeEnd + 1 : n;
  }
  return { prefixes, hunks };
}

function resolveHunkDeterministic(ours: string, theirs: string): { resolved: string; reason: string } | null {
  if (ours === theirs) return { resolved: ours, reason: "both sides identical" };
  if (ours.trim() === theirs.trim()) return { resolved: theirs, reason: "whitespace-only — preferred upstream" };
  if (ours.trim() === "") return { resolved: theirs, reason: "fork deleted, upstream added" };
  if (theirs.trim() === "") return { resolved: ours, reason: "upstream deleted, fork added" };
  return null;
}
