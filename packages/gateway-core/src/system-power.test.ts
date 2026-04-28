import { describe, it, expect } from "vitest";
import { computePowerWatts, parseNvidiaSmiOutput } from "./system-power.js";

/**
 * s111 t377 — RAPL CPU power math. The sysfs read is exercised by
 * integration paths; these tests cover the pure delta + wraparound logic.
 *
 * s111 t417 — nvidia-smi output parsing. The spawnSync is exercised by
 * integration paths; these tests cover the pure parser.
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

describe("parseNvidiaSmiOutput (s111 t417)", () => {
  it("parses a single-GPU power.draw row", () => {
    // nvidia-smi --query-gpu=power.draw --format=csv,noheader,nounits
    // produces one numeric value per GPU per line.
    expect(parseNvidiaSmiOutput("145.20\n")).toBe(145.2);
  });

  it("rounds to 1 decimal (matches CpuPowerSampler precision)", () => {
    // nvidia-smi reports 4-decimal precision on some drivers; the dashboard
    // chart only needs ~1W resolution. Rounding here keeps the wire shape
    // consistent with cpuWatts and prevents jittery sub-watt graphs.
    expect(parseNvidiaSmiOutput("145.2856\n")).toBe(145.3);
  });

  it("takes the first GPU on multi-GPU systems (multi-GPU aggregation deferred)", () => {
    // 2-GPU box returns 2 lines. This slice intentionally takes only the
    // first GPU; multi-GPU sum/average is a separate task.
    expect(parseNvidiaSmiOutput("180.40\n145.20\n")).toBe(180.4);
  });

  it("returns null on empty output (driver not loaded)", () => {
    // nvidia-smi exits 0 with empty stdout when no NVIDIA driver is loaded.
    expect(parseNvidiaSmiOutput("")).toBeNull();
    expect(parseNvidiaSmiOutput("   \n")).toBeNull();
  });

  it("returns null on N/A (old cards without power.draw support)", () => {
    // Pre-Pascal cards report "N/A" for power.draw — a real GPU but no
    // power telemetry. The dashboard should hide the chart in this case,
    // not show a fake number.
    expect(parseNvidiaSmiOutput("[N/A]\n")).toBeNull();
  });

  it("returns null on negative or zero values (sentinel/broken)", () => {
    // Some buggy driver versions report 0 or -1 instead of N/A. Treat both
    // as "unknown power" rather than rendering them as 0W.
    expect(parseNvidiaSmiOutput("0\n")).toBeNull();
    expect(parseNvidiaSmiOutput("-1.5\n")).toBeNull();
  });
});
