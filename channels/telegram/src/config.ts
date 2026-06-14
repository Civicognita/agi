// ---------------------------------------------------------------------------
// Telegram config
// ---------------------------------------------------------------------------

export interface TelegramConfig {
  /** Bot token from @BotFather */
  botToken: string;
  /** If non-empty, only these Telegram chat IDs may interact with the bot. */
  allowedChatIds?: number[];
  /** Long-polling timeout in seconds (default: 30). */
  pollingTimeout?: number;
  /** Max messages per user per minute before rate-limiting (default: 30). */
  rateLimitPerMinute?: number;
}

/**
 * Runtime type guard for {@link TelegramConfig}.
 * Keeps the telegram package dependency-free from Zod.
 */
export function isTelegramConfig(value: unknown): value is TelegramConfig {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;

  if (typeof obj["botToken"] !== "string" || obj["botToken"].length === 0)
    return false;

  if ("allowedChatIds" in obj) {
    if (!Array.isArray(obj["allowedChatIds"])) return false;
    if (
      !(obj["allowedChatIds"] as unknown[]).every(
        (id) => typeof id === "number",
      )
    )
      return false;
  }

  if (
    "pollingTimeout" in obj &&
    (typeof obj["pollingTimeout"] !== "number" || obj["pollingTimeout"] <= 0)
  )
    return false;

  if (
    "rateLimitPerMinute" in obj &&
    (typeof obj["rateLimitPerMinute"] !== "number" ||
      obj["rateLimitPerMinute"] <= 0)
  )
    return false;

  return true;
}

/** ChannelConfigAdapter for the Telegram channel. */
export function createConfigAdapter() {
  return {
    validate: (config: unknown) => isTelegramConfig(config),
    getDefaults: () => ({ pollingTimeout: 30, rateLimitPerMinute: 30 }),
  };
}
