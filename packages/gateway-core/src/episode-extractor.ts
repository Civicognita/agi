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

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ulid } from "ulid";

import type { LLMProvider } from "./llm/index.js";
import type { EpisodicRecord } from "@agi/memory";
import { canonicalEpisodicHash, NoopAnchor, episodicToAnchor } from "@agi/memory";
import type { CandidateDatasetAccumulator } from "@agi/memory";
import type { AlignmentScorer } from "./prime-alignment-scorer.js";
import type { ComponentLogger } from "./logger.js";

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
  consolidationEngine?: { maybeConsolidate(opts: { entityId: string; projectPath?: string | null; trigger: "session_close" | "job_complete" | "idle" }): Promise<unknown> };
  logger?: ComponentLogger;
  /** Timeout for the full extract+score+store cycle, ms. Default 45_000. */
  timeoutMs?: number;
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
}

// ---------------------------------------------------------------------------
// Prompt loading
// ---------------------------------------------------------------------------

const _promptsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../prompts");

function _loadPrompt(name: string): string {
  try {
    return readFileSync(join(_promptsDir, name), "utf-8");
  } catch {
    return "";
  }
}

const EXTRACT_PROMPT = _loadPrompt("episode-extract.md");
const SCORE_PROMPT = _loadPrompt("episode-score.md");

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
  private readonly anchor = new NoopAnchor();

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
      if (!extracted || !extracted.summary) return null; // not noteworthy

      // Step 2: Score quality
      const scored = await this._score(extracted, input.toolsUsed, deadline);

      const timestamp = new Date().toISOString();
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

      this.logger?.debug(
        `episode extracted: ${record.id} conf=${record.confidence.toFixed(2)} tags=[${record.tags.join(",")}]`,
      );

      // Step 8: Trigger consolidation at session boundary (non-blocking)
      if (this.consolidationEngine) {
        void this.consolidationEngine
          .maybeConsolidate({
            entityId: this.entityId,
            projectPath: input.projectPath ?? null,
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
    if (!EXTRACT_PROMPT || Date.now() >= deadline) return null;

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
    } catch {
      return null;
    }

    return _parseExtractResult(raw);
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
