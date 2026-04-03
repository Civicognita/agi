import type { ChannelConfigAdapter } from "@aionima/channel-sdk";

// ---------------------------------------------------------------------------
// Email config
// ---------------------------------------------------------------------------

export interface EmailConfig {
  /** Gmail account address (e.g. "aionima@civicognita.com"). */
  account: string;
  /** OAuth2 client ID from Google Cloud Console. */
  clientId: string;
  /** OAuth2 client secret from Google Cloud Console. */
  clientSecret: string;
  /** OAuth2 refresh token (obtained via scripts/gmail-auth.ts). */
  refreshToken: string;
  /** Gmail label to poll (default: "INBOX"). */
  label?: string;
  /** How often to poll Gmail for new messages in ms (default: 15000). */
  pollingIntervalMs?: number;
  /** If non-empty, only these email addresses may interact. Case-insensitive. */
  allowedAddresses?: string[];
  /** Max messages per user per minute before rate-limiting (default: 20). */
  rateLimitPerMinute?: number;
  /** Ignore messages older than this many minutes (default: 30). */
  maxAgeMinutes?: number;
}

/**
 * Runtime type guard for {@link EmailConfig}.
 */
export function isEmailConfig(value: unknown): value is EmailConfig {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;

  if (typeof obj["account"] !== "string" || obj["account"].length === 0)
    return false;
  if (typeof obj["clientId"] !== "string" || obj["clientId"].length === 0)
    return false;
  if (typeof obj["clientSecret"] !== "string" || obj["clientSecret"].length === 0)
    return false;
  if (typeof obj["refreshToken"] !== "string" || obj["refreshToken"].length === 0)
    return false;

  if ("label" in obj && typeof obj["label"] !== "string") return false;

  if (
    "pollingIntervalMs" in obj &&
    (typeof obj["pollingIntervalMs"] !== "number" || obj["pollingIntervalMs"] <= 0)
  )
    return false;

  if ("allowedAddresses" in obj) {
    if (!Array.isArray(obj["allowedAddresses"])) return false;
    if (
      !(obj["allowedAddresses"] as unknown[]).every(
        (a) => typeof a === "string",
      )
    )
      return false;
  }

  if (
    "rateLimitPerMinute" in obj &&
    (typeof obj["rateLimitPerMinute"] !== "number" || obj["rateLimitPerMinute"] <= 0)
  )
    return false;

  if (
    "maxAgeMinutes" in obj &&
    (typeof obj["maxAgeMinutes"] !== "number" || obj["maxAgeMinutes"] <= 0)
  )
    return false;

  return true;
}

/** ChannelConfigAdapter for the Email channel. */
export function createConfigAdapter(): ChannelConfigAdapter {
  return {
    validate: (config: unknown) => isEmailConfig(config),
    getDefaults: () => ({
      label: "INBOX",
      pollingIntervalMs: 15_000,
      rateLimitPerMinute: 20,
      maxAgeMinutes: 30,
    }),
  };
}
