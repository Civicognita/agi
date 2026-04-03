/**
 * ScheduledTaskManager — runs plugin-registered scheduled tasks
 * using setInterval for interval tasks and basic cron parsing.
 */

import type { PluginRegistry } from "@aionima/plugins";
import type { Logger } from "./logger.js";
import { createComponentLogger } from "./logger.js";

interface RunningTask {
  taskId: string;
  pluginId: string;
  timer: ReturnType<typeof setInterval>;
  running: boolean;
  enabled: boolean;
  lastRun?: Date;
  lastError?: string;
}

export class ScheduledTaskManager {
  private readonly tasks = new Map<string, RunningTask>();
  private readonly log;

  constructor(private readonly deps: { pluginRegistry: PluginRegistry; logger?: Logger }) {
    this.log = createComponentLogger(deps.logger, "scheduled-tasks");
  }

  /** Start all enabled scheduled tasks from plugin registry. */
  start(): void {
    for (const { pluginId, task } of this.deps.pluginRegistry.getScheduledTasks()) {
      if (task.enabled === false) continue;

      const intervalMs = task.intervalMs ?? this.parseCronToMs(task.cron);
      if (!intervalMs || intervalMs < 1000) {
        this.log.warn(`task "${task.id}" from "${pluginId}" has invalid interval — skipping`);
        continue;
      }

      const running: RunningTask = {
        taskId: task.id,
        pluginId,
        running: false,
        enabled: true,
        timer: setInterval(() => void this.executeTask(running, task), intervalMs),
      };

      this.tasks.set(task.id, running);
      this.log.info(`scheduled task "${task.id}" from "${pluginId}" (every ${String(intervalMs)}ms)`);
    }
  }

  /** Stop all running tasks. */
  stop(): void {
    for (const task of this.tasks.values()) {
      clearInterval(task.timer);
    }
    this.tasks.clear();
  }

  /** Get status of all tasks. */
  getStatus(): Array<{ id: string; pluginId: string; enabled: boolean; running: boolean; lastRun?: string; lastError?: string }> {
    return [...this.tasks.values()].map((t) => ({
      id: t.taskId,
      pluginId: t.pluginId,
      enabled: t.enabled,
      running: t.running,
      lastRun: t.lastRun?.toISOString(),
      lastError: t.lastError,
    }));
  }

  private async executeTask(state: RunningTask, task: { handler?: () => Promise<void>; skipIfRunning?: boolean }): Promise<void> {
    if (task.skipIfRunning && state.running) return;
    if (!state.enabled) return;

    state.running = true;
    state.lastError = undefined;
    try {
      await (task as { handler: () => Promise<void> }).handler();
      state.lastRun = new Date();
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err);
      this.log.error(`task "${state.taskId}" failed: ${state.lastError}`);
    } finally {
      state.running = false;
    }
  }

  /** Simple cron-to-interval conversion for common patterns. */
  private parseCronToMs(cron?: string): number | null {
    if (!cron) return null;
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    // Every N minutes: */N * * * *
    if (parts[0]?.startsWith("*/") && parts.slice(1).every((p) => p === "*")) {
      return parseInt(parts[0].slice(2), 10) * 60_000;
    }
    // Every hour: 0 * * * *
    if (parts[0] === "0" && parts.slice(1).every((p) => p === "*")) {
      return 3_600_000;
    }
    // Every day at midnight: 0 0 * * *
    if (parts[0] === "0" && parts[1] === "0" && parts.slice(2).every((p) => p === "*")) {
      return 86_400_000;
    }

    return null;
  }
}
