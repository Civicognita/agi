/**
 * Symptom-hash — Wish #21 Slice 1 dedup key.
 *
 * Deterministic hash of a normalized failure signature. Two failures
 * collapse onto the same issue when their `(symptom, tool, exit_code)`
 * tuple normalizes identically.
 *
 * Normalization aggressively strips noise that wouldn't matter for a
 * "have I seen this before?" lookup:
 *   - timestamps          (any `\d{4}-\d{2}-\d{2}T...` or unix epoch)
 *   - absolute paths      (replaced with `<path>`)
 *   - numeric IDs         (`/\b\d{4,}\b/` → `<n>`)
 *   - temp dirs           (`/tmp/<rand>/...` → `<tmp>/...`)
 *   - whitespace          (collapsed)
 *   - case                (lowercased)
 *
 * The algorithm is intentionally simple — false collisions are rare for
 * curated issue logging and far cheaper to fix manually than running an
 * embedding pipeline (deferred to a future slice if symptom-hash proves
 * insufficient).
 */

import { createHash } from "node:crypto";

/**
 * Strip noise from raw symptom text so equivalent failures produce the
 * same canonical form.
 */
export function normalizeSymptom(raw: string): string {
  return raw
    // Unix epoch (ms or s) inside brackets/parens or bare
    .replace(/\b\d{10,13}\b/g, "<ts>")
    // ISO timestamps
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, "<iso>")
    // Common temp-dir patterns first (before generic absolute path)
    .replace(/\/tmp\/[A-Za-z0-9._-]+/g, "<tmp>")
    .replace(/\/var\/tmp\/[A-Za-z0-9._-]+/g, "<tmp>")
    // Absolute paths (Linux / macOS) — match anything starting with /
    // followed by a non-space sequence of chars.
    .replace(/(^|\s)\/[A-Za-z0-9._/-]+/g, "$1<path>")
    // Long numeric IDs (4+ digits)
    .replace(/\b\d{4,}\b/g, "<n>")
    // Hex hashes (8+ hex chars)
    .replace(/\b[a-f0-9]{8,}\b/g, "<hash>")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Compose the dedup key from the three identifying fields.
 * `tool` and `exit_code` are optional — missing fields render as the
 * literal string `none` so the hash is still well-defined.
 */
export function hashSymptom(symptom: string, tool?: string, exitCode?: number): string {
  const normalized = normalizeSymptom(symptom);
  const toolPart = tool?.trim().toLowerCase() ?? "none";
  const exitPart = typeof exitCode === "number" ? String(exitCode) : "none";
  const key = `${normalized}::${toolPart}::${exitPart}`;
  return createHash("sha1").update(key, "utf8").digest("hex");
}
