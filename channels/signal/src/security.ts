import type { ChannelSecurityAdapter } from "@agi/channel-sdk";

// ---------------------------------------------------------------------------
// Security adapter: hashed phone allowlist + rate limiting
// ---------------------------------------------------------------------------

export interface SignalSecurityConfig {
  /**
   * If non-empty, only these hashed phone numbers may interact.
   * Values must be SHA-256 hex digests — never raw phone numbers.
   * Matches the `channelUserId` produced by the normalizer.
   */
  allowedNumbers?: string[];
  /** Max messages per user per minute (default: 15). */
  rateLimitPerMinute?: number;
}

/**
 * Create a {@link ChannelSecurityAdapter} with a hashed-number allowlist
 * and per-user sliding-window rate limiting.
 *
 * When `allowedNumbers` is empty or omitted, all users are permitted (open
 * mode). The adapter receives `channelUserId` values that are already
 * SHA-256 hashes (produced by the normalizer) — no raw phone numbers are
 * ever seen here.
 *
 * Rate buckets use a sliding window of 60 seconds.
 */
export function createSecurityAdapter(
  config: SignalSecurityConfig,
): ChannelSecurityAdapter {
  const allowSet = new Set(config.allowedNumbers ?? []);
  const rateLimit = config.rateLimitPerMinute ?? 15;

  // Sliding-window rate buckets: hashedUserId → timestamp[]
  const rateBuckets = new Map<string, number[]>();

  return {
    isAllowed: async (channelUserId: string) => {
      // Allowlist check — empty set = everyone allowed
      if (allowSet.size > 0 && !allowSet.has(channelUserId)) {
        return false;
      }

      // Sliding-window rate limit
      const now = Date.now();
      const windowMs = 60_000;
      const bucket = rateBuckets.get(channelUserId) ?? [];
      const active = bucket.filter((t) => now - t < windowMs);

      if (active.length >= rateLimit) {
        rateBuckets.set(channelUserId, active);
        return false;
      }

      active.push(now);
      rateBuckets.set(channelUserId, active);
      return true;
    },

    getAllowlist: async () => [...allowSet],
  };
}
