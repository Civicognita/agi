/**
 * EpisodeExtractor — fire-and-forget episodic memory pipeline (s112 t384).
 *
 * At the end of every successful chat invocation, the agent-invoker calls
 * extractAndStore() asynchronously (non-blocking). This file handles steps
 * 1–4 of the draft-a memory loop:
 *   1. Trigger — post-response, async
 *   2. Extraction — short summarize() call → {summary, decisions, preferences, facts, tags}
 *   3. Scoring — second summarize() call → {useful, aligned, correct, confidence}
 *   4. Write path — writes EpisodicRecord + NoopAnchor + memoryAdapter.store()
 *
 * Step 5 (primeAlignment via AlignmentScorer / G2) is optional: if an
 * alignmentScorer is configured it runs after step 3 and populates
 * EpisodicRecord.primeAlignment.
 *
 * Cost discipline: scoring always uses the same LLMProvider supplied to this
 * class (see wiring in agent-invoker.ts). Future iteration: route to a
 * local-only provider when costMode=balanced/max to enforce "scoring is
 * always cheap and local."
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ulid } from "ulid";

import type { LLMProvider } from "./llm/index.js";
import type { EpisodicRecord } from "@agi/memory";
import { canonicalEpisodicHash, NoopAnchor, episodicToAnchor } from "@agi/memory";
import type { CandidateDatasetAccumulator } from "@agi/memory";
import type { AlignmentScorer } from "./prime-alignment-scorer.js";
import type { ComponentLogger } from "./logger.js";
import { resolveWriteScopeWithPolicy, type CascadePolicy } from "./memory-scope.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EpisodeExtractorOptions {
  /** LLM provider for summarize() calls. */
  provider: LLMProvider;
  /** Memory adapter write path. */
  memoryAdapter: { store(entry: unknown): Promise<void> };
  /** Entity performing this episode (e.g. "$A0"). */
  entityId: string;
  /** Short COA alias for the actor (e.g. "$A0", "#E0.#O0.$A0"). */
  coaAlias: string;
  /** Optional PRIME alignment scorer. If absent, primeAlignment stays undefined. */
  alignmentScorer?: AlignmentScorer;
  /** Optional dataset accumulator. Runs 4-gate pipeline on each stored record. */
  accumulator?: CandidateDatasetAccumulator;
  /** Optional consolidation engine — triggered at session boundaries. */
  consolidationEngine?: { maybeConsolidate(opts: { entityId: string; projectPath?: string | null; scope?: string | null; trigger: "session_close" | "job_complete" | "idle" }): Promise<unknown> };
  logger?: ComponentLogger;
  /** Timeout for the full extract+score+store cycle, ms. Default 45_000. */
  timeoutMs?: number;
  /** s234 — live reader for the owner cascade-up policy (gateway.json memory.cascade). Hot. */
  getCascadePolicy?: () => CascadePolicy | undefined;
}

export interface ExtractionInput {
  userMessage: string;
  assistantResponse: string;
  toolsUsed: string[];
  model: string;
  coaFingerprint: string;
  sessionKey: string;
  /** Project path for project-scoped memory tagging (optional). */
  projectPath?: string | null;
  /** s234 — channel adapter id (e.g. "discord") when the turn came from a channel. */
  channelId?: string | null;
  /** s234 — room/thread id within the channel. With channelId, scopes the memory to that room. */
  roomId?: string | null;
}

// ---------------------------------------------------------------------------
// Prompt loading
// ---------------------------------------------------------------------------

/**
 * Resolve the prompts/ dir robustly. The relative depth from import.meta.url is
 * NOT constant: this module is bundled into BOTH packages/gateway-core/dist/
 * index.js (repo-root + 3) AND cli/dist/index.js (repo-root + 2) — and the
 * gateway actually runs the cli bundle. A fixed "../../../prompts" overshoots for
 * the cli bundle (lands on /mnt/prompts), the readFileSync throws, _loadPrompt
 * swallows it to "", and episodic memory records 0 rows forever. Walk up from the
 * module location until prompts/episode-extract.md is found instead.
 */
function _resolvePromptsDir(): string {
  const start = dirname(fileURLToPath(import.meta.url));
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "prompts");
    if (existsSync(join(candidate, "episode-extract.md"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  // Legacy fallback (gateway-core/dist depth) if the walk somehow fails.
  return join(start, "../../../prompts");
}

const _promptsDir = _resolvePromptsDir();

function _loadPrompt(name: string): string {
  try {
    return readFileSync(join(_promptsDir, name), "utf-8");
  } catch {
    return "";
  }
}

const EXTRACT_PROMPT = _loadPrompt("episode-extract.md");
const SCORE_PROMPT = _loadPrompt("episode-score.md");

/**
 * Test/diagnostic hook: true when both episodic prompts resolved + loaded. Guards
 * against the prompt files going missing or the prompts-dir resolver breaking
 * (the bug that left episodic memory empty). The boot-time DEGRADED warning is
 * the runtime catch for the bundled-artifact case.
 */
export function episodicPromptsLoaded(): boolean {
  return EXTRACT_PROMPT.length > 0 && SCORE_PROMPT.length > 0;
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export class EpisodeExtractor {
  private readonly provider: LLMProvider;
  private readonly memoryAdapter: { store(entry: unknown): Promise<void> };
  private readonly entityId: string;
  private readonly coaAlias: string;
  private readonly alignmentScorer?: AlignmentScorer;
  private readonly accumulator?: CandidateDatasetAccumulator;
  private readonly consolidationEngine?: EpisodeExtractorOptions["consolidationEngine"];
  private readonly logger?: ComponentLogger;
  private readonly timeoutMs: number;
  private readonly getCascadePolicy?: () => CascadePolicy | undefined;
  private readonly anchor = new NoopAnchor();
  // Running tallies so a 100%-failing capture layer is visible in logs instead
  // of silently writing 0 rows forever. The whole pipeline is fire-and-forget,
  // so without this a swallowed summarize() error rots undetected (the bug that
  // left memory_events empty: "Aion says it has memories but can't search them").
  private storedCount = 0;
  private skippedCount = 0;

  constructor(opts: EpisodeExtractorOptions) {
    this.provider = opts.provider;
    this.memoryAdapter = opts.memoryAdapter;
    this.entityId = opts.entityId;
    this.coaAlias = opts.coaAlias;
    this.alignmentScorer = opts.alignmentScorer;
    this.accumulator = opts.accumulator;
    this.consolidationEngine = opts.consolidationEngine;
    this.logger = opts.logger;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.getCascadePolicy = opts.getCascadePolicy;
    // Boot-time loud failure: if the prompts didn't load, episodic memory can
    // NEVER record (every _extract returns null). Surface it once, loudly.
    if (!EXTRACT_PROMPT || !SCORE_PROMPT) {
      this.logger?.warn(
        `episodic memory DEGRADED: ${!EXTRACT_PROMPT ? "episode-extract.md" : "episode-score.md"} prompt not loaded — no episodes will be recorded`,
      );
    }
  }

  /**
   * Extract, score, and store an episode. Returns the stored EpisodicRecord on
   * success, or null if the exchange was not noteworthy or an error occurred.
   *
   * This method must be called with `void` — it must never block the caller's
   * response path.
   */
  async extractAndStore(input: ExtractionInput): Promise<EpisodicRecord | null> {
    const deadline = Date.now() + this.timeoutMs;

    try {
      // Step 1: Extract episode content
      const extracted = await this._extract(input, deadline);
      if (!extracted || !extracted.summary) {
        // _extract logged the SPECIFIC reason (prompt missing / summarize threw /
        // unparseable / not noteworthy). Keep a running tally so a persistently
        // empty memory_events table is diagnosable from logs alone.
        this.skippedCount++;
        this.logger?.debug(`episode not stored (stored=${this.storedCount} skipped=${this.skippedCount})`);
        return null;
      }

      // Step 2: Score quality
      const scored = await this._score(extracted, input.toolsUsed, deadline);

      const timestamp = new Date().toISOString();
      // s234 — locality scope from the turn's channel/project context. Channel
      // turns confine to room:<channelId>:<roomId>; otherwise project, else gestalt.
      // The owner cascade-up policy (read live, hot) may promote it to a broader scope.
      const scope = resolveWriteScopeWithPolicy(
        { channelId: input.channelId, roomId: input.roomId, projectPath: input.projectPath },
        this.getCascadePolicy?.(),
      );
      const recordBase = {
        id: ulid(),
        timestamp,
        actor: { entityId: this.entityId, coaAlias: this.coaAlias },
        summary: extracted.summary,
        tags: extracted.tags,
        confidence: scored.confidence,
        sourceLinks: [input.sessionKey, `model:${input.model}`],
        coaFingerprint: input.coaFingerprint,
        modelVersion: input.model,
        // projectPath is carried through for graph-adapter project-scoped storage
        projectPath: input.projectPath ?? null,
        scope,
      };

      // Step 3: Compute canonical hash (includes all stable fields)
      const hash = canonicalEpisodicHash(recordBase);
      const record: EpisodicRecord = { ...recordBase, hash };

      // Step 4: Optional primeAlignment score
      if (this.alignmentScorer && Date.now() < deadline - 5000) {
        try {
          record.primeAlignment = await this.alignmentScorer.scoreEpisode(record);
        } catch {
          // Alignment scoring is best-effort — don't fail the episode
        }
      }

      // Step 5: Anchor (NoopAnchor in v0.4.0)
      try {
        await this.anchor.anchor(episodicToAnchor(record));
      } catch {
        // Anchor failure is non-fatal
      }

      // Step 6: Persist
      await this.memoryAdapter.store(record);

      // Step 7: Gate + accumulate for training dataset (non-blocking, best-effort)
      if (this.accumulator) {
        try {
          const result = this.accumulator.accumulate(record);
          if (!result.admitted) {
            this.logger?.debug(`episode gated out by accumulator`);
          }
        } catch {
          // Accumulator failure must never block or surface to callers
        }
      }

      // First successful store is logged at INFO so "episodic memory is alive"
      // is visible without debug logging; subsequent stores stay at debug.
      this.storedCount++;
      this.logger?.[this.storedCount === 1 ? "info" : "debug"](
        `episode stored: ${record.id} conf=${record.confidence.toFixed(2)} tags=[${record.tags.join(",")}] (stored=${this.storedCount})`,
      );

      // Step 8: Trigger consolidation at session boundary (non-blocking)
      if (this.consolidationEngine) {
        void this.consolidationEngine
          .maybeConsolidate({
            entityId: this.entityId,
            projectPath: input.projectPath ?? null,
            scope,
            trigger: "session_close",
          })
          .catch(() => { /* consolidation failure is non-fatal */ });
      }

      return record;
    } catch (err) {
      this.logger?.warn(
        `episode extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async _extract(
    input: ExtractionInput,
    deadline: number,
  ): Promise<ExtractResult | null> {
    // EXTRACT_PROMPT absence is already warned once at construction; don't spam.
    if (!EXTRACT_PROMPT) return null;
    if (Date.now() >= deadline) {
      this.logger?.warn("episode extract: deadline exceeded before the summarize() call");
      return null;
    }

    const exchangeText = [
      `User: ${input.userMessage.slice(0, 1200)}`,
      `Tools used: ${input.toolsUsed.length > 0 ? input.toolsUsed.join(", ") : "none"}`,
      `Assistant: ${input.assistantResponse.slice(0, 2000)}`,
    ].join("\n\n");

    const remaining = deadline - Date.now();
    let raw: string;
    try {
      raw = await Promise.race([
        this.provider.summarize(exchangeText, EXTRACT_PROMPT),
        new Promise<never>((_, r) =>
          setTimeout(() => r(new Error("extract timeout")), Math.min(remaining, 20_000)),
        ),
      ]);
    } catch (err) {
      // The single most common silent-failure cause: the economy summarize()
      // model is unavailable/erroring. Surface it instead of swallowing.
      this.logger?.warn(
        `episode extract: summarize() failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    const parsed = _parseExtractResult(raw);
    if (parsed === null) {
      // Debug, not warn: an empty {summary} legitimately means "not noteworthy"
      // (the extract prompt returns no summary for trivial exchanges), so this is
      // not necessarily a failure. summarize()-throw and prompt-missing above ARE
      // failures and stay at warn.
      this.logger?.debug(
        `episode extract: no summary returned (${raw.length} chars) — not noteworthy or unparseable`,
      );
    }
    return parsed;
  }

  private async _score(
    extracted: ExtractResult,
    toolsUsed: string[],
    deadline: number,
  ): Promise<ScoreResult> {
    if (!SCORE_PROMPT || Date.now() >= deadline) return _defaultScore();

    const scoreText = [
      `Summary: ${extracted.summary}`,
      `Tools used: ${toolsUsed.length > 0 ? toolsUsed.join(", ") : "none"}`,
      `Tags: ${extracted.tags.join(", ") || "none"}`,
    ].join("\n");

    const remaining = deadline - Date.now();
    let raw: string;
    try {
      raw = await Promise.race([
        this.provider.summarize(scoreText, SCORE_PROMPT),
        new Promise<never>((_, r) =>
          setTimeout(() => r(new Error("score timeout")), Math.min(remaining, 15_000)),
        ),
      ]);
    } catch {
      return _defaultScore();
    }

    return _parseScoreResult(raw);
  }
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

interface ExtractResult {
  summary: string;
  decisions: string[];
  preferences: string[];
  facts: string[];
  tags: string[];
}

interface ScoreResult {
  useful: number;
  aligned: number;
  correct: number;
  confidence: number;
}

function _parseExtractResult(raw: string): ExtractResult | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]) as Partial<ExtractResult>;
    const summary = typeof p.summary === "string" ? p.summary.trim() : "";
    if (!summary) return null; // nothing noteworthy
    return {
      summary,
      decisions: Array.isArray(p.decisions) ? p.decisions.slice(0, 3).map(String) : [],
      preferences: Array.isArray(p.preferences) ? p.preferences.slice(0, 3).map(String) : [],
      facts: Array.isArray(p.facts) ? p.facts.slice(0, 3).map(String) : [],
      tags: Array.isArray(p.tags) ? p.tags.slice(0, 4).map(String) : [],
    };
  } catch {
    return null;
  }
}

function _parseScoreResult(raw: string): ScoreResult {
  try {
    const m = raw.match(/\{[\s\S]*?\}/);
    if (!m) return _defaultScore();
    const p = JSON.parse(m[0]) as Partial<Record<string, unknown>>;
    const useful = _clamp(Number(p.useful));
    const aligned = _clamp(Number(p.aligned));
    const correct = _clamp(Number(p.correct));
    const confidence = _clamp((useful + aligned + correct) / 3);
    return { useful, aligned, correct, confidence };
  } catch {
    return _defaultScore();
  }
}

function _defaultScore(): ScoreResult {
  return { useful: 0.5, aligned: 0.8, correct: 0.8, confidence: 0.7 };
}

function _clamp(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
