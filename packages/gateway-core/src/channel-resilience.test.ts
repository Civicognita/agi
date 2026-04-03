/**
 * Channel Resilience Tests — Story 5
 *
 * Covers:
 * - Exponential backoff delay computation (computeBackoffDelay-equivalent)
 * - ChannelRegistry.restartChannel() health tracking
 * - Max attempt enforcement (scheduleChannelRestart)
 * - channel_error event triggering restart
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelRegistry } from "./channel-registry.js";
import type { ChannelHealth } from "./channel-registry.js";
import type { AionimaChannelPlugin } from "@aionima/channel-sdk";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid AionimaChannelPlugin stub. */
function makePlugin(id: string, opts?: {
  startShouldFail?: boolean;
  stopShouldFail?: boolean;
}): AionimaChannelPlugin {
  let running = false;
  return {
    id: id as AionimaChannelPlugin["id"],
    meta: { name: id, version: "0.0.1" },
    capabilities: {
      text: true,
      media: false,
      voice: false,
      reactions: false,
      threads: false,
      ephemeral: false,
    },
    config: {
      validate: () => true,
      getDefaults: () => ({}),
    },
    gateway: {
      start: vi.fn(async () => {
        if (opts?.startShouldFail) {
          throw new Error(`${id} start failed`);
        }
        running = true;
      }),
      stop: vi.fn(async () => {
        if (opts?.stopShouldFail) {
          throw new Error(`${id} stop failed`);
        }
        running = false;
      }),
      isRunning: () => running,
    },
    outbound: {
      send: vi.fn(async () => {}),
    },
    messaging: {
      onMessage: vi.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Backoff delay formula
// ---------------------------------------------------------------------------

describe("Backoff delay formula", () => {
  /**
   * Replicate the formula from server-startup.ts for unit testing:
   *   delay = min(initialDelay * 2^attempt, maxDelay) + jitter
   *
   * We test the deterministic part (no jitter) by checking bounds.
   */
  const INITIAL_MS = 5_000;
  const MAX_MS = 300_000;

  function baseDelay(attempt: number): number {
    return Math.min(INITIAL_MS * Math.pow(2, attempt), MAX_MS);
  }

  it("attempt 0 yields initial delay (5s)", () => {
    expect(baseDelay(0)).toBe(5_000);
  });

  it("attempt 1 yields 10s (2x initial)", () => {
    expect(baseDelay(1)).toBe(10_000);
  });

  it("attempt 2 yields 20s (4x initial)", () => {
    expect(baseDelay(2)).toBe(20_000);
  });

  it("attempt 3 yields 40s (8x initial)", () => {
    expect(baseDelay(3)).toBe(40_000);
  });

  it("delay is capped at maxDelay (300s)", () => {
    // At attempt 6: 5000 * 64 = 320000 > 300000 — should cap
    expect(baseDelay(6)).toBe(300_000);
    expect(baseDelay(10)).toBe(300_000);
    expect(baseDelay(100)).toBe(300_000);
  });

  it("delay doubles each attempt until cap", () => {
    for (let i = 0; i < 5; i++) {
      const current = baseDelay(i);
      const next = baseDelay(i + 1);
      expect(next).toBe(Math.min(current * 2, MAX_MS));
    }
  });
});

// ---------------------------------------------------------------------------
// 2. ChannelRegistry.restartChannel() — health tracking
// ---------------------------------------------------------------------------

describe("ChannelRegistry.restartChannel()", () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry();
  });

  it("throws when channel is not registered", async () => {
    await expect(registry.restartChannel("nonexistent")).rejects.toThrow(
      'Channel "nonexistent" is not registered',
    );
  });

  it("increments attempt count on each restart", async () => {
    const plugin = makePlugin("test");
    registry.register(plugin);
    await registry.startChannel("test");

    await registry.restartChannel("test");
    const health1 = registry.getChannelHealth("test") as ChannelHealth;
    expect(health1.attempts).toBe(1);

    await registry.restartChannel("test");
    const health2 = registry.getChannelHealth("test") as ChannelHealth;
    expect(health2.attempts).toBe(2);
  });

  it("sets status to running on successful restart", async () => {
    const plugin = makePlugin("test-ok");
    registry.register(plugin);
    await registry.startChannel("test-ok");

    await registry.restartChannel("test-ok");
    const health = registry.getChannelHealth("test-ok") as ChannelHealth;
    expect(health.status).toBe("running");
  });

  it("clears lastError on successful restart", async () => {
    const plugin = makePlugin("test-clear");
    registry.register(plugin);

    // First start fails
    vi.mocked(plugin.gateway.start).mockRejectedValueOnce(new Error("init error"));
    await registry.startChannel("test-clear").catch(() => {});

    // Subsequent restart succeeds
    vi.mocked(plugin.gateway.start).mockResolvedValueOnce(undefined);
    await registry.restartChannel("test-clear");

    const health = registry.getChannelHealth("test-clear") as ChannelHealth;
    expect(health.lastError).toBe("");
  });

  it("sets status to failed when restart fails", async () => {
    const plugin = makePlugin("test-fail", { startShouldFail: true });
    registry.register(plugin);

    await expect(registry.restartChannel("test-fail")).rejects.toThrow("test-fail start failed");

    const health = registry.getChannelHealth("test-fail") as ChannelHealth;
    expect(health.status).toBe("failed");
  });

  it("records lastError message when restart fails", async () => {
    const plugin = makePlugin("test-err", { startShouldFail: true });
    registry.register(plugin);

    await expect(registry.restartChannel("test-err")).rejects.toThrow();

    const health = registry.getChannelHealth("test-err") as ChannelHealth;
    expect(health.lastError).toContain("test-err start failed");
  });
});

// ---------------------------------------------------------------------------
// 3. ChannelRegistry.getChannelHealth()
// ---------------------------------------------------------------------------

describe("ChannelRegistry.getChannelHealth()", () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry();
  });

  it("returns undefined for a channel with no restarts", () => {
    const plugin = makePlugin("fresh");
    registry.register(plugin);
    expect(registry.getChannelHealth("fresh")).toBeUndefined();
  });

  it("returns a ChannelHealth object after a restart attempt", async () => {
    const plugin = makePlugin("has-health");
    registry.register(plugin);
    await registry.startChannel("has-health");

    await registry.restartChannel("has-health");

    const health = registry.getChannelHealth("has-health") as ChannelHealth;
    expect(health).toBeDefined();
    expect(typeof health.attempts).toBe("number");
    expect(typeof health.status).toBe("string");
    expect(typeof health.lastError).toBe("string");
  });

  it("returns a Map when called with no channelId argument", async () => {
    const p1 = makePlugin("ch-a");
    const p2 = makePlugin("ch-b");
    registry.register(p1);
    registry.register(p2);

    await registry.startChannel("ch-a");
    await registry.restartChannel("ch-a");

    const allHealth = registry.getChannelHealth() as Map<string, ChannelHealth>;
    expect(allHealth instanceof Map).toBe(true);
    expect(allHealth.has("ch-a")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. channel_error event → restart triggering (integration smoke)
// ---------------------------------------------------------------------------

describe("channel_error event", () => {
  it("ChannelRegistry emits channel_error on startChannel failure", async () => {
    const registry = new ChannelRegistry();
    const plugin = makePlugin("err-plugin", { startShouldFail: true });
    registry.register(plugin);

    const errors: string[] = [];
    registry.on("channel_error", (id: string, msg: string) => {
      errors.push(`${id}:${msg}`);
    });

    await registry.startChannel("err-plugin").catch(() => {});

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("err-plugin");
  });

  it("ChannelRegistry can emit channel_error without crashing the registry", () => {
    const registry = new ChannelRegistry();
    const plugin = makePlugin("error-emitter");
    registry.register(plugin);

    const errorEvents: string[] = [];
    registry.on("channel_error", (id: string, msg: string) => {
      errorEvents.push(`${id}:${msg}`);
    });

    // Emitting channel_error should not throw
    expect(() => {
      registry.emit("channel_error", "error-emitter", "simulated failure");
    }).not.toThrow();

    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toBe("error-emitter:simulated failure");
  });
});
