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
import type { IterativeWorkFire, IterativeWorkSchedulerEvents } from "./types.js";

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
  logger?: Logger;
}

const DEFAULT_TICK_MS = 30_000;
const MIN_TICK_MS = 1_000;

export class IterativeWorkScheduler extends EventEmitter<IterativeWorkSchedulerEvents> {
  private timer?: ReturnType<typeof setInterval>;
  private readonly inFlight = new Set<string>();
  private readonly lastFiredAt = new Map<string, Date>();
  private readonly log: ComponentLogger;
  private readonly tickIntervalMs: number;

  constructor(private readonly deps: IterativeWorkSchedulerDeps) {
    super();
    this.log = createComponentLogger(deps.logger, "iterative-work-scheduler");
    const requested = deps.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.tickIntervalMs = Math.max(MIN_TICK_MS, requested);
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
    this.log.info("scheduler stopped");
  }

  /**
   * Mark a project's iteration as complete so the next due tick can fire.
   * MUST be called by the fire-event consumer when its handler finishes —
   * otherwise the project stays in-flight forever.
   */
  markComplete(projectPath: string): void {
    this.inFlight.delete(projectPath);
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
      this.lastFiredAt.set(projectPath, now);
      this.log.info(`fire: ${projectPath} (cron=${iw.cron})`);
      this.emit("fire", fire);
    }
  }

  /** Diagnostic: snapshot of current in-flight project paths. */
  getInFlight(): string[] {
    return [...this.inFlight];
  }
}
