/**
 * Per-entity rate limiting for API invocations.
 *
 * Rate limits are enforced at the invocation gate (step [3]) before any
 * API call. State is in-memory only — counters reset on gateway restart.
 *
 * @see docs/governance/agent-invocation-spec.md §4.4
 */

import type { GatewayState } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitEntry {
  entityId: string;
  windowStart: number; // epoch ms
  requestCount: number;
  burstUsed: number;
}

export interface RateLimitConfig {
  /** Requests per minute per entity, keyed by gateway state. */
  limits: Record<GatewayState, { perMinute: number; burst: number }>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

// ---------------------------------------------------------------------------
// Defaults — from agent-invocation-spec.md §4.4
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RateLimitConfig = {
  limits: {
    ONLINE: { perMinute: 20, burst: 5 },
    LIMBO: { perMinute: 5, burst: 2 },
    OFFLINE: { perMinute: 0, burst: 0 },
    UNKNOWN: { perMinute: 0, burst: 0 },
  },
};

const WINDOW_MS = 60_000; // 1 minute

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

export class RateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly config: RateLimitConfig;

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check whether an entity is allowed to make a request in the given state.
   * If allowed, the request count is incremented.
   */
  check(entityId: string, state: GatewayState): RateLimitResult {
    const limit = this.config.limits[state];

    // OFFLINE and UNKNOWN always block
    if (limit.perMinute === 0) {
      return { allowed: false, remaining: 0 };
    }

    const now = Date.now();
    let entry = this.entries.get(entityId);

    // Reset window if expired
    if (entry === undefined || now - entry.windowStart >= WINDOW_MS) {
      entry = {
        entityId,
        windowStart: now,
        requestCount: 0,
        burstUsed: 0,
      };
      this.entries.set(entityId, entry);
    }

    const totalAllowed = limit.perMinute + limit.burst;

    if (entry.requestCount >= totalAllowed) {
      const retryAfterMs = WINDOW_MS - (now - entry.windowStart);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    // Increment
    entry.requestCount++;
    if (entry.requestCount > limit.perMinute) {
      entry.burstUsed++;
    }

    const remaining = totalAllowed - entry.requestCount;
    return { allowed: true, remaining };
  }

  /** Get current rate limit state for an entity (for diagnostics). */
  getEntry(entityId: string): RateLimitEntry | undefined {
    return this.entries.get(entityId);
  }

  /** Clear all rate limit state (e.g. on gateway restart). */
  reset(): void {
    this.entries.clear();
  }
}
