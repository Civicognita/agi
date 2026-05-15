/**
 * Telegram channel definition built against the defineChannelV2 SDK
 * (CHN-A s162). This is the s170 CHN-I migration target.
 *
 * **Status — 2026-05-15 slice 1:** the definition compiles + typechecks
 * against `ChannelDefinition` but is NOT yet wired into `index.ts`'s
 * `activate()`. The legacy `createTelegramPlugin` registration remains
 * the live path. Slice 2 (t731) wires both in parallel.
 *
 * Mapping summary — every ChannelProtocol method ↔ Grammy/bot-api:
 *
 *   | Protocol method        | Implementation                               |
 *   |------------------------|----------------------------------------------|
 *   | start()                | bot.start() (long-polling, fire-and-forget)  |
 *   | onEvent(handler)       | bot.on("message", ...) + command handlers    |
 *   | listRooms()            | seenRooms registry (populated on inbound msg)|
 *   | getRoom(roomId)        | seenRooms cache → bot.api.getChat fallback   |
 *   | subscribeRoom(...)     | onEvent + roomId filter                      |
 *   | postToRoom(...)        | sendOutbound() via bot.api                   |
 *   | searchMessages(...)    | unsupported — Telegram bot API has no search |
 *   | getUser(userId)        | bot.api.getChat(userId) best-effort          |
 *   | listMembers(scope)     | unsupported — Telegram can't enumerate all   |
 *
 * Room ID encoding:
 *   `dm:${chatId}`       for private (1-on-1) chats
 *   `group:${chatId}`    for group / supergroup chats
 *   `channel:${chatId}`  for Telegram broadcast channels
 *
 * Reference: agi/docs/agents/channel-plugin-redesign.md §4 + §11 (CHN-I).
 */

import { Bot } from "grammy";
import type { Chat, Message } from "grammy/types";
import {
  defineChannelV2,
  type ChannelDefinition,
  type ChannelProtocol,
  type ChannelContext,
  type ChannelEvent,
  type ChannelMessage,
  type ChannelRoom,
  type ChannelUser,
} from "@agi/sdk";

import type { TelegramConfig } from "./config.js";
import { TELEGRAM_CHANNEL_ID } from "./normalizer.js";
import { sendOutbound } from "./outbound.js";

// ---------------------------------------------------------------------------
// Room ID encoding / decoding
// ---------------------------------------------------------------------------

type TelegramChatType = Chat["type"];

function chatTypeToRoomKind(chatType: TelegramChatType): ChannelRoom["kind"] {
  switch (chatType) {
    case "private": return "dm";
    case "group":
    case "supergroup": return "group";
    case "channel": return "channel";
    default: return "group";
  }
}

function chatTypeToPrivacy(chatType: TelegramChatType): ChannelRoom["privacy"] {
  return chatType === "private" ? "private" : "public";
}

export function encodeRoomId(chatId: number, chatType: TelegramChatType): string {
  return `${chatTypeToRoomKind(chatType)}:${chatId}`;
}

export function decodeChatId(roomId: string): number {
  const colon = roomId.indexOf(":");
  return colon === -1 ? Number(roomId) : Number(roomId.slice(colon + 1));
}

// ---------------------------------------------------------------------------
// Message + room normalizers
// ---------------------------------------------------------------------------

export function msgToChannelMessage(msg: Message): ChannelMessage | null {
  const text =
    msg.text ??
    msg.caption ??
    (msg.voice !== undefined ? "[voice message]" : null) ??
    null;

  // Skip stickers, locations, polls, etc.
  if (
    text === null &&
    msg.document === undefined &&
    msg.photo === undefined
  ) {
    return null;
  }

  return {
    messageId: String(msg.message_id),
    roomId: encodeRoomId(msg.chat.id, msg.chat.type),
    authorId: String(msg.from?.id ?? msg.chat.id),
    text: text ?? "",
    sentAt: new Date(msg.date * 1000).toISOString(),
    replyToMessageId: msg.reply_to_message
      ? String(msg.reply_to_message.message_id)
      : undefined,
    threadRootMessageId: msg.message_thread_id
      ? String(msg.message_thread_id)
      : undefined,
    mentionsBot:
      // Private chats are always directed at the bot; groups need explicit @mention
      msg.chat.type === "private" ||
      (msg.entities?.some((e) => e.type === "mention") ?? false),
  };
}

export function chatToChannelRoom(
  chat: Pick<Chat, "id" | "type"> & { title?: string; first_name?: string; username?: string },
): ChannelRoom {
  const label =
    "title" in chat && typeof chat.title === "string"
      ? chat.title
      : "first_name" in chat && typeof chat.first_name === "string"
      ? chat.first_name
      : `tg:${chat.id}`;

  return {
    roomId: encodeRoomId(chat.id, chat.type),
    label,
    kind: chatTypeToRoomKind(chat.type),
    privacy: chatTypeToPrivacy(chat.type),
  };
}

// ---------------------------------------------------------------------------
// Protocol implementation
// ---------------------------------------------------------------------------

function buildProtocol(config: TelegramConfig, _ctx: ChannelContext): ChannelProtocol {
  const bot = new Bot(config.botToken);
  const eventHandlers: Array<(e: ChannelEvent) => void> = [];
  // Populated as messages arrive — the only way to discover Telegram rooms.
  const seenRooms = new Map<string, ChannelRoom>();

  function dispatchMessage(msg: Message): void {
    const room = chatToChannelRoom(msg.chat);
    seenRooms.set(room.roomId, room);

    const channelMsg = msgToChannelMessage(msg);
    if (channelMsg === null) return;
    const event: ChannelEvent = { kind: "message", message: channelMsg };
    for (const h of eventHandlers) h(event);
  }

  // Grammy handlers — wired once, fire throughout the session.
  bot.on("message", (ctx) => { dispatchMessage(ctx.message); });
  bot.command("start", (ctx) => {
    if (ctx.message !== undefined) dispatchMessage(ctx.message);
  });

  return {
    start: async () => {
      void bot.start({
        drop_pending_updates: true,
        timeout: config.pollingTimeout ?? 30,
      });
      return {
        stop: async () => { await bot.stop(); },
      };
    },

    onEvent: (handler) => {
      eventHandlers.push(handler);
      return () => {
        const i = eventHandlers.indexOf(handler);
        if (i >= 0) eventHandlers.splice(i, 1);
      };
    },

    listRooms: async () => [...seenRooms.values()],

    getRoom: async (roomId) => {
      if (seenRooms.has(roomId)) return seenRooms.get(roomId)!;
      const chatId = decodeChatId(roomId);
      try {
        const chat = await bot.api.getChat(chatId);
        const room = chatToChannelRoom(chat);
        seenRooms.set(roomId, room);
        return room;
      } catch {
        return null;
      }
    },

    subscribeRoom: (roomId, handler) => {
      const filtered = (event: ChannelEvent) => {
        if (
          (event.kind === "message" || event.kind === "message-edit") &&
          event.message.roomId !== roomId
        ) return;
        handler(event);
      };
      eventHandlers.push(filtered);
      return () => {
        const i = eventHandlers.indexOf(filtered);
        if (i >= 0) eventHandlers.splice(i, 1);
      };
    },

    postToRoom: async (roomId, message) => {
      const chatId = decodeChatId(roomId);
      await sendOutbound(bot.api, chatId, { type: "text", text: message.text });
      return {
        messageId: `pending-${Date.now().toString()}`,
        roomId,
        authorId: "bot",
        text: message.text,
        sentAt: new Date().toISOString(),
        mentionsBot: false,
      };
    },

    // Telegram bot API has no message-search endpoint.
    searchMessages: async (_roomId, _opts) => ({ messages: [] }),

    getUser: async (userId) => {
      try {
        const chat = await bot.api.getChat(Number(userId));
        if (chat.type !== "private") return null;
        const pc = chat as Chat.PrivateChat;
        const displayName = pc.last_name
          ? `${pc.first_name} ${pc.last_name}`
          : pc.first_name;
        return {
          userId,
          displayName,
          username: pc.username,
          avatarUrl: undefined,
        } satisfies ChannelUser;
      } catch {
        return null;
      }
    },

    // Telegram bot API cannot enumerate channel members.
    listMembers: async (_scope) => [],
  };
}

// ---------------------------------------------------------------------------
// Factory + definition
// ---------------------------------------------------------------------------

const StubSettingsPage = () => null;

/**
 * Build a v2 ChannelDefinition for Telegram. NOT yet wired into the live
 * registration — see file header. Slice 2 (t731) wires this alongside the
 * legacy `createTelegramPlugin()` in activate().
 */
export function createTelegramChannelDefV2(config: TelegramConfig): ChannelDefinition {
  return defineChannelV2({
    id: TELEGRAM_CHANNEL_ID,
    displayName: "Telegram",
    icon: undefined,
    createProtocol: (ctx) => buildProtocol(config, ctx),
    SettingsPage: StubSettingsPage as unknown as ChannelDefinition["SettingsPage"],
    bridgeTools: [],
    readPolicy: {
      canReadAllMessages: { configurable: true, defaultOn: false },
      canReadPresence: { configurable: false, defaultOn: false },
      canReadRoles: { configurable: false, defaultOn: false },
      nativeIntents: [],
    },
    roomDiscovery: { model: "seen-rooms", dynamicRooms: true },
  });
}
