import type { ChannelConfigAdapter } from "@agi/channel-sdk";

// ---------------------------------------------------------------------------
// Slack config
// ---------------------------------------------------------------------------

export interface SlackConfig {
  /** Bot OAuth token (xoxb-…) */
  botToken: string;
  /** App-level token for Socket Mode (xapp-…) */
  appToken: string;
  /** If non-empty, only respond to messages in these Slack channel IDs. */
  allowedChannelIds?: string[];
  /** Max messages per user per minute before rate-limiting (default: 20). */
  rateLimitPerMinute?: number;
}

/**
 * Runtime type guard for {@link SlackConfig}.
 * Keeps the slack package dependency-free from Zod.
 */
export function isSlackConfig(value: unknown): value is SlackConfig {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;

  if (typeof obj["botToken"] !== "string" || !obj["botToken"].startsWith("xoxb-"))
    return false;

  if (typeof obj["appToken"] !== "string" || !obj["appToken"].startsWith("xapp-"))
    return false;

  if ("allowedChannelIds" in obj) {
    if (!Array.isArray(obj["allowedChannelIds"])) return false;
    if (!(obj["allowedChannelIds"] as unknown[]).every((id) => typeof id === "string"))
      return false;
  }

  if (
    "rateLimitPerMinute" in obj &&
    (typeof obj["rateLimitPerMinute"] !== "number" || obj["rateLimitPerMinute"] <= 0)
  )
    return false;

  return true;
}

/** ChannelConfigAdapter for the Slack channel. */
export function createConfigAdapter(): ChannelConfigAdapter {
  return {
    validate: (config: unknown) => isSlackConfig(config),
    getDefaults: () => ({ rateLimitPerMinute: 20 }),
  };
}
