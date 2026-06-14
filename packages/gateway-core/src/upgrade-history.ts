/**
 * upgrade-history.ts — persistent record of every upgrade attempt.
 *
 * Appends to ~/.agi/upgrade-history.ndjson (NDJSON, one entry per line).
 * Each entry captures: when, from/to version, source, outcome, steps, error,
 * and an optional resolution note the user can add after fixing a failure.
 *
 * This file is separate from upgrade-log.ts (which tracks the current/last
 * upgrade in real-time) — history is the durable audit record.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HISTORY_FILE = join(homedir(), ".agi", "upgrade-history.ndjson");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpgradeHistoryEntry {
  /** Unique ID (ISO timestamp + random suffix) */
  id: string;
  /** ISO timestamp when the upgrade started */
  startedAt: string;
  /** ISO timestamp when it completed/failed */
  completedAt: string;
  /** Version before this upgrade */
  fromVersion: string;
  /** Version after this upgrade (may equal fromVersion on failure) */
  toVersion: string;
  /** Git ref that was merged (e.g. "upstream/main") */
  source: string | null;
  /** Whether the upgrade completed successfully */
  success: boolean;
  /** The step where failure occurred (if any) */
  failedAtStep: string | null;
  /** Error message from the failing step */
  errorMessage: string | null;
  /** Resolution note — set by user/agent after a failure is fixed */
  resolutionNote: string | null;
  /** Phase log entries from upgrade.sh */
  log: Array<{ phase: string; step: string; status: string; message: string; timestamp: string }>;
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

export function readUpgradeHistory(): UpgradeHistoryEntry[] {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    return readFileSync(HISTORY_FILE, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as UpgradeHistoryEntry)
      .reverse(); // newest first
  } catch {
    return [];
  }
}

export function appendUpgradeHistory(entry: UpgradeHistoryEntry): void {
  try {
    appendFileSync(HISTORY_FILE, JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* best-effort — upgrade must not fail because of history write */ }
}

export function addResolutionNote(id: string, note: string): boolean {
  if (!existsSync(HISTORY_FILE)) return false;
  try {
    const lines = readFileSync(HISTORY_FILE, "utf-8").split("\n").filter(Boolean);
    let found = false;
    const updated = lines.map((line) => {
      const entry = JSON.parse(line) as UpgradeHistoryEntry;
      if (entry.id === id) {
        found = true;
        return JSON.stringify({ ...entry, resolutionNote: note });
      }
      return line;
    });
    if (found) {
      writeFileSync(HISTORY_FILE, updated.join("\n") + "\n", "utf-8");
    }
    return found;
  } catch {
    return false;
  }
}

/** Generate a unique upgrade history entry ID */
export function generateHistoryId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 7);
}
