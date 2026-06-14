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

// ---------------------------------------------------------------------------
// CHN-G (s168) slice 1 — aggregate_stats bridge tool helpers
// ---------------------------------------------------------------------------

/**
 * Input parsing + validation for `discord_aggregate_stats`. `days` is
 * clamped to [1, 90] (Discord retains messages effectively forever but
 * scanning further than 90 days is rarely useful for scrum-master-style
 * summaries). `limit` caps at 1000 messages — beyond that the tool would
 * burn API quota for little marginal benefit; consumers can re-call with
 * a different time window for deeper history.
 */
export interface AggregateStatsOptions {
  channelId: string;
  /** Look-back window in days. Default 7; min 1, max 90. */
  days: number;
  /** Max messages to scan. Default 500, max 1000. */
  limit: number;
}

export function buildAggregateStatsOptions(input: Record<string, unknown>): AggregateStatsOptions {
  const channelId = String(input["channelId"] ?? "").trim();
  if (channelId.length === 0) {
    throw new Error("channelId is required");
  }
  const daysRaw = Number(input["days"] ?? 7);
  const days = Math.max(1, Math.min(90, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 7));
  const limitRaw = Number(input["limit"] ?? 500);
  const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 500));
  return { channelId, days, limit };
}

/**
 * Minimal message shape needed by the aggregator. Lets unit tests pass
 * fakes without spinning up discord.js.
 */
export interface MessageForStats {
  authorId: string;
  authorName: string;
  createdAtMs: number;
  isBot: boolean;
}

/** Per-author roll-up. */
export interface AuthorStats {
  authorId: string;
  authorName: string;
  messageCount: number;
}

/** Aggregate result handed back to the agent. */
export interface AggregateStats {
  channelId: string;
  /** Window descriptor — e.g. "last 7 days". */
  dayRange: string;
  /** Total messages from non-bot authors within the window. */
  messageCount: number;
  /** Distinct non-bot authors within the window. */
  uniqueAuthors: number;
  /** Top 5 authors by message count, descending. Ties broken by name. */
  topAuthors: AuthorStats[];
  /** ISO timestamp of the OLDEST message in the window (or null if none). */
  firstMessageAt: string | null;
  /** ISO timestamp of the NEWEST message in the window (or null if none). */
  lastMessageAt: string | null;
  /** Bot-author messages excluded from the aggregate (informational). */
  botMessagesExcluded: number;
}

/**
 * Pure-logic aggregator. Filters out bot authors (scrum-master cares
 * about human contribution), bounds by the day window, computes
 * messageCount + uniqueAuthors + top-5 authors. Returns nulls for
 * empty windows so consumers can render "no activity" cleanly.
 */
// ---------------------------------------------------------------------------
// CHN-G (s168) slice 3 — available_rooms filter
// ---------------------------------------------------------------------------

/**
 * Minimal shape needed by the filter — matches AvailableRoomDescriptor's
 * surface but stays decoupled so the pure-logic module doesn't import
 * from `./state.ts`.
 */
export interface RoomForFilter {
  channelId: string;
  roomId: string;
  label: string;
  kind: string;
  privacy: "public" | "private" | "secret";
  group: string;
  parent?: string;
}

export interface AvailableRoomsFilter {
  /** Substring (case-insensitive) match against label OR group. Optional. */
  query?: string;
  /** Restrict to a specific guild/server group. Optional. */
  group?: string;
}

/**
 * Pure-logic filter applied to AvailableRoomDescriptor[] before the bridge
 * tool returns it. Keeps the discord.js side trivial (just gather, then
 * delegate). Tests pass plain objects.
 */
export function filterAvailableRooms(
  rooms: RoomForFilter[],
  filter: AvailableRoomsFilter,
): RoomForFilter[] {
  const q = filter.query?.trim().toLowerCase() ?? "";
  const g = filter.group?.trim() ?? "";
  return rooms.filter((r) => {
    if (g.length > 0 && r.group !== g) return false;
    if (q.length > 0) {
      const label = r.label.toLowerCase();
      const group = r.group.toLowerCase();
      // Match a leading "#" so the agent can pass "#general" or "general".
      const qStripped = q.startsWith("#") ? q.slice(1) : q;
      if (!label.includes(qStripped) && !group.includes(qStripped)) return false;
    }
    return true;
  });
}

export function aggregateChannelStats(
  channelId: string,
  days: number,
  messages: MessageForStats[],
): AggregateStats {
  const nowMs = Date.now();
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;

  let botMessagesExcluded = 0;
  let firstMessageMs = Number.POSITIVE_INFINITY;
  let lastMessageMs = Number.NEGATIVE_INFINITY;
  const authorTally = new Map<string, AuthorStats>();
  let messageCount = 0;

  for (const m of messages) {
    if (m.createdAtMs < cutoffMs) continue;
    if (m.isBot) {
      botMessagesExcluded += 1;
      continue;
    }
    messageCount += 1;
    if (m.createdAtMs < firstMessageMs) firstMessageMs = m.createdAtMs;
    if (m.createdAtMs > lastMessageMs) lastMessageMs = m.createdAtMs;
    const existing = authorTally.get(m.authorId);
    if (existing === undefined) {
      authorTally.set(m.authorId, { authorId: m.authorId, authorName: m.authorName, messageCount: 1 });
    } else {
      existing.messageCount += 1;
    }
  }

  const topAuthors = [...authorTally.values()]
    .sort((a, b) => {
      if (b.messageCount !== a.messageCount) return b.messageCount - a.messageCount;
      return a.authorName.localeCompare(b.authorName);
    })
    .slice(0, 5);

  return {
    channelId,
    dayRange: `last ${String(days)} day${days === 1 ? "" : "s"}`,
    messageCount,
    uniqueAuthors: authorTally.size,
    topAuthors,
    firstMessageAt: firstMessageMs === Number.POSITIVE_INFINITY ? null : new Date(firstMessageMs).toISOString(),
    lastMessageAt: lastMessageMs === Number.NEGATIVE_INFINITY ? null : new Date(lastMessageMs).toISOString(),
    botMessagesExcluded,
  };
}
