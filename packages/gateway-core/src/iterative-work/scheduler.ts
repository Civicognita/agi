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
import type { IterativeWorkArtifact, IterativeWorkCompletion, IterativeWorkLogEntry, IterativeWorkProjectStatus, ScheduledJobFire, ScheduledJobProjectStatus, ScheduledJobStatus, IterativeWorkSchedulerEvents } from "./types.js";

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
   * Mark a job's iteration as complete so the next due tick can fire.
   * MUST be called by the fire-event consumer when its handler finishes —
   * otherwise the job stays in-flight forever.
   */
  markComplete(projectPath: string, jobId: string): void {
    const key = `${projectPath}::${jobId}`;
    this.inFlight.delete(key);
    this.inFlightStartedAt.delete(key);
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
    jobId: string,
    outcome: { status: "done" | "error"; error?: string; now?: Date; artifact?: IterativeWorkArtifact },
  ): void {
    const key = `${projectPath}::${jobId}`;
    const buffer = this.iterationLog.get(key);
    if (buffer === undefined || buffer.length === 0) return;
    const head = buffer[0];
    if (head === undefined || head.status !== "running") return;
    const now = outcome.now ?? new Date();
    const startedAt = this.inFlightStartedAt.get(key);
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
   * Read-only snapshot of the per-job iteration log, most-recent-first.
   * `limit` defaults to the full buffer; values larger than the buffer are
   * silently capped. Empty array when the job has never fired.
   */
  getLog(projectPath: string, jobId: string, limit?: number): IterativeWorkLogEntry[] {
    const buffer = this.iterationLog.get(`${projectPath}::${jobId}`) ?? [];
    if (limit === undefined) return [...buffer];
    return buffer.slice(0, Math.max(0, limit));
  }

  /**
   * @deprecated Use getLog(projectPath, jobId, limit). Returns the log for
   * the first pm-loop job for this project (legacy API shim).
   */
  getLogLegacy(projectPath: string, limit?: number): IterativeWorkLogEntry[] {
    const config = this.deps.projectConfigManager.read(projectPath);
    const pmLoop = config?.scheduledJobs?.find(j => j.type === "pm-loop");
    if (!pmLoop) return [];
    return this.getLog(projectPath, pmLoop.id, limit);
  }

  /**
   * Run one tick synchronously. Public so tests + the "run now" UX surface
   * can advance the scheduler without waiting for the timer.
   * When `onlyJobId` is provided, only that specific job is evaluated (used
   * by the "run now" endpoint to trigger a single job immediately).
   */
  tick(now: Date = new Date(), onlyJobId?: string): void {
    const list = this.deps.listProjectPaths?.() ?? [];
    for (const projectPath of list) {
      const config = this.deps.projectConfigManager.read(projectPath);
      const jobs = config?.scheduledJobs ?? [];

      for (const job of jobs) {
        if (onlyJobId !== undefined && job.id !== onlyJobId) continue;
        if (!job.enabled) continue;
        if (!job.cron || job.cron.trim().length === 0) continue;

        const key = `${projectPath}::${job.id}`;
        if (this.inFlight.has(key)) continue;

        const lastFire = this.lastFiredAt.get(key);
        // When firing immediately (onlyJobId set), bypass the cron check.
        if (onlyJobId === undefined) {
          const since = lastFire ?? new Date(now.getTime() - 60_000);
          const nextFire = nextFireAfter(job.cron, since);
          if (nextFire === null) {
            this.log.warn(`job "${job.id}" on project "${projectPath}" has unparseable cron "${job.cron}" — skipping`);
            continue;
          }
          if (nextFire > now) continue;
        }

        const fire: ScheduledJobFire = {
          projectPath,
          job,
          firedAt: now,
          cron: job.cron,
        };
        this.inFlight.add(key);
        this.inFlightStartedAt.set(key, now);
        this.lastFiredAt.set(key, now);

        // s159 t693 — fire-rate tracking per job key.
        const recent = this.recentFiresByProject.get(key) ?? [];
        const cutoffMs = now.getTime() - FIRE_RATE_WINDOW_MS;
        const pruned = recent.filter((t) => t >= cutoffMs);
        pruned.push(now.getTime());
        this.recentFiresByProject.set(key, pruned);
        if (pruned.length >= FIRE_RATE_WARN_THRESHOLD) {
          this.log.warn(
            `fire-rate: job "${job.id}" (${job.type}) on "${projectPath}" fired ${String(pruned.length)} times in the last ${String(FIRE_RATE_WINDOW_MS / 1000)}s — possible runaway loop.`,
          );
        }

        // Push a "running" entry to the per-job ring buffer.
        const buffer = this.iterationLog.get(key) ?? [];
        const entry: IterativeWorkLogEntry = {
          firedAt: now.toISOString(),
          completedAt: null,
          durationMs: null,
          status: "running",
          cron: job.cron,
        };
        buffer.unshift(entry);
        while (buffer.length > this.logBufferSize) buffer.pop();
        this.iterationLog.set(key, buffer);
        this.log.info(`fire: ${projectPath} job=${job.id} type=${job.type} cron=${job.cron}`);
        this.emit("fire", fire);
      }
    }
  }

  /** Diagnostic: snapshot of current in-flight project paths. */
  getInFlight(): string[] {
    return [...this.inFlight];
  }

  /**
   * Diagnostic: how many times a job has fired in the rolling 60s window.
   * > FIRE_RATE_WARN_THRESHOLD means the scheduler logged a WARN. (s159 t693)
   */
  getRecentFireCount(projectPath: string, jobId: string, now: Date = new Date()): number {
    const recent = this.recentFiresByProject.get(`${projectPath}::${jobId}`);
    if (!recent) return 0;
    const cutoffMs = now.getTime() - FIRE_RATE_WINDOW_MS;
    return recent.filter((t) => t >= cutoffMs).length;
  }

  /**
   * Operator kill switch — force-clears in-flight + last-fired tracking for
   * one or all jobs on a project. When `jobId` is provided, clears only that
   * job. When omitted, clears ALL jobs for the project path.
   * Returns counts of what was cleared.
   */
  forceClearProject(projectPath: string, jobId?: string): { wasInFlight: number; hadLastFired: number } {
    let wasInFlight = 0;
    let hadLastFired = 0;
    const prefix = `${projectPath}::`;
    const keysToDelete = jobId
      ? [`${projectPath}::${jobId}`]
      : [...this.inFlight, ...this.lastFiredAt.keys()].filter(k => k.startsWith(prefix));

    for (const key of new Set(keysToDelete)) {
      if (this.inFlight.has(key)) { this.inFlight.delete(key); wasInFlight++; }
      this.inFlightStartedAt.delete(key);
      if (this.lastFiredAt.has(key)) { this.lastFiredAt.delete(key); hadLastFired++; }
    }
    if (wasInFlight > 0 || hadLastFired > 0) {
      this.log.warn(`forceClearProject(${projectPath}${jobId ? ` job=${jobId}` : ""}) — cleared ${String(wasInFlight)} in-flight, ${String(hadLastFired)} lastFired`);
    }
    return { wasInFlight, hadLastFired };
  }

  /**
   * Force-clear ALL jobs from in-flight + last-fired tracking. Nuclear option.
   */
  forceClearAll(): { inFlightCleared: number; lastFiredCleared: number } {
    const inFlightCleared = this.inFlight.size;
    const lastFiredCleared = this.lastFiredAt.size;
    this.inFlight.clear();
    this.inFlightStartedAt.clear();
    this.lastFiredAt.clear();
    if (inFlightCleared > 0 || lastFiredCleared > 0) {
      this.log.warn(`forceClearAll — cleared ${String(inFlightCleared)} in-flight + ${String(lastFiredCleared)} lastFired entries`);
    }
    return { inFlightCleared, lastFiredCleared };
  }

  /**
   * Per-project status: list of per-job snapshots. Returns null when project
   * has no config file. nextFireAt computed off lastFiredAt (or `now` if never fired).
   */
  getProjectStatus(projectPath: string, now: Date = new Date()): ScheduledJobProjectStatus | null {
    const config = this.deps.projectConfigManager.read(projectPath);
    if (config === null) return null;
    const jobs: ScheduledJobStatus[] = (config.scheduledJobs ?? []).map((job) => {
      const key = `${projectPath}::${job.id}`;
      const cron = job.cron && job.cron.trim().length > 0 ? job.cron : null;
      const lastFire = this.lastFiredAt.get(key);
      const nextFire = cron !== null ? nextFireAfter(cron, lastFire ?? now) : null;
      return {
        jobId: job.id,
        type: job.type,
        name: job.name,
        enabled: job.enabled,
        cron,
        cadence: job.cadence ?? null,
        inFlight: this.inFlight.has(key),
        lastFiredAt: lastFire?.toISOString() ?? null,
        nextFireAt: nextFire?.toISOString() ?? null,
      };
    });
    return { jobs };
  }

  /**
   * @deprecated Use getProjectStatus(). Returns a legacy IterativeWorkProjectStatus
   * by mapping the first pm-loop job to the old shape. Kept for the API shim.
   */
  getStatus(projectPath: string, now: Date = new Date()): IterativeWorkProjectStatus | null {
    const config = this.deps.projectConfigManager.read(projectPath);
    if (config === null) return null;
    const pmLoop = config.scheduledJobs?.find(j => j.type === "pm-loop");
    if (!pmLoop) {
      return { enabled: false, cron: null, cadence: null, inFlight: false, lastFiredAt: null, nextFireAt: null };
    }
    const key = `${projectPath}::${pmLoop.id}`;
    const cron = pmLoop.cron && pmLoop.cron.trim().length > 0 ? pmLoop.cron : null;
    const lastFire = this.lastFiredAt.get(key);
    const nextFire = cron !== null ? nextFireAfter(cron, lastFire ?? now) : null;
    return {
      enabled: pmLoop.enabled,
      cron,
      cadence: pmLoop.cadence ?? null,
      inFlight: this.inFlight.has(key),
      lastFiredAt: lastFire?.toISOString() ?? null,
      nextFireAt: nextFire?.toISOString() ?? null,
    };
  }
}
