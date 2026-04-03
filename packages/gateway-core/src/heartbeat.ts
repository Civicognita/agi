import { readFileSync } from "node:fs";
import type { AgentInvoker } from "./agent-invoker.js";
import type { EntityStore } from "@aionima/entity-model";
import type { COAChainLogger } from "@aionima/coa-chain";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";

export interface HeartbeatSchedulerDeps {
  /** Interval between heartbeats in ms (default: 3600000 = 1 hour). */
  intervalMs: number;
  /** Path to HEARTBEAT.md prompt file. */
  promptPath: string;
  /** Agent invoker for executing heartbeat prompts. */
  agentInvoker: AgentInvoker;
  /** Entity store for resolving/creating system entity. */
  entityStore: EntityStore;
  /** COA logger for heartbeat accountability. */
  coaLogger: COAChainLogger;
  /** Gateway resource ID (e.g. "$A0"). */
  resourceId: string;
  /** Gateway node ID (e.g. "@A0"). */
  nodeId: string;
  /** Optional logger instance. */
  logger?: Logger;
}

export class HeartbeatScheduler {
  private readonly deps: HeartbeatSchedulerDeps;
  private readonly log: ComponentLogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(deps: HeartbeatSchedulerDeps) {
    this.deps = deps;
    this.log = createComponentLogger(deps.logger, "heartbeat");
  }

  start(): void {
    if (this.timer !== null) return;

    this.log.info(`started (interval: ${String(this.deps.intervalMs)}ms)`);

    this.timer = setInterval(() => {
      void this.tick();
    }, this.deps.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.log.info("stopped");
    }
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.log.info("skipping — previous heartbeat still running");
      return;
    }

    this.running = true;
    try {
      // Read heartbeat prompt
      let prompt: string;
      try {
        prompt = readFileSync(this.deps.promptPath, "utf-8").trim();
      } catch {
        // HEARTBEAT.md missing — skip silently
        return;
      }

      if (prompt.length === 0) return;

      // Create/resolve system entity for heartbeat
      const systemEntity = this.deps.entityStore.resolveOrCreate(
        "system",
        "$HEARTBEAT",
        "Heartbeat System",
      );

      // Heartbeat tracking ID (COA entry only created at invocation DONE)
      const coaFingerprint = `${this.deps.resourceId}.${systemEntity.coaAlias}.${this.deps.nodeId}.heartbeat`;

      this.log.info("executing heartbeat prompt...");

      await this.deps.agentInvoker.process({
        entity: systemEntity,
        channel: "system",
        content: prompt,
        coaFingerprint,
        queueMessageId: `heartbeat-${Date.now()}`,
      });

      this.log.info("heartbeat complete");
    } catch (err) {
      this.log.error(
        `error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
