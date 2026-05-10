/**
 * Sync queue + conflict log — s155 t672 Phase 1.
 *
 * Storage primitives for the layered-write retry queue + soft-conflict
 * surfacing per the ADR at
 * `agi/docs/agents/adr-layered-pm-conflict-resolution.md` (s155 t669).
 *
 * **Phase 1 scope (this slice):**
 * - `~/.agi/sync-queue.jsonl` — append-only log of writes that need to
 *   reach the primary PM provider when it's reachable again. Drained
 *   on successful primary write.
 * - `~/.agi/sync-conflicts.jsonl` — append-only log of soft conflicts
 *   detected when reading back from primary. Owner triages via the
 *   dashboard PM-Lite panel (a later phase).
 *
 * **NOT in this phase:**
 * - LayeredPmProvider.write() integration — risks hot-path regression;
 *   lands in Phase 2 with explicit feature flag.
 * - Per-field timestamps in TynnLite schema — Phase 3.
 * - Read-back diff routine — Phase 4.
 * - /api/pm/conflicts REST + dashboard — Phase 5.
 * - Background primary-refresh worker — Phase 6.
 *
 * Same side-channel discipline as raw-capture (Wish #21 Slice 5):
 * helpers never throw. Failure to record a sync entry must NOT cascade
 * back into the write path.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Single retry-queue entry — one pending write to be replayed against primary. */
export interface SyncQueueEntry {
  /** Stable id within the queue (timestamp + sequence). */
  id: string;
  /** ISO-8601 timestamp at enqueue. */
  ts: string;
  /** Method on PmProvider that needs to be replayed (e.g. "setTaskStatus"). */
  method: string;
  /** Arguments captured at enqueue time. JSON-serializable. */
  args: unknown[];
  /** Project this write was scoped to (for filtering during replay). */
  projectPath: string;
  /** Optional reason the primary write failed at enqueue (for debugging). */
  failureReason?: string;
  /** Replay attempt count — bumps on each failed retry. */
  attempts: number;
}

/** Single soft-conflict entry — divergence detected on primary read-back. */
export interface SyncConflictEntry {
  /** Stable id within the conflict log. */
  id: string;
  /** ISO-8601 timestamp when the conflict was detected. */
  ts: string;
  /** Project the conflict was detected in. */
  projectPath: string;
  /** Tynn entity type (story/task/version). */
  entityType: string;
  /** Tynn entity id. */
  entityId: string;
  /** Field that diverged (e.g. "title", "status"). */
  field: string;
  /** Value seen on primary at read-back. */
  primaryValue: unknown;
  /** Value held in TynnLite (the "floor"). */
  liteValue: unknown;
  /** Per-side last-updated timestamps (LWW resolution input). */
  primaryUpdatedAt?: string;
  liteUpdatedAt?: string;
  /** Whether the conflict is hard (invalid status transition) — owner-only. */
  hard: boolean;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const SYNC_QUEUE_FILE = "sync-queue.jsonl";
const SYNC_CONFLICT_FILE = "sync-conflicts.jsonl";
const MAX_SYNC_LOG_BYTES = 5 * 1024 * 1024; // 5MB before opportunistic truncation

export function syncQueueDir(): string {
  return join(homedir(), ".agi");
}
export function syncQueuePath(): string {
  return join(syncQueueDir(), SYNC_QUEUE_FILE);
}
export function syncConflictPath(): string {
  return join(syncQueueDir(), SYNC_CONFLICT_FILE);
}

let syncSeq = 0;

function generateId(prefix: string, now: Date): string {
  syncSeq = (syncSeq + 1) % 100000;
  return `${prefix}-${now.getTime().toString(36)}-${syncSeq.toString(36).padStart(3, "0")}`;
}

function ensureDir(): void {
  const dir = syncQueueDir();
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch { /* swallow */ }
  }
}

// ---------------------------------------------------------------------------
// Sync queue (retry log)
// ---------------------------------------------------------------------------

/** Append a pending-write entry. Side-channel discipline: never throws. */
export function enqueueSync(
  partial: Omit<SyncQueueEntry, "id" | "ts" | "attempts"> & Partial<Pick<SyncQueueEntry, "id" | "ts" | "attempts">>,
  now: Date = new Date(),
): SyncQueueEntry {
  const entry: SyncQueueEntry = {
    id: partial.id ?? generateId("s", now),
    ts: partial.ts ?? now.toISOString(),
    method: partial.method,
    args: partial.args,
    projectPath: partial.projectPath,
    failureReason: partial.failureReason,
    attempts: partial.attempts ?? 0,
  };
  try {
    ensureDir();
    appendFileSync(syncQueuePath(), JSON.stringify(entry) + "\n", "utf-8");
    truncateIfExcessive(syncQueuePath());
  } catch { /* swallow */ }
  return entry;
}

/** Read all pending entries (most-recent-last). Tolerates malformed lines. */
export function readSyncQueue(): SyncQueueEntry[] {
  return readJsonlFile<SyncQueueEntry>(syncQueuePath());
}

/** Filter pending entries to one project. */
export function readSyncQueueForProject(projectPath: string): SyncQueueEntry[] {
  return readSyncQueue().filter((e) => e.projectPath === projectPath);
}

/** Drain the queue to only the entries that REMAIN unsuccessful — caller passes a set of ids that succeeded on replay. */
export function drainSyncQueue(succeededIds: Set<string>): number {
  const all = readSyncQueue();
  const remaining = all.filter((e) => !succeededIds.has(e.id));
  rewriteJsonlFile(syncQueuePath(), remaining);
  return all.length - remaining.length;
}

/** Bump retry-attempt count for an entry that failed on replay. */
export function bumpAttempts(id: string): boolean {
  const all = readSyncQueue();
  const idx = all.findIndex((e) => e.id === id);
  if (idx < 0) return false;
  const entry = all[idx];
  if (!entry) return false;
  all[idx] = { ...entry, attempts: entry.attempts + 1 };
  rewriteJsonlFile(syncQueuePath(), all);
  return true;
}

/** Operator reset — clear all pending entries. Returns the count cleared. */
export function clearSyncQueue(): number {
  const all = readSyncQueue();
  rewriteJsonlFile(syncQueuePath(), []);
  return all.length;
}

// ---------------------------------------------------------------------------
// Sync conflict log
// ---------------------------------------------------------------------------

/** Append a soft-conflict entry. Side-channel discipline: never throws. */
export function recordSyncConflict(
  partial: Omit<SyncConflictEntry, "id" | "ts"> & Partial<Pick<SyncConflictEntry, "id" | "ts">>,
  now: Date = new Date(),
): SyncConflictEntry {
  const entry: SyncConflictEntry = {
    id: partial.id ?? generateId("c", now),
    ts: partial.ts ?? now.toISOString(),
    projectPath: partial.projectPath,
    entityType: partial.entityType,
    entityId: partial.entityId,
    field: partial.field,
    primaryValue: partial.primaryValue,
    liteValue: partial.liteValue,
    primaryUpdatedAt: partial.primaryUpdatedAt,
    liteUpdatedAt: partial.liteUpdatedAt,
    hard: partial.hard,
  };
  try {
    ensureDir();
    appendFileSync(syncConflictPath(), JSON.stringify(entry) + "\n", "utf-8");
    truncateIfExcessive(syncConflictPath());
  } catch { /* swallow */ }
  return entry;
}

/** Read all conflict entries. Tolerates malformed lines. */
export function readSyncConflicts(): SyncConflictEntry[] {
  return readJsonlFile<SyncConflictEntry>(syncConflictPath());
}

export function readSyncConflictsForProject(projectPath: string): SyncConflictEntry[] {
  return readSyncConflicts().filter((e) => e.projectPath === projectPath);
}

/** Resolve a conflict entry by removing it from the log. Returns true if found + removed. */
export function resolveSyncConflict(id: string): boolean {
  const all = readSyncConflicts();
  const filtered = all.filter((e) => e.id !== id);
  if (filtered.length === all.length) return false;
  rewriteJsonlFile(syncConflictPath(), filtered);
  return true;
}

export function clearSyncConflicts(): number {
  const all = readSyncConflicts();
  rewriteJsonlFile(syncConflictPath(), []);
  return all.length;
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

function readJsonlFile<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  try {
    const raw = readFileSync(path, "utf-8");
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (parsed && typeof parsed === "object") out.push(parsed as T);
      } catch { /* skip malformed line */ }
    }
  } catch { /* unreadable */ }
  return out;
}

function rewriteJsonlFile<T>(path: string, entries: T[]): void {
  ensureDir();
  if (entries.length === 0) {
    try { writeFileSync(path, "", "utf-8"); } catch { /* ignore */ }
    return;
  }
  try {
    writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
  } catch { /* ignore */ }
}

function truncateIfExcessive(path: string): void {
  if (!existsSync(path)) return;
  try {
    const stat = statSync(path);
    if (stat.size <= MAX_SYNC_LOG_BYTES) return;
    const all = readJsonlFile<unknown>(path);
    rewriteJsonlFile(path, all.slice(Math.floor(all.length / 2)));
  } catch { /* ignore */ }
}

/** Test-only helper. */
export function _resetSyncSeqForTest(): void {
  syncSeq = 0;
}
