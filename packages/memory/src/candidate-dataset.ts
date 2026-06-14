/**
 * Candidate dataset accumulator (s112 t385, G5).
 *
 * Reads EpisodicRecords where confidence >= threshold (default 0.75).
 * Passes each through the 4-gate evaluation pipeline. Records that pass
 * Gate 1 (data quality) and Gate 4 (rollback-safe) are appended to a
 * monthly JSONL file at <datasetDir>/candidates-YYYY-MM.jsonl.
 *
 * Format for each JSONL line:
 * {
 *   episode_id: string,
 *   hash: string,
 *   confidence: number,
 *   prime_alignment?: number,
 *   summary: string,
 *   tags: string[],
 *   provenance: {
 *     coa_fingerprint: string,
 *     model_version?: string,
 *     source_links: string[],
 *     timestamp: string
 *   }
 * }
 *
 * The full (prompt, response) training pair is not stored here in v0.4.0 —
 * the episodic summary serves as the teaching signal. The session-transcript
 * correlation that produces proper (prompt, response) pairs is a v0.5.0 slice.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { EpisodicRecord } from "./episodic.js";
import {
  gateDataQuality,
  gateReward,
  gateGovernance,
  gateRollback,
  type GateResult,
} from "./gates/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single line in the candidate JSONL file. */
export interface CandidateEntry {
  episode_id: string;
  hash: string;
  confidence: number;
  prime_alignment?: number;
  summary: string;
  tags: string[];
  provenance: {
    coa_fingerprint: string;
    model_version?: string;
    source_links: string[];
    timestamp: string;
  };
}

export interface AccumulatorOptions {
  /** Directory to write candidate JSONL files. Default: ~/.agi/datasets/ */
  datasetDir?: string;
  /** Confidence threshold to admit an episode. Default: 0.75 */
  confidenceThreshold?: number;
  /** Max past hashes to keep for novelty dedup. Default: 1000 */
  noveltyWindow?: number;
  /** If true, skip Gate 2 and Gate 3 (not yet wired stubs). Default: true */
  bypassUnwiredGates?: boolean;
}

export interface AccumulateResult {
  admitted: boolean;
  gates: {
    dataQuality: GateResult;
    reward: GateResult;
    governance: GateResult;
    rollback: GateResult;
  };
  entry?: CandidateEntry;
}

// ---------------------------------------------------------------------------
// CandidateDatasetAccumulator
// ---------------------------------------------------------------------------

export class CandidateDatasetAccumulator {
  private readonly datasetDir: string;
  private readonly confidenceThreshold: number;
  private readonly noveltyWindow: number;
  private readonly bypassUnwiredGates: boolean;
  /** Ring buffer of seen hashes for novelty dedup. */
  private readonly seenHashes: string[] = [];

  constructor(opts: AccumulatorOptions = {}) {
    this.datasetDir = opts.datasetDir ?? join(homedir(), ".agi", "datasets");
    this.confidenceThreshold = opts.confidenceThreshold ?? 0.75;
    this.noveltyWindow = opts.noveltyWindow ?? 1000;
    this.bypassUnwiredGates = opts.bypassUnwiredGates ?? true;
  }

  /**
   * Evaluate an EpisodicRecord through the 4-gate pipeline and, if admitted,
   * append it to this month's candidates file.
   *
   * Returns the per-gate results whether admitted or not — useful for
   * debugging why a record was rejected.
   */
  accumulate(record: EpisodicRecord): AccumulateResult {
    if (record.confidence < this.confidenceThreshold) {
      return {
        admitted: false,
        gates: {
          dataQuality: { pass: false, reason: `confidence ${record.confidence.toFixed(2)} < threshold ${this.confidenceThreshold.toFixed(2)}` },
          reward: { pass: false, reason: "skipped — data quality failed" },
          governance: { pass: false, reason: "skipped — data quality failed" },
          rollback: { pass: false, reason: "skipped — data quality failed" },
        },
      };
    }

    const dq = gateDataQuality(record, this.seenHashes);
    if (!dq.pass) {
      return { admitted: false, gates: { dataQuality: dq, reward: { pass: false, reason: "skipped" }, governance: { pass: false, reason: "skipped" }, rollback: { pass: false, reason: "skipped" } } };
    }

    const reward = this.bypassUnwiredGates ? gateReward(record) : gateReward(record);
    const governance = this.bypassUnwiredGates ? gateGovernance(record) : gateGovernance(record);
    const rollback = gateRollback(record);

    const allPass = dq.pass && (this.bypassUnwiredGates || (reward.pass && governance.pass)) && rollback.pass;
    if (!allPass) {
      return { admitted: false, gates: { dataQuality: dq, reward, governance, rollback } };
    }

    // Admit: add to novelty window and write JSONL
    this._addToNoveltyWindow(record.hash);
    const entry = this._toEntry(record);
    this._append(entry);

    return { admitted: true, gates: { dataQuality: dq, reward, governance, rollback }, entry };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private _addToNoveltyWindow(hash: string): void {
    this.seenHashes.push(hash);
    if (this.seenHashes.length > this.noveltyWindow) {
      this.seenHashes.splice(0, this.seenHashes.length - this.noveltyWindow);
    }
  }

  private _toEntry(record: EpisodicRecord): CandidateEntry {
    return {
      episode_id: record.id,
      hash: record.hash,
      confidence: record.confidence,
      prime_alignment: record.primeAlignment,
      summary: record.summary,
      tags: record.tags,
      provenance: {
        coa_fingerprint: record.coaFingerprint,
        model_version: record.modelVersion,
        source_links: record.sourceLinks,
        timestamp: record.timestamp,
      },
    };
  }

  private _append(entry: CandidateEntry): void {
    try {
      if (!existsSync(this.datasetDir)) {
        mkdirSync(this.datasetDir, { recursive: true });
      }
      const month = new Date().toISOString().slice(0, 7); // "YYYY-MM"
      const file = join(this.datasetDir, `candidates-${month}.jsonl`);
      appendFileSync(file, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      // Non-fatal — log silently (accumulator failure must not surface to user)
    }
  }

  /** Load seen hashes from an existing candidates file for dedup continuity. */
  loadSeenHashes(file?: string): void {
    const month = new Date().toISOString().slice(0, 7);
    const target = file ?? join(this.datasetDir, `candidates-${month}.jsonl`);
    if (!existsSync(target)) return;
    try {
      const lines = readFileSync(target, "utf-8").split("\n").filter((l) => l.trim());
      for (const line of lines.slice(-this.noveltyWindow)) {
        try {
          const e = JSON.parse(line) as Partial<CandidateEntry>;
          if (typeof e.hash === "string") this.seenHashes.push(e.hash);
        } catch { /* skip malformed lines */ }
      }
    } catch { /* file unreadable */ }
  }
}
