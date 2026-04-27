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
  /** Configured cron expression (null when not set or unset). */
  cron: string | null;
  /** Whether an iteration is currently running for this project. */
  inFlight: boolean;
  /** ISO timestamp of the most recent fire (null when never fired). */
  lastFiredAt: string | null;
  /** ISO timestamp of the next computed fire (null when cron unparseable or not set). */
  nextFireAt: string | null;
}

/**
 * The shape of every event the scheduler emits. Strongly typed so consumers
 * can `on("fire", ...)` without losing payload typing.
 */
export interface IterativeWorkSchedulerEvents {
  fire: [IterativeWorkFire];
}
