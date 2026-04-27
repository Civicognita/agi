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
 * The shape of every event the scheduler emits. Strongly typed so consumers
 * can `on("fire", ...)` without losing payload typing.
 */
export interface IterativeWorkSchedulerEvents {
  fire: [IterativeWorkFire];
}
