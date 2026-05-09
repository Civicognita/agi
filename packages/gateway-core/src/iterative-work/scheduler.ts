/**
 * IterativeWorkScheduler — walks all registered project paths on each tick,
 * decides which projects with `iterativeWork.enabled: true` are due to fire
 * based on their cron expression and last-fired timestamp, and emits a `fire`
 * event so a downstream consumer can invoke the agent.
 *
 * **Why an EventEmitter (not a direct AgentInvoker dep):** keeps the scheduler
 * unit-testable without spinning up the LLM stack, lets t440's regression
 * test listen on the same channel, and matches the ProjectConfigManager
 * "emit on change" decoupling pattern already proven in this codebase.
 *
 * **Idempotency model:** in-flight projects are tracked in an in-memory Set.
 * Consumers MUST call `markComplete(projectPath)` when their handler finishes
 * (success or failure), otherwise the project stays in-flight forever and
 * never fires again. Persistence across restart is deferred to a later slice
 * — restart resets in-flight (no over-firing risk because the cron's next
 * minute is the earliest possible re-fire).
 *
 * **Hot config:** project configs are read fresh on every tick via
 * ProjectConfigManager.read(). A project that toggles
 * `iterativeWork.enabled: false` mid-run stops firing on the next tick.
 */

import { EventEmitter } from "node:events";
import type { ProjectConfigManager } from "../project-config-manager.js";
import { createComponentLogger } from "../logger.js";
import type { Logger, ComponentLogger } from "../logger.js";
import { nextFireAfter } from "./cron.js";
import type { IterativeWorkArtifact, IterativeWorkCompletion, IterativeWorkFire, IterativeWorkLogEntry, IterativeWorkProjectStatus, IterativeWorkSchedulerEvents } from "./types.js";

export interface IterativeWorkSchedulerDeps {
  projectConfigManager: ProjectConfigManager;
  /**
   * Resolves the absolute paths of all projects the gateway knows about.
   * Called on every tick so a newly-created project becomes schedulable
   * without restart. Defaults to () => [] when omitted (scheduler is
   * inert until enumeration is wired in a later slice).
   */
  listProjectPaths?: () => string[];
  /** Custom tick interval; default 30000ms (30s). Lower bound 1000ms. */
  tickIntervalMs?: number;
  /** Max entries kept per project in the in-memory iteration log; default 50. */
  logBufferSize?: number;
  logger?: Logger;
}

const DEFAULT_TICK_MS = 30_000;
const MIN_TICK_MS = 1_000;
const DEFAULT_LOG_BUFFER = 50;

/**
 * s159 t693 — fire-rate observability constants. The scheduler tracks
 * timestamps of recent fires per project; if more than
 * FIRE_RATE_WARN_THRESHOLD fires occur within FIRE_RATE_WINDOW_MS, a
 * WARN log surfaces the runaway pattern. Pure observability — does not
 * gate the fire (that's t695 idempotency + t696 cooldown's job).
 *
 * Threshold of 5 fires/60s is intentionally permissive — the
 * scheduler ticks every 30s by default so legitimate per-minute crons
 * fire 1×/min for one project, well under the threshold. A loop that
 * trips this is firing every 10-15s (4-6 per minute) — clearly broken.
 */
const FIRE_RATE_WINDOW_MS = 60_000;
const FIRE_RATE_WARN_THRESHOLD = 5;

export class IterativeWorkScheduler extends EventEmitter<IterativeWorkSchedulerEvents> {
  private timer?: ReturnType<typeof setInterval>;
  private readonly inFlight = new Set<string>();
  private readonly lastFiredAt = new Map<string, Date>();
  private readonly log: ComponentLogger;
  private readonly tickIntervalMs: number;
  private readonly logBufferSize: number;
  /** Per-project ring buffer of iteration log entries (most recent first). */
  private readonly iterationLog = new Map<string, IterativeWorkLogEntry[]>();
  /** Per-project timestamp of the in-flight fire, used to compute durationMs at completion. */
  private readonly inFlightStartedAt = new Map<string, Date>();
  /**
   * s159 t693 — sliding window of recent fire timestamps per project,
   * for the runaway-loop WARN log + future dashboard surface.
   */
  private readonly recentFiresByProject = new Map<string, number[]>();

  constructor(private readonly deps: IterativeWorkSchedulerDeps) {
    super();
    this.log = createComponentLogger(deps.logger, "iterative-work-scheduler");
    const requested = deps.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.tickIntervalMs = Math.max(MIN_TICK_MS, requested);
    this.logBufferSize = Math.max(1, deps.logBufferSize ?? DEFAULT_LOG_BUFFER);
  }

  /** Begin periodic ticking. Calling start twice is a no-op. */
  start(): void {
    if (this.timer !== undefined) return;
    this.log.info(`scheduler started (tickIntervalMs=${String(this.tickIntervalMs)})`);
    this.timer = setInterval(() => {
      this.tick();
    }, this.tickIntervalMs);
  }

  /** Stop ticking and clear the in-flight set. */
  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.inFlight.clear();
    this.inFlightStartedAt.clear();
    this.log.info("scheduler stopped");
  }

  /**
   * Mark a project's iteration as complete so the next due tick can fire.
   * MUST be called by the fire-event consumer when its handler finishes —
   * otherwise the project stays in-flight forever.
   */
  markComplete(projectPath: string): void {
    this.inFlight.delete(projectPath);
    this.inFlightStartedAt.delete(projectPath);
  }

  /**
   * Record the terminal status of an in-flight iteration into the per-project
   * ring buffer. Called by the fire-event consumer alongside markComplete.
   * The `error` field is captured for status === "error" only. The buffer
   * mutates the most-recent (head) entry — the running entry pushed by tick()
   * — so callers don't need to thread an entry-id through their try/catch.
   * If no running entry exists for the project (e.g. recordCompletion called
   * twice or out-of-order), the call is a no-op.
   *
   * **Emits a `complete` event** (s124 t468) carrying the iteration's terminal
   * shape + optional artifact metadata. Notifications (s124 t470) and Toast
   * UI (s124 t471) consume this event to surface iteration completions to
   * the owner. Artifact metadata is populated by the agent-observability
   * hook (s124 t469) — when not provided, the event still fires but
   * `artifact` is undefined so downstream consumers can treat it as "no
   * preview available".
   */
  recordCompletion(
    projectPath: string,
    outcome: { status: "done" | "error"; error?: string; now?: Date; artifact?: IterativeWorkArtifact },
  ): void {
    const buffer = this.iterationLog.get(projectPath);
    if (buffer === undefined || buffer.length === 0) return;
    const head = buffer[0];
    if (head === undefined || head.status !== "running") return;
    const now = outcome.now ?? new Date();
    const startedAt = this.inFlightStartedAt.get(projectPath);
    const completedAt = now.toISOString();
    const durationMs = startedAt !== undefined ? now.getTime() - startedAt.getTime() : null;
    head.completedAt = completedAt;
    head.durationMs = durationMs;
    head.status = outcome.status;
    if (outcome.status === "error" && outcome.error !== undefined) {
      head.error = outcome.error;
    }

    // Emit completion event so NotificationStore (s124 t470) can route +
    // Toast UI (s124 t471) can render the preview.
    const completion: IterativeWorkCompletion = {
      projectPath,
      cron: head.cron,
      firedAt: head.firedAt,
      completedAt,
      durationMs: durationMs ?? 0,
      status: outcome.status,
      ...(outcome.error !== undefined && outcome.status === "error" ? { error: outcome.error } : {}),
      ...(outcome.artifact !== undefined ? { artifact: outcome.artifact } : {}),
    };
    this.emit("complete", completion);
  }

  /**
   * Read-only snapshot of the per-project iteration log, most-recent-first.
   * `limit` defaults to the full buffer; values larger than the buffer are
   * silently capped. Empty array when the project has never fired.
   */
  getLog(projectPath: string, limit?: number): IterativeWorkLogEntry[] {
    const buffer = this.iterationLog.get(projectPath) ?? [];
    if (limit === undefined) return [...buffer];
    return buffer.slice(0, Math.max(0, limit));
  }

  /**
   * Run one tick synchronously. Public so tests + the future "fire now"
   * UX surface can advance the scheduler without waiting for the timer.
   */
  tick(now: Date = new Date()): void {
    const list = this.deps.listProjectPaths?.() ?? [];
    for (const projectPath of list) {
      if (this.inFlight.has(projectPath)) continue;

      const config = this.deps.projectConfigManager.read(projectPath);
      const iw = config?.iterativeWork;
      if (iw?.enabled !== true) continue;
      if (iw.cron === undefined || iw.cron.trim().length === 0) continue;

      const lastFire = this.lastFiredAt.get(projectPath);
      const since = lastFire ?? new Date(now.getTime() - 60_000);
      const nextFire = nextFireAfter(iw.cron, since);
      if (nextFire === null) {
        this.log.warn(`project "${projectPath}" has unparseable cron "${iw.cron}" — skipping`);
        continue;
      }
      if (nextFire > now) continue;

      const fire: IterativeWorkFire = {
        projectPath,
        firedAt: now,
        cron: iw.cron,
      };
      this.inFlight.add(projectPath);
      this.inFlightStartedAt.set(projectPath, now);
      this.lastFiredAt.set(projectPath, now);

      // s159 t693 — fire-rate tracking. Push the firedAt timestamp into
      // a 60s sliding window per project; if the window contains
      // FIRE_RATE_WARN_THRESHOLD or more entries, emit a WARN log so
      // the next runaway loop is visible BEFORE it becomes a crisis.
      // Pure observability — does not gate the fire itself (that's the
      // job of t695 idempotency + t696 cooldown).
      const recent = this.recentFiresByProject.get(projectPath) ?? [];
      const cutoffMs = now.getTime() - FIRE_RATE_WINDOW_MS;
      const pruned = recent.filter((t) => t >= cutoffMs);
      pruned.push(now.getTime());
      this.recentFiresByProject.set(projectPath, pruned);
      if (pruned.length >= FIRE_RATE_WARN_THRESHOLD) {
        this.log.warn(
          `fire-rate: ${projectPath} fired ${String(pruned.length)} times in the last ${String(FIRE_RATE_WINDOW_MS / 1000)}s — possible runaway loop. ` +
          `Use \`agi iw stop --project ${projectPath}\` to break it without restarting the gateway.`,
        );
      }
      // Push a "running" entry to the per-project ring buffer. recordCompletion
      // mutates this head entry when the consumer reports status; until then
      // the log surface shows the in-flight iteration as running.
      const buffer = this.iterationLog.get(projectPath) ?? [];
      const entry: IterativeWorkLogEntry = {
        firedAt: now.toISOString(),
        completedAt: null,
        durationMs: null,
        status: "running",
        cron: iw.cron,
      };
      buffer.unshift(entry);
      while (buffer.length > this.logBufferSize) buffer.pop();
      this.iterationLog.set(projectPath, buffer);
      this.log.info(`fire: ${projectPath} (cron=${iw.cron})`);
      this.emit("fire", fire);
    }
  }

  /** Diagnostic: snapshot of current in-flight project paths. */
  getInFlight(): string[] {
    return [...this.inFlight];
  }

  /**
   * Diagnostic: how many times this project has fired in the rolling
   * 60s window. > FIRE_RATE_WARN_THRESHOLD means the scheduler logged
   * a WARN on the most recent fire. Caller (e.g. dashboard tile, doctor
   * check) can surface the same data ahead of crisis. (s159 t693)
   */
  getRecentFireCount(projectPath: string, now: Date = new Date()): number {
    const recent = this.recentFiresByProject.get(projectPath);
    if (!recent) return 0;
    const cutoffMs = now.getTime() - FIRE_RATE_WINDOW_MS;
    return recent.filter((t) => t >= cutoffMs).length;
  }

  /**
   * Operator kill switch (s159 t692). Force-clears the in-flight + last-fired
   * tracking for one project so the scheduler treats it as never-fired.
   * Pair with flipping `iterativeWork.enabled = false` in project.json to
   * also prevent future fires; this method ONLY clears the runtime tracking.
   * Returns whether anything was cleared.
   *
   * Use case: scheduler thinks a project is in-flight (so it won't re-fire)
   * but actually the consumer crashed without calling markComplete — OR the
   * opposite, jobs keep re-firing for the same key without backing off and
   * the operator wants to break the loop without a gateway restart.
   */
  forceClearProject(projectPath: string): { wasInFlight: boolean; hadLastFired: boolean } {
    const wasInFlight = this.inFlight.has(projectPath);
    const hadLastFired = this.lastFiredAt.has(projectPath);
    this.inFlight.delete(projectPath);
    this.inFlightStartedAt.delete(projectPath);
    if (wasInFlight || hadLastFired) {
      this.log.warn(`forceClearProject(${projectPath}) — wasInFlight=${String(wasInFlight)} hadLastFired=${String(hadLastFired)}`);
    }
    return { wasInFlight, hadLastFired };
  }

  /**
   * Force-clear ALL projects from in-flight + last-fired tracking. Nuclear
   * option for the runaway scenario when the operator can't identify which
   * project is looping. Returns counts.
   */
  forceClearAll(): { inFlightCleared: number; lastFiredCleared: number } {
    const inFlightCleared = this.inFlight.size;
    const lastFiredCleared = this.lastFiredAt.size;
    this.inFlight.clear();
    this.inFlightStartedAt.clear();
    if (inFlightCleared > 0 || lastFiredCleared > 0) {
      this.log.warn(`forceClearAll — cleared ${String(inFlightCleared)} in-flight + ${String(lastFiredCleared)} lastFired entries`);
    }
    return { inFlightCleared, lastFiredCleared };
  }

  /**
   * Read-only per-project introspection — the data behind the status API +
   * the eventual Settings UX. Returns null when the project has no config
   * file at all (callers can distinguish "unknown project" from "configured
   * but disabled" that way). nextFireAt is computed off lastFiredAt when
   * present, falling back to `now` so a never-fired project still surfaces a
   * meaningful next-due timestamp.
   */
  getStatus(projectPath: string, now: Date = new Date()): IterativeWorkProjectStatus | null {
    const config = this.deps.projectConfigManager.read(projectPath);
    if (config === null) return null;
    const iw = config.iterativeWork;
    const enabled = iw?.enabled === true;
    const cron = iw?.cron !== undefined && iw.cron.trim().length > 0 ? iw.cron : null;
    const cadence = (iw as { cadence?: string } | undefined)?.cadence ?? null;
    const lastFire = this.lastFiredAt.get(projectPath);
    const nextFire = cron !== null ? nextFireAfter(cron, lastFire ?? now) : null;
    return {
      enabled,
      cron,
      cadence,
      inFlight: this.inFlight.has(projectPath),
      lastFiredAt: lastFire?.toISOString() ?? null,
      nextFireAt: nextFire?.toISOString() ?? null,
    };
  }
}
