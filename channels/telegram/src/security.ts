import type { ChannelSecurityAdapter } from "@agi/channel-sdk";

// ---------------------------------------------------------------------------
// Security adapter: allowlist + rate limiting
// ---------------------------------------------------------------------------

export interface TelegramSecurityConfig {
  /** If non-empty, only these user IDs may interact. */
  allowedChatIds?: number[];
  /** Max messages per user per minute (default: 30). */
  rateLimitPerMinute?: number;
}

/**
 * Create a {@link ChannelSecurityAdapter} with per-user rate limiting and
 * an optional allowlist.
 *
 * When `allowedChatIds` is empty or omitted, all users are permitted (open mode).
 * Rate buckets use a sliding window of 60 seconds.
 */
export function createSecurityAdapter(
  config: TelegramSecurityConfig,
): ChannelSecurityAdapter {
  const allowSet = new Set(config.allowedChatIds?.map(String) ?? []);
  const rateLimit = config.rateLimitPerMinute ?? 30;

  // Sliding-window rate buckets: userId → timestamp[]
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
