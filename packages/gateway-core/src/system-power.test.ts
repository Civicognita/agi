import { describe, it, expect } from "vitest";
import { computePowerWatts } from "./system-power.js";

/**
 * s111 t377 — RAPL CPU power math. The sysfs read is exercised by
 * integration paths; these tests cover the pure delta + wraparound logic.
 */

describe("computePowerWatts (s111 t377)", () => {
  // RAPL counter reaches ~262 GJ on a typical Intel desktop (~73 hours @ 1W).
  const MAX = 262_143_328_850;

  it("computes watts from microjoule delta over elapsed milliseconds", () => {
    // 30 J consumed in 1 second = 30 W average (typical desktop idle to
    // light-load range). 30 J = 30_000_000 μJ, 1s = 1000ms.
    expect(computePowerWatts(0, 30_000_000, 1_000, MAX)).toBe(30);
  });

  it("rounds to 1 decimal so the graph isn't noisy from sub-watt jitter", () => {
    // 33.456 W → 33.5 W. CPU power changes meaningfully at the ~1W scale;
    // sub-watt detail is noise from RAPL's microsecond-resolution counter.
    expect(computePowerWatts(0, 33_456_000, 1_000, MAX)).toBe(33.5);
  });

  it("handles wraparound when the cumulative counter rolls past maxRange", () => {
    // Counter near max (260 GJ); next sample wraps back near 0. The real
    // delta is (max - prev) + current, not the negative arithmetic delta.
    const prev = MAX - 5_000_000;            // 5 J shy of wrapping
    const current = 25_000_000;              // wrapped, 25 J post-zero
    // Real delta: 5 J + 25 J = 30 J in 1s = 30 W.
    expect(computePowerWatts(prev, current, 1_000, MAX)).toBe(30);
  });

  it("returns 0 for non-positive elapsed windows (clock skew defense)", () => {
    // Defensive. Caller shouldn't pass elapsedMs <= 0, but a NTP step at
    // sample time could produce zero or negative deltas. Better to report
    // 0W than to divide by zero.
    expect(computePowerWatts(0, 1_000_000, 0, MAX)).toBe(0);
    expect(computePowerWatts(0, 1_000_000, -100, MAX)).toBe(0);
  });

  it("computes sub-watt readings precisely (idle laptop at ~3W)", () => {
    // Modern laptop CPUs idle at ~2-4W in package power. 3.2W in 5s window.
    // 3.2 W * 5 s = 16 J = 16_000_000 μJ.
    expect(computePowerWatts(0, 16_000_000, 5_000, MAX)).toBe(3.2);
  });
});
