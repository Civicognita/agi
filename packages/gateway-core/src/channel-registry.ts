import { EventEmitter } from "node:events";

import type { AionimaChannelPlugin } from "@agi/channel-sdk";
import { assertValidAdapter } from "@agi/channel-sdk";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lifecycle state of a registered channel plugin. */
export type ChannelStatus =
  | "registered"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

/** Health state for a channel, tracked for dashboard visibility. */
export type ChannelHealthStatus = "running" | "failed" | "restarting";

/** Health state snapshot for a channel. */
export interface ChannelHealth {
  status: ChannelHealthStatus;
  /** Number of restart attempts made. */
  attempts: number;
  /** Last error message, if any. */
  lastError: string;
}

/** A single entry in the channel registry. */
export interface ChannelEntry {
  plugin: AionimaChannelPlugin;
  status: ChannelStatus;
  /** ISO timestamp of when the plugin was registered. */
  registeredAt: string;
  /** Last error message, set when status is "error". */
  error?: string;
}

// ---------------------------------------------------------------------------
// ChannelRegistry
// ---------------------------------------------------------------------------

/**
 * Registry for `AionimaChannelPlugin` instances — validates, stores, and manages
 * the lifecycle (start/stop) of all registered channel adapters.
 *
 * Emits lifecycle events: `"channel_registered"`, `"channel_unregistered"`,
 * `"channel_started"`, `"channel_stopped"`, `"channel_error"`.
 *
 * @example
 * const registry = new ChannelRegistry();
 * registry.on("channel_started", (id) => console.log(`${id} is live`));
 * registry.register(telegramPlugin);
 * await registry.startAll();
 */
export class ChannelRegistry extends EventEmitter {
  private readonly channels: Map<string, ChannelEntry> = new Map();
  private readonly health: Map<string, ChannelHealth> = new Map();
  private readonly log: ComponentLogger;

  constructor(logger?: Logger) {
    super();
    this.log = createComponentLogger(logger, "channel-registry");
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a channel plugin.
   *
   * Validates the plugin via `assertValidAdapter()` before storing it.
   * Throws if the plugin is invalid or a plugin with the same id is already
   * registered.
   *
   * Emits `"channel_registered"` with the channel id on success.
   *
   * @throws {Error} If validation fails or the id is already registered.
   */
  register(plugin: AionimaChannelPlugin): void {
    const id = plugin.id as string;

    if (this.channels.has(id)) {
      throw new Error(`Channel "${id}" is already registered`);
    }

    // Throws with a descriptive message on any validation failure
    assertValidAdapter(plugin);

    const entry: ChannelEntry = {
      plugin,
      status: "registered",
      registeredAt: new Date().toISOString(),
    };

    this.channels.set(id, entry);
    this.emit("channel_registered", id);
  }

  /**
   * Unregister a channel plugin by id.
   *
   * If the channel is currently running, it is stopped first (errors are
   * logged but do not prevent removal from the registry).
   *
   * Emits `"channel_unregistered"` with the channel id after removal.
   */
  unregister(channelId: string): void {
    const entry = this.channels.get(channelId);
    if (entry === undefined) {
      return;
    }

    if (entry.status === "running") {
      // Fire-and-forget stop; errors are swallowed here so the channel is
      // always removed from the registry regardless of stop outcome.
      this.stopChannel(channelId).catch((err: unknown) => {
        this.log.error(
          `error stopping "${channelId}" during unregister: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    this.channels.delete(channelId);
    this.emit("channel_unregistered", channelId);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle — individual channels
  // ---------------------------------------------------------------------------

  /**
   * Start a single channel by id.
   *
   * Transitions the entry through `"starting"` → `"running"` on success, or
   * `"starting"` → `"error"` on failure.
   *
   * Emits `"channel_started"` on success, `"channel_error"` on failure.
   *
   * @throws {Error} If no channel with the given id is registered.
   */
  async startChannel(channelId: string): Promise<void> {
    const entry = this.channels.get(channelId);
    if (entry === undefined) {
      throw new Error(`Channel "${channelId}" is not registered`);
    }

    entry.status = "starting";

    try {
      await entry.plugin.gateway.start();
      entry.status = "running";
      entry.error = undefined;
      this.emit("channel_started", channelId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      entry.status = "error";
      entry.error = message;
      this.emit("channel_error", channelId, message);
      throw err;
    }
  }

  /**
   * Stop a single channel by id.
   *
   * Transitions the entry through `"stopping"` → `"stopped"` on success.
   *
   * Emits `"channel_stopped"` on success.
   *
   * @throws {Error} If no channel with the given id is registered.
   */
  async stopChannel(channelId: string): Promise<void> {
    const entry = this.channels.get(channelId);
    if (entry === undefined) {
      throw new Error(`Channel "${channelId}" is not registered`);
    }

    entry.status = "stopping";

    try {
      await entry.plugin.gateway.stop();
      entry.status = "stopped";
      entry.error = undefined;
      this.emit("channel_stopped", channelId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      entry.status = "error";
      entry.error = message;
      this.emit("channel_error", channelId, message);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle — bulk operations
  // ---------------------------------------------------------------------------

  /**
   * Start all registered channels in parallel.
   *
   * Individual channel errors are emitted as `"channel_error"` events and do
   * not prevent other channels from starting. This method always resolves.
   */
  async startAll(): Promise<void> {
    const ids = Array.from(this.channels.keys());

    await Promise.allSettled(
      ids.map((id) =>
        this.startChannel(id).catch((err: unknown) => {
          this.log.error(
            `failed to start "${id}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }),
      ),
    );
  }

  /**
   * Stop all running channels in parallel.
   *
   * Only channels with status `"running"` are stopped. Individual errors are
   * emitted as `"channel_error"` events and do not prevent other channels from
   * stopping. This method always resolves.
   */
  async stopAll(): Promise<void> {
    const runningIds = this.getRunningChannels().map(
      (entry) => entry.plugin.id as string,
    );

    await Promise.allSettled(
      runningIds.map((id) =>
        this.stopChannel(id).catch((err: unknown) => {
          this.log.error(
            `failed to stop "${id}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Resilience — restart with backoff
  // ---------------------------------------------------------------------------

  /**
   * Restart a channel by id, updating health state for dashboard visibility.
   *
   * Transitions the entry to `"restarting"` state and increments the attempt
   * counter. On success, health status moves to `"running"`. On failure,
   * health status moves to `"failed"` and the error is recorded.
   *
   * Does not implement the backoff delay itself — callers (server-startup.ts)
   * must schedule the delay before calling this.
   *
   * @throws {Error} If no channel with the given id is registered.
   */
  async restartChannel(channelId: string): Promise<void> {
    const entry = this.channels.get(channelId);
    if (entry === undefined) {
      throw new Error(`Channel "${channelId}" is not registered`);
    }

    const existing = this.health.get(channelId) ?? { status: "restarting" as const, attempts: 0, lastError: "" };
    const attempts = existing.attempts + 1;
    this.health.set(channelId, { status: "restarting", attempts, lastError: existing.lastError });

    try {
      // Stop first if currently in error/running state
      if (entry.status === "running") {
        try {
          await this.stopChannel(channelId);
        } catch {
          // Swallow stop errors during restart
        }
      }

      await this.startChannel(channelId);
      this.health.set(channelId, { status: "running", attempts, lastError: "" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.health.set(channelId, { status: "failed", attempts, lastError: message });
      throw err;
    }
  }

  /**
   * Return the health state for a channel, or undefined if not tracked.
   *
   * Health tracking begins on the first restart attempt. Channels that start
   * cleanly without errors may not have a health entry.
   */
  getChannelHealth(channelId?: string): Map<string, ChannelHealth> | ChannelHealth | undefined {
    if (channelId !== undefined) {
      return this.health.get(channelId);
    }
    return new Map(this.health);
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /**
   * Return the registry entry for a channel, or `undefined` if not found.
   */
  getChannel(channelId: string): ChannelEntry | undefined {
    return this.channels.get(channelId);
  }

  /** Return all registered channel entries. */
  getChannels(): ChannelEntry[] {
    return Array.from(this.channels.values());
  }

  /** Return only the entries whose status is `"running"`. */
  getRunningChannels(): ChannelEntry[] {
    return Array.from(this.channels.values()).filter(
      (entry) => entry.status === "running",
    );
  }
}
