/**
 * Discord bridge tools for Aion.
 *
 * Owner directive 2026-05-13: Aion needs context surfaces beyond just
 * inbound @-mentions — user profiles, roles, presence, all chat messages
 * with time-window search. This file exports four AgentToolDefinitions
 * the channel plugin registers when it starts.
 *
 * **Response gate stays mention-only** (existing `mentionOnly` config).
 * These tools are READ-side surfaces — Aion can use them anytime it has
 * a project-context-bound chat session. They don't change when Aion
 * *responds* to Discord messages, only what context it can pull.
 *
 * **Read policy (per OQ-2 owner answer 2026-05-13):** bot-presence on
 * public guild channels implies consent. Private rooms / DMs require
 * explicit per-room toggles (config field `readPolicy.readDmMessages`
 * gates the DM case). Roles + presence default off; opt-in via config.
 *
 * Pure-logic primitives live in `./aion-tools-logic.ts` for tests; the
 * handlers in this file glue them to a live discord.js Client + the
 * AgentToolDefinition contract.
 */

import type { Client } from "discord.js";
import type { AgentToolDefinition } from "@agi/plugins";
import type { DiscordConfig } from "./config.js";
import {
  buildSearchOptions,
  normalizeUserPresence,
  normalizeMemberRoles,
  type DiscordSearchOptions,
} from "./aion-tools-logic.js";

interface BridgeToolContext {
  client: Client;
  config: DiscordConfig;
}

/**
 * `discord_search_messages` — read message history from a channel,
 * optionally bounded by time-frame, paged via Discord's `before` cursor.
 *
 * Per OQ-2: callers must specify `channelId` (public channels where the
 * bot is present are readable by default; the channel plugin's policy
 * layer rejects requests for private rooms unless explicitly enabled).
 */
function buildSearchMessagesTool(ctx: BridgeToolContext): AgentToolDefinition {
  return {
    name: "discord_search_messages",
    description:
      "Read message history from a Discord channel. Optionally bound by time-frame (`fromTs`/`toTs` ISO timestamps). Paged via `cursor` (Discord message ID). Returns up to `limit` messages (default 50, max 100) newest-first.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Discord channel ID (text channel, forum thread, or DM)." },
        fromTs: { type: "string", description: "ISO timestamp — only return messages sent at or after this time." },
        toTs: { type: "string", description: "ISO timestamp — only return messages sent at or before this time." },
        limit: { type: "number", description: "Max messages to return (default 50, capped at 100)." },
        cursor: { type: "string", description: "Discord message ID to page from. Returns messages older than this." },
      },
      required: ["channelId"],
    },
    handler: async (input) => {
      const opts: DiscordSearchOptions = buildSearchOptions(input as Record<string, unknown>);
      const channel = await ctx.client.channels.fetch(opts.channelId).catch(() => null);
      if (channel === null) {
        return { error: `channel ${opts.channelId} not found or bot lacks access` };
      }
      // Only text-based channels support fetching messages.
      const fetchable = channel as { messages?: { fetch?: (q: Record<string, unknown>) => Promise<Map<string, unknown>> } };
      if (typeof fetchable.messages?.fetch !== "function") {
        return { error: `channel ${opts.channelId} is not a text-based channel` };
      }
      const query: Record<string, unknown> = { limit: opts.limit };
      if (opts.cursor !== undefined) query["before"] = opts.cursor;
      const fetched = await fetchable.messages.fetch(query);
      const messages: Array<Record<string, unknown>> = [];
      let nextCursor: string | undefined;
      for (const [id, msg] of fetched as Map<string, { id: string; createdTimestamp: number; content: string; author: { id: string; username: string; displayName?: string }; channelId: string }>) {
        const ts = new Date(msg.createdTimestamp).toISOString();
        if (opts.fromTs !== undefined && ts < opts.fromTs) continue;
        if (opts.toTs !== undefined && ts > opts.toTs) continue;
        messages.push({
          messageId: msg.id,
          channelId: msg.channelId,
          sentAt: ts,
          author: { id: msg.author.id, username: msg.author.username, displayName: msg.author.displayName },
          text: msg.content,
        });
        nextCursor = id; // overwritten until oldest in the batch
      }
      return { messages, nextCursor, count: messages.length };
    },
  };
}

/** `discord_get_user` — fetch a Discord user's profile + roles. */
function buildGetUserTool(ctx: BridgeToolContext): AgentToolDefinition {
  return {
    name: "discord_get_user",
    description:
      "Get a Discord user's profile (id, username, displayName, avatar) and, when `guildId` is provided, their roles in that guild. Roles available iff the bot has the GuildMembers intent enabled.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Discord user snowflake id." },
        guildId: { type: "string", description: "When set, also returns the user's role IDs + names within this guild." },
      },
      required: ["userId"],
    },
    handler: async (input) => {
      const userId = String((input as Record<string, unknown>)["userId"] ?? "").trim();
      const guildId = (input as Record<string, unknown>)["guildId"];
      if (userId.length === 0) return { error: "userId is required" };

      const user = await ctx.client.users.fetch(userId).catch(() => null);
      if (user === null) return { error: `user ${userId} not found` };

      const profile: Record<string, unknown> = {
        userId: user.id,
        username: user.username,
        displayName: user.globalName ?? user.username,
        avatarUrl: user.displayAvatarURL(),
        bot: user.bot,
      };

      if (typeof guildId === "string" && guildId.length > 0) {
        const guild = await ctx.client.guilds.fetch(guildId).catch(() => null);
        if (guild !== null) {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member !== null) {
            profile["roles"] = normalizeMemberRoles(member.roles.cache);
            profile["joinedAt"] = member.joinedAt?.toISOString();
            profile["nickname"] = member.nickname;
          }
        }
      }

      return { user: profile };
    },
  };
}

/** `discord_list_members` — paged roster of a guild's members. */
function buildListMembersTool(ctx: BridgeToolContext): AgentToolDefinition {
  return {
    name: "discord_list_members",
    description:
      "List members of a Discord guild. Requires the GuildMembers intent. Returns up to `limit` members (default 100, max 1000). Use `after` to page (last seen member id).",
    inputSchema: {
      type: "object",
      properties: {
        guildId: { type: "string", description: "Discord guild id." },
        limit: { type: "number", description: "Max members to return (default 100, max 1000)." },
        after: { type: "string", description: "Page cursor — member id after which to start (Discord-ordered)." },
      },
      required: ["guildId"],
    },
    handler: async (input) => {
      const guildId = String((input as Record<string, unknown>)["guildId"] ?? "").trim();
      const limitRaw = Number((input as Record<string, unknown>)["limit"] ?? 100);
      const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 100));
      const after = (input as Record<string, unknown>)["after"];
      if (guildId.length === 0) return { error: "guildId is required" };

      const guild = await ctx.client.guilds.fetch(guildId).catch(() => null);
      if (guild === null) return { error: `guild ${guildId} not found` };

      const query: Record<string, unknown> = { limit };
      if (typeof after === "string" && after.length > 0) query["after"] = after;
      const fetched = await guild.members.fetch(query as Parameters<typeof guild.members.fetch>[0]).catch(() => null);
      if (fetched === null) return { error: "failed to fetch members — verify GuildMembers intent is enabled" };

      const members: Array<Record<string, unknown>> = [];
      for (const [, m] of fetched) {
        members.push({
          userId: m.user.id,
          username: m.user.username,
          displayName: m.user.globalName ?? m.user.username,
          nickname: m.nickname,
          roles: normalizeMemberRoles(m.roles.cache),
          joinedAt: m.joinedAt?.toISOString(),
        });
      }
      return { members, count: members.length };
    },
  };
}

/** `discord_get_user_activity` — current presence + activity for a user. */
function buildGetUserActivityTool(ctx: BridgeToolContext): AgentToolDefinition {
  return {
    name: "discord_get_user_activity",
    description:
      "Get a Discord user's current presence (online/idle/dnd/offline) and any active activity (playing X, listening to Y). Requires the GuildPresences intent. Returns null fields when presence isn't shared or the intent is off.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Discord user snowflake id." },
        guildId: { type: "string", description: "Guild to read presence from — presence is per-guild." },
      },
      required: ["userId", "guildId"],
    },
    handler: async (input) => {
      const userId = String((input as Record<string, unknown>)["userId"] ?? "").trim();
      const guildId = String((input as Record<string, unknown>)["guildId"] ?? "").trim();
      if (userId.length === 0 || guildId.length === 0) {
        return { error: "userId and guildId are required" };
      }
      const guild = await ctx.client.guilds.fetch(guildId).catch(() => null);
      if (guild === null) return { error: `guild ${guildId} not found` };
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member === null) return { error: `member ${userId} not found in guild ${guildId}` };
      const presence = member.presence;
      return normalizeUserPresence(presence);
    },
  };
}

/**
 * Build the full set of Discord bridge tools for registration with the
 * agent tool registry. Caller (channel plugin's `start()`) iterates and
 * calls `api.registerAgentTool(def)` for each.
 */
export function buildDiscordBridgeTools(ctx: BridgeToolContext): AgentToolDefinition[] {
  return [
    buildSearchMessagesTool(ctx),
    buildGetUserTool(ctx),
    buildListMembersTool(ctx),
    buildGetUserActivityTool(ctx),
  ];
}
