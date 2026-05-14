/**
 * Discord channel definition built against the new defineChannelV2 SDK
 * (CHN-A s162). This file is the s163 CHN-B migration target.
 *
 * **Status — 2026-05-14 slice 1:** the definition compiles + typechecks
 * against `ChannelDefinition` but is NOT yet wired into `index.ts`'s
 * `activate()`. The legacy `createDiscordPlugin` registration remains
 * the live path. This file is the bridge — it proves the v2 contract
 * is implementable against discord.js, gives owner a concrete diff to
 * sign off on (s162 AC4), and serves as the integration template for
 * the next slice (wire `defineChannelV2` definition in parallel to the
 * legacy registration).
 *
 * Mapping summary — every ChannelProtocol method ↔ existing helper:
 *
 *   | Protocol method        | Existing implementation                  |
 *   |------------------------|------------------------------------------|
 *   | start()                | client.login(botToken)                   |
 *   | onEvent(handler)       | client.on(Events.MessageCreate, ...)     |
 *   | listRooms()            | getDiscordAvailableRooms()  (CHN-D 3b)   |
 *   | getRoom(roomId)        | client.channels.fetch(channelIdFromRoomId)|
 *   | subscribeRoom(...)     | onEvent + room filter                    |
 *   | postToRoom(...)        | sendOutbound() against fetched channel   |
 *   | searchMessages(...)    | channel.messages.fetch (existing pattern)|
 *   | getUser(userId)        | client.users.fetch                       |
 *   | listMembers(scope)     | guild.members.fetch / channel.members    |
 *
 * Subsequent slices:
 *   - Slice 2: wire `defineChannelV2` registration in `activate()` in
 *     parallel to the legacy `registerChannel()`. Test both code paths
 *     coexist.
 *   - Slice 3: switch the gateway dispatcher to consume the v2 channel
 *     definition; legacy stops being used at runtime.
 *   - Slice 4: delete legacy `createDiscordPlugin` + `AionimaChannelPlugin`
 *     references (waits for CHN-M s174 channel-sdk@0.1 removal).
 *
 * Reference: agi/docs/agents/channel-plugin-redesign.md §11.
 */

import {
  Client,
  Events,
  GatewayIntentBits,
  TextChannel,
  type Channel,
  type Message,
} from "discord.js";
import {
  defineChannelV2,
  type ChannelDefinition,
  type ChannelProtocol,
  type ChannelContext,
  type ChannelEvent,
  type ChannelMessage,
  type ChannelRoom,
  type ChannelUser,
  type ChannelBridgeToolDefinition,
} from "@agi/sdk";

import type { DiscordConfig } from "./config.js";
import { DISCORD_CHANNEL_ID, normalizeMessage } from "./normalizer.js";
import { sendOutbound } from "./outbound.js";
import { getDiscordAvailableRooms } from "./state.js";
import { buildDiscordBridgeTools } from "./aion-tools.js";

// ---------------------------------------------------------------------------
// Helpers — roomId encoding/decoding
// ---------------------------------------------------------------------------

/**
 * roomId encoding (matches CHN-D + the dashboard's RoomPickerDialog):
 *   `${guildId}:${channelId}`  for guild channels
 *   `dm:${userId}`              for DMs
 *
 * Plain-channelId-as-roomId is accepted as a fallback for ergonomics.
 */
function parseRoomId(roomId: string): { guildId?: string; channelId: string; isDM: boolean } {
  if (roomId.startsWith("dm:")) {
    return { channelId: roomId.slice(3), isDM: true };
  }
  const colon = roomId.indexOf(":");
  if (colon === -1) {
    return { channelId: roomId, isDM: false };
  }
  return { guildId: roomId.slice(0, colon), channelId: roomId.slice(colon + 1), isDM: false };
}

function aionimaMessageToChannel(msg: Message): ChannelMessage | null {
  const normalized = normalizeMessage(msg);
  if (normalized === null) return null;
  // normalized.content is { type: "text"; text: string } (or a media
  // variant). For the v2 ChannelMessage we surface text only; media goes
  // into attachments[] in a later slice.
  const text = normalized.content.type === "text" ? normalized.content.text : "";
  return {
    messageId: msg.id,
    roomId: msg.guildId !== null ? `${msg.guildId}:${msg.channelId}` : `dm:${msg.author.id}`,
    authorId: msg.author.id,
    text,
    sentAt: new Date(msg.createdTimestamp).toISOString(),
    mentionsBot: msg.mentions.users.size > 0,
  };
}

// ---------------------------------------------------------------------------
// Bridge tool adapter — AgentToolDefinition → ChannelBridgeToolDefinition
// ---------------------------------------------------------------------------

/**
 * Wraps the existing AgentToolDefinition family from `aion-tools.ts` into
 * the ChannelBridgeToolDefinition shape v2 expects. The handler signature
 * differs slightly (v2 receives `(input, ctx: ChannelContext)`); we
 * ignore ctx for now since the existing tools are already context-bound
 * via closure at construction time.
 */
function adaptBridgeTools(client: Client, config: DiscordConfig): ChannelBridgeToolDefinition[] {
  const legacy = buildDiscordBridgeTools({ client, config });
  // AgentToolHandler signature is (input, {sessionId, entityId}). v2's
  // ChannelBridgeToolDefinition.handler is (input, ChannelContext). The
  // existing Discord tools don't read the legacy ctx today (they capture
  // client + config in closure), so we can pass a synthetic stub. When
  // the gateway dispatcher wires v2 in slice 3, it'll thread the real
  // session ids through.
  const legacyCtx = { sessionId: "channel-def-v2", entityId: "channel-def-v2" };
  return legacy.map((t) => ({
    name: t.name.startsWith("discord_") ? t.name.slice("discord_".length) : t.name,
    description: t.description,
    inputSchema: t.inputSchema as ChannelBridgeToolDefinition["inputSchema"],
    handler: (input: Record<string, unknown>, _ctx: ChannelContext) => t.handler(input, legacyCtx),
  }));
}

// ---------------------------------------------------------------------------
// Protocol implementation
// ---------------------------------------------------------------------------

function buildProtocol(config: DiscordConfig, _ctx: ChannelContext): ChannelProtocol {
  // One client per channel definition activation (matches legacy plugin
  // semantics). The protocol stays alive until stop().
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
    ],
  });

  const eventHandlers: Array<(e: ChannelEvent) => void> = [];

  client.on(Events.MessageCreate, (msg) => {
    const channelMessage = aionimaMessageToChannel(msg);
    if (channelMessage === null) return;
    const event: ChannelEvent = { kind: "message", message: channelMessage };
    for (const h of eventHandlers) h(event);
  });

  return {
    start: async () => {
      await client.login(config.botToken);
      return { stop: async () => { client.destroy(); } };
    },

    onEvent: (handler) => {
      eventHandlers.push(handler);
      return () => {
        const i = eventHandlers.indexOf(handler);
        if (i >= 0) eventHandlers.splice(i, 1);
      };
    },

    listRooms: async () => {
      const rooms = getDiscordAvailableRooms(client);
      return rooms.map((r): ChannelRoom => ({
        roomId: r.roomId,
        label: r.label,
        kind: r.kind === "voice" ? "channel" : r.kind, // shouldn't happen — getDiscordAvailableRooms filters voice
        privacy: r.privacy,
      }));
    },

    getRoom: async (roomId) => {
      const { channelId } = parseRoomId(roomId);
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel === null) return null;
      const ch = channel as Channel & { name?: string; type?: number };
      return {
        roomId,
        label: ch.name ?? channelId,
        kind: "channel",
        privacy: "public",
      };
    },

    subscribeRoom: (roomId, handler) => {
      const filtered = (event: ChannelEvent) => {
        if (event.kind === "message" && event.message.roomId !== roomId) return;
        if (event.kind === "message-edit" && event.message.roomId !== roomId) return;
        handler(event);
      };
      eventHandlers.push(filtered);
      return () => {
        const i = eventHandlers.indexOf(filtered);
        if (i >= 0) eventHandlers.splice(i, 1);
      };
    },

    postToRoom: async (roomId, message) => {
      const { channelId } = parseRoomId(roomId);
      const channel = await client.channels.fetch(channelId);
      if (!(channel instanceof TextChannel)) {
        throw new Error(`Discord postToRoom: channel ${channelId} is not a TextChannel`);
      }
      await sendOutbound(channel, { type: "text", text: message.text });
      // sendOutbound doesn't return the persisted message — synthesize a
      // ChannelMessage. Slice 2 will surface a discord.js-side fetch of
      // the actual server-assigned id; for now, this satisfies the
      // contract shape.
      return {
        messageId: `pending-${Date.now().toString()}`,
        roomId,
        authorId: client.user?.id ?? "bot",
        text: message.text,
        sentAt: new Date().toISOString(),
        mentionsBot: false,
      };
    },

    searchMessages: async (roomId, opts) => {
      const { channelId } = parseRoomId(roomId);
      const channel = await client.channels.fetch(channelId);
      if (channel === null || !("messages" in channel)) {
        return { messages: [] };
      }
      const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
      const fetchOpts: { limit: number; before?: string } = { limit };
      if (opts.cursor !== undefined) fetchOpts.before = opts.cursor;
      const page = await (channel as { messages: { fetch: (o: typeof fetchOpts) => Promise<Map<string, Message>> } }).messages.fetch(fetchOpts);
      const messages: ChannelMessage[] = [];
      let oldestId: string | undefined;
      for (const msg of page.values()) {
        const cm = aionimaMessageToChannel(msg);
        if (cm !== null) messages.push(cm);
        oldestId = msg.id;
      }
      return { messages, nextCursor: page.size === limit ? oldestId : undefined };
    },

    getUser: async (userId) => {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user === null) return null;
      // buildDisplayName takes a Message; here we have only a User, so
      // we inline the equivalent logic (globalName → username → fallback).
      const displayName = user.globalName ?? user.username;
      return {
        userId: user.id,
        displayName,
        username: user.username,
        avatarUrl: user.displayAvatarURL(),
      } satisfies ChannelUser;
    },

    listMembers: async (scope) => {
      if (scope.roomId !== undefined) {
        const { guildId } = parseRoomId(scope.roomId);
        if (guildId !== undefined) {
          const guild = await client.guilds.fetch(guildId).catch(() => null);
          if (guild === null) return [];
          const members = await guild.members.fetch();
          return [...members.values()].map((m): ChannelUser => ({
            userId: m.user.id,
            displayName: m.displayName,
            username: m.user.username,
            avatarUrl: m.user.displayAvatarURL(),
          }));
        }
      }
      return [];
    },
  };
}

// ---------------------------------------------------------------------------
// The factory + definition
// ---------------------------------------------------------------------------

/**
 * Build a v2 ChannelDefinition for Discord. NOT yet wired into the live
 * registration; see file header for migration plan.
 *
 * SettingsPage + ProjectPagePanel are left as stub components in this
 * slice — the dashboard already renders Discord-specific UI through the
 * legacy registration. Slice 2/3 of s163 will lift those into proper
 * React components owned by this package.
 */
const StubSettingsPage = () => null;

export function createDiscordChannelDefV2(config: DiscordConfig): ChannelDefinition {
  return defineChannelV2({
    id: DISCORD_CHANNEL_ID,
    displayName: "Discord",
    icon: undefined,
    createProtocol: (ctx) => buildProtocol(config, ctx),
    SettingsPage: StubSettingsPage as unknown as ChannelDefinition["SettingsPage"],
    bridgeTools: [], // populated at activation time when the live Client exists
    readPolicy: {
      canReadAllMessages: { configurable: true, defaultOn: false },
      canReadPresence: { configurable: true, defaultOn: false },
      canReadRoles: { configurable: true, defaultOn: true },
      nativeIntents: ["Guilds", "GuildMessages", "MessageContent", "GuildMembers", "GuildPresences"],
    },
  });
}

/**
 * Variant that includes bridge tools wired against a live Client. Called
 * from the activate() path in slice 2 once we have both a Client and a
 * ChannelContext in hand.
 */
export function createDiscordChannelDefV2WithTools(
  config: DiscordConfig,
  client: Client,
): ChannelDefinition {
  return defineChannelV2({
    id: DISCORD_CHANNEL_ID,
    displayName: "Discord",
    icon: undefined,
    createProtocol: (ctx) => buildProtocol(config, ctx),
    SettingsPage: StubSettingsPage as unknown as ChannelDefinition["SettingsPage"],
    bridgeTools: adaptBridgeTools(client, config),
    readPolicy: {
      canReadAllMessages: { configurable: true, defaultOn: false },
      canReadPresence: { configurable: true, defaultOn: false },
      canReadRoles: { configurable: true, defaultOn: true },
      nativeIntents: ["Guilds", "GuildMessages", "MessageContent", "GuildMembers", "GuildPresences"],
    },
  });
}
