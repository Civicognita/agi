import type { ChannelSecurityAdapter } from "@agi/channel-sdk";

// ---------------------------------------------------------------------------
// Security adapter: email allowlist + rate limiting
// ---------------------------------------------------------------------------

export interface EmailSecurityConfig {
  /** If non-empty, only these email addresses may interact. Case-insensitive. */
  allowedAddresses?: string[];
  /** Max messages per user per minute (default: 20). */
  rateLimitPerMinute?: number;
}

/**
 * Create a {@link ChannelSecurityAdapter} with a case-insensitive email
 * allowlist and per-user sliding-window rate limiting.
 *
 * When `allowedAddresses` is empty or omitted, all senders are permitted
 * (open mode).
 */
export function createSecurityAdapter(
  config: EmailSecurityConfig,
): ChannelSecurityAdapter {
  const allowSet = new Set(
    (config.allowedAddresses ?? []).map((a) => a.toLowerCase()),
  );
  const rateLimit = config.rateLimitPerMinute ?? 20;

  // Sliding-window rate buckets: email → timestamp[]
  const rateBuckets = new Map<string, number[]>();

  return {
    isAllowed: async (channelUserId: string) => {
      const email = channelUserId.toLowerCase();

      // Allowlist check — empty set = everyone allowed
      if (allowSet.size > 0 && !allowSet.has(email)) {
        return false;
      }

      // Sliding-window rate limit
      const now = Date.now();
      const windowMs = 60_000;
      const bucket = rateBuckets.get(email) ?? [];
      const active = bucket.filter((t) => now - t < windowMs);

      if (active.length >= rateLimit) {
        rateBuckets.set(email, active);
        return false;
      }

      active.push(now);
      rateBuckets.set(email, active);
      return true;
    },

    getAllowlist: async () => [...allowSet],
  };
}
