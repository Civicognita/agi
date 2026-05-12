/**
 * CpuWatchdog pure-logic tests (s159-sibling: sustained-CPU alert).
 */

import { describe, it, expect } from "vitest";
import { CpuWatchdog, DEFAULT_CPU_WATCHDOG_CONFIG } from "./cpu-watchdog.js";

describe("CpuWatchdog defaults", () => {
  it("starts in normal state", () => {
    const w = new CpuWatchdog();
    expect(w.getState()).toBe("normal");
  });

  it("emits no events for low samples", () => {
    const w = new CpuWatchdog();
    for (let i = 0; i < 10; i++) {
      expect(w.feed(20)).toBeNull();
    }
    expect(w.getState()).toBe("normal");
  });

  it("does NOT fire before sustainWindow samples", () => {
    const w = new CpuWatchdog();
    for (let i = 0; i < DEFAULT_CPU_WATCHDOG_CONFIG.sustainWindow - 1; i++) {
      expect(w.feed(95)).toBeNull();
    }
    expect(w.getState()).toBe("normal");
  });

  it("fires alert-fired after sustainWindow consecutive high samples", () => {
    const w = new CpuWatchdog();
    const events = [];
    for (let i = 0; i < DEFAULT_CPU_WATCHDOG_CONFIG.sustainWindow; i++) {
      const evt = w.feed(95);
      if (evt) events.push(evt);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("alert-fired");
    expect(w.getState()).toBe("alerting");
  });

  it("resets streak when a low sample breaks the high run", () => {
    const w = new CpuWatchdog();
    // 3 highs, then a low, then 5 highs — should NOT fire (only 5 consecutive)
    for (let i = 0; i < 3; i++) w.feed(95);
    w.feed(20); // breaks streak
    for (let i = 0; i < 5; i++) {
      expect(w.feed(95)).toBeNull();
    }
    expect(w.getState()).toBe("normal");
  });

  it("clears alert after clearWindow consecutive low samples", () => {
    const w = new CpuWatchdog();
    // Fire the alert
    for (let i = 0; i < DEFAULT_CPU_WATCHDOG_CONFIG.sustainWindow; i++) w.feed(95);
    expect(w.getState()).toBe("alerting");
    // Feed clear samples
    const events = [];
    for (let i = 0; i < DEFAULT_CPU_WATCHDOG_CONFIG.clearWindow; i++) {
      const evt = w.feed(20);
      if (evt) events.push(evt);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("alert-cleared");
    expect(w.getState()).toBe("normal");
  });

  it("hysteresis — samples between clearThreshold and highThreshold do NOT clear", () => {
    const w = new CpuWatchdog();
    // Fire
    for (let i = 0; i < DEFAULT_CPU_WATCHDOG_CONFIG.sustainWindow; i++) w.feed(95);
    expect(w.getState()).toBe("alerting");
    // Feed samples in the hysteresis band (75% — below high, above clear)
    for (let i = 0; i < 20; i++) {
      expect(w.feed(75)).toBeNull();
    }
    expect(w.getState()).toBe("alerting");
  });

  it("clear streak resets when a sample bumps back into hysteresis band", () => {
    const w = new CpuWatchdog();
    for (let i = 0; i < DEFAULT_CPU_WATCHDOG_CONFIG.sustainWindow; i++) w.feed(95);
    // Partial clear progress
    for (let i = 0; i < DEFAULT_CPU_WATCHDOG_CONFIG.clearWindow - 1; i++) w.feed(50);
    expect(w.getStreak().clear).toBe(DEFAULT_CPU_WATCHDOG_CONFIG.clearWindow - 1);
    // Bump back up — should reset
    w.feed(75);
    expect(w.getStreak().clear).toBe(0);
    expect(w.getState()).toBe("alerting");
  });

  it("can fire-clear-fire across multiple cycles", () => {
    const w = new CpuWatchdog();
    const events = [];
    // Cycle 1: fire
    for (let i = 0; i < DEFAULT_CPU_WATCHDOG_CONFIG.sustainWindow; i++) {
      const e = w.feed(95);
      if (e) events.push(e);
    }
    // Clear
    for (let i = 0; i < DEFAULT_CPU_WATCHDOG_CONFIG.clearWindow; i++) {
      const e = w.feed(20);
      if (e) events.push(e);
    }
    // Cycle 2: fire again
    for (let i = 0; i < DEFAULT_CPU_WATCHDOG_CONFIG.sustainWindow; i++) {
      const e = w.feed(95);
      if (e) events.push(e);
    }
    expect(events.map((e) => e.kind)).toEqual(["alert-fired", "alert-cleared", "alert-fired"]);
  });
});

describe("CpuWatchdog with custom config", () => {
  it("respects shorter sustainWindow", () => {
    const w = new CpuWatchdog({
      highThreshold: 80,
      sustainWindow: 2,
      clearThreshold: 50,
      clearWindow: 2,
    });
    w.feed(85);
    const evt = w.feed(85);
    expect(evt?.kind).toBe("alert-fired");
  });

  it("uses custom thresholds", () => {
    const w = new CpuWatchdog({
      highThreshold: 50,
      sustainWindow: 3,
      clearThreshold: 30,
      clearWindow: 3,
    });
    // 55 > 50 high
    for (let i = 0; i < 3; i++) w.feed(55);
    expect(w.getState()).toBe("alerting");
    // 40 is between 30 and 50 — hysteresis band, should NOT clear
    for (let i = 0; i < 10; i++) w.feed(40);
    expect(w.getState()).toBe("alerting");
    // 25 < 30 clear
    for (let i = 0; i < 3; i++) w.feed(25);
    expect(w.getState()).toBe("normal");
  });
});
