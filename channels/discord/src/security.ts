import type { ChannelSecurityAdapter } from "@agi/sdk";

// ---------------------------------------------------------------------------
// Security adapter: guild/channel allowlists + rate limiting
// ---------------------------------------------------------------------------

export interface DiscordSecurityConfig {
  /** If non-empty, only these guild (server) IDs are permitted. */
  allowedGuildIds?: string[];
  /** If non-empty, only these channel IDs are permitted. */
  allowedChannelIds?: string[];
  /** Max messages per user per minute (default: 20). */
  rateLimitPerMinute?: number;
}

/**
 * Create a {@link ChannelSecurityAdapter} with guild/channel allowlists and
 * per-user rate limiting.
 *
 * When `allowedGuildIds` and `allowedChannelIds` are both empty or omitted,
 * all users are permitted (open mode).
 * Rate buckets use a sliding window of 60 seconds.
 *
 * Note: Guild and channel scope checks are performed in the gateway's message
 * handler before calling `isAllowed`. This adapter's `isAllowed` method
 * enforces the per-user rate limit only (channelUserId = Discord user ID).
 */
export function createSecurityAdapter(
  config: DiscordSecurityConfig,
): ChannelSecurityAdapter {
  const guildAllowSet = new Set(config.allowedGuildIds ?? []);
  const channelAllowSet = new Set(config.allowedChannelIds ?? []);
  const rateLimit = config.rateLimitPerMinute ?? 20;

  // Sliding-window rate buckets: userId → timestamp[]
  const rateBuckets = new Map<string, number[]>();

  return {
    isAllowed: async (channelUserId: string) => {
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

    // Returns union of both allowlists — callers interpret context
    getAllowlist: async () => [
      ...guildAllowSet,
      ...channelAllowSet,
    ],
  };
}

// ---------------------------------------------------------------------------
// Scope check helpers (used by gateway before isAllowed)
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the guild is permitted (or no guild allowlist is set).
 */
export function isGuildAllowed(
  guildId: string | null,
  allowedGuildIds: string[] | undefined,
): boolean {
  if (!allowedGuildIds || allowedGuildIds.length === 0) return true;
  if (guildId === null) return false;
  return allowedGuildIds.includes(guildId);
}

/**
 * Returns `true` if the channel is permitted (or no channel allowlist is set).
 */
export function isChannelAllowed(
  channelId: string,
  allowedChannelIds: string[] | undefined,
): boolean {
  if (!allowedChannelIds || allowedChannelIds.length === 0) return true;
  return allowedChannelIds.includes(channelId);
}
