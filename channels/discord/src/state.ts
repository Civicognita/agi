/**
 * Discord plugin state introspection — pure helpers + HTTP-route binding.
 *
 * Exposes the live Discord Client's connection state, guild list, and
 * per-guild text-channel + forum lists so the dashboard can render a
 * "Discord — Connected" status card with the actual servers/rooms the
 * bot can see. Owner-facing surface for the "setup before bed" UX
 * (CHN-B partial slice, 2026-05-14).
 *
 * The pure-logic extractor (`describeClientState`) is exported separately
 * so it's unit-testable without instantiating a real discord.js Client.
 */

import type { Client, Guild, TextChannel, ForumChannel } from "discord.js";

export type DiscordChannelKind = "text" | "forum" | "voice" | "category" | "other";

export interface DiscordChannelDescriptor {
  id: string;
  name: string;
  kind: DiscordChannelKind;
  /** Parent category name when present. */
  parent?: string;
}

export interface DiscordGuildDescriptor {
  id: string;
  name: string;
  iconUrl?: string;
  memberCount?: number;
  channels: DiscordChannelDescriptor[];
}

export interface DiscordStateDescriptor {
  /** Bot user is fully ready + connected to Discord gateway. */
  connected: boolean;
  /** Bot user identity (when connected). */
  user?: {
    id: string;
    tag: string;
    avatarUrl?: string;
  };
  /** Guilds the bot is currently a member of. */
  guilds: DiscordGuildDescriptor[];
  /** Timestamp when this snapshot was taken (ISO 8601). */
  snapshotAt: string;
}

/**
 * Map a discord.js channel-type number to our normalized kind string.
 * Reference: https://discord.com/developers/docs/resources/channel#channel-object-channel-types
 */
export function channelKindFromType(type: number): DiscordChannelKind {
  switch (type) {
    case 0: return "text";      // GUILD_TEXT
    case 2: return "voice";     // GUILD_VOICE
    case 4: return "category";  // GUILD_CATEGORY
    case 5: return "text";      // GUILD_ANNOUNCEMENT
    case 13: return "voice";    // GUILD_STAGE_VOICE
    case 15: return "forum";    // GUILD_FORUM
    case 16: return "forum";    // GUILD_MEDIA (forum-like)
    default: return "other";
  }
}

/**
 * Pure-logic extractor: walk a Guild's channel cache and produce a
 * sorted, normalized list of channel descriptors.
 */
export function describeGuildChannels(guild: Pick<Guild, "channels">): DiscordChannelDescriptor[] {
  const out: DiscordChannelDescriptor[] = [];
  const cache = guild.channels.cache;
  // Build a category-id → name map for parent lookup
  const categoryNames = new Map<string, string>();
  for (const ch of cache.values()) {
    const c = ch as { id: string; name: string; type: number };
    if (channelKindFromType(c.type) === "category") {
      categoryNames.set(c.id, c.name);
    }
  }
  for (const ch of cache.values()) {
    const c = ch as {
      id: string;
      name: string;
      type: number;
      parentId?: string | null;
    };
    const kind = channelKindFromType(c.type);
    // Skip categories themselves — they're a layout concept, not a room
    if (kind === "category") continue;
    out.push({
      id: c.id,
      name: c.name,
      kind,
      parent: c.parentId !== null && c.parentId !== undefined
        ? categoryNames.get(c.parentId)
        : undefined,
    });
  }
  // Sort by (parent ?? "", name)
  out.sort((a, b) => {
    const pa = a.parent ?? "";
    const pb = b.parent ?? "";
    if (pa !== pb) return pa.localeCompare(pb);
    return a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * Pure-logic extractor for the full client state. Accepts a thin
 * duck-typed shape so unit tests can pass a fake. The avatar/icon
 * lookups are resolved in `getDiscordState()` (the type-safe wrapper
 * over the real discord.js Client) — the pure extractor takes
 * pre-resolved strings so it doesn't have to deal with discord.js's
 * tight literal-union argument typing.
 */
export interface ClientStateInput {
  user: { id: string; tag: string; avatarUrl?: string } | null;
  guilds: Array<{
    id: string;
    name: string;
    memberCount?: number;
    iconUrl?: string;
    channels: DiscordChannelDescriptor[];
  }>;
}

export function describeClientState(input: ClientStateInput): DiscordStateDescriptor {
  const snapshotAt = new Date().toISOString();
  if (input.user === null) {
    return { connected: false, guilds: [], snapshotAt };
  }
  const guilds = [...input.guilds].sort((a, b) => a.name.localeCompare(b.name));
  return {
    connected: true,
    user: {
      id: input.user.id,
      tag: input.user.tag,
      avatarUrl: input.user.avatarUrl,
    },
    guilds,
    snapshotAt,
  };
}

/**
 * Type-safe wrapper around describeClientState for the real discord.js
 * Client. Resolves avatar/icon URLs and channel descriptors, then hands
 * pre-typed data to the pure extractor. Called from the HTTP route handler.
 */
export function getDiscordState(client: Client): DiscordStateDescriptor {
  if (client.user === null) {
    return describeClientState({ user: null, guilds: [] });
  }
  const guilds: ClientStateInput["guilds"] = [];
  for (const g of client.guilds.cache.values()) {
    const iconUrl = g.iconURL({ extension: "png", size: 64 }) ?? undefined;
    guilds.push({
      id: g.id,
      name: g.name,
      memberCount: g.memberCount,
      iconUrl,
      channels: describeGuildChannels(g),
    });
  }
  return describeClientState({
    user: {
      id: client.user.id,
      tag: client.user.tag,
      avatarUrl: client.user.displayAvatarURL({ extension: "png", size: 64 }),
    },
    guilds,
  });
}

// Re-export TextChannel / ForumChannel types for consumer convenience.
export type { TextChannel, ForumChannel };
