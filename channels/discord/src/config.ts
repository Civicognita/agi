import type { ChannelConfigAdapter } from "@aionima/channel-sdk";

// ---------------------------------------------------------------------------
// Discord config
// ---------------------------------------------------------------------------

export interface DiscordConfig {
  /** Bot token from Discord Developer Portal */
  botToken: string;
  /** Application ID — required for slash commands (future use). */
  applicationId?: string;
  /** If non-empty, only respond to messages in these guild (server) IDs. */
  allowedGuildIds?: string[];
  /** If non-empty, only respond to messages in these channel IDs. */
  allowedChannelIds?: string[];
  /** Only respond when @mentioned or in DMs, default true. */
  mentionOnly?: boolean;
  /** Max messages per user per minute before rate-limiting (default: 20). */
  rateLimitPerMinute?: number;
}

/**
 * Runtime type guard for {@link DiscordConfig}.
 * Keeps the discord package dependency-free from Zod.
 */
export function isDiscordConfig(value: unknown): value is DiscordConfig {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;

  if (typeof obj["botToken"] !== "string" || obj["botToken"].length === 0)
    return false;

  if (
    "applicationId" in obj &&
    typeof obj["applicationId"] !== "string"
  )
    return false;

  if ("allowedGuildIds" in obj) {
    if (!Array.isArray(obj["allowedGuildIds"])) return false;
    if (
      !(obj["allowedGuildIds"] as unknown[]).every(
        (id) => typeof id === "string",
      )
    )
      return false;
  }

  if ("allowedChannelIds" in obj) {
    if (!Array.isArray(obj["allowedChannelIds"])) return false;
    if (
      !(obj["allowedChannelIds"] as unknown[]).every(
        (id) => typeof id === "string",
      )
    )
      return false;
  }

  if ("mentionOnly" in obj && typeof obj["mentionOnly"] !== "boolean")
    return false;

  if (
    "rateLimitPerMinute" in obj &&
    (typeof obj["rateLimitPerMinute"] !== "number" ||
      obj["rateLimitPerMinute"] <= 0)
  )
    return false;

  return true;
}

/** ChannelConfigAdapter for the Discord channel. */
export function createConfigAdapter(): ChannelConfigAdapter {
  return {
    validate: (config: unknown) => isDiscordConfig(config),
    getDefaults: () => ({ rateLimitPerMinute: 20 }),
  };
}
