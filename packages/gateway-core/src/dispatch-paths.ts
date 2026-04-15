/**
 * Shared project-slug + runtime-dir derivation for per-project storage under
 * ~/.agi/{projectSlug}/*.
 *
 * Plans and TaskMaster dispatch jobs both live in ~/.agi/{projectSlug}/, so
 * the slugifier has to agree across both stores. One canonical helper here;
 * PlanStore imports it, TaskMaster tool handlers + worker runtime import it.
 *
 * Also owns the live-status overlay helpers used by the Work Queue view AND
 * the taskmaster_status tool — dispatch files are write-once immutable
 * records of intent; ~/.agi/state/taskmaster.json is the source of truth
 * for progress. Both readers overlay the same way so Aion and the UI never
 * disagree on what a job is doing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Convert an absolute project path to a filesystem-safe slug used as the
 * subdirectory name under ~/.agi/.
 *
 * Strips the leading slash, collapses remaining path separators into dashes,
 * and replaces every other unsafe character with underscores. Empty input
 * (or a bare "/") maps to "general" — the fallback bucket used by chats that
 * aren't scoped to any project.
 */
export function projectSlug(projectPath: string): string {
  return (
    projectPath
      .replace(/^\//, "")
      .replace(/\//g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "_") || "general"
  );
}

/**
 * Base directory for a project's TaskMaster dispatch files.
 * Jobs land at `${dispatchDir(projectPath)}/jobs/{jobId}.json`.
 */
export function dispatchDir(projectPath: string): string {
  return join(homedir(), ".agi", projectSlug(projectPath), "dispatch");
}

/** `${dispatchDir(projectPath)}/jobs` — where the dispatch JSON files live. */
export function dispatchJobsDir(projectPath: string): string {
  return join(dispatchDir(projectPath), "jobs");
}

// ---------------------------------------------------------------------------
// Live-status overlay (shared by Work Queue listing + taskmaster_status tool)
// ---------------------------------------------------------------------------

/** Minimal live-state shape we need to overlay onto dispatch files. */
export interface LiveJobOverlay {
  status: "pending" | "running" | "checkpoint" | "complete" | "failed";
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/** Flat shape matching what taskmaster_queue writes to disk. */
interface DispatchRecord {
  id: string;
  status: "pending" | "running" | "checkpoint" | "complete" | "failed";
  handoffs?: Array<{ question: string; askedAt: string }>;
}

/**
 * Load the live-status overlay from ~/.agi/state/taskmaster.json. Returns an
 * empty map when the state file is missing or unreadable — callers should
 * treat "no overlay" as "use whatever the dispatch file says."
 */
export function loadLiveJobOverlay(stateDir?: string): Map<string, LiveJobOverlay> {
  const base = stateDir ?? join(homedir(), ".agi", "state");
  const statePath = join(base, "taskmaster.json");
  const out = new Map<string, LiveJobOverlay>();
  if (!existsSync(statePath)) return out;
  try {
    const raw = readFileSync(statePath, "utf-8");
    const state = JSON.parse(raw) as { wip?: { jobs?: Record<string, LiveJobOverlay & { id: string }> } };
    if (state.wip?.jobs) {
      for (const [id, job] of Object.entries(state.wip.jobs)) {
        out.set(id, {
          status: job.status,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          error: job.error,
        });
      }
    }
  } catch {
    // Corrupt state file — return whatever we have (empty).
  }
  return out;
}

/**
 * Merge the dispatch-file record with a live overlay (if any) and return the
 * effective status. Precedence: live state > handoff sentinel > dispatch
 * status. Keeps the merge rule in one place so Work Queue + taskmaster_status
 * can never drift apart.
 */
export function mergeJobStatus(
  dispatch: DispatchRecord,
  live?: LiveJobOverlay,
): "pending" | "running" | "checkpoint" | "complete" | "failed" {
  if (live?.status) return live.status;
  if (dispatch.handoffs && dispatch.handoffs.length > 0) return "checkpoint";
  return dispatch.status;
}
