/**
 * Taskmaster queue diagnostic (s159 t689, 2026-05-10).
 *
 * Pure-logic helpers for inspecting the dispatch jobs directory. Used by
 * the `GET /api/taskmaster/queue` endpoint to give operators visibility
 * into the queue BEFORE it's a crisis — see same-keyed pending jobs
 * stacking up, oldest pending age, total counts by status.
 *
 * Idempotency-key shape (s159 t695, pending reproducer): `{projectPath,
 * planRef.planId, planRef.stepId}` when planRef is present. Without
 * planRef, falls back to a stable description hash so same-text
 * dispatches still cluster together in the duplicate detector. This is
 * observability-only — the actual idempotency *gate* on enqueue waits
 * for the reproducer to confirm the bug's exact path.
 */

import { createHash } from "node:crypto";

/**
 * Shape of a dispatch job file as read from
 * `~/.agi/{projectSlug}/dispatch/jobs/{jobId}.json`. Trimmed to the
 * fields this module actually reads — extras are ignored.
 */
export interface DispatchJobLike {
  id: string;
  description?: string;
  status?: string;
  projectPath?: string;
  createdAt?: string;
  planRef?: { planId?: string; stepId?: string } | null;
}

/** One group of dispatch jobs that share an idempotency-key. */
export interface DuplicateGroup {
  /** The shared key — either `plan:<planId>:<stepId>` or `desc:<sha1-12>`. */
  key: string;
  /** Number of jobs in this group. Always ≥ 2 (groups of 1 are filtered). */
  count: number;
  /** Job ids in the group, in input order. */
  jobIds: string[];
  /** Earliest createdAt in the group, ISO string. */
  earliest: string | null;
}

export interface QueueSummary {
  /** Total jobs read. */
  total: number;
  /** Count by status (`pending`, `running`, `completed`, `error`, etc). */
  byStatus: Record<string, number>;
  /** Oldest non-terminal (pending/running) job's createdAt ISO. */
  oldestActiveAt: string | null;
  /** Duplicate groups — same idempotency key on 2+ jobs. */
  duplicates: DuplicateGroup[];
}

const TERMINAL_STATUSES = new Set<string>(["completed", "error", "cancelled", "failed"]);

/**
 * Compute the idempotency-key candidate for one job. Matches the t695
 * spec: `{projectPath, taskId, phase}` →
 *   - `plan:<planId>:<stepId>` when planRef present
 *   - `desc:<sha1-12>` fallback (12-char sha1 of description) when no planRef
 *
 * Pure: same input → same output. Exported so tests can pin the
 * key-shape without re-deriving via group-detection.
 */
export function idempotencyKey(job: DispatchJobLike): string {
  const planId = job.planRef?.planId;
  const stepId = job.planRef?.stepId;
  if (typeof planId === "string" && planId.length > 0 && typeof stepId === "string" && stepId.length > 0) {
    return `plan:${planId}:${stepId}`;
  }
  const desc = typeof job.description === "string" ? job.description : "";
  const hash = createHash("sha1").update(desc).digest("hex").slice(0, 12);
  return `desc:${hash}`;
}

/**
 * Find groups of 2+ jobs sharing an idempotency-key. Only considers
 * non-terminal jobs (pending/running) — completed/error/cancelled past
 * jobs are noise for queue-stacking detection.
 *
 * Pure function — no I/O, no side effects.
 */
export function detectDuplicateGroups(jobs: readonly DispatchJobLike[]): DuplicateGroup[] {
  const groups = new Map<string, DispatchJobLike[]>();
  for (const job of jobs) {
    const status = typeof job.status === "string" ? job.status : "pending";
    if (TERMINAL_STATUSES.has(status)) continue;
    const key = idempotencyKey(job);
    const bucket = groups.get(key) ?? [];
    bucket.push(job);
    groups.set(key, bucket);
  }
  const out: DuplicateGroup[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const earliest = members
      .map((m) => (typeof m.createdAt === "string" ? m.createdAt : null))
      .filter((s): s is string => s !== null)
      .sort()[0] ?? null;
    out.push({
      key,
      count: members.length,
      jobIds: members.map((m) => m.id),
      earliest,
    });
  }
  // Sort by count descending so the worst offender is first.
  out.sort((a, b) => b.count - a.count);
  return out;
}

/**
 * Roll up jobs into a full queue summary. Used by the
 * `GET /api/taskmaster/queue` endpoint payload.
 *
 * Pure function — no I/O, no side effects.
 */
export function summarizeQueue(jobs: readonly DispatchJobLike[]): QueueSummary {
  const byStatus: Record<string, number> = {};
  let oldestActiveAt: string | null = null;
  for (const job of jobs) {
    const status = typeof job.status === "string" ? job.status : "pending";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (!TERMINAL_STATUSES.has(status) && typeof job.createdAt === "string") {
      if (oldestActiveAt === null || job.createdAt < oldestActiveAt) {
        oldestActiveAt = job.createdAt;
      }
    }
  }
  return {
    total: jobs.length,
    byStatus,
    oldestActiveAt,
    duplicates: detectDuplicateGroups(jobs),
  };
}
