/**
 * notification-mapper — translate an `IterativeWorkCompletion` into the
 * `CreateNotificationParams` shape consumed by NotificationStore (s124 t470).
 *
 * Type contract for the metadata payload is `IterativeWorkNotificationMetadata`
 * — a flat shape that mirrors IterativeWorkCompletion + IterativeWorkArtifact
 * fields. Downstream Toast UI (t471) and notification-list rendering read
 * the metadata directly via this typed shape (parsed from the `metadata`
 * JSON column).
 *
 * Architecture rationale: NotificationStore lives in @agi/entity-model and
 * doesn't depend on @agi/gateway-core. To avoid a circular dep we keep the
 * mapper here next to the scheduler (the producer), and have it return
 * `CreateNotificationParams` (the entity-model contract) so the call site
 * just does `store.create(mapToNotificationParams(completion))`.
 */

import type { CreateNotificationParams } from "@agi/entity-model";
import type { IterativeWorkCompletion } from "./types.js";

/** Stable type tag for iterative-work notifications. Used by Toast UI to
 *  branch rendering and by Notifications page filters. */
export const ITERATIVE_WORK_NOTIFICATION_TYPE = "iterative-work";

/**
 * Typed shape of the metadata column for iterative-work notifications.
 * Flat — every field is optional to allow incremental population (e.g.,
 * `thumbnailPath`/`summary` only land once the agent-observability hook
 * (t469) is wired).
 */
export interface IterativeWorkNotificationMetadata {
  /** Absolute project path (matches IterativeWorkCompletion.projectPath). */
  projectPath: string;
  /** Cron expression that fired the iteration. */
  cron: string;
  /** ISO timestamp when the iteration fired. */
  firedAt: string;
  /** ISO timestamp when the iteration completed. */
  completedAt: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Terminal status. */
  status: "done" | "error";
  /** Error message — only present when status === "error". */
  error?: string;
  /** Path/URI to the captured thumbnail (set by t469 once shipped). */
  thumbnailPath?: string;
  /** 1-line natural-language summary of what the iteration did. */
  summary?: string;
  /** Chat session id used by chat-routing (t472) to detect existing chat. */
  chatSessionId?: string;
  /** Tynn task number worked on (most iterations touch tynn). */
  taskNumber?: number;
  /** Short git SHA of the commit shipped (when one shipped). */
  commitHash?: string;
  /** package.json version after the iteration (when bumped). */
  shipVersion?: string;
}

/** Project-name extractor — last path segment, with leading dots/slashes
 *  stripped so the title reads "<project>" not "/abs/path/.proj". */
function projectNameFromPath(path: string): string {
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? path;
}

/** Format duration in ms as a short human label ("12s", "1m 23s", "47m"). */
function formatDuration(ms: number): string {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) return `${String(totalSec)}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec === 0 ? `${String(min)}m` : `${String(min)}m ${String(sec)}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin === 0 ? `${String(hr)}h` : `${String(hr)}h ${String(remMin)}m`;
}

/**
 * Translate a completion event into NotificationStore params. Title is the
 * project name + status; body is the summary (when populated by t469) else
 * a short status sentence; metadata carries the full typed shape so the
 * Toast UI + Notifications page can render the rich preview.
 */
export function mapIterativeWorkCompletionToParams(
  completion: IterativeWorkCompletion,
  projectName: string = projectNameFromPath(completion.projectPath),
): CreateNotificationParams {
  const dur = formatDuration(completion.durationMs);
  const titleStatus = completion.status === "done" ? "Iteration complete" : "Iteration failed";
  const title = `${projectName} · ${titleStatus}`;

  const summary = completion.artifact?.summary;
  const body = completion.status === "done"
    ? (summary !== undefined && summary.length > 0
        ? summary
        : `Cycle finished in ${dur}.`)
    : `Cycle errored after ${dur}: ${completion.error ?? "unknown error"}`;

  const metadata: IterativeWorkNotificationMetadata = {
    projectPath: completion.projectPath,
    cron: completion.cron,
    firedAt: completion.firedAt,
    completedAt: completion.completedAt,
    durationMs: completion.durationMs,
    status: completion.status,
    ...(completion.error !== undefined ? { error: completion.error } : {}),
    ...(completion.artifact?.thumbnailPath !== undefined ? { thumbnailPath: completion.artifact.thumbnailPath } : {}),
    ...(completion.artifact?.summary !== undefined ? { summary: completion.artifact.summary } : {}),
    ...(completion.artifact?.chatSessionId !== undefined ? { chatSessionId: completion.artifact.chatSessionId } : {}),
    ...(completion.artifact?.taskNumber !== undefined ? { taskNumber: completion.artifact.taskNumber } : {}),
    ...(completion.artifact?.commitHash !== undefined ? { commitHash: completion.artifact.commitHash } : {}),
    ...(completion.artifact?.shipVersion !== undefined ? { shipVersion: completion.artifact.shipVersion } : {}),
  };

  return {
    type: ITERATIVE_WORK_NOTIFICATION_TYPE,
    title,
    body,
    metadata,
  };
}
