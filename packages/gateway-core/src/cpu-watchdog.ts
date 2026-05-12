/**
 * CpuWatchdog — sustained-high CPU detector with hysteresis.
 *
 * Owner directive 2026-05-12: "agi needs something that throws an alert if
 * CPU usage is high for a sustained period of time." Real incident
 * background: 324 stuck multipass-exec processes accumulated over 34
 * hours pushed load average to 329 before the owner noticed. The pre-fix
 * Aionima had no early-warning surface for sustained-high CPU.
 *
 * **Design — pure state machine, no I/O.** The 30s resource-stats sampler
 * already produces a cpu % every tick (`recordStatsSnapshot` in
 * server-runtime-state.ts). The watchdog observes each sample and emits
 * transition events: alert-fired when the high-CPU pattern is sustained,
 * alert-cleared when it returns to normal. The wrapper owns logging,
 * incident-record writes, and dashboard notification.
 *
 * **Default thresholds (overridable via config):**
 *   - High threshold: 90% CPU. Once N consecutive samples sit at-or-above
 *     this value, the watchdog fires.
 *   - Sustain window: 6 samples × 30s interval = 3 minutes.
 *   - Clear threshold: 70% CPU. Hysteresis avoids flapping on a noisy
 *     just-below-the-high-threshold trace.
 *   - Clear window: 4 samples × 30s = 2 minutes below clear threshold.
 *
 * Total alert latency: 3 minutes from first high sample. Clearance: 2
 * minutes from first low sample. These match a "sustained" intuition
 * without alerting on every 30s spike.
 */

export interface CpuWatchdogConfig {
  /** High threshold percentage (0-100). Samples ≥ this count toward fire. */
  highThreshold: number;
  /** Number of consecutive ≥-high samples needed to fire the alert. */
  sustainWindow: number;
  /** Clear threshold percentage. Samples < this count toward clearance. */
  clearThreshold: number;
  /** Number of consecutive <-clear samples needed to clear the alert. */
  clearWindow: number;
}

/** Default thresholds: 90% sustained for 3min (6×30s), clear at 70% for 2min (4×30s). */
export const DEFAULT_CPU_WATCHDOG_CONFIG: CpuWatchdogConfig = {
  highThreshold: 90,
  sustainWindow: 6,
  clearThreshold: 70,
  clearWindow: 4,
};

export type CpuWatchdogEvent =
  | { kind: "alert-fired"; cpuPercent: number; sustainedSamples: number }
  | { kind: "alert-cleared"; cpuPercent: number; clearedSamples: number };

export type WatchdogState = "normal" | "alerting";

/**
 * Sliding-counter implementation — tracks consecutive samples in each
 * direction. Resets the counter when the sample falls outside the
 * relevant band. Hysteresis prevents flapping: once alerting, only the
 * clear band's consecutive count is tracked (high count irrelevant);
 * once normal, only the high band counts.
 */
export class CpuWatchdog {
  private state: WatchdogState = "normal";
  private highStreak = 0;
  private clearStreak = 0;

  constructor(private readonly config: CpuWatchdogConfig = DEFAULT_CPU_WATCHDOG_CONFIG) {}

  /**
   * Feed one cpu % sample. Returns an event when state transitions; null
   * otherwise. Wrapper consumes the event to log + notify + record incident.
   */
  feed(cpuPercent: number): CpuWatchdogEvent | null {
    if (this.state === "normal") {
      if (cpuPercent >= this.config.highThreshold) {
        this.highStreak += 1;
        if (this.highStreak >= this.config.sustainWindow) {
          this.state = "alerting";
          const sustained = this.highStreak;
          this.highStreak = 0; // reset for next cycle
          return { kind: "alert-fired", cpuPercent, sustainedSamples: sustained };
        }
      } else {
        this.highStreak = 0;
      }
      return null;
    }
    // state === "alerting"
    if (cpuPercent < this.config.clearThreshold) {
      this.clearStreak += 1;
      if (this.clearStreak >= this.config.clearWindow) {
        this.state = "normal";
        const cleared = this.clearStreak;
        this.clearStreak = 0;
        return { kind: "alert-cleared", cpuPercent, clearedSamples: cleared };
      }
    } else {
      this.clearStreak = 0;
    }
    return null;
  }

  /** Diagnostic — current state for logs / dashboard. */
  getState(): WatchdogState {
    return this.state;
  }

  /** Diagnostic — how many consecutive samples in the current direction. */
  getStreak(): { high: number; clear: number } {
    return { high: this.highStreak, clear: this.clearStreak };
  }
}
