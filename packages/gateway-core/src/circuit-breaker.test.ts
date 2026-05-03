import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CircuitBreakerTracker } from "./circuit-breaker.js";
import { SystemConfigService } from "./system-config-service.js";

function makeTmpConfig(): { path: string; cleanup: () => void } {
  const dir = join(tmpdir(), `circuit-breaker-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "gateway.json");
  writeFileSync(path, "{}", "utf-8");
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("CircuitBreakerTracker (s143 t567)", () => {
  let cfg: ReturnType<typeof makeTmpConfig>;
  let svc: SystemConfigService;
  let tracker: CircuitBreakerTracker;
  // Frozen clock so cool-down math is deterministic. Stored as { current }
  // so individual tests can advance it.
  const clock = { current: new Date("2026-05-01T06:00:00Z") };

  beforeEach(() => {
    cfg = makeTmpConfig();
    svc = new SystemConfigService({ configPath: cfg.path });
    clock.current = new Date("2026-05-01T06:00:00Z");
    tracker = new CircuitBreakerTracker({ configService: svc, now: () => clock.current });
  });

  it("starts with no state — shouldSkip returns false", () => {
    expect(tracker.shouldSkip("hosting:/x")).toEqual({ skip: false });
    expect(tracker.getState("hosting:/x")).toBeUndefined();
  });

  it("recordFailure increments the counter and stays closed below threshold", () => {
    tracker.recordFailure("hosting:/x", new Error("boom"));
    expect(tracker.getState("hosting:/x")).toMatchObject({
      failures: 1,
      status: "closed",
      lastError: "boom",
    });
    tracker.recordFailure("hosting:/x", new Error("boom 2"));
    expect(tracker.getState("hosting:/x")).toMatchObject({ failures: 2, status: "closed" });
    expect(tracker.shouldSkip("hosting:/x")).toEqual({ skip: false });
  });

  it("flips to open at the configured threshold (default 3)", () => {
    tracker.recordFailure("hosting:/x", new Error("f1"));
    tracker.recordFailure("hosting:/x", new Error("f2"));
    tracker.recordFailure("hosting:/x", new Error("f3"));
    expect(tracker.getState("hosting:/x")).toMatchObject({ failures: 3, status: "open" });
    const decision = tracker.shouldSkip("hosting:/x");
    expect(decision.skip).toBe(true);
    expect(decision.reason).toContain("circuit open");
  });

  it("respects a custom threshold from config", () => {
    svc.patch("services.circuitBreaker.threshold", 5);
    tracker = new CircuitBreakerTracker({ configService: svc, now: () => clock.current });
    for (let i = 0; i < 4; i++) tracker.recordFailure("hosting:/x", new Error(`f${String(i)}`));
    expect(tracker.getState("hosting:/x")?.status).toBe("closed");
    tracker.recordFailure("hosting:/x", new Error("f5"));
    expect(tracker.getState("hosting:/x")?.status).toBe("open");
  });

  it("recordSuccess clears state on a previously-failing service", () => {
    tracker.recordFailure("hosting:/x", new Error("f1"));
    tracker.recordFailure("hosting:/x", new Error("f2"));
    tracker.recordSuccess("hosting:/x");
    expect(tracker.getState("hosting:/x")).toMatchObject({ failures: 0, status: "closed" });
  });

  it("recordSuccess is a no-op on a never-failing service (avoids unnecessary writes)", () => {
    tracker.recordSuccess("hosting:/x");
    expect(tracker.getState("hosting:/x")).toBeUndefined();
  });

  it("transitions open → half-open after cool-down elapses", () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) tracker.recordFailure("hosting:/x", new Error("boom"));
    expect(tracker.getState("hosting:/x")?.status).toBe("open");

    // Advance the clock past the default 24h cool-down
    clock.current = new Date("2026-05-02T07:00:00Z"); // +25h
    const decision = tracker.shouldSkip("hosting:/x");
    expect(decision.skip).toBe(false);
    expect(decision.transitionedTo).toBe("half-open");
    expect(tracker.getState("hosting:/x")?.status).toBe("half-open");
  });

  it("does NOT transition before cool-down elapses", () => {
    for (let i = 0; i < 3; i++) tracker.recordFailure("hosting:/x", new Error("boom"));
    clock.current = new Date("2026-05-01T18:00:00Z"); // +12h, less than 24h default
    const decision = tracker.shouldSkip("hosting:/x");
    expect(decision.skip).toBe(true);
    expect(tracker.getState("hosting:/x")?.status).toBe("open");
  });

  it("half-open → open immediately on failure (does NOT need to re-hit threshold)", () => {
    for (let i = 0; i < 3; i++) tracker.recordFailure("hosting:/x", new Error("boom"));
    clock.current = new Date("2026-05-02T07:00:00Z");
    tracker.shouldSkip("hosting:/x"); // moves to half-open
    tracker.recordFailure("hosting:/x", new Error("retry-failed"));
    expect(tracker.getState("hosting:/x")?.status).toBe("open");
  });

  it("half-open → closed on first success after recovery", () => {
    for (let i = 0; i < 3; i++) tracker.recordFailure("hosting:/x", new Error("boom"));
    clock.current = new Date("2026-05-02T07:00:00Z");
    tracker.shouldSkip("hosting:/x"); // moves to half-open
    tracker.recordSuccess("hosting:/x");
    expect(tracker.getState("hosting:/x")?.status).toBe("closed");
    expect(tracker.getState("hosting:/x")?.failures).toBe(0);
  });

  it("reset clears state and stamps lastResetAt", () => {
    for (let i = 0; i < 3; i++) tracker.recordFailure("hosting:/x", new Error("boom"));
    tracker.reset("hosting:/x");
    const state = tracker.getState("hosting:/x");
    expect(state?.status).toBe("closed");
    expect(state?.failures).toBe(0);
    expect(state?.lastResetAt).toBe("2026-05-01T06:00:00.000Z");
  });

  it("resetAll resets every tracked service and returns the count", () => {
    tracker.recordFailure("hosting:/a", new Error("a"));
    tracker.recordFailure("hosting:/b", new Error("b"));
    tracker.recordFailure("plugin:reader-media", new Error("c"));
    expect(tracker.resetAll()).toBe(3);
    expect(tracker.getState("hosting:/a")?.failures).toBe(0);
    expect(tracker.getState("hosting:/b")?.failures).toBe(0);
    expect(tracker.getState("plugin:reader-media")?.failures).toBe(0);
  });

  it("listStates returns every tracked service id", () => {
    tracker.recordFailure("hosting:/a", new Error("a"));
    tracker.recordFailure("channel:slack", new Error("b"));
    const states = tracker.listStates();
    expect(Object.keys(states).sort()).toEqual(["channel:slack", "hosting:/a"]);
  });

  it("survives a service id that contains dots without breaking the states map", () => {
    // Regression guard: an earlier draft used dot-notation patch for the
    // service id, which would split 'hosting:/a.b' into nested keys.
    tracker.recordFailure("hosting:/home/owner/projects/site.local", new Error("boom"));
    const state = tracker.getState("hosting:/home/owner/projects/site.local");
    expect(state).toMatchObject({ failures: 1, status: "closed", lastError: "boom" });
    // And the OTHER keys should not have been polluted.
    expect(tracker.listStates()).toHaveProperty(["hosting:/home/owner/projects/site.local"]);
  });

  it("persists state to gateway.json so it survives re-instantiation", () => {
    for (let i = 0; i < 3; i++) tracker.recordFailure("hosting:/x", new Error("boom"));
    // Build a brand-new SystemConfigService + tracker reading the same file
    const svc2 = new SystemConfigService({ configPath: cfg.path });
    const tracker2 = new CircuitBreakerTracker({ configService: svc2, now: () => clock.current });
    expect(tracker2.getState("hosting:/x")?.status).toBe("open");
    expect(tracker2.shouldSkip("hosting:/x").skip).toBe(true);
  });

  it("truncates very long error messages to keep gateway.json small", () => {
    const longErr = "x".repeat(2000);
    tracker.recordFailure("hosting:/x", new Error(longErr));
    const state = tracker.getState("hosting:/x");
    expect(state?.lastError?.length).toBe(500);
  });
});
