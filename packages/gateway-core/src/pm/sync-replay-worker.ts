/**
 * Sync replay worker — s155 t672 Phase 6.
 *
 * Periodically attempts to replay queued writes against primary, then
 * reads back to detect divergence between primary's state and
 * TynnLite's state via the Phase 4 conflict-detection module.
 *
 * Lifecycle: created with `new SyncReplayWorker(...)`, started via
 * `start()` (begins the interval tick), stopped via `stop()`. Single-
 * tick reentrant: a second `start()` while running is a no-op.
 *
 * Tick behavior:
 *   1. Read pending entries from `sync-queue.jsonl` (Phase 1).
 *   2. For each entry: invoke `<primary>[entry.method](...entry.args)`.
 *      - Success: mark for drain.
 *      - Throw / error-shaped payload: bumpAttempts (Phase 1).
 *   3. After all replays processed, drainSyncQueue with the success set.
 *   4. (Optional, when `enableReadBackDiff: true`): for each successful
 *      replay against a task-typed primary call, read the task back +
 *      diff against TynnLite via `detectConflicts` (Phase 4); record
 *      any divergences via `recordSyncConflict` (Phase 1).
 *
 * Default-disabled (`enabled: false`) — owner opts in via gateway.json
 * once Phase 5's REST/UI surface lands. The worker constructs cheaply
 * + safely; calling `start()` on a disabled instance is a no-op.
 *
 * Side-channel discipline: tick errors NEVER throw. The worker is
 * defensive: any error during replay/diff is logged + the entry stays
 * queued (with bumped attempts) for the next tick. A poisoned entry
 * (always errors) accumulates attempts that an operator can clear via
 * `agi issue raw clear` (or a future `agi pm sync clear` command).
 */

import type { PmProvider, PmTask } from "@agi/sdk";
import type { TynnLitePmProvider } from "./tynn-lite-provider.js";
import { bumpAttempts, drainSyncQueue, readSyncQueue, recordSyncConflict } from "./sync-queue.js";
import { detectConflicts } from "./conflict-detection.js";

export interface SyncReplayWorkerOptions {
  /** Whether to start the interval at all. Default false. */
  enabled?: boolean;
  /**
   * Tick interval in milliseconds. Default 5min — owner can lower for
   * test VMs or raise for cloud-cost scenarios.
   */
  tickIntervalMs?: number;
  /** Primary provider to replay against. */
  primary: PmProvider;
  /** TynnLite provider — used for read-back diff against primary. */
  lite: TynnLitePmProvider;
  /**
   * When true, after each successful replay, read the task back from
   * primary + diff against TynnLite. Records conflicts via Phase 1's
   * `recordSyncConflict`. Default true; the conflict log is the main
   * output of the worker. Set false to test replay-only behavior.
   */
  enableReadBackDiff?: boolean;
  /** Optional logger for diagnostic events. */
  logger?: { info(msg: string): void; warn(msg: string): void };
}

const DEFAULT_TICK_MS = 5 * 60 * 1000;

export class SyncReplayWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly enabled: boolean;
  private readonly tickIntervalMs: number;
  private readonly primary: PmProvider;
  private readonly lite: TynnLitePmProvider;
  private readonly enableReadBackDiff: boolean;
  private readonly logger?: { info(msg: string): void; warn(msg: string): void };

  constructor(opts: SyncReplayWorkerOptions) {
    this.enabled = opts.enabled ?? false;
    this.tickIntervalMs = opts.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.primary = opts.primary;
    this.lite = opts.lite;
    this.enableReadBackDiff = opts.enableReadBackDiff ?? true;
    this.logger = opts.logger;
  }

  /** Start the periodic tick. No-op when disabled or already running. */
  start(): void {
    if (!this.enabled || this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        this.logger?.warn(`sync-replay tick error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, this.tickIntervalMs);
  }

  /** Stop the periodic tick. No-op when not running. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Run one replay cycle. Public for testing + manual operator triggers
   * (e.g. an `agi pm sync replay` CLI command in a future slice).
   *
   * Returns a summary of the cycle (counts).
   */
  async tick(): Promise<{ scanned: number; succeeded: number; failed: number; conflicts: number }> {
    if (this.running) {
      // Re-entrancy guard — if a previous tick is still mid-flight,
      // skip this one rather than overlapping.
      this.logger?.info("sync-replay: previous tick still running; skipping");
      return { scanned: 0, succeeded: 0, failed: 0, conflicts: 0 };
    }
    this.running = true;
    try {
      const queue = readSyncQueue();
      const succeededIds = new Set<string>();
      let failed = 0;
      let conflicts = 0;

      for (const entry of queue) {
        try {
          const replayResult = await this.replayEntry(entry.method, entry.args);
          succeededIds.add(entry.id);

          if (this.enableReadBackDiff) {
            const detected = await this.diffReplayResult(entry, replayResult);
            for (const c of detected) {
              recordSyncConflict(c);
              conflicts++;
            }
          }
        } catch (err) {
          failed++;
          bumpAttempts(entry.id);
          this.logger?.info(
            `sync-replay: entry ${entry.id} (${entry.method}) failed on replay: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (succeededIds.size > 0) {
        drainSyncQueue(succeededIds);
      }

      return { scanned: queue.length, succeeded: succeededIds.size, failed, conflicts };
    } finally {
      this.running = false;
    }
  }

  /**
   * Invoke a method on the primary provider with the queued args.
   * Type-narrowed at runtime — args[0/1/2/...] casts as needed.
   * Throws on unknown method or primary error.
   */
  private async replayEntry(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case "setTaskStatus":
        return this.primary.setTaskStatus(args[0] as string, args[1] as PmTask["status"], args[2] as string | undefined);
      case "addComment":
        return this.primary.addComment(args[0] as "task" | "story" | "version", args[1] as string, args[2] as string);
      case "updateTask":
        return this.primary.updateTask(args[0] as string, args[1] as Partial<PmTask>);
      case "createTask":
        return this.primary.createTask(args[0] as Parameters<PmProvider["createTask"]>[0]);
      case "iWish":
        return this.primary.iWish(args[0] as Parameters<PmProvider["iWish"]>[0]);
      default:
        throw new Error(`sync-replay: unknown method "${method}"`);
    }
  }

  /**
   * After a successful replay, read the task back from primary + diff
   * against TynnLite. Returns conflict descriptors (caller writes them
   * to the conflict log). Only meaningful for task-typed mutations;
   * comment / wish / iWish replays return early with no diff.
   */
  private async diffReplayResult(
    entry: { method: string; args: unknown[]; projectPath: string },
    replayResult: unknown,
  ): Promise<ReturnType<typeof detectConflicts>> {
    // Only task mutations have a primary-readable record + lite-side
    // counterpart we can diff. Comments + wishes are append-only on
    // both sides; no LWW resolution to do.
    if (entry.method !== "setTaskStatus" && entry.method !== "updateTask" && entry.method !== "createTask") {
      return [];
    }

    const replayTask = replayResult as PmTask | null;
    if (!replayTask || typeof replayTask !== "object" || !("id" in replayTask)) return [];

    const liteTask = await this.lite.getTask(replayTask.id);
    if (!liteTask) return [];

    const liteTimestamps = this.lite.getTaskFieldTimestamps(replayTask.id);
    if (!liteTimestamps) return [];

    return detectConflicts({
      projectPath: entry.projectPath,
      entityType: "task",
      entityId: replayTask.id,
      primary: {
        title: replayTask.title,
        description: replayTask.description,
        status: replayTask.status,
        codeArea: replayTask.codeArea,
        verificationSteps: replayTask.verificationSteps,
      },
      lite: {
        title: liteTask.title,
        description: liteTask.description,
        status: liteTask.status,
        codeArea: liteTask.codeArea,
        verificationSteps: liteTask.verificationSteps,
      },
      liteTimestamps,
      // Most PmProviders don't expose primary-side timestamps; LWW
      // defaults to lite-wins per ADR floor stance.
    });
  }
}
