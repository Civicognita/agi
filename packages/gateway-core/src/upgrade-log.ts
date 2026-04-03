/**
 * Upgrade Log — NDJSON persistence for upgrade events.
 *
 * Each upgrade event is appended as a single JSON line to ~/.agi/upgrade-log.json.
 * This survives server restarts so the dashboard can recover logs after reload.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export interface UpgradeLogEntry {
  phase: string;
  message: string;
  step?: string;
  status?: string;
  timestamp: string;
}

const LOG_PATH = join(homedir(), ".agi", "upgrade-log.json");

function ensureDir(): void {
  const dir = dirname(LOG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Append a single upgrade event as an NDJSON line. */
export function appendUpgradeLog(entry: UpgradeLogEntry): void {
  ensureDir();
  appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
}

/** Read all persisted upgrade log entries. */
export function getUpgradeLog(): UpgradeLogEntry[] {
  if (!existsSync(LOG_PATH)) return [];
  const content = readFileSync(LOG_PATH, "utf-8").trim();
  if (!content) return [];
  const entries: UpgradeLogEntry[] = [];
  for (const line of content.split("\n")) {
    try {
      entries.push(JSON.parse(line) as UpgradeLogEntry);
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

/** Clear the upgrade log (called at the start of each new upgrade). */
export function clearUpgradeLog(): void {
  ensureDir();
  writeFileSync(LOG_PATH, "");
}
