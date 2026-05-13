/**
 * Pure-logic primitives for the Discord bridge tools.
 *
 * Extracted from `./aion-tools.ts` so the input-parsing + normalization
 * logic can be unit-tested without spinning up a real discord.js Client.
 */

export interface DiscordSearchOptions {
  channelId: string;
  fromTs?: string;
  toTs?: string;
  /** Bounded 1..100 — discord.js max per fetch. */
  limit: number;
  cursor?: string;
}

/**
 * Parse + validate input for `discord_search_messages`. Bounds limit
 * within Discord's per-fetch max (100). Returns a fully-defaulted
 * options object; channelId is required and throws when missing.
 */
export function buildSearchOptions(input: Record<string, unknown>): DiscordSearchOptions {
  const channelId = String(input["channelId"] ?? "").trim();
  if (channelId.length === 0) {
    throw new Error("channelId is required");
  }
  const limitRaw = Number(input["limit"] ?? 50);
  const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 50));
  const fromTs = typeof input["fromTs"] === "string" ? (input["fromTs"] as string) : undefined;
  const toTs = typeof input["toTs"] === "string" ? (input["toTs"] as string) : undefined;
  const cursor = typeof input["cursor"] === "string" && (input["cursor"] as string).length > 0
    ? (input["cursor"] as string)
    : undefined;
  return { channelId, fromTs, toTs, limit, cursor };
}

/**
 * Discord.js presence shape → flat normalized record. Returns null
 * fields when presence isn't shared / intent disabled.
 */
export function normalizeUserPresence(presence: unknown): {
  presence: string | null;
  activity: string | null;
  status: string | null;
} {
  if (presence === null || presence === undefined) {
    return { presence: null, activity: null, status: null };
  }
  const p = presence as { status?: string; activities?: Array<{ type?: number | string; name?: string; state?: string; details?: string }> };
  const status = typeof p.status === "string" ? p.status : null;
  let activity: string | null = null;
  if (Array.isArray(p.activities) && p.activities.length > 0) {
    const first = p.activities[0]!;
    const verb =
      first.type === 0 ? "Playing" :
      first.type === 1 ? "Streaming" :
      first.type === 2 ? "Listening to" :
      first.type === 3 ? "Watching" :
      first.type === 4 ? "" :       // Custom status — render just state/details
      first.type === 5 ? "Competing in" :
      "";
    const subject = first.state ?? first.details ?? first.name ?? "";
    activity = verb.length > 0 ? `${verb} ${subject}`.trim() : subject;
    if (activity.length === 0) activity = null;
  }
  return {
    presence: status,
    activity,
    status: p.activities?.find((a) => a.type === 4)?.state ?? null,
  };
}

/**
 * Normalize a discord.js role-cache Collection (or any iterable of
 * `{id, name, color, position}`) into a flat array of `{id, name, color, position}`.
 */
export function normalizeMemberRoles(roleCache: Iterable<{ id: string; name: string; color?: number; position?: number }> | Map<string, { id: string; name: string; color?: number; position?: number }>): Array<{ id: string; name: string; color?: number; position?: number }> {
  const out: Array<{ id: string; name: string; color?: number; position?: number }> = [];
  // Maps and Collections both iterate as [k, v] pairs OR as values via for-of
  // when the structure supports it. Use a try-both pattern.
  if (typeof (roleCache as Map<string, unknown>).values === "function") {
    for (const role of (roleCache as Map<string, { id: string; name: string; color?: number; position?: number }>).values()) {
      out.push({ id: role.id, name: role.name, color: role.color, position: role.position });
    }
  } else {
    for (const role of roleCache as Iterable<{ id: string; name: string; color?: number; position?: number }>) {
      out.push({ id: role.id, name: role.name, color: role.color, position: role.position });
    }
  }
  // Sort by position descending (matches Discord UI ordering — top roles first)
  out.sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  return out;
}
