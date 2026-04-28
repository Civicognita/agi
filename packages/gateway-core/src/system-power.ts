/**
 * system-power — power tracking for $WATCHER.RESOURCE (s111 E-section).
 *
 * Two samplers as of v0.4.213:
 *   - CpuPowerSampler: Intel RAPL sysfs (s111 t377)
 *   - GpuPowerSampler: NVIDIA via nvidia-smi --query-gpu=power.draw (s111 t417)
 *
 * RAPL (Running Average Power Limit) exposes a monotonically-increasing
 * energy counter at /sys/class/powercap/intel-rapl:0/energy_uj counting
 * cumulative microjoules. Watts = ΔμJ / Δμs from two readings. Counter
 * wraps at max_energy_range_uj (~262 GJ ≈ 73 hours @ 1W); the math handles
 * wraparound by computing (max - prev) + current when current < prev.
 *
 * NVIDIA exposes instantaneous power via nvidia-smi (no delta math needed —
 * the driver computes a moving average internally). We shell out rather
 * than depending on a libnvml binding because (a) nvidia-smi is the canonical
 * stable interface across driver versions, (b) AGI doesn't ship native
 * bindings, (c) parse-cost is negligible (single CSV row).
 *
 * Future scope (NOT in this file):
 *   - NPU power (vendor-specific; Intel /sys/class/intel_npu/power; AMD
 *     amdgpu_pm_info; Qualcomm QPC counters)
 *   - Per-package multi-socket CPU aggregation
 *   - Multi-GPU aggregation (this slice takes first GPU only)
 *   - AMD GPU power via amdgpu_pm_info or radeontop
 *
 * Graceful degradation: every sampler returns null on missing hardware,
 * missing tools, or permission denied. The catalog UI hides power chips
 * + chart series when sample()=null. ARM/macOS, Intel-iGPU-only hosts,
 * and hardened distros all hit the null path; that's the design, not a bug.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const RAPL_ENERGY_PATH = "/sys/class/powercap/intel-rapl:0/energy_uj";
const RAPL_MAX_RANGE_PATH = "/sys/class/powercap/intel-rapl:0/max_energy_range_uj";

/**
 * Compute average CPU power in watts from two RAPL energy readings.
 *
 * Pure function — exercised by unit tests independent of sysfs availability.
 * Handles the wraparound case where the energy counter rolled past
 * `maxRangeUj` between samples (current < prev). Returns 0 when the elapsed
 * window is non-positive (defensive — caller shouldn't pass that, but a
 * clock skew at sample time could).
 *
 * Watts = (ΔμJ / 1_000_000) / (Δms / 1_000) = ΔμJ / (1000 * Δms).
 */
export function computePowerWatts(
  prevUj: number,
  currentUj: number,
  elapsedMs: number,
  maxRangeUj: number,
): number {
  if (elapsedMs <= 0) return 0;
  const deltaUj =
    currentUj >= prevUj
      ? currentUj - prevUj
      : maxRangeUj - prevUj + currentUj;
  // Round to 1 decimal so the dashboard graph doesn't render noise from
  // sub-watt fluctuations. CPU power changes meaningfully at the ~1W scale.
  return Math.round((deltaUj / (1000 * elapsedMs)) * 10) / 10;
}

/**
 * CpuPowerSampler — wraps the sysfs read with the delta-tracking state.
 *
 * Returns null on non-Linux systems, missing kernel module (Intel RAPL not
 * exposed), or insufficient permissions (the energy_uj file is sometimes
 * 0400 root-only on hardened distros — agi runs as a regular user, so this
 * is a graceful degradation path, not an error).
 *
 * First call returns null because there's no prior sample to delta against;
 * second and subsequent calls return watts. The class is single-use per
 * machine — instantiate once at server startup, sample on a 1+ second
 * cadence (RAPL readings under 1s become noisy because the counter resolves
 * in ~1ms increments but cooler/turbo states change at ~10ms scale).
 */
export class CpuPowerSampler {
  private maxRangeUj: number | null = null;
  private last: { uj: number; ts: number } | null = null;

  /** True when /sys/class/powercap/intel-rapl:0/* is readable on this host. */
  isAvailable(): boolean {
    if (this.maxRangeUj !== null) return true;
    try {
      const raw = readFileSync(RAPL_MAX_RANGE_PATH, "utf-8").trim();
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        this.maxRangeUj = parsed;
        return true;
      }
    } catch {
      /* RAPL not exposed — non-Linux, missing module, or permission denied */
    }
    return false;
  }

  /** Returns current CPU watts, or null when unavailable / first sample. */
  sample(): number | null {
    if (!this.isAvailable()) return null;
    let currentUj: number;
    try {
      currentUj = Number.parseInt(readFileSync(RAPL_ENERGY_PATH, "utf-8").trim(), 10);
    } catch {
      return null;
    }
    if (!Number.isFinite(currentUj)) return null;

    const now = Date.now();
    const prev = this.last;
    this.last = { uj: currentUj, ts: now };
    if (prev === null) return null;

    return computePowerWatts(prev.uj, currentUj, now - prev.ts, this.maxRangeUj!);
  }
}

/**
 * Parse the first GPU's instantaneous watts from
 * `nvidia-smi --query-gpu=power.draw --format=csv,noheader,nounits` output.
 *
 * Pure function — testable without nvidia-smi installed. The expected
 * format is one numeric watts value per GPU on its own line. Multi-GPU
 * systems return one row per GPU; this slice takes only the first row
 * (multi-GPU aggregation is its own task).
 *
 * Returns null when:
 *   - The output is empty or whitespace-only (driver not loaded)
 *   - The first row isn't a finite number ("N/A" appears for old cards
 *     that don't report power.draw)
 *   - The reading is negative or zero (sentinel values from broken paths)
 *
 * Returns watts rounded to 1 decimal — same precision pattern as the RAPL
 * helper, keeping the dashboard chart from rendering jitter from nvidia-smi's
 * sub-watt resolution.
 */
export function parseNvidiaSmiOutput(stdout: string): number | null {
  const firstLine = stdout.split("\n").map((s) => s.trim()).find((s) => s.length > 0);
  if (firstLine === undefined) return null;
  const parsed = Number.parseFloat(firstLine);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 10) / 10;
}

/**
 * GpuPowerSampler — wraps nvidia-smi shell-out with availability detection.
 *
 * Returns null when nvidia-smi isn't installed (most non-NVIDIA hosts),
 * when the driver isn't loaded, when no GPUs report power.draw, or when
 * the spawn times out. The class caches the availability decision after
 * the first probe so non-NVIDIA hosts pay the spawn cost once, not on
 * every sample.
 *
 * Unlike CpuPowerSampler, the first sample() returns a real watt value —
 * NVIDIA's driver computes a moving average internally, so we don't need
 * a delta. Sample cadence above 1s is safe; nvidia-smi spawn is ~50ms.
 */
export class GpuPowerSampler {
  private static readonly SPAWN_TIMEOUT_MS = 5_000;
  /** null = unprobed; false = probed and unavailable; true = probed and OK. */
  private availability: boolean | null = null;

  isAvailable(): boolean {
    if (this.availability !== null) return this.availability;
    // Probe by trying to run nvidia-smi with the same query the sampler uses.
    // A successful first probe primes the cache for this lifetime; failures
    // also cache so we don't re-spawn on every sample on non-NVIDIA hosts.
    const result = spawnSync(
      "nvidia-smi",
      ["--query-gpu=power.draw", "--format=csv,noheader,nounits"],
      { timeout: GpuPowerSampler.SPAWN_TIMEOUT_MS, encoding: "utf-8" },
    );
    if (result.status === 0 && result.stdout) {
      const parsed = parseNvidiaSmiOutput(result.stdout);
      this.availability = parsed !== null;
    } else {
      this.availability = false;
    }
    return this.availability;
  }

  /** Returns current GPU watts, or null when unavailable. */
  sample(): number | null {
    if (!this.isAvailable()) return null;
    const result = spawnSync(
      "nvidia-smi",
      ["--query-gpu=power.draw", "--format=csv,noheader,nounits"],
      { timeout: GpuPowerSampler.SPAWN_TIMEOUT_MS, encoding: "utf-8" },
    );
    if (result.status !== 0 || !result.stdout) return null;
    return parseNvidiaSmiOutput(result.stdout);
  }
}
