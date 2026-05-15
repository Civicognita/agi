/**
 * Slack channel definition built against the defineChannelV2 SDK (CHN-A s162).
 * Net-new — no legacy channel-sdk@0.1 plugin exists for Slack, so there is no
 * coexistence slice: this is registered directly as v2 only.
 *
 * Uses Bolt for JavaScript in Socket Mode, matching the same "no public
 * webhook required" pattern as Discord.js Gateway and Grammy long-polling.
 *
 * Room mapping (from channel-plugin-redesign.md §4):
 *   Channel        → kind:"channel"  roomId:"<teamId>:channel:<channelId>"
 *   DM             → kind:"dm"       roomId:"<teamId>:dm:<userId>"
 *   Group DM       → kind:"group"    roomId:"<teamId>:mpdm:<convId>"
 *
 * Reference: agi/docs/agents/channel-plugin-redesign.md §4 + §11 (CHN-K).
 */

import { App, LogLevel } from "@slack/bolt";
import {
  defineChannelV2,
  type ChannelDefinition,
  type ChannelProtocol,
  type ChannelContext,
  type ChannelEvent,
  type ChannelMessage,
  type ChannelMessageAttachment,
  type ChannelRoom,
  type ChannelUser,
} from "@agi/sdk";

import type { SlackConfig } from "./config.js";

export const SLACK_CHANNEL_ID = "slack";

// ---------------------------------------------------------------------------
// Helpers — roomId encoding / decoding
// ---------------------------------------------------------------------------

export type SlackConvType = "channel" | "dm" | "mpdm";

export function encodeRoomId(teamId: string, convType: SlackConvType, convId: string): string {
  return `${teamId}:${convType}:${convId}`;
}

export function decodeRoomId(
  roomId: string,
): { teamId: string; convType: SlackConvType; convId: string } | null {
  const first = roomId.indexOf(":");
  if (first === -1) return null;
  const second = roomId.indexOf(":", first + 1);
  if (second === -1) return null;

  const teamId = roomId.slice(0, first);
  const convType = roomId.slice(first + 1, second) as SlackConvType;
  const convId = roomId.slice(second + 1);

  if (!teamId || !convId) return null;
  if (convType !== "channel" && convType !== "dm" && convType !== "mpdm") return null;
  return { teamId, convType, convId };
}

// ---------------------------------------------------------------------------
// Slack event shape — subset of fields used for normalization
// ---------------------------------------------------------------------------

export interface SlackMessageEvent {
  type: "message";
  subtype?: string;
  ts: string;
  user?: string;
  text?: string;
  channel: string;
  channel_type?: "channel" | "im" | "group" | "mpim";
  team?: string;
  files?: Array<{
    url_private?: string;
    mimetype?: string;
    filetype?: string;
    name?: string;
  }>;
  edited?: { user: string; ts: string };
}

export interface SlackConversation {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_private?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  user?: string;
  topic?: { value: string };
  purpose?: { value: string };
  num_members?: number;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function classifyAttachment(mimetype: string | undefined): ChannelMessageAttachment["kind"] {
  if (!mimetype) return "file";
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "file";
}

/**
 * Derive the room kind from a Slack channel_type field. Slack sends
 * `channel_type` in message events: "channel" | "im" | "group" | "mpim".
 * "group" and "mpim" both map to "group" in our schema (group conversation).
 */
function channelTypeToConvType(channelType: string | undefined): SlackConvType {
  if (channelType === "im") return "dm";
  if (channelType === "mpim" || channelType === "group") return "mpdm";
  return "channel";
}

/**
 * Convert a raw Slack message event to a {@link ChannelMessage}.
 * Returns null for bot messages, edited-message subtypes, or events
 * with no user ID (system messages, webhooks).
 *
 * @param event  - Raw Slack message event.
 * @param teamId - Workspace team ID, obtained from auth.test().
 * @param botUserId - Bot's own user ID; used to detect @-mention.
 */
export function msgToChannelMessage(
  event: SlackMessageEvent,
  teamId: string,
  botUserId: string,
): ChannelMessage | null {
  // Skip subtypes: bot_message, message_changed, message_deleted, etc.
  if (event.subtype !== undefined) return null;
  if (!event.user) return null;

  const convType = channelTypeToConvType(event.channel_type);
  const roomId = encodeRoomId(teamId, convType, event.channel);
  const text = event.text ?? "";

  const attachments: ChannelMessageAttachment[] = (event.files ?? []).map((f) => ({
    kind: classifyAttachment(f.mimetype),
    url: f.url_private ?? "",
    mime: f.mimetype,
  }));

  // DMs always mention the bot implicitly; for channels/groups we look for <@botUserId>
  const mentionsBot = convType === "dm" || text.includes(`<@${botUserId}>`);

  return {
    messageId: event.ts,
    roomId,
    authorId: event.user,
    text,
    ...(attachments.length > 0 ? { attachments } : {}),
    sentAt: new Date(Number(event.ts) * 1000).toISOString(),
    mentionsBot,
  };
}

/**
 * Convert a Slack conversations.list entry to a {@link ChannelRoom}.
 */
export function convToChannelRoom(conv: SlackConversation, teamId: string): ChannelRoom {
  let convType: SlackConvType = "channel";
  if (conv.is_im) convType = "dm";
  else if (conv.is_mpim) convType = "mpdm";

  const kind: ChannelRoom["kind"] = convType === "dm" ? "dm" : convType === "mpdm" ? "group" : "channel";
  const privacy: ChannelRoom["privacy"] = conv.is_private ? "private" : "public";

  const label = conv.is_im
    ? (conv.user ?? conv.id)  // DM label = the other user's ID (resolved to display name by dispatcher)
    : (conv.name ?? conv.id);

  return {
    roomId: encodeRoomId(teamId, convType, conv.id),
    label,
    kind,
    privacy,
  };
}

// ---------------------------------------------------------------------------
// Protocol implementation
// ---------------------------------------------------------------------------

function buildProtocol(config: SlackConfig, _ctx: ChannelContext): ChannelProtocol {
  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  const eventHandlers: Array<(e: ChannelEvent) => void> = [];
  let teamId = "";
  let botUserId = "";

  // Fan every incoming Slack message event out to registered handlers.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  app.event("message", async ({ event }) => {
    const slackMsg = event as unknown as SlackMessageEvent;
    const msg = msgToChannelMessage(slackMsg, teamId, botUserId);
    if (msg === null) return;
    const channelEvent: ChannelEvent = { kind: "message", message: msg };
    for (const h of eventHandlers) h(channelEvent);
  });

  return {
    start: async () => {
      await app.start();
      // Resolve team ID + bot user ID from the workspace after login.
      const auth = await app.client.auth.test({ token: config.botToken });
      teamId = (auth.team_id as string | undefined) ?? "";
      botUserId = (auth.user_id as string | undefined) ?? "";
      return {
        stop: async () => {
          await app.stop();
        },
      };
    },

    onEvent: (handler) => {
      eventHandlers.push(handler);
      return () => {
        const i = eventHandlers.indexOf(handler);
        if (i >= 0) eventHandlers.splice(i, 1);
      };
    },

    listRooms: async () => {
      const result = await app.client.conversations.list({
        token: config.botToken,
        types: "public_channel,private_channel,im,mpim",
        exclude_archived: true,
        limit: 200,
      });
      const convs = (result.channels as SlackConversation[] | undefined) ?? [];
      return convs.map((c) => convToChannelRoom(c, teamId));
    },

    getRoom: async (roomId) => {
      const decoded = decodeRoomId(roomId);
      if (decoded === null) return null;
      const result = await app.client.conversations.info({
        token: config.botToken,
        channel: decoded.convId,
      }).catch(() => null);
      if (result === null || !result.channel) return null;
      return convToChannelRoom(result.channel as SlackConversation, decoded.teamId);
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
      const decoded = decodeRoomId(roomId);
      if (decoded === null) throw new Error(`Slack postToRoom: invalid roomId ${roomId}`);
      const result = await app.client.chat.postMessage({
        token: config.botToken,
        channel: decoded.convId,
        text: message.text,
      });
      const ts = (result.ts as string | undefined) ?? String(Date.now() / 1000);
      return {
        messageId: ts,
        roomId,
        authorId: botUserId,
        text: message.text,
        sentAt: new Date(Number(ts) * 1000).toISOString(),
        mentionsBot: false,
      };
    },

    searchMessages: async (roomId, opts) => {
      const decoded = decodeRoomId(roomId);
      if (decoded === null) return { messages: [] };
      const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
      const result = await app.client.conversations.history({
        token: config.botToken,
        channel: decoded.convId,
        limit,
        ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
        ...(opts.fromTs !== undefined ? { oldest: String(new Date(opts.fromTs).getTime() / 1000) } : {}),
      }).catch(() => null);
      if (result === null) return { messages: [] };
      const messages: ChannelMessage[] = [];
      for (const msg of (result.messages ?? []) as SlackMessageEvent[]) {
        const cm = msgToChannelMessage(msg, decoded.teamId, botUserId);
        if (cm !== null) messages.push(cm);
      }
      const nextCursor = result.has_more
        ? (result.response_metadata as { next_cursor?: string } | undefined)?.next_cursor
        : undefined;
      return { messages, nextCursor: nextCursor ?? undefined };
    },

    getUser: async (userId) => {
      const result = await app.client.users.info({
        token: config.botToken,
        user: userId,
      }).catch(() => null);
      if (result === null || !result.user) return null;
      const user = result.user as {
        id: string;
        profile?: { display_name?: string; real_name?: string; image_72?: string };
        name?: string;
      };
      const displayName =
        user.profile?.display_name || user.profile?.real_name || user.name || userId;
      return {
        userId: user.id,
        displayName,
        username: user.name ?? userId,
        avatarUrl: user.profile?.image_72,
      } satisfies ChannelUser;
    },

    listMembers: async (scope) => {
      if (scope.roomId === undefined) return [];
      const decoded = decodeRoomId(scope.roomId);
      if (decoded === null) return [];
      const result = await app.client.conversations.members({
        token: config.botToken,
        channel: decoded.convId,
        limit: 200,
      }).catch(() => null);
      if (result === null) return [];
      const memberIds = (result.members as string[] | undefined) ?? [];
      const users: ChannelUser[] = [];
      for (const uid of memberIds) {
        const info = await app.client.users.info({
          token: config.botToken,
          user: uid,
        }).catch(() => null);
        if (info?.user) {
          const u = info.user as {
            id: string;
            profile?: { display_name?: string; real_name?: string; image_72?: string };
            name?: string;
          };
          users.push({
            userId: u.id,
            displayName: u.profile?.display_name || u.profile?.real_name || u.name || uid,
            username: u.name ?? uid,
            avatarUrl: u.profile?.image_72,
          });
        }
      }
      return users;
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const StubSettingsPage = () => null;

/**
 * Build a v2 ChannelDefinition for Slack.
 *
 * Net-new: no legacy v1 path. Registered only via api.registerChannelV2()
 * in activate(). The gateway dispatcher activates it in slice 3 (CHN-D).
 */
export function createSlackChannelDefV2(config: SlackConfig): ChannelDefinition {
  return defineChannelV2({
    id: SLACK_CHANNEL_ID,
    displayName: "Slack",
    icon: undefined,
    createProtocol: (ctx) => buildProtocol(config, ctx),
    SettingsPage: StubSettingsPage as unknown as ChannelDefinition["SettingsPage"],
    bridgeTools: [],
    readPolicy: {
      canReadAllMessages: { configurable: true, defaultOn: false },
      canReadPresence: { configurable: false, defaultOn: false },
      canReadRoles: { configurable: false, defaultOn: false },
      nativeIntents: [
        "channels:read",
        "channels:history",
        "chat:write",
        "users:read",
        "im:read",
        "im:history",
        "groups:read",
        "groups:history",
        "mpim:read",
        "mpim:history",
      ],
    },
    roomDiscovery: { model: "enumerable" },
  });
}
