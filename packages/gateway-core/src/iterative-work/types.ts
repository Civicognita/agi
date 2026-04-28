/**
 * Iterative-work mode public types.
 *
 * The scheduler walks all projects with `iterativeWork.enabled: true` on each
 * tick, decides which are due based on their cron expression + last-fired
 * timestamp, and emits a `fire` event with this payload. A separate consumer
 * (wired in a later slice) translates the event into an AgentInvoker call.
 */

export interface IterativeWorkFire {
  /** Absolute path of the project being fired. */
  projectPath: string;
  /** Wall-clock time when the scheduler decided the project was due. */
  firedAt: Date;
  /** Cron expression that produced this fire (for audit). */
  cron: string;
}

/**
 * Per-project introspection snapshot. Returned by IterativeWorkScheduler.getStatus
 * and surfaced by GET /api/projects/iterative-work/status. ISO-string timestamps
 * (not Date) so the shape JSON-serializes cleanly across the API boundary.
 */
export interface IterativeWorkProjectStatus {
  /** Whether the project's iterativeWork.enabled is true. */
  enabled: boolean;
  /** Configured cron expression (null when not set or unset). When `cadence`
   *  is set, this is the auto-staggered cron computed at save time (D3). */
  cron: string | null;
  /** User-picked cadence key (s118 t442 D1). Null for legacy `cron`-only
   *  configs. When set, the `cron` field is auto-derived. */
  cadence: string | null;
  /** Whether an iteration is currently running for this project. */
  inFlight: boolean;
  /** ISO timestamp of the most recent fire (null when never fired). */
  lastFiredAt: string | null;
  /** ISO timestamp of the next computed fire (null when cron unparseable or not set). */
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
 * The shape of every event the scheduler emits. Strongly typed so consumers
 * can `on("fire", ...)` without losing payload typing.
 */
export interface IterativeWorkSchedulerEvents {
  fire: [IterativeWorkFire];
}
