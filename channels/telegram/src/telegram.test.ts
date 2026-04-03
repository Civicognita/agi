import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Message } from "grammy/types";

import { isTelegramConfig, createConfigAdapter } from "./config.js";
import {
  TELEGRAM_CHANNEL_ID,
  normalizeMessage,
  buildDisplayName,
} from "./normalizer.js";
import { splitText } from "./outbound.js";
import { createSecurityAdapter } from "./security.js";
import { createTelegramPlugin } from "./index.js";
import { validateAdapter } from "@aionima/channel-sdk";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cast a partial object as a Telegram Message for test fixtures. */
function msg(partial: Record<string, unknown>): Message {
  return partial as unknown as Message;
}

// ---------------------------------------------------------------------------
// 1. config.ts
// ---------------------------------------------------------------------------

describe("isTelegramConfig", () => {
  it("accepts a minimal valid config with only botToken", () => {
    expect(isTelegramConfig({ botToken: "123:abc" })).toBe(true);
  });

  it("accepts a fully-specified valid config", () => {
    expect(
      isTelegramConfig({
        botToken: "123:abc",
        allowedChatIds: [1, 2, 3],
        pollingTimeout: 60,
        rateLimitPerMinute: 10,
      })
    ).toBe(true);
  });

  it("accepts an empty allowedChatIds array", () => {
    expect(isTelegramConfig({ botToken: "tok", allowedChatIds: [] })).toBe(
      true
    );
  });

  it("rejects null", () => {
    expect(isTelegramConfig(null)).toBe(false);
  });

  it("rejects a non-object primitive", () => {
    expect(isTelegramConfig("string")).toBe(false);
    expect(isTelegramConfig(42)).toBe(false);
  });

  it("rejects missing botToken", () => {
    expect(isTelegramConfig({})).toBe(false);
  });

  it("rejects an empty botToken string", () => {
    expect(isTelegramConfig({ botToken: "" })).toBe(false);
  });

  it("rejects a numeric botToken", () => {
    expect(isTelegramConfig({ botToken: 123 })).toBe(false);
  });

  it("rejects allowedChatIds that is not an array", () => {
    expect(
      isTelegramConfig({ botToken: "tok", allowedChatIds: "all" })
    ).toBe(false);
  });

  it("rejects allowedChatIds containing non-numbers", () => {
    expect(
      isTelegramConfig({ botToken: "tok", allowedChatIds: ["123"] })
    ).toBe(false);
  });

  it("rejects pollingTimeout of zero", () => {
    expect(
      isTelegramConfig({ botToken: "tok", pollingTimeout: 0 })
    ).toBe(false);
  });

  it("rejects negative pollingTimeout", () => {
    expect(
      isTelegramConfig({ botToken: "tok", pollingTimeout: -5 })
    ).toBe(false);
  });

  it("rejects non-numeric pollingTimeout", () => {
    expect(
      isTelegramConfig({ botToken: "tok", pollingTimeout: "30" })
    ).toBe(false);
  });

  it("rejects non-numeric rateLimitPerMinute", () => {
    expect(
      isTelegramConfig({ botToken: "tok", rateLimitPerMinute: "30" })
    ).toBe(false);
  });

  it("rejects zero rateLimitPerMinute", () => {
    expect(
      isTelegramConfig({ botToken: "tok", rateLimitPerMinute: 0 })
    ).toBe(false);
  });
});

describe("createConfigAdapter", () => {
  const adapter = createConfigAdapter();

  it("validate returns true for a valid config", () => {
    expect(adapter.validate({ botToken: "tok" })).toBe(true);
  });

  it("validate returns false for an invalid config", () => {
    expect(adapter.validate({ botToken: "" })).toBe(false);
    expect(adapter.validate(null)).toBe(false);
  });

  it("getDefaults returns pollingTimeout: 30", () => {
    expect(adapter.getDefaults()).toMatchObject({ pollingTimeout: 30 });
  });

  it("getDefaults returns rateLimitPerMinute: 30", () => {
    expect(adapter.getDefaults()).toMatchObject({ rateLimitPerMinute: 30 });
  });
});

// ---------------------------------------------------------------------------
// 2. normalizer.ts
// ---------------------------------------------------------------------------

describe("TELEGRAM_CHANNEL_ID", () => {
  it('is the string "telegram"', () => {
    expect(TELEGRAM_CHANNEL_ID).toBe("telegram");
  });
});

describe("normalizeMessage", () => {
  it("normalizes a text message to type:text", () => {
    const result = normalizeMessage(
      msg({
        message_id: 1,
        date: 1700000000,
        chat: { id: 123, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Alice" },
        text: "hello",
      })
    );

    expect(result).not.toBeNull();
    expect(result!.content.type).toBe("text");
    if (result!.content.type === "text") {
      expect(result!.content.text).toBe("hello");
    }
  });

  it("sets correct top-level fields from a text message", () => {
    const result = normalizeMessage(
      msg({
        message_id: 7,
        date: 1700000000,
        chat: { id: 99, type: "group" },
        from: { id: 22, is_bot: false, first_name: "Bob" },
        text: "hi",
      })
    );

    expect(result!.id).toBe("7");
    expect(result!.channelId).toBe("telegram");
    expect(result!.channelUserId).toBe("22");
    expect(result!.timestamp).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it("normalizes a voice message to type:voice with file_id and duration", () => {
    const result = normalizeMessage(
      msg({
        message_id: 2,
        date: 1700000001,
        chat: { id: 123, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Alice" },
        voice: { file_id: "voice_abc", duration: 12 },
      })
    );

    expect(result).not.toBeNull();
    expect(result!.content.type).toBe("voice");
    if (result!.content.type === "voice") {
      expect(result!.content.url).toBe("voice_abc");
      expect(result!.content.duration).toBe(12);
    }
  });

  it("normalizes a document message to type:media with mime_type", () => {
    const result = normalizeMessage(
      msg({
        message_id: 3,
        date: 1700000002,
        chat: { id: 123, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Alice" },
        document: {
          file_id: "doc_xyz",
          mime_type: "application/pdf",
          file_unique_id: "u1",
        },
      })
    );

    expect(result).not.toBeNull();
    expect(result!.content.type).toBe("media");
    if (result!.content.type === "media") {
      expect(result!.content.url).toBe("doc_xyz");
      expect(result!.content.mimeType).toBe("application/pdf");
    }
  });

  it("falls back to application/octet-stream when document has no mime_type", () => {
    const result = normalizeMessage(
      msg({
        message_id: 4,
        date: 1700000003,
        chat: { id: 123, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Alice" },
        document: { file_id: "doc_xyz", file_unique_id: "u2" },
      })
    );

    expect(result!.content.type).toBe("media");
    if (result!.content.type === "media") {
      expect(result!.content.mimeType).toBe("application/octet-stream");
    }
  });

  it("normalizes a photo array to type:media picking the largest (last) size", () => {
    const result = normalizeMessage(
      msg({
        message_id: 5,
        date: 1700000004,
        chat: { id: 123, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Alice" },
        photo: [
          { file_id: "small", file_unique_id: "s", width: 90, height: 90 },
          { file_id: "medium", file_unique_id: "m", width: 320, height: 320 },
          { file_id: "large", file_unique_id: "l", width: 1280, height: 960 },
        ],
      })
    );

    expect(result).not.toBeNull();
    expect(result!.content.type).toBe("media");
    if (result!.content.type === "media") {
      expect(result!.content.url).toBe("large");
      expect(result!.content.mimeType).toBe("image/jpeg");
    }
  });

  it("returns null for an unsupported message type (sticker only)", () => {
    const result = normalizeMessage(
      msg({
        message_id: 6,
        date: 1700000005,
        chat: { id: 123, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Alice" },
        sticker: { file_id: "stk1", file_unique_id: "s1", width: 512, height: 512, is_animated: false, is_video: false, type: "regular" },
      })
    );

    expect(result).toBeNull();
  });

  it("populates replyTo when reply_to_message is present", () => {
    const result = normalizeMessage(
      msg({
        message_id: 10,
        date: 1700000010,
        chat: { id: 123, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Alice" },
        text: "replying",
        reply_to_message: { message_id: 5 },
      })
    );

    expect(result!.replyTo).toBe("5");
  });

  it("leaves replyTo undefined when no reply_to_message", () => {
    const result = normalizeMessage(
      msg({
        message_id: 11,
        date: 1700000011,
        chat: { id: 123, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Alice" },
        text: "standalone",
      })
    );

    expect(result!.replyTo).toBeUndefined();
  });

  it("populates threadId when message_thread_id is present", () => {
    const result = normalizeMessage(
      msg({
        message_id: 12,
        date: 1700000012,
        chat: { id: 123, type: "supergroup" },
        from: { id: 456, is_bot: false, first_name: "Alice" },
        text: "thread msg",
        message_thread_id: 99,
      })
    );

    expect(result!.threadId).toBe("99");
  });

  it("leaves threadId undefined when no message_thread_id", () => {
    const result = normalizeMessage(
      msg({
        message_id: 13,
        date: 1700000013,
        chat: { id: 123, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Alice" },
        text: "no thread",
      })
    );

    expect(result!.threadId).toBeUndefined();
  });

  it("populates metadata with chatId, chatType, username, firstName, lastName", () => {
    const result = normalizeMessage(
      msg({
        message_id: 14,
        date: 1700000014,
        chat: { id: 500, type: "group" },
        from: {
          id: 789,
          is_bot: false,
          first_name: "Carol",
          last_name: "Danvers",
          username: "carol_d",
        },
        text: "meta test",
      })
    );

    expect(result!.metadata).toMatchObject({
      chatId: 500,
      chatType: "group",
      username: "carol_d",
      firstName: "Carol",
      lastName: "Danvers",
    });
  });

  it("falls back channelUserId to chat.id when from is undefined", () => {
    const result = normalizeMessage(
      msg({
        message_id: 15,
        date: 1700000015,
        chat: { id: 888, type: "channel" },
        text: "channel post",
      })
    );

    expect(result!.channelUserId).toBe("888");
  });
});

describe("buildDisplayName", () => {
  it("combines first_name and last_name with a space", () => {
    const name = buildDisplayName(
      msg({
        message_id: 1,
        date: 0,
        chat: { id: 1, type: "private" },
        from: { id: 10, is_bot: false, first_name: "Alice", last_name: "Smith" },
      })
    );
    expect(name).toBe("Alice Smith");
  });

  it("returns first_name only when last_name is absent", () => {
    const name = buildDisplayName(
      msg({
        message_id: 1,
        date: 0,
        chat: { id: 1, type: "private" },
        from: { id: 10, is_bot: false, first_name: "Alice" },
      })
    );
    expect(name).toBe("Alice");
  });

  it("returns username when only username is present (no first_name)", () => {
    const name = buildDisplayName(
      msg({
        message_id: 1,
        date: 0,
        chat: { id: 1, type: "private" },
        from: { id: 10, is_bot: false, first_name: "", username: "alice_tg" },
      })
    );
    // first_name is falsy (""), so falls through to username
    expect(name).toBe("alice_tg");
  });

  it('returns "tg:<chatId>" when from is undefined', () => {
    const name = buildDisplayName(
      msg({
        message_id: 1,
        date: 0,
        chat: { id: 42, type: "channel" },
      })
    );
    expect(name).toBe("tg:42");
  });
});

// ---------------------------------------------------------------------------
// 3. outbound.ts — splitText
// ---------------------------------------------------------------------------

describe("splitText", () => {
  it("returns a single chunk when text is shorter than the limit", () => {
    const result = splitText("hello world", 100);
    expect(result).toEqual(["hello world"]);
  });

  it("returns a single chunk when text is exactly the limit", () => {
    const text = "a".repeat(50);
    const result = splitText(text, 50);
    expect(result).toEqual([text]);
  });

  it("splits long text at a newline boundary", () => {
    const line1 = "a".repeat(20);
    const line2 = "b".repeat(20);
    const full = `${line1}\n${line2}`;
    // maxLength 25 — the newline at index 20 is within the first 25 chars
    const result = splitText(full, 25);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toBe(line1);
    expect(result[1]).toBe(line2);
  });

  it("splits at a space boundary when there is no suitable newline", () => {
    // "aaa...aaa bbb...bbb" — 20 a's, space, 20 b's = 41 chars, limit 25
    const text = "a".repeat(20) + " " + "b".repeat(20);
    const result = splitText(text, 25);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // All chunks must be within the limit
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(25);
    }
    // Reconstructed content should match (trimStart is applied between chunks)
    expect(result.join(" ")).toContain("a");
    expect(result.join(" ")).toContain("b");
  });

  it("hard-breaks when there is no word boundary available", () => {
    const text = "x".repeat(100);
    const result = splitText(text, 40);
    expect(result.length).toBeGreaterThanOrEqual(3);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(40);
    }
    // All content is preserved
    expect(result.join("")).toBe(text);
  });

  it("produces multiple chunks for a very long multi-sentence text", () => {
    const sentence = "The quick brown fox jumps over the lazy dog. ";
    const text = sentence.repeat(30); // ~1350 chars
    const result = splitText(text, 100);
    expect(result.length).toBeGreaterThan(5);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. security.ts — createSecurityAdapter
// ---------------------------------------------------------------------------

describe("createSecurityAdapter — allowlist", () => {
  it("allows everyone when allowedChatIds is empty", async () => {
    const sec = createSecurityAdapter({ allowedChatIds: [] });
    expect(await sec.isAllowed("999")).toBe(true);
  });

  it("allows everyone when allowedChatIds is omitted", async () => {
    const sec = createSecurityAdapter({});
    expect(await sec.isAllowed("999")).toBe(true);
  });

  it("blocks users not in the allowlist", async () => {
    const sec = createSecurityAdapter({ allowedChatIds: [100, 200] });
    expect(await sec.isAllowed("300")).toBe(false);
  });

  it("allows a user that is in the allowlist", async () => {
    const sec = createSecurityAdapter({ allowedChatIds: [100, 200] });
    expect(await sec.isAllowed("100")).toBe(true);
  });

  it("getAllowlist returns the configured IDs as strings", async () => {
    const sec = createSecurityAdapter({ allowedChatIds: [10, 20, 30] });
    const list = await sec.getAllowlist();
    expect(list).toEqual(expect.arrayContaining(["10", "20", "30"]));
    expect(list).toHaveLength(3);
  });

  it("getAllowlist returns an empty array when no allowlist configured", async () => {
    const sec = createSecurityAdapter({});
    expect(await sec.getAllowlist()).toEqual([]);
  });
});

describe("createSecurityAdapter — rate limiting", () => {
  let dateSpy: ReturnType<typeof vi.spyOn>;
  let fakeNow: number;

  beforeEach(() => {
    fakeNow = 1_000_000;
    dateSpy = vi.spyOn(Date, "now").mockImplementation(() => fakeNow);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  it("allows the first N calls within the rate limit", async () => {
    const limit = 3;
    const sec = createSecurityAdapter({ rateLimitPerMinute: limit });
    for (let i = 0; i < limit; i++) {
      expect(await sec.isAllowed("user1")).toBe(true);
    }
  });

  it("blocks the (N+1)th call in the same window", async () => {
    const limit = 3;
    const sec = createSecurityAdapter({ rateLimitPerMinute: limit });
    for (let i = 0; i < limit; i++) {
      await sec.isAllowed("user1");
    }
    expect(await sec.isAllowed("user1")).toBe(false);
  });

  it("allows the user again after the 60-second window expires", async () => {
    const limit = 2;
    const sec = createSecurityAdapter({ rateLimitPerMinute: limit });

    // Exhaust the limit
    await sec.isAllowed("user2");
    await sec.isAllowed("user2");
    expect(await sec.isAllowed("user2")).toBe(false);

    // Advance time past the 60s window
    fakeNow += 61_000;

    // Should be allowed again
    expect(await sec.isAllowed("user2")).toBe(true);
  });

  it("tracks rate limits independently per user", async () => {
    const limit = 1;
    const sec = createSecurityAdapter({ rateLimitPerMinute: limit });

    // Exhaust limit for userA
    await sec.isAllowed("userA");
    expect(await sec.isAllowed("userA")).toBe(false);

    // userB's bucket is independent — still allowed
    expect(await sec.isAllowed("userB")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. index.ts — createTelegramPlugin
// ---------------------------------------------------------------------------

describe("createTelegramPlugin", () => {
  it("throws when botToken is missing", () => {
    expect(() =>
      createTelegramPlugin({ botToken: "" })
    ).toThrow("Invalid Telegram config");
  });

  it("throws when config is invalid (botToken is empty string)", () => {
    expect(() => createTelegramPlugin({ botToken: "" })).toThrow();
  });

  it('returns a plugin with id "telegram"', () => {
    const plugin = createTelegramPlugin({ botToken: "test:fake-token" });
    expect(plugin.id).toBe("telegram");
  });

  it('has meta.name "Telegram"', () => {
    const plugin = createTelegramPlugin({ botToken: "test:fake-token" });
    expect(plugin.meta.name).toBe("Telegram");
  });

  it('has meta.version "0.1.0"', () => {
    const plugin = createTelegramPlugin({ botToken: "test:fake-token" });
    expect(plugin.meta.version).toBe("0.1.0");
  });

  it("has correct capabilities", () => {
    const plugin = createTelegramPlugin({ botToken: "test:fake-token" });
    expect(plugin.capabilities).toEqual({
      text: true,
      media: true,
      voice: true,
      reactions: false,
      threads: true,
      ephemeral: false,
    });
  });

  it("config.validate() accepts a valid config", () => {
    const plugin = createTelegramPlugin({ botToken: "test:fake-token" });
    expect(plugin.config.validate({ botToken: "tok" })).toBe(true);
  });

  it("config.validate() rejects an invalid config", () => {
    const plugin = createTelegramPlugin({ botToken: "test:fake-token" });
    expect(plugin.config.validate({})).toBe(false);
  });

  it("config.getDefaults() returns expected defaults", () => {
    const plugin = createTelegramPlugin({ botToken: "test:fake-token" });
    const defaults = plugin.config.getDefaults();
    expect(defaults).toMatchObject({ pollingTimeout: 30, rateLimitPerMinute: 30 });
  });

  it("messaging.onMessage registers a handler without throwing", () => {
    const plugin = createTelegramPlugin({ botToken: "test:fake-token" });
    expect(() => {
      plugin.messaging.onMessage(async () => {
        // no-op handler
      });
    }).not.toThrow();
  });

  it("gateway.isRunning() returns false before start is called", () => {
    const plugin = createTelegramPlugin({ botToken: "test:fake-token" });
    expect(plugin.gateway.isRunning()).toBe(false);
  });

  it("has a security adapter", () => {
    const plugin = createTelegramPlugin({ botToken: "test:fake-token" });
    expect(plugin.security).toBeDefined();
    expect(typeof plugin.security!.isAllowed).toBe("function");
    expect(typeof plugin.security!.getAllowlist).toBe("function");
  });

  it("passes validateAdapter from channel-sdk", () => {
    const plugin = createTelegramPlugin({ botToken: "test:fake-token" });
    const result = validateAdapter(plugin);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
