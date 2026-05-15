/**
 * Circuit-breaker integration tests — s143 t569
 *
 * Verifies that ChannelRegistry.startChannel and the plugin-loader path both
 * gate on shouldSkip and record success/failure, mirroring the hosting-manager
 * wiring shipped in t568. Pure-logic — runs on host.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ChannelRegistry } from "./channel-registry.js";
import { CircuitBreakerTracker } from "./circuit-breaker.js";
import { SystemConfigService } from "./system-config-service.js";
import type { AionimaChannelPlugin } from "@agi/plugins";

function makeTmpConfig(): { path: string; cleanup: () => void } {
  const dir = join(tmpdir(), `cb-integration-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "gateway.json");
  writeFileSync(path, "{}", "utf-8");
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function makePlugin(id: string, opts?: { startShouldFail?: boolean }): AionimaChannelPlugin {
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
    config: { validate: () => true, getDefaults: () => ({}) },
    gateway: {
      start: vi.fn(async () => {
        if (opts?.startShouldFail) throw new Error(`${id} start failed`);
        running = true;
      }),
      stop: vi.fn(async () => { running = false; }),
      isRunning: () => running,
    },
    outbound: { send: vi.fn(async () => {}) },
    messaging: { onMessage: vi.fn() },
  };
}

describe("ChannelRegistry × CircuitBreakerTracker (s143 t569)", () => {
  let cfg: ReturnType<typeof makeTmpConfig>;
  let svc: SystemConfigService;
  let tracker: CircuitBreakerTracker;
  let registry: ChannelRegistry;
  const clock = { current: new Date("2026-05-09T06:00:00Z") };

  beforeEach(() => {
    cfg = makeTmpConfig();
    svc = new SystemConfigService({ configPath: cfg.path });
    clock.current = new Date("2026-05-09T06:00:00Z");
    tracker = new CircuitBreakerTracker({ configService: svc, now: () => clock.current });
    registry = new ChannelRegistry();
    registry.setCircuitBreaker(tracker);
  });

  it("records success on a clean start", async () => {
    const plugin = makePlugin("slack");
    registry.register(plugin);
    await registry.startChannel("slack");
    // No failure ever recorded — tracker has no state for this serviceId.
    expect(tracker.getState("channel:slack")).toBeUndefined();
  });

  it("records failure when the adapter's start throws", async () => {
    const plugin = makePlugin("discord", { startShouldFail: true });
    registry.register(plugin);
    await expect(registry.startChannel("discord")).rejects.toThrow("discord start failed");
    expect(tracker.getState("channel:discord")).toMatchObject({ failures: 1, status: "closed" });
  });

  it("trips the breaker after threshold, then skips subsequent starts without invoking adapter.start", async () => {
    const plugin = makePlugin("telegram", { startShouldFail: true });
    registry.register(plugin);
    // 3 failures = threshold (default).
    await expect(registry.startChannel("telegram")).rejects.toThrow("telegram start failed");
    await expect(registry.startChannel("telegram")).rejects.toThrow("telegram start failed");
    await expect(registry.startChannel("telegram")).rejects.toThrow("telegram start failed");
    expect(tracker.getState("channel:telegram")?.status).toBe("open");
    expect(plugin.gateway.start).toHaveBeenCalledTimes(3);

    // 4th attempt: should be skipped by breaker — adapter.start MUST NOT be invoked.
    await expect(registry.startChannel("telegram")).rejects.toThrow(/circuit open/);
    expect(plugin.gateway.start).toHaveBeenCalledTimes(3);
    // Failures counter doesn't increment when the breaker pre-empts the call.
    expect(tracker.getState("channel:telegram")?.failures).toBe(3);
  });

  it("clears state on success after prior failures", async () => {
    const plugin = makePlugin("matrix", { startShouldFail: true });
    registry.register(plugin);
    await expect(registry.startChannel("matrix")).rejects.toThrow();
    expect(tracker.getState("channel:matrix")?.failures).toBe(1);

    // Swap in a healthy start — same plugin id, fresh start fn.
    plugin.gateway.start = vi.fn(async () => {});
    await registry.startChannel("matrix");
    expect(tracker.getState("channel:matrix")).toMatchObject({ failures: 0, status: "closed" });
  });

  it("works when no breaker is wired (fallback path)", async () => {
    const bareRegistry = new ChannelRegistry();
    const plugin = makePlugin("twilio", { startShouldFail: true });
    bareRegistry.register(plugin);
    // Throws as before; no NPE despite no breaker.
    await expect(bareRegistry.startChannel("twilio")).rejects.toThrow("twilio start failed");
  });
});
