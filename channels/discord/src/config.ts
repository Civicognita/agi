import type { ChannelConfigAdapter } from "@agi/sdk";

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
  /**
   * If non-empty, only allow messages from guild members that have at least
   * one of these Discord role IDs. Members without a matching role receive a
   * DM explanation and the message is dropped. Empty = open access (default).
   *
   * UI stores this as a comma-separated string; normalizeDiscordArrayField()
   * converts it to string[] before use.
   */
  allowedRoleIds?: string[];
  /**
   * Channels where Aion reads all messages for context and moderation but
   * does NOT route to the AI (no responses). Respond to @mentions only in
   * allowedChannelIds; read everything here. Empty = no monitor-only channels.
   */
  presenceChannelIds?: string[];
  /** Only respond when @mentioned or in DMs, default true. */
  mentionOnly?: boolean;
  /** Max messages per user per minute before rate-limiting (default: 20). */
  rateLimitPerMinute?: number;
  /**
   * Enable the Server Members privileged intent.
   *
   * Required for: guild member sync on bot ready, `discord_list_members` tool,
   * per-guild role data in `discord_get_user` tool.
   *
   * BEFORE enabling this, go to discord.com/developers/applications → your app
   * → Bot → Privileged Gateway Intents → turn on "Server Members Intent".
   * Without that portal toggle, discord.js will fail to connect (4014 error).
   *
   * Default: false (bot connects without member data).
   */
  enableServerMembersIntent?: boolean;
}

/**
 * Normalise a DiscordConfig array field that may arrive as a comma-separated
 * string (from the generic Settings UI form) or as a proper string[] (from
 * gateway.json). Returns an empty array when the value is absent or blank.
 */
export function normalizeDiscordArrayField(value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).filter((v) => typeof v === "string") as string[];
  }
  return [];
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

  // Accept both string[] and comma-separated string for all array fields
  // (the generic Settings UI form saves them as comma-separated strings).
  for (const field of ["allowedGuildIds", "allowedChannelIds", "allowedRoleIds", "presenceChannelIds"] as const) {
    if (field in obj) {
      const v = obj[field];
      if (
        v !== "" &&
        !Array.isArray(v) &&
        typeof v !== "string"
      ) return false;
      if (Array.isArray(v) && !(v as unknown[]).every((id) => typeof id === "string")) return false;
    }
  }

  // Accept boolean, "true"/"false" string, OR empty string (field cleared in UI = use default).
  // coerceDiscordConfig() normalises these before the plugin consumes them.
  if ("mentionOnly" in obj) {
    const v = obj["mentionOnly"];
    if (v !== undefined && v !== "" && typeof v !== "boolean" && v !== "true" && v !== "false")
      return false;
  }

  if ("enableServerMembersIntent" in obj) {
    const v = obj["enableServerMembersIntent"];
    if (v !== undefined && v !== "" && typeof v !== "boolean" && v !== "true" && v !== "false")
      return false;
  }

  if ("rateLimitPerMinute" in obj) {
    const v = obj["rateLimitPerMinute"];
    // Empty string = field cleared, treat as "not set" (coerce will use default)
    if (v !== undefined && v !== "") {
      if (typeof v === "number") {
        if (v <= 0) return false;
      } else if (typeof v === "string") {
        const n = Number(v);
        if (Number.isNaN(n) || n <= 0) return false;
      } else {
        return false;
      }
    }
  }

  return true;
}

/**
 * Coerce a validated-but-stringified Discord config object to proper types.
 *
 * The dashboard settings form stores ALL values as `Record<string, string>`.
 * This means boolean fields arrive as `"true"/"false"` and numeric fields as
 * numeric strings. Call this after `isDiscordConfig()` returns true to
 * guarantee `createDiscordPlugin()` always receives correctly-typed values.
 */
export function coerceDiscordConfig(raw: Record<string, unknown>): DiscordConfig {
  // Empty string = field cleared in UI; treat as not-set and use the default.
  const parseBool = (v: unknown, def: boolean): boolean =>
    v === true || v === "true" ? true : v === false || v === "false" ? false : def;
  const posNum = (v: unknown, def: number): number => {
    if (v === "" || v === null || v === undefined) return def;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  return {
    botToken: String(raw["botToken"] ?? ""),
    ...(raw["applicationId"] !== undefined
      ? { applicationId: String(raw["applicationId"]) }
      : {}),
    ...(raw["allowedGuildIds"] !== undefined
      ? { allowedGuildIds: raw["allowedGuildIds"] as DiscordConfig["allowedGuildIds"] }
      : {}),
    ...(raw["allowedChannelIds"] !== undefined
      ? { allowedChannelIds: raw["allowedChannelIds"] as DiscordConfig["allowedChannelIds"] }
      : {}),
    ...(raw["allowedRoleIds"] !== undefined
      ? { allowedRoleIds: raw["allowedRoleIds"] as DiscordConfig["allowedRoleIds"] }
      : {}),
    ...(raw["presenceChannelIds"] !== undefined
      ? { presenceChannelIds: raw["presenceChannelIds"] as DiscordConfig["presenceChannelIds"] }
      : {}),
    mentionOnly: parseBool(raw["mentionOnly"], true),
    rateLimitPerMinute: posNum(raw["rateLimitPerMinute"], 20),
    enableServerMembersIntent: parseBool(raw["enableServerMembersIntent"], false),
  };
}

/** ChannelConfigAdapter for the Discord channel. */
export function createConfigAdapter(): ChannelConfigAdapter {
  return {
    validate: (config: unknown) => isDiscordConfig(config),
    getDefaults: () => ({
      botToken: "",
      applicationId: "",
      allowedGuildIds: "",
      allowedChannelIds: "",
      presenceChannelIds: "",
      allowedRoleIds: "",
      mentionOnly: true,
      rateLimitPerMinute: 20,
      enableServerMembersIntent: false,
    }),
  };
}
