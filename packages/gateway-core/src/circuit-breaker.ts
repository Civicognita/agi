/**
 * CircuitBreakerTracker — persistent failure tracking for gateway-managed
 * services (s143 t567).
 *
 * Backstory: v0.4.431 added a per-project try/catch + 15s timeout in the
 * hosting boot loop so one bad project couldn't hang the gateway. That fix
 * was local — every restart re-attempted every project, so a permanently
 * broken service kept burning a 15s budget on every boot. This tracker is
 * the proper persistent version: after N consecutive failures, the service
 * transitions to "open" and the gateway skips it on subsequent boots until
 * either (a) cool-down elapses, moving it to "half-open" for a single retry,
 * or (b) an operator manually resets it.
 *
 * State lives in `~/.agi/gateway.json` under
 * `services.circuitBreaker.states[serviceId]`, persisted via SystemConfigService
 * so it survives restarts and is visible to the dashboard.
 *
 * Service-id conventions (load-bearing — the dashboard groups by prefix):
 *   - hosting:<absoluteProjectPath>   → projects with `hosting.enabled = true`
 *   - channel:<channelId>             → channel adapters (slack, discord, ...)
 *   - plugin:<pluginId>               → plugin activation
 *   - service:<serviceId>             → runtime/service startup
 *   - mcp:<serverId>                  → MCP server connections
 *
 * Pattern is generalizable — any boot-time failure path that returns
 * "broken until human-fixed" benefits from running through this tracker.
 */

import type { CircuitBreakerConfig, CircuitBreakerState } from "@agi/config";
import type { SystemConfigService } from "./system-config-service.js";
import { createComponentLogger, type ComponentLogger, type Logger } from "./logger.js";

export interface CircuitBreakerDeps {
  configService: SystemConfigService;
  logger?: Logger;
  /** Override clock for testing — defaults to `() => new Date()`. */
  now?: () => Date;
}

export interface ShouldSkipResult {
  skip: boolean;
  /** Human-readable explanation surfaced into the boot logs and the dashboard. */
  reason?: string;
  /** Set when the breaker transitioned during this check (so callers can log it). */
  transitionedTo?: CircuitBreakerState["status"];
}

const DEFAULT_THRESHOLD = 3;
const DEFAULT_COOLDOWN_HOURS = 24;

export class CircuitBreakerTracker {
  private readonly config: SystemConfigService;
  private readonly log: ComponentLogger;
  private readonly now: () => Date;

  constructor(deps: CircuitBreakerDeps) {
    this.config = deps.configService;
    this.log = createComponentLogger(deps.logger, "circuit-breaker");
    this.now = deps.now ?? (() => new Date());
  }

  /** Read the breaker config (threshold + cool-down) with defaults. */
  private readBreakerConfig(): { threshold: number; coolDownHours: number } {
    const cb = this.readBreakerConfigRaw();
    return {
      threshold: cb?.threshold ?? DEFAULT_THRESHOLD,
      coolDownHours: cb?.coolDownHours ?? DEFAULT_COOLDOWN_HOURS,
    };
  }

  private readBreakerConfigRaw(): CircuitBreakerConfig | undefined {
    return this.config.read().services?.circuitBreaker;
  }

  /** Read the current state for a single service id. Undefined when never recorded. */
  getState(serviceId: string): CircuitBreakerState | undefined {
    const cb = this.readBreakerConfigRaw();
    return cb?.states?.[serviceId];
  }

  /** Read all known states. Useful for the diagnostic API + Services page. */
  listStates(): Record<string, CircuitBreakerState> {
    const cb = this.readBreakerConfigRaw();
    return cb?.states ?? {};
  }

  /**
   * Decide whether the gateway should skip booting this service. Performs the
   * "open → half-open after cool-down" transition lazily here so callers don't
   * need to schedule a separate timer.
   */
  shouldSkip(serviceId: string): ShouldSkipResult {
    const state = this.getState(serviceId);
    if (!state || state.status === "closed") return { skip: false };

    if (state.status === "half-open") {
      // Half-open allows ONE attempt — caller will record success/failure.
      return { skip: false, reason: "half-open: one attempt allowed" };
    }

    // status === "open" — check whether cool-down has elapsed.
    const { coolDownHours } = this.readBreakerConfig();
    if (state.lastFailureAt) {
      const lastFailureMs = Date.parse(state.lastFailureAt);
      const ageHours = (this.now().getTime() - lastFailureMs) / (1000 * 60 * 60);
      if (Number.isFinite(ageHours) && ageHours >= coolDownHours) {
        // Transition to half-open and let this attempt through.
        this.persistState(serviceId, { ...state, status: "half-open" });
        this.log.info(`[${serviceId}] cool-down elapsed (${ageHours.toFixed(1)}h ≥ ${String(coolDownHours)}h) — transitioning open → half-open`);
        return { skip: false, reason: "cool-down elapsed", transitionedTo: "half-open" };
      }
    }

    return {
      skip: true,
      reason: `circuit open (${String(state.failures)} failures; last error: ${state.lastError ?? "(unknown)"})`,
    };
  }

  /**
   * Record a failure. Increments the counter, persists the latest error,
   * flips to "open" once threshold is reached. Half-open failures flip back
   * to "open" immediately regardless of failure count.
   */
  recordFailure(serviceId: string, err: unknown): void {
    const { threshold } = this.readBreakerConfig();
    const prev = this.getState(serviceId) ?? {
      failures: 0,
      status: "closed" as const,
    };
    const errMessage = err instanceof Error ? err.message : String(err);
    const failures = prev.failures + 1;
    const wasHalfOpen = prev.status === "half-open";
    const status: CircuitBreakerState["status"] =
      wasHalfOpen || failures >= threshold ? "open" : "closed";

    const next: CircuitBreakerState = {
      failures,
      lastFailureAt: this.now().toISOString(),
      lastError: errMessage.slice(0, 500), // bound to keep gateway.json reasonable
      status,
      ...(prev.lastResetAt ? { lastResetAt: prev.lastResetAt } : {}),
    };
    this.persistState(serviceId, next);

    if (status === "open" && prev.status !== "open") {
      this.log.warn(
        `[${serviceId}] OPENED — ${String(failures)} failures (threshold ${String(threshold)}); future boots will skip until reset or cool-down elapses`,
      );
    } else {
      this.log.info(`[${serviceId}] failure ${String(failures)}/${String(threshold)}: ${errMessage.slice(0, 120)}`);
    }
  }

  /** Record a success — resets the counter and closes the breaker. */
  recordSuccess(serviceId: string): void {
    const prev = this.getState(serviceId);
    if (!prev || (prev.failures === 0 && prev.status === "closed")) {
      // Nothing to update — common case: normal boot of a healthy service.
      return;
    }
    this.persistState(serviceId, {
      failures: 0,
      status: "closed",
      ...(prev.lastResetAt ? { lastResetAt: prev.lastResetAt } : {}),
    });
    if (prev.status !== "closed") {
      this.log.info(`[${serviceId}] CLOSED — recovery success after ${String(prev.failures)} prior failure(s)`);
    }
  }

  /** Manual reset (clears the breaker regardless of previous state). */
  reset(serviceId: string): void {
    const prev = this.getState(serviceId);
    if (!prev) return;
    this.persistState(serviceId, {
      failures: 0,
      status: "closed",
      lastResetAt: this.now().toISOString(),
    });
    this.log.info(`[${serviceId}] RESET (was ${prev.status} with ${String(prev.failures)} failures)`);
  }

  /** Reset every breaker. Returns the number of services reset. */
  resetAll(): number {
    const states = this.listStates();
    const ids = Object.keys(states);
    for (const id of ids) this.reset(id);
    return ids.length;
  }

  // -------------------------------------------------------------------------
  // Persistence helpers
  // -------------------------------------------------------------------------

  private persistState(serviceId: string, state: CircuitBreakerState): void {
    // Service ids may contain '.' (e.g. an absolute path with .local in it),
    // which would confuse SystemConfigService.patch's dot-notation splitter
    // and create unwanted nesting. Read-modify-write the full states map at
    // the parent path instead. Failure-rate is bounded (only on transitions),
    // so the extra payload size of the whole map is negligible.
    const states = { ...this.listStates() };
    states[serviceId] = state;
    this.config.patch("services.circuitBreaker.states", states);
  }
}
