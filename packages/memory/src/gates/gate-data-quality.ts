/**
 * Gate 1 — Data Quality (s112 t385, G5).
 *
 * Fully wired in v0.4.0. Three checks:
 *   1. Coherence — summary is non-empty, no raw error tokens
 *   2. Doctrine alignment — primeAlignment >= 0.75 when present
 *   3. Novelty — hash not seen in the last N records
 */

import type { EpisodicRecord } from "../episodic.js";
import type { GateResult } from "./index.js";

const ERROR_TOKENS = [
  "error:", "traceback", "exception:", "stack trace", "undefined is not",
  "cannot read properties", "is not a function", "syntaxerror",
];

export function gateDataQuality(record: EpisodicRecord, seenHashes: string[]): GateResult {
  // Check 1: coherence
  if (!record.summary || record.summary.trim().length < 10) {
    return { pass: false, reason: "coherence: summary is empty or too short" };
  }
  const summaryLower = record.summary.toLowerCase();
  for (const token of ERROR_TOKENS) {
    if (summaryLower.includes(token)) {
      return { pass: false, reason: `coherence: summary contains error token "${token}"` };
    }
  }

  // Check 2: doctrine alignment (optional — only applied when primeAlignment is set)
  if (record.primeAlignment !== undefined && record.primeAlignment < 0.75) {
    return {
      pass: false,
      reason: `doctrine: primeAlignment ${record.primeAlignment.toFixed(2)} < 0.75`,
    };
  }

  // Check 3: novelty
  if (seenHashes.includes(record.hash)) {
    return { pass: false, reason: "novelty: duplicate hash already in dataset" };
  }

  return { pass: true };
}
