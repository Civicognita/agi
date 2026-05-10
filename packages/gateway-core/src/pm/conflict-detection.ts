/**
 * Read-back conflict detection — s155 t672 Phase 4.
 *
 * Pure-logic comparator that takes a primary record + a TynnLite record
 * + per-field updated-at timestamps and emits conflict descriptors per
 * the t669 ADR (`agi/docs/agents/adr-layered-pm-conflict-resolution.md`).
 *
 * Inputs come from upstream (Phase 6 worker fetches from primary; Phase
 * 3's `getTaskFieldTimestamps` provides TynnLite's stamps). Output
 * descriptors get fed to `recordSyncConflict()` by the caller for
 * surface in the dashboard PM-Lite panel (Phase 5).
 *
 * Resolution model (per ADR):
 *   - Soft conflict: per-field divergence with valid LWW resolution
 *     possible. The newer-stamped side wins; the loser's value is
 *     surfaced in the conflict log so the owner can see the override.
 *   - Hard conflict: status moved through an invalid transition (e.g.
 *     primary says `done`, lite says `backlog` — neither is reachable
 *     from the other without intermediate states). Blocks auto-merge;
 *     owner-resolves via the dashboard.
 *
 * Hard-conflict detection is STATUS-ONLY for this phase. Future phases
 * could add hard rules for other fields (e.g. tags can never go from
 * non-empty to empty without explicit clear), but status is the clear
 * winner today: it has a defined state graph, and "backwards" moves
 * (done → backlog) are nearly always errors.
 */

import type { PmStatus, PmTask } from "@agi/sdk";
import type { TaskFieldTimestamps } from "./tynn-lite-provider.js";
import type { SyncConflictEntry } from "./sync-queue.js";

/** Fields the diff covers. Mirror the keys in TaskFieldTimestamps. */
export const TRACKED_FIELDS = ["title", "description", "status", "codeArea", "verificationSteps"] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

/** Output of the diff — one entry per diverged field. */
export type DetectedConflict = Omit<SyncConflictEntry, "id" | "ts">;

/** Per-field comparison input. */
export interface DiffInput {
  /** Project the records belong to. Threaded into output entries. */
  projectPath: string;
  /** Tynn entity type (typically "task" — extends to "story" later). */
  entityType: string;
  /** Tynn entity id. */
  entityId: string;
  /** Record value as observed on primary. Fields may be undefined when
   *  the upstream API omits them (e.g. tynn doesn't always populate
   *  codeArea); the diff treats undefined identically on both sides. */
  primary: Partial<Pick<PmTask, "title" | "description" | "status" | "codeArea" | "verificationSteps">>;
  /** Same shape from TynnLite. */
  lite: Partial<Pick<PmTask, "title" | "description" | "status" | "codeArea" | "verificationSteps">>;
  /** Per-field updated-at timestamps from TynnLite. */
  liteTimestamps: TaskFieldTimestamps;
  /**
   * Per-field timestamps as observed on primary. Often unavailable
   * (most PmProvider implementations don't expose them). When
   * undefined, LWW defaults to "lite is newer" — primary's stale data
   * loses, which matches the ADR's "TynnLite is the floor" stance.
   */
  primaryTimestamps?: Partial<TaskFieldTimestamps>;
}

/**
 * Hard-conflict detection: status moves that aren't reachable in the
 * canonical workflow. Returns true when the (primary, lite) pair is
 * an invalid bypass (e.g. one says `done`, other says `backlog`).
 *
 * Soft moves (e.g. `doing` ↔ `testing`, `backlog` → `doing`,
 * `doing` → `finished`) are NOT hard conflicts even when they
 * diverge — LWW resolves them.
 */
export function isHardStatusConflict(primaryStatus: PmStatus, liteStatus: PmStatus): boolean {
  if (primaryStatus === liteStatus) return false;
  // The status pairs that can't be reconciled by LWW alone:
  // - terminal vs not-yet-started (done/archived <-> backlog)
  // - blocked + active (blocked <-> doing/testing/finished)
  const terminal: PmStatus[] = ["finished", "archived"];
  const notStarted: PmStatus[] = ["backlog"];
  const liveStates: PmStatus[] = ["starting", "doing", "testing"];
  if (terminal.includes(primaryStatus) && notStarted.includes(liteStatus)) return true;
  if (terminal.includes(liteStatus) && notStarted.includes(primaryStatus)) return true;
  if (primaryStatus === "blocked" && liveStates.includes(liteStatus)) return true;
  if (liteStatus === "blocked" && liveStates.includes(primaryStatus)) return true;
  return false;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return false;
}

/**
 * Walk every tracked field; for each that diverges, emit a conflict
 * descriptor. Returns an empty array when records agree on all fields.
 *
 * Pure: same input → same output. No I/O, no clock. Caller is
 * responsible for actually writing the descriptors via
 * `recordSyncConflict()`.
 */
export function detectConflicts(input: DiffInput): DetectedConflict[] {
  const conflicts: DetectedConflict[] = [];
  const ptimes = input.primaryTimestamps ?? {};

  for (const field of TRACKED_FIELDS) {
    const liteValue = input.lite[field];
    const primaryValue = input.primary[field];
    if (valuesEqual(liteValue, primaryValue)) continue;

    // Status gets the hard-conflict check.
    const isHard = field === "status"
      ? isHardStatusConflict(primaryValue as PmStatus, liteValue as PmStatus)
      : false;

    conflicts.push({
      projectPath: input.projectPath,
      entityType: input.entityType,
      entityId: input.entityId,
      field,
      primaryValue,
      liteValue,
      primaryUpdatedAt: ptimes[field],
      liteUpdatedAt: input.liteTimestamps[field],
      hard: isHard,
    });
  }

  return conflicts;
}

/**
 * Resolve a single conflict by LWW: returns `"primary"` when primary's
 * timestamp is strictly greater than lite's, `"lite"` otherwise. When
 * primary's timestamp is undefined (most current PmProviders don't
 * expose them), lite wins — matches the ADR's "TynnLite is the floor"
 * stance.
 *
 * Hard conflicts SHOULD NOT be auto-resolved; this helper still
 * returns a winner for completeness but callers should check
 * `c.hard` before using the result.
 */
export function lwwWinner(c: DetectedConflict): "primary" | "lite" {
  if (!c.primaryUpdatedAt) return "lite";
  if (!c.liteUpdatedAt) return "primary";
  return c.primaryUpdatedAt > c.liteUpdatedAt ? "primary" : "lite";
}
