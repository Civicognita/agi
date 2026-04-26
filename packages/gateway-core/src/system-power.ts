/**
 * system-power — RAPL CPU power tracking for $WATCHER.RESOURCE (s111 t377).
 *
 * The Intel RAPL (Running Average Power Limit) sysfs interface exposes a
 * monotonically-increasing energy counter at
 *   /sys/class/powercap/intel-rapl:0/energy_uj
 * counting cumulative microjoules consumed by the CPU package since boot.
 * Watts = ΔμJ / Δμs, computed from two readings.
 *
 * The counter wraps at /sys/class/powercap/intel-rapl:0/max_energy_range_uj
 * (typically ~262_143_328_850 μJ ≈ 73 hours @ 1W). When `current < prev`,
 * the math adds (maxRange - prev) + current to recover the real delta.
 *
 * Future scope (NOT in this slice):
 *   - GPU power via NVML (nvidia-smi --query-gpu=power.draw or libnvml)
 *   - NPU power (vendor-specific; Intel via /sys/class/intel_npu/power; AMD
 *     via amdgpu_pm_info; Qualcomm via QPC counters)
 *   - Per-package multi-socket aggregation
 *   - AMD energy via /sys/class/powercap/intel-rapl:0 alias OR libcpupower
 *
 * The Linux RAPL driver covers Intel CPUs (since Sandy Bridge) and AMD
 * Zen/Zen2/Zen3+ when the amd_energy module is loaded. ARM/macOS return
 * null gracefully — the catalog UI hides the power gauge for those.
 */

import { readFileSync } from "node:fs";

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
