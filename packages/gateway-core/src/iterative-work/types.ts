/**
 * Scheduled-jobs / iterative-work public types (s118 redesign).
 *
 * The scheduler walks all projects' `scheduledJobs` arrays on each tick,
 * fires each enabled job that is due based on its cron expression + last-fired
 * timestamp, and emits a `fire` event. A downstream consumer dispatches by
 * job.type (pm-loop → agent, prompt → agent, command → agi bash, action → plugin).
 */

import type { ScheduledJob } from "@agi/config";

/** Fire event emitted when a scheduled job is due. */
export interface ScheduledJobFire {
  /** Absolute path of the project owning this job. */
  projectPath: string;
  /** The job that fired (type-discriminated for the consumer's switch). */
  job: ScheduledJob;
  /** Wall-clock time when the scheduler decided the job was due. */
  firedAt: Date;
  /** Cron expression that produced this fire (for audit). */
  cron: string;
}

/** @deprecated Use ScheduledJobFire. Kept for backward compat during transition. */
export type IterativeWorkFire = ScheduledJobFire;

/**
 * Per-job introspection snapshot. ISO-string timestamps (not Date) so the
 * shape JSON-serializes cleanly across the API boundary.
 */
export interface ScheduledJobStatus {
  jobId: string;
  type: string;
  name: string;
  enabled: boolean;
  cron: string | null;
  cadence: string | null;
  inFlight: boolean;
  lastFiredAt: string | null;
  nextFireAt: string | null;
}

/**
 * Per-project introspection snapshot (list of job statuses).
 * Returned by IterativeWorkScheduler.getProjectStatus.
 */
export interface ScheduledJobProjectStatus {
  jobs: ScheduledJobStatus[];
}

/**
 * @deprecated Use ScheduledJobStatus / ScheduledJobProjectStatus.
 * Kept for the legacy GET /api/projects/iterative-work/status shim which
 * maps the first pm-loop job to this shape.
 */
export interface IterativeWorkProjectStatus {
  enabled: boolean;
  cron: string | null;
  cadence: string | null;
  inFlight: boolean;
  lastFiredAt: string | null;
  nextFireAt: string | null;
}

/**
 * One entry in the per-project iteration log — captures what the scheduler can
 * directly observe for a single fire: when it fired, when it completed, how
 * long it ran, terminal status, and an optional error message. Richer fields
 * the spec eventually wants (task picked, ship version, commit hash) require
 * agent-observability hooks that don't exist yet — they'll be added when
 * those hooks land. ISO-string timestamps for clean JSON serialization.
 */
export type IterativeWorkLogStatus = "running" | "done" | "error";

export interface IterativeWorkLogEntry {
  /** ISO timestamp when the scheduler emitted the fire event. */
  firedAt: string;
  /** ISO timestamp when the iteration completed (success or failure). Null while still running. */
  completedAt: string | null;
  /** Wall-clock duration in milliseconds from fire to completion. Null while running. */
  durationMs: number | null;
  /** Terminal state of the iteration. "running" until completion is recorded. */
  status: IterativeWorkLogStatus;
  /** Error message when status === "error". Otherwise undefined. */
  error?: string;
  /** Cron expression that produced the fire (for retroactive debugging if config changed). */
  cron: string;
}

/**
 * Optional artifact metadata captured at iteration completion. Populated by
 * the agent-observability hook (s124 t469) — until that hook lands, all
 * fields stay undefined and consumers receive completion events with empty
 * artifact data. The shape is fixed now so downstream consumers
 * (NotificationStore in t470, Toast UI in t471) can be wired against the
 * real type without waiting for the hook.
 *
 * Field semantics:
 * - `thumbnailPath`: file path or data URI to a representative screenshot
 *   captured by the agent-observability hook (t469). Used by Toast preview
 *   and the per-project Iteration log surface.
 * - `summary`: 1-line natural-language description of what the iteration did
 *   ("Shipped v0.4.290: ProjectDetail tabs to ADF primitives").
 * - `chatSessionId`: id of the chat session that handled the iteration. Used
 *   by chat-routing in t472 to detect "open existing chat" vs "create new
 *   with seed message".
 * - `taskNumber`: tynn task number that was worked on (when the iteration
 *   touched tynn — most do under iterative-work mode).
 * - `commitHash`: short git SHA of the commit shipped during this iteration
 *   (when one shipped — some iterations are pure verification + don't ship).
 * - `shipVersion`: package.json version at end of iteration (when bumped).
 */
export interface IterativeWorkArtifact {
  thumbnailPath?: string;
  summary?: string;
  chatSessionId?: string;
  taskNumber?: number;
  commitHash?: string;
  shipVersion?: string;
}

/**
 * Completion event payload. Emitted by the scheduler when a fire-event
 * consumer calls `recordCompletion()` to report terminal status. Carries
 * the same fields as IterativeWorkLogEntry plus the project path (so
 * NotificationStore can route events without a separate lookup) and
 * optional artifact metadata (when available).
 */
export interface IterativeWorkCompletion {
  /** Absolute path of the project. */
  projectPath: string;
  /** Cron expression that produced the original fire. */
  cron: string;
  /** ISO timestamp when the iteration fired. */
  firedAt: string;
  /** ISO timestamp when the iteration completed. */
  completedAt: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Terminal status. */
  status: "done" | "error";
  /** Error message when status === "error". */
  error?: string;
  /** Artifact metadata — fully populated only after the agent-observability
   *  hook (t469) lands. Until then, fields are undefined. */
  artifact?: IterativeWorkArtifact;
}

/**
 * The shape of every event the scheduler emits. Strongly typed so consumers
 * can `on("fire", ...)` without losing payload typing.
 */
export interface IterativeWorkSchedulerEvents {
  fire: [ScheduledJobFire];
  complete: [IterativeWorkCompletion];
}
