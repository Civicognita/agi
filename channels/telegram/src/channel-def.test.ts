/**
 * Unit tests for the Telegram v2 channel definition (CHN-I s170 t732).
 *
 * Verifies: roomId encoding/decoding, msgToChannelMessage null-returns
 * for unsupported types, chatToChannelRoom kind + privacy mapping, and
 * that createTelegramChannelDefV2 compiles + passes defineChannelV2 validation.
 */

import { describe, it, expect } from "vitest";
import type { Message, Chat } from "grammy/types";
import {
  encodeRoomId,
  decodeChatId,
  msgToChannelMessage,
  chatToChannelRoom,
  createTelegramChannelDefV2,
} from "./channel-def.js";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

function msg(partial: Record<string, unknown>): Message {
  return partial as unknown as Message;
}

function chat(partial: Record<string, unknown>): Chat {
  return partial as unknown as Chat;
}

// ---------------------------------------------------------------------------
// 1. roomId encoding / decoding
// ---------------------------------------------------------------------------

describe("encodeRoomId", () => {
  it('encodes private chat as "dm:<chatId>"', () => {
    expect(encodeRoomId(123, "private")).toBe("dm:123");
  });

  it('encodes group chat as "group:<chatId>"', () => {
    expect(encodeRoomId(456, "group")).toBe("group:456");
  });

  it('encodes supergroup as "group:<chatId>"', () => {
    expect(encodeRoomId(789, "supergroup")).toBe("group:789");
  });

  it('encodes channel as "channel:<chatId>"', () => {
    expect(encodeRoomId(101, "channel")).toBe("channel:101");
  });

  it("handles negative chat IDs (groups/channels are negative in Telegram)", () => {
    expect(encodeRoomId(-1001234567890, "supergroup")).toBe(
      "group:-1001234567890",
    );
  });
});

describe("decodeChatId", () => {
  it("decodes a dm: roomId to the numeric chatId", () => {
    expect(decodeChatId("dm:123")).toBe(123);
  });

  it("decodes a group: roomId to the numeric chatId", () => {
    expect(decodeChatId("group:-100456")).toBe(-100456);
  });

  it("decodes a channel: roomId to the numeric chatId", () => {
    expect(decodeChatId("channel:789")).toBe(789);
  });

  it("falls back to treating the whole string as a number when no prefix", () => {
    expect(decodeChatId("999")).toBe(999);
  });

  it("encodeRoomId → decodeChatId round-trips correctly", () => {
    const chatId = -1001234567890;
    const roomId = encodeRoomId(chatId, "supergroup");
    expect(decodeChatId(roomId)).toBe(chatId);
  });
});

// ---------------------------------------------------------------------------
// 2. msgToChannelMessage
// ---------------------------------------------------------------------------

describe("msgToChannelMessage", () => {
  it("converts a text message", () => {
    const result = msgToChannelMessage(
      msg({
        message_id: 1,
        date: 1700000000,
        chat: { id: 123, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Alice" },
        text: "hello v2",
      }),
    );

    expect(result).not.toBeNull();
    expect(result!.messageId).toBe("1");
    expect(result!.roomId).toBe("dm:123");
    expect(result!.authorId).toBe("456");
    expect(result!.text).toBe("hello v2");
    expect(result!.sentAt).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it("sets mentionsBot=true for private chats regardless of entities", () => {
    const result = msgToChannelMessage(
      msg({
        message_id: 2,
        date: 1700000001,
        chat: { id: 99, type: "private" },
        from: { id: 1, is_bot: false, first_name: "Bob" },
        text: "hi",
      }),
    );
    expect(result!.mentionsBot).toBe(true);
  });

  it("sets mentionsBot=false for group chats with no @mention entity", () => {
    const result = msgToChannelMessage(
      msg({
        message_id: 3,
        date: 1700000002,
        chat: { id: -100123, type: "group" },
        from: { id: 2, is_bot: false, first_name: "Carol" },
        text: "group message no mention",
      }),
    );
    expect(result!.mentionsBot).toBe(false);
  });

  it("sets mentionsBot=true for group chats with a mention entity", () => {
    const result = msgToChannelMessage(
      msg({
        message_id: 4,
        date: 1700000003,
        chat: { id: -100123, type: "group" },
        from: { id: 3, is_bot: false, first_name: "Dave" },
        text: "@mybot hello",
        entities: [{ type: "mention", offset: 0, length: 7 }],
      }),
    );
    expect(result!.mentionsBot).toBe(true);
  });

  it("populates replyToMessageId from reply_to_message", () => {
    const result = msgToChannelMessage(
      msg({
        message_id: 5,
        date: 1700000004,
        chat: { id: 123, type: "private" },
        from: { id: 1, is_bot: false, first_name: "Alice" },
        text: "reply",
        reply_to_message: { message_id: 3 },
      }),
    );
    expect(result!.replyToMessageId).toBe("3");
  });

  it("populates threadRootMessageId from message_thread_id", () => {
    const result = msgToChannelMessage(
      msg({
        message_id: 6,
        date: 1700000005,
        chat: { id: -100456, type: "supergroup" },
        from: { id: 1, is_bot: false, first_name: "Alice" },
        text: "thread reply",
        message_thread_id: 42,
      }),
    );
    expect(result!.threadRootMessageId).toBe("42");
  });

  it("returns null for a sticker-only message", () => {
    const result = msgToChannelMessage(
      msg({
        message_id: 7,
        date: 1700000006,
        chat: { id: 123, type: "private" },
        from: { id: 1, is_bot: false, first_name: "Alice" },
        sticker: {
          file_id: "stk1",
          file_unique_id: "s1",
          width: 512,
          height: 512,
          is_animated: false,
          is_video: false,
          type: "regular",
        },
      }),
    );
    expect(result).toBeNull();
  });

  it("returns non-null for a voice message (renders as [voice message])", () => {
    const result = msgToChannelMessage(
      msg({
        message_id: 8,
        date: 1700000007,
        chat: { id: 123, type: "private" },
        from: { id: 1, is_bot: false, first_name: "Alice" },
        voice: { file_id: "v1", duration: 5, file_unique_id: "vu1", mime_type: "audio/ogg" },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.text).toBe("[voice message]");
  });

  it("falls back authorId to chat.id when from is absent (channel posts)", () => {
    const result = msgToChannelMessage(
      msg({
        message_id: 9,
        date: 1700000008,
        chat: { id: -100789, type: "channel" },
        text: "channel post",
      }),
    );
    expect(result!.authorId).toBe("-100789");
  });
});

// ---------------------------------------------------------------------------
// 3. chatToChannelRoom
// ---------------------------------------------------------------------------

describe("chatToChannelRoom", () => {
  it('maps private chat to kind="dm", privacy="private"', () => {
    const room = chatToChannelRoom(
      chat({ id: 123, type: "private", first_name: "Alice" }),
    );
    expect(room.kind).toBe("dm");
    expect(room.privacy).toBe("private");
    expect(room.roomId).toBe("dm:123");
    expect(room.label).toBe("Alice");
  });

  it('maps group to kind="group", privacy="public"', () => {
    const room = chatToChannelRoom(
      chat({ id: -100123, type: "group", title: "Dev Team" }),
    );
    expect(room.kind).toBe("group");
    expect(room.privacy).toBe("public");
    expect(room.label).toBe("Dev Team");
  });

  it('maps supergroup to kind="group"', () => {
    const room = chatToChannelRoom(
      chat({ id: -1001234, type: "supergroup", title: "Big Group" }),
    );
    expect(room.kind).toBe("group");
    expect(room.roomId).toBe("group:-1001234");
  });

  it('maps channel to kind="channel"', () => {
    const room = chatToChannelRoom(
      chat({ id: -1009999, type: "channel", title: "News Channel" }),
    );
    expect(room.kind).toBe("channel");
    expect(room.privacy).toBe("public");
  });

  it('falls back label to "tg:<id>" when title and first_name are absent', () => {
    const room = chatToChannelRoom(chat({ id: 42, type: "group" }));
    expect(room.label).toBe("tg:42");
  });
});

// ---------------------------------------------------------------------------
// 4. createTelegramChannelDefV2 — shape + defineChannelV2 validation
// ---------------------------------------------------------------------------

describe("createTelegramChannelDefV2", () => {
  it('produces a ChannelDefinition with id "telegram"', () => {
    const def = createTelegramChannelDefV2({ botToken: "test:fake-token" });
    expect(def.id).toBe("telegram");
  });

  it('has displayName "Telegram"', () => {
    const def = createTelegramChannelDefV2({ botToken: "test:fake-token" });
    expect(def.displayName).toBe("Telegram");
  });

  it("has a readPolicy with canReadAllMessages configurable=true", () => {
    const def = createTelegramChannelDefV2({ botToken: "test:fake-token" });
    expect(def.readPolicy.canReadAllMessages.configurable).toBe(true);
    expect(def.readPolicy.canReadAllMessages.defaultOn).toBe(false);
  });

  it("has canReadPresence and canReadRoles both non-configurable", () => {
    const def = createTelegramChannelDefV2({ botToken: "test:fake-token" });
    expect(def.readPolicy.canReadPresence.configurable).toBe(false);
    expect(def.readPolicy.canReadRoles.configurable).toBe(false);
  });

  it("createProtocol returns an object with all required ChannelProtocol methods", () => {
    const def = createTelegramChannelDefV2({ botToken: "test:fake-token" });
    const stubCtx = {
      config: {},
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      cageProvider: () => null,
      resolveEntity: async () => ({ entityId: "test", isPending: false }),
    };
    const protocol = def.createProtocol(stubCtx);
    expect(typeof protocol.start).toBe("function");
    expect(typeof protocol.onEvent).toBe("function");
    expect(typeof protocol.listRooms).toBe("function");
    expect(typeof protocol.getRoom).toBe("function");
    expect(typeof protocol.subscribeRoom).toBe("function");
    expect(typeof protocol.postToRoom).toBe("function");
    expect(typeof protocol.searchMessages).toBe("function");
    expect(typeof protocol.getUser).toBe("function");
    expect(typeof protocol.listMembers).toBe("function");
  });

  it("listRooms returns empty array before any messages arrive", async () => {
    const def = createTelegramChannelDefV2({ botToken: "test:fake-token" });
    const stubCtx = {
      config: {},
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      cageProvider: () => null,
      resolveEntity: async () => ({ entityId: "test", isPending: false }),
    };
    const protocol = def.createProtocol(stubCtx);
    const rooms = await protocol.listRooms();
    expect(rooms).toEqual([]);
  });

  it("searchMessages always returns empty (Telegram bot API has no search)", async () => {
    const def = createTelegramChannelDefV2({ botToken: "test:fake-token" });
    const stubCtx = {
      config: {},
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      cageProvider: () => null,
      resolveEntity: async () => ({ entityId: "test", isPending: false }),
    };
    const protocol = def.createProtocol(stubCtx);
    const result = await protocol.searchMessages("dm:123", { limit: 10 });
    expect(result.messages).toEqual([]);
    expect(result.nextCursor).toBeUndefined();
  });

  it("listMembers always returns empty (Telegram bot API cannot enumerate)", async () => {
    const def = createTelegramChannelDefV2({ botToken: "test:fake-token" });
    const stubCtx = {
      config: {},
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      cageProvider: () => null,
      resolveEntity: async () => ({ entityId: "test", isPending: false }),
    };
    const protocol = def.createProtocol(stubCtx);
    expect(await protocol.listMembers({})).toEqual([]);
  });

  it("onEvent registers and unregisters a handler without throwing", () => {
    const def = createTelegramChannelDefV2({ botToken: "test:fake-token" });
    const stubCtx = {
      config: {},
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      cageProvider: () => null,
      resolveEntity: async () => ({ entityId: "test", isPending: false }),
    };
    const protocol = def.createProtocol(stubCtx);
    const unsubscribe = protocol.onEvent(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
