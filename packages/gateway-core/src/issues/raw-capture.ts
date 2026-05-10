/**
 * Raw-tier issue capture (Wish #21 Slice 5).
 *
 * Auto-capture sink for tool-call failures + similar agent-side
 * exceptions. Lives at `<projectPath>/k/issues/raw.jsonl` (append-only)
 * to keep disk growth bounded — full Markdown issue files are reserved
 * for the curated tier.
 *
 * Workflow:
 *   1. Tool dispatcher (or any caller) records a failure via
 *      `recordRawCapture()`.
 *   2. Capture lives in raw.jsonl; doesn't appear in the curated
 *      `index.json`.
 *   3. Agent (or owner) reviews via `listRawCaptures()`.
 *   4. Agent promotes interesting captures via `promoteRawCapture()`,
 *      which calls `logIssue()` against the curated store and removes
 *      the entry from raw.jsonl.
 *
 * The raw tier intentionally has NO dedup — every error gets logged.
 * Dedup happens at promotion time via `logIssue`'s symptom-hash. This
 * matches the design from CLAUDE.md § 4 Pattern Substrate: capture
 * everything richly, distill later.
 *
 * Disk-growth safeguard: raw.jsonl is opportunistically truncated when
 * it crosses RAW_LOG_MAX_BYTES — we keep the most recent half. Truly
 * paranoid operators can add a cron rotate or wire the bash-policy log
 * rotation pattern (sibling concept).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { issuesDir, logIssue } from "./store.js";
import type { LogIssueResult } from "./types.js";

export interface RawCaptureEntry {
  /** Stable id within the raw log (timestamp + sequence — idiomatic JSONL key). */
  id: string;
  /** ISO-8601 timestamp of capture. */
  ts: string;
  /** Tool / surface that failed (`fetch`, `taskmaster`, `agent-invoker`, etc.). */
  source: string;
  /** Single-line summary of the failure. */
  summary: string;
  /** Optional structured details — exit code, error class, etc. */
  details?: Record<string, unknown>;
}

const RAW_LOG_FILENAME = "raw.jsonl";
const RAW_LOG_MAX_BYTES = 5 * 1024 * 1024; // 5 MB before opportunistic truncation

let rawCaptureSeq = 0;

export function rawCapturePath(projectPath: string): string {
  return join(issuesDir(projectPath), RAW_LOG_FILENAME);
}

function ensureIssuesDir(projectPath: string): void {
  const dir = issuesDir(projectPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function generateId(now: Date = new Date()): string {
  rawCaptureSeq = (rawCaptureSeq + 1) % 100000;
  return `r-${now.getTime().toString(36)}-${rawCaptureSeq.toString(36).padStart(3, "0")}`;
}

/**
 * Append a raw capture. Cheap (single fs append). Never throws — raw
 * capture is a side-channel; failure to record shouldn't propagate
 * back to the caller.
 */
export function recordRawCapture(
  projectPath: string,
  partial: Omit<RawCaptureEntry, "id" | "ts"> & Partial<Pick<RawCaptureEntry, "id" | "ts">>,
  now: Date = new Date(),
): RawCaptureEntry {
  const entry: RawCaptureEntry = {
    id: partial.id ?? generateId(now),
    ts: partial.ts ?? now.toISOString(),
    source: partial.source,
    summary: partial.summary,
    details: partial.details,
  };
  try {
    ensureIssuesDir(projectPath);
    appendFileSync(rawCapturePath(projectPath), JSON.stringify(entry) + "\n", "utf-8");
    truncateIfExcessive(projectPath);
  } catch {
    // Side-channel — swallow errors; capture failure must not leak.
  }
  return entry;
}

/** Read all raw captures (most-recent-last per JSONL append order). */
export function listRawCaptures(projectPath: string): RawCaptureEntry[] {
  const path = rawCapturePath(projectPath);
  if (!existsSync(path)) return [];
  const entries: RawCaptureEntry[] = [];
  try {
    const raw = readFileSync(path, "utf-8");
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (parsed && typeof parsed === "object") {
          entries.push(parsed as RawCaptureEntry);
        }
      } catch {
        // skip malformed line
      }
    }
  } catch {
    // unreadable — treat as empty
  }
  return entries;
}

/**
 * Promote a single raw capture to a curated issue. Writes to the
 * Markdown registry via `logIssue` (which auto-dedups via
 * symptom-hash) AND removes the entry from raw.jsonl by rewriting the
 * file without that line. Returns the LogIssueResult.
 *
 * If the raw id isn't found, returns null without touching disk.
 */
export function promoteRawCapture(
  projectPath: string,
  rawId: string,
  override?: { title?: string; tags?: string[] },
): LogIssueResult | null {
  const all = listRawCaptures(projectPath);
  const match = all.find((e) => e.id === rawId);
  if (!match) return null;

  const title = override?.title ?? `Auto-captured: ${match.summary}`;
  const tags = override?.tags ?? ["auto-captured", match.source];
  const detailsBlob = match.details ? `\n\n## Details\n\n\`\`\`json\n${JSON.stringify(match.details, null, 2)}\n\`\`\`\n` : "";
  const result = logIssue(projectPath, {
    title,
    symptom: `${match.source}: ${match.summary}`,
    tool: match.source,
    tags,
    body: `## Symptom\n\n${match.summary}\n\n## Context\n\n- source: \`${match.source}\`\n- captured: ${match.ts}${detailsBlob}\n\n## Investigation log\n\n- ${new Date().toISOString()} — promoted from raw capture ${rawId}.\n\n## Resolution\n\n_(filled when status flips to \`fixed\`)_\n`,
    agent: "raw-promotion",
  });

  // Remove the promoted entry from raw.jsonl
  const remaining = all.filter((e) => e.id !== rawId);
  rewriteRawLog(projectPath, remaining);
  return result;
}

/** Remove all raw captures (operator reset). Returns count cleared. */
export function clearRawCaptures(projectPath: string): number {
  const all = listRawCaptures(projectPath);
  rewriteRawLog(projectPath, []);
  return all.length;
}

function rewriteRawLog(projectPath: string, entries: RawCaptureEntry[]): void {
  const path = rawCapturePath(projectPath);
  if (entries.length === 0) {
    try {
      writeFileSync(path, "", "utf-8");
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
  } catch {
    /* ignore */
  }
}

/**
 * Opportunistic truncation: if raw.jsonl exceeds the configured cap,
 * keep the most recent half. Cheap heuristic — operators who need
 * stricter rotation should swap in their own.
 */
function truncateIfExcessive(projectPath: string): void {
  const path = rawCapturePath(projectPath);
  if (!existsSync(path)) return;
  try {
    const stat = statSync(path);
    if (stat.size <= RAW_LOG_MAX_BYTES) return;
    const all = listRawCaptures(projectPath);
    const keep = all.slice(Math.floor(all.length / 2));
    rewriteRawLog(projectPath, keep);
  } catch {
    /* ignore */
  }
}

/**
 * Test-only helper to reset the in-process sequence counter so tests
 * produce deterministic ids when paired with a frozen `Date`.
 */
export function _resetRawCaptureSeqForTest(): void {
  rawCaptureSeq = 0;
}
