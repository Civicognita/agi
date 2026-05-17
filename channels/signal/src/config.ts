// ---------------------------------------------------------------------------
// Signal config
// ---------------------------------------------------------------------------

export interface SignalConfig {
  /** URL of the signal-cli REST API (default: "http://localhost:8080"). */
  signalCliUrl: string;
  /** The bot's registered phone number (E.164 format). */
  accountNumber: string;
  /** How often to poll signal-cli for new messages in ms (default: 2000). */
  pollingIntervalMs?: number;
  /**
   * If non-empty, only these numbers may interact with the bot.
   * Stored as SHA-256 hashes — never raw phone numbers.
   */
  allowedNumbers?: string[];
  /** Max messages per user per minute before rate-limiting (default: 15). */
  rateLimitPerMinute?: number;
}

/**
 * Runtime type guard for {@link SignalConfig}.
 * Keeps the signal package dependency-free from Zod.
 */
export function isSignalConfig(value: unknown): value is SignalConfig {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;

  if (
    typeof obj["signalCliUrl"] !== "string" ||
    obj["signalCliUrl"].length === 0
  )
    return false;

  if (
    typeof obj["accountNumber"] !== "string" ||
    obj["accountNumber"].length === 0
  )
    return false;

  if (
    "pollingIntervalMs" in obj &&
    (typeof obj["pollingIntervalMs"] !== "number" ||
      obj["pollingIntervalMs"] <= 0)
  )
    return false;

  if ("allowedNumbers" in obj) {
    if (!Array.isArray(obj["allowedNumbers"])) return false;
    if (
      !(obj["allowedNumbers"] as unknown[]).every(
        (n) => typeof n === "string",
      )
    )
      return false;
  }

  if (
    "rateLimitPerMinute" in obj &&
    (typeof obj["rateLimitPerMinute"] !== "number" ||
      obj["rateLimitPerMinute"] <= 0)
  )
    return false;

  return true;
}

/** ChannelConfigAdapter for the Signal channel. */
export function createConfigAdapter() {
  return {
    validate: (config: unknown) => isSignalConfig(config),
    getDefaults: () => ({ pollingIntervalMs: 2000, rateLimitPerMinute: 15 }),
  };
}
