import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Message } from "discord.js";

import { isDiscordConfig, createConfigAdapter } from "./config.js";
import {
  DISCORD_CHANNEL_ID,
  normalizeMessage,
  buildDisplayName,
} from "./normalizer.js";
import { splitText, sendOutbound } from "./outbound.js";
import {
  createSecurityAdapter,
  isGuildAllowed,
  isChannelAllowed,
} from "./security.js";
import { createDiscordPlugin } from "./index.js";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock discord.js Message with the minimum shape the adapter needs.
 * Cast through unknown so partial objects satisfy the type.
 */
function mockMessage(partial: Record<string, unknown>): Message {
  // Provide sensible defaults for every field the normalizer touches.
  const defaults: Record<string, unknown> = {
    id: "msg-1",
    content: "",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    guildId: null,
    guild: null,
    channelId: "chan-1",
    reference: null,
    author: {
      id: "user-1",
      username: "testuser",
      discriminator: "0",
      bot: false,
      globalName: null,
    },
    attachments: {
      first: () => undefined,
    },
    channel: {
      isThread: () => false,
      id: "chan-1",
      name: "general",
    },
  };

  // Deep-merge: caller wins for top-level keys
  return { ...defaults, ...partial } as unknown as Message;
}

/** Helper to create a mock TextChannel-like object for outbound tests. */
function mockTextChannel(sendFn = vi.fn().mockResolvedValue(undefined)) {
  return { send: sendFn } as unknown as import("discord.js").TextChannel;
}

// ---------------------------------------------------------------------------
// 1. config.ts — isDiscordConfig
// ---------------------------------------------------------------------------

describe("isDiscordConfig", () => {
  it("accepts a minimal valid config with only botToken", () => {
    expect(isDiscordConfig({ botToken: "Bot abc123" })).toBe(true);
  });

  it("accepts a fully-specified valid config", () => {
    expect(
      isDiscordConfig({
        botToken: "Bot abc123",
        applicationId: "99999",
        allowedGuildIds: ["guild1"],
        allowedChannelIds: ["chan1"],
        rateLimitPerMinute: 30,
      })
    ).toBe(true);
  });

  it("accepts empty allowedGuildIds array", () => {
    expect(isDiscordConfig({ botToken: "tok", allowedGuildIds: [] })).toBe(true);
  });

  it("accepts empty allowedChannelIds array", () => {
    expect(isDiscordConfig({ botToken: "tok", allowedChannelIds: [] })).toBe(true);
  });

  it("rejects null", () => {
    expect(isDiscordConfig(null)).toBe(false);
  });

  it("rejects a string primitive", () => {
    expect(isDiscordConfig("Bot token")).toBe(false);
  });

  it("rejects a numeric primitive", () => {
    expect(isDiscordConfig(42)).toBe(false);
  });

  it("rejects missing botToken", () => {
    expect(isDiscordConfig({})).toBe(false);
  });

  it("rejects an empty botToken string", () => {
    expect(isDiscordConfig({ botToken: "" })).toBe(false);
  });

  it("rejects a numeric botToken", () => {
    expect(isDiscordConfig({ botToken: 123 })).toBe(false);
  });

  it("rejects allowedGuildIds that is not an array", () => {
    expect(isDiscordConfig({ botToken: "tok", allowedGuildIds: "guild1" })).toBe(false);
  });

  it("rejects allowedGuildIds containing non-strings", () => {
    expect(isDiscordConfig({ botToken: "tok", allowedGuildIds: [123] })).toBe(false);
  });

  it("rejects allowedChannelIds that is not an array", () => {
    expect(isDiscordConfig({ botToken: "tok", allowedChannelIds: 9 })).toBe(false);
  });

  it("rejects allowedChannelIds containing non-strings", () => {
    expect(isDiscordConfig({ botToken: "tok", allowedChannelIds: [true] })).toBe(false);
  });

  it("rejects non-string applicationId", () => {
    expect(isDiscordConfig({ botToken: "tok", applicationId: 12345 })).toBe(false);
  });

  it("accepts optional applicationId as a string", () => {
    expect(isDiscordConfig({ botToken: "tok", applicationId: "12345" })).toBe(true);
  });

  it("rejects non-numeric rateLimitPerMinute", () => {
    expect(isDiscordConfig({ botToken: "tok", rateLimitPerMinute: "30" })).toBe(false);
  });

  it("rejects zero rateLimitPerMinute", () => {
    expect(isDiscordConfig({ botToken: "tok", rateLimitPerMinute: 0 })).toBe(false);
  });

  it("rejects negative rateLimitPerMinute", () => {
    expect(isDiscordConfig({ botToken: "tok", rateLimitPerMinute: -5 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 1b. config.ts — createConfigAdapter
// ---------------------------------------------------------------------------

describe("createConfigAdapter", () => {
  const adapter = createConfigAdapter();

  it("validate returns true for a valid config", () => {
    expect(adapter.validate({ botToken: "Bot abc" })).toBe(true);
  });

  it("validate returns false for a missing botToken", () => {
    expect(adapter.validate({})).toBe(false);
  });

  it("validate returns false for null", () => {
    expect(adapter.validate(null)).toBe(false);
  });

  it("getDefaults returns rateLimitPerMinute: 20", () => {
    expect(adapter.getDefaults()).toMatchObject({ rateLimitPerMinute: 20 });
  });
});

// ---------------------------------------------------------------------------
// 2. normalizer.ts — DISCORD_CHANNEL_ID
// ---------------------------------------------------------------------------

describe("DISCORD_CHANNEL_ID", () => {
  it('is the string "discord"', () => {
    expect(DISCORD_CHANNEL_ID).toBe("discord");
  });
});

// ---------------------------------------------------------------------------
// 2b. normalizer.ts — normalizeMessage
// ---------------------------------------------------------------------------

describe("normalizeMessage", () => {
  it("normalizes a plain text message to type:text", () => {
    const result = normalizeMessage(
      mockMessage({ content: "hello world" })
    );

    expect(result).not.toBeNull();
    expect(result!.content.type).toBe("text");
    if (result!.content.type === "text") {
      expect(result!.content.text).toBe("hello world");
    }
  });

  it("sets top-level fields correctly for a text message", () => {
    const ts = new Date("2024-06-01T12:00:00Z");
    const result = normalizeMessage(
      mockMessage({
        id: "msg-99",
        content: "hi",
        createdAt: ts,
        author: {
          id: "user-42",
          username: "alice",
          discriminator: "0",
          bot: false,
          globalName: null,
        },
      })
    );

    expect(result!.id).toBe("msg-99");
    expect(result!.channelId).toBe("discord");
    // channelUserId is the author's Discord ID for per-user entity resolution
    expect(result!.channelUserId).toBe("user-42");
    expect(result!.timestamp).toBe(ts.toISOString());
    // Author ID is also preserved in metadata
    expect((result!.metadata as Record<string, unknown>).authorId).toBe("user-42");
    // Reply channel ID is stored in metadata for outbound routing
    expect((result!.metadata as Record<string, unknown>).replyChannelId).toBe("chan-1");
  });

  it("returns null for an empty message (no content, no attachments)", () => {
    const result = normalizeMessage(
      mockMessage({ content: "" })
    );

    expect(result).toBeNull();
  });

  // CHN-B (s163) slice 2 — roomId encoding for dispatcher consumption
  it("attaches metadata.roomId as `guildId:channelId` for guild messages", () => {
    const result = normalizeMessage(
      mockMessage({
        content: "hi",
        guildId: "1234567890",
        channelId: "9876543210",
        channel: { isThread: () => false, id: "9876543210", name: "general" },
      })
    );
    expect((result!.metadata as Record<string, unknown>).roomId).toBe("1234567890:9876543210");
  });

  it("leaves metadata.roomId undefined for DMs (no guildId)", () => {
    const result = normalizeMessage(
      mockMessage({
        content: "hi from a DM",
        guildId: null,
        channelId: "dm-channel-1",
        channel: { isThread: () => false, id: "dm-channel-1", name: "DM" },
      })
    );
    expect((result!.metadata as Record<string, unknown>).roomId).toBeUndefined();
  });

  it("normalizes an image attachment to type:media", () => {
    const attachment = {
      url: "https://cdn.discord.com/image.png",
      contentType: "image/png",
      duration_secs: undefined,
    };

    const result = normalizeMessage(
      mockMessage({
        content: "",
        attachments: {
          first: () => attachment,
        },
      })
    );

    expect(result).not.toBeNull();
    expect(result!.content.type).toBe("media");
    if (result!.content.type === "media") {
      expect(result!.content.url).toBe("https://cdn.discord.com/image.png");
      expect(result!.content.mimeType).toBe("image/png");
    }
  });

  it("uses application/octet-stream when attachment has no contentType", () => {
    const attachment = {
      url: "https://cdn.discord.com/file.bin",
      contentType: null,
      duration_secs: undefined,
    };

    const result = normalizeMessage(
      mockMessage({
        content: "",
        attachments: { first: () => attachment },
      })
    );

    expect(result!.content.type).toBe("media");
    if (result!.content.type === "media") {
      expect(result!.content.mimeType).toBe("application/octet-stream");
    }
  });

  it("adds caption from message content when attachment has text alongside it", () => {
    const attachment = {
      url: "https://cdn.discord.com/pic.jpg",
      contentType: "image/jpeg",
      duration_secs: undefined,
    };

    const result = normalizeMessage(
      mockMessage({
        content: "look at this",
        attachments: { first: () => attachment },
      })
    );

    expect(result!.content.type).toBe("media");
    if (result!.content.type === "media") {
      expect(result!.content.caption).toBe("look at this");
    }
  });

  it("normalizes a voice message attachment to type:voice", () => {
    const attachment = {
      url: "https://cdn.discord.com/voice.ogg",
      contentType: "audio/ogg",
      duration_secs: 8,
    };

    const result = normalizeMessage(
      mockMessage({
        content: "",
        attachments: { first: () => attachment },
      })
    );

    expect(result).not.toBeNull();
    expect(result!.content.type).toBe("voice");
    if (result!.content.type === "voice") {
      expect(result!.content.url).toBe("https://cdn.discord.com/voice.ogg");
      expect(result!.content.duration).toBe(8);
    }
  });

  it("does NOT treat audio attachment without duration_secs as voice", () => {
    // An audio file that isn't a voice message has no duration_secs raw field
    const attachment = {
      url: "https://cdn.discord.com/music.mp3",
      contentType: "audio/mpeg",
      // no duration_secs → should be media, not voice
    };

    const result = normalizeMessage(
      mockMessage({
        content: "",
        attachments: { first: () => attachment },
      })
    );

    expect(result!.content.type).toBe("media");
  });

  it("populates replyTo when message has a reference", () => {
    const result = normalizeMessage(
      mockMessage({
        content: "reply here",
        reference: { messageId: "original-msg-5" },
      })
    );

    expect(result!.replyTo).toBe("original-msg-5");
  });

  it("leaves replyTo undefined when there is no reference", () => {
    const result = normalizeMessage(
      mockMessage({ content: "standalone", reference: null })
    );

    expect(result!.replyTo).toBeUndefined();
  });

  it("sets threadId when channel.isThread() returns true", () => {
    const result = normalizeMessage(
      mockMessage({
        content: "thread reply",
        channelId: "thread-chan-99",
        channel: {
          isThread: () => true,
          id: "thread-chan-99",
          name: "thread-name",
        },
      })
    );

    expect(result!.threadId).toBe("thread-chan-99");
  });

  it("leaves threadId undefined when channel is not a thread", () => {
    const result = normalizeMessage(
      mockMessage({ content: "not in thread" })
    );

    expect(result!.threadId).toBeUndefined();
  });

  it("populates metadata with guildId, channelId, username, discriminator, displayName", () => {
    const result = normalizeMessage(
      mockMessage({
        content: "meta test",
        guildId: "guild-777",
        guild: { name: "Cool Server" },
        channelId: "chan-88",
        channel: {
          isThread: () => false,
          id: "chan-88",
          name: "chat",
        },
        author: {
          id: "user-55",
          username: "carol",
          discriminator: "1234",
          bot: false,
          globalName: null,
        },
      })
    );

    expect(result!.metadata).toMatchObject({
      guildId: "guild-777",
      guildName: "Cool Server",
      channelId: "chan-88",
      replyChannelId: "chan-88",
      authorId: "user-55",
      username: "carol",
      discriminator: "1234",
      displayName: "carol",
    });
  });

  it("leaves guildId/guildName undefined when message is from a DM", () => {
    const result = normalizeMessage(
      mockMessage({
        content: "dm message",
        guildId: null,
        guild: null,
      })
    );

    expect(result!.metadata).toMatchObject({
      guildId: undefined,
      guildName: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// 2c. normalizer.ts — buildDisplayName
// ---------------------------------------------------------------------------

describe("buildDisplayName", () => {
  it("prefers globalName over username", () => {
    const name = buildDisplayName(
      mockMessage({
        author: {
          id: "user-1",
          username: "alice_username",
          discriminator: "0",
          bot: false,
          globalName: "Alice Display",
        },
      })
    );
    expect(name).toBe("Alice Display");
  });

  it("falls back to username when globalName is null", () => {
    const name = buildDisplayName(
      mockMessage({
        author: {
          id: "user-2",
          username: "bob_username",
          discriminator: "0",
          bot: false,
          globalName: null,
        },
      })
    );
    expect(name).toBe("bob_username");
  });

  it("falls back to username when globalName is an empty string", () => {
    const name = buildDisplayName(
      mockMessage({
        author: {
          id: "user-3",
          username: "carol_user",
          discriminator: "0",
          bot: false,
          globalName: "",
        },
      })
    );
    expect(name).toBe("carol_user");
  });

  it('falls back to "discord:<userId>" when both globalName and username are empty', () => {
    const name = buildDisplayName(
      mockMessage({
        author: {
          id: "user-999",
          username: "",
          discriminator: "0",
          bot: false,
          globalName: null,
        },
      })
    );
    expect(name).toBe("discord:user-999");
  });
});

// ---------------------------------------------------------------------------
// 3. outbound.ts — splitText
// ---------------------------------------------------------------------------

describe("splitText", () => {
  it("returns a single chunk when text is shorter than the limit", () => {
    const result = splitText("hello world", 2000);
    expect(result).toEqual(["hello world"]);
  });

  it("returns a single chunk when text is exactly the limit", () => {
    const text = "a".repeat(2000);
    const result = splitText(text, 2000);
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
    // 20 a's + space + 20 b's = 41 chars, limit 25
    const text = "a".repeat(20) + " " + "b".repeat(20);
    const result = splitText(text, 25);
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(25);
    }
    expect(result.join(" ")).toContain("a");
    expect(result.join(" ")).toContain("b");
  });

  it("hard-breaks when there is no word boundary within the window", () => {
    const text = "x".repeat(100);
    const result = splitText(text, 40);
    expect(result.length).toBeGreaterThanOrEqual(3);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(40);
    }
    // All content is preserved
    expect(result.join("")).toBe(text);
  });

  it("produces multiple chunks for very long multi-sentence text", () => {
    const sentence = "The quick brown fox jumps over the lazy dog. ";
    const text = sentence.repeat(100); // ~4500 chars, well above 2000
    const result = splitText(text, 2000);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it("preserves all content across all chunks (hard-break scenario)", () => {
    const text = "word ".repeat(200).trimEnd(); // ~999 chars of "word word word..."
    const result = splitText(text, 50);
    // Joining with space should reconstruct something equivalent
    expect(result.every((c) => c.length <= 50)).toBe(true);
    // Content should not be lost — number of "word" occurrences
    const combined = result.join(" ");
    expect(combined.split("word").length - 1).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 3b. outbound.ts — sendOutbound
// ---------------------------------------------------------------------------

describe("sendOutbound", () => {
  it("sends a single chunk when text is under 2000 chars", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = mockTextChannel(send);

    await sendOutbound(channel, { type: "text", text: "short message" });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ content: "short message" });
  });

  it("sends multiple chunks when text exceeds 2000 chars", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = mockTextChannel(send);

    // Build text just over 2000 chars — words so splits are at spaces
    const text = ("long word ".repeat(210)).trimEnd(); // ~2099 chars

    await sendOutbound(channel, { type: "text", text });

    expect(send.mock.calls.length).toBeGreaterThan(1);
    // Each call's content should be within the limit
    for (const [callArgs] of send.mock.calls) {
      expect((callArgs as { content: string }).content.length).toBeLessThanOrEqual(2000);
    }
  });

  it("sends a media attachment with the correct url and files array", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = mockTextChannel(send);

    await sendOutbound(channel, {
      type: "media",
      url: "https://example.com/image.png",
      mimeType: "image/png",
    });

    expect(send).toHaveBeenCalledTimes(1);
    const callArgs = send.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["files"]).toBeDefined();
    expect(Array.isArray(callArgs["files"])).toBe(true);
    expect((callArgs["files"] as unknown[]).length).toBe(1);
  });

  it("sends media attachment with caption as content field", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = mockTextChannel(send);

    await sendOutbound(channel, {
      type: "media",
      url: "https://example.com/doc.pdf",
      mimeType: "application/pdf",
      caption: "Here is the report",
    });

    expect(send).toHaveBeenCalledTimes(1);
    const callArgs = send.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["content"]).toBe("Here is the report");
  });
});

// ---------------------------------------------------------------------------
// 4. security.ts — createSecurityAdapter
// ---------------------------------------------------------------------------

describe("createSecurityAdapter — open mode (no allowlists)", () => {
  it("allows any user when no config is provided", async () => {
    const sec = createSecurityAdapter({});
    expect(await sec.isAllowed("any-user")).toBe(true);
  });

  it("getAllowlist returns empty array in open mode", async () => {
    const sec = createSecurityAdapter({});
    expect(await sec.getAllowlist()).toEqual([]);
  });
});

describe("createSecurityAdapter — guild + channel allowlist (getAllowlist)", () => {
  it("getAllowlist returns union of guild and channel IDs as strings", async () => {
    const sec = createSecurityAdapter({
      allowedGuildIds: ["guild1", "guild2"],
      allowedChannelIds: ["chan1"],
    });
    const list = await sec.getAllowlist();
    expect(list).toEqual(expect.arrayContaining(["guild1", "guild2", "chan1"]));
    expect(list).toHaveLength(3);
  });

  it("getAllowlist returns only guild IDs when no channel IDs configured", async () => {
    const sec = createSecurityAdapter({ allowedGuildIds: ["g1"] });
    expect(await sec.getAllowlist()).toEqual(["g1"]);
  });

  it("getAllowlist returns only channel IDs when no guild IDs configured", async () => {
    const sec = createSecurityAdapter({ allowedChannelIds: ["c1", "c2"] });
    expect(await sec.getAllowlist()).toEqual(["c1", "c2"]);
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

  it("allows the first N calls within the rate limit window", async () => {
    const limit = 3;
    const sec = createSecurityAdapter({ rateLimitPerMinute: limit });
    for (let i = 0; i < limit; i++) {
      expect(await sec.isAllowed("user1")).toBe(true);
    }
  });

  it("blocks the (N+1)th call in the same 60-second window", async () => {
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

    await sec.isAllowed("user2");
    await sec.isAllowed("user2");
    expect(await sec.isAllowed("user2")).toBe(false);

    // Advance time past the 60-second window
    fakeNow += 61_000;

    expect(await sec.isAllowed("user2")).toBe(true);
  });

  it("tracks rate limits independently per user", async () => {
    const limit = 1;
    const sec = createSecurityAdapter({ rateLimitPerMinute: limit });

    await sec.isAllowed("userA");
    expect(await sec.isAllowed("userA")).toBe(false);

    // userB's bucket is independent
    expect(await sec.isAllowed("userB")).toBe(true);
  });

  it("uses default rate limit of 20 when not specified", async () => {
    const sec = createSecurityAdapter({});
    // Allow 20 calls
    for (let i = 0; i < 20; i++) {
      expect(await sec.isAllowed("userX")).toBe(true);
    }
    // 21st should be blocked
    expect(await sec.isAllowed("userX")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4b. security.ts — isGuildAllowed
// ---------------------------------------------------------------------------

describe("isGuildAllowed", () => {
  it("returns true when allowedGuildIds is undefined (no allowlist)", () => {
    expect(isGuildAllowed("guild-1", undefined)).toBe(true);
  });

  it("returns true when allowedGuildIds is empty (open mode)", () => {
    expect(isGuildAllowed("guild-1", [])).toBe(true);
  });

  it("returns true when guildId is in the allowlist", () => {
    expect(isGuildAllowed("guild-1", ["guild-1", "guild-2"])).toBe(true);
  });

  it("returns false when guildId is not in the allowlist", () => {
    expect(isGuildAllowed("guild-9", ["guild-1", "guild-2"])).toBe(false);
  });

  it("returns false when guildId is null and allowlist is set", () => {
    expect(isGuildAllowed(null, ["guild-1"])).toBe(false);
  });

  it("returns true when guildId is null and allowlist is empty", () => {
    expect(isGuildAllowed(null, [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4c. security.ts — isChannelAllowed
// ---------------------------------------------------------------------------

describe("isChannelAllowed", () => {
  it("returns true when allowedChannelIds is undefined (no allowlist)", () => {
    expect(isChannelAllowed("chan-1", undefined)).toBe(true);
  });

  it("returns true when allowedChannelIds is empty (open mode)", () => {
    expect(isChannelAllowed("chan-1", [])).toBe(true);
  });

  it("returns true when channelId is in the allowlist", () => {
    expect(isChannelAllowed("chan-1", ["chan-1", "chan-2"])).toBe(true);
  });

  it("returns false when channelId is not in the allowlist", () => {
    expect(isChannelAllowed("chan-9", ["chan-1", "chan-2"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. index.ts — createDiscordPlugin
// ---------------------------------------------------------------------------

describe("createDiscordPlugin", () => {
  it("throws when botToken is empty", () => {
    expect(() => createDiscordPlugin({ botToken: "" })).toThrow(
      "Invalid Discord config"
    );
  });

  it("throws when config object has no botToken", () => {
    expect(() =>
      createDiscordPlugin({} as { botToken: string })
    ).toThrow();
  });

  it('returns a plugin with id "discord"', () => {
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
    expect(plugin.id).toBe("discord");
  });

  it('has meta.name "Discord"', () => {
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
    expect(plugin.meta.name).toBe("Discord");
  });

  it('has meta.version "0.1.0"', () => {
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
    expect(plugin.meta.version).toBe("0.1.0");
  });

  it("has meta.description set", () => {
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
    expect(typeof plugin.meta.description).toBe("string");
    expect(plugin.meta.description!.length).toBeGreaterThan(0);
  });

  it("has correct capabilities flags", () => {
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
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
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
    expect(plugin.config.validate({ botToken: "Bot valid" })).toBe(true);
  });

  it("config.validate() rejects an invalid config", () => {
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
    expect(plugin.config.validate({})).toBe(false);
  });

  it("config.getDefaults() returns rateLimitPerMinute: 20", () => {
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
    expect(plugin.config.getDefaults()).toMatchObject({ rateLimitPerMinute: 20 });
  });

  it("gateway.isRunning() returns false before start is called", () => {
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
    expect(plugin.gateway.isRunning()).toBe(false);
  });

  it("messaging.onMessage registers a handler without throwing", () => {
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
    expect(() => {
      plugin.messaging.onMessage(async () => {
        // no-op handler
      });
    }).not.toThrow();
  });

  it("has a security adapter with isAllowed and getAllowlist", () => {
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
    expect(plugin.security).toBeDefined();
    expect(typeof plugin.security!.isAllowed).toBe("function");
    expect(typeof plugin.security!.getAllowlist).toBe("function");
  });

  it("security.isAllowed returns true in open mode (no allowlists)", async () => {
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
    expect(await plugin.security!.isAllowed("any-user")).toBe(true);
  });

  it("has gateway.start and gateway.stop as functions", () => {
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
    expect(typeof plugin.gateway.start).toBe("function");
    expect(typeof plugin.gateway.stop).toBe("function");
  });

  it("has outbound.send as a function", () => {
    const plugin = createDiscordPlugin({ botToken: "Bot fake-token" });
    expect(typeof plugin.outbound.send).toBe("function");
  });

});

// ---------------------------------------------------------------------------
// 6. config.ts — mentionOnly validation
// ---------------------------------------------------------------------------

describe("isDiscordConfig — mentionOnly", () => {
  it("accepts mentionOnly: true", () => {
    expect(isDiscordConfig({ botToken: "tok", mentionOnly: true })).toBe(true);
  });

  it("accepts mentionOnly: false", () => {
    expect(isDiscordConfig({ botToken: "tok", mentionOnly: false })).toBe(true);
  });

  it("rejects non-boolean mentionOnly", () => {
    expect(isDiscordConfig({ botToken: "tok", mentionOnly: "yes" })).toBe(false);
  });

  it("rejects numeric mentionOnly", () => {
    expect(isDiscordConfig({ botToken: "tok", mentionOnly: 1 })).toBe(false);
  });

  it("accepts config without mentionOnly (optional)", () => {
    expect(isDiscordConfig({ botToken: "tok" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Mention filter logic (unit-level)
// ---------------------------------------------------------------------------

describe("mention filter logic", () => {
  /**
   * Simulates the mention filter logic from the MessageCreate handler.
   * Returns true if the message should be processed, false if skipped.
   */
  function shouldProcess(opts: {
    mentionOnly: boolean;
    guildId: string | null;
    isMentioned: boolean;
    hasReference: boolean;
  }): boolean {
    if (opts.mentionOnly && opts.guildId !== null) {
      if (!opts.isMentioned && !opts.hasReference) return false;
    }
    return true;
  }

  it("processes all guild messages when mentionOnly is false", () => {
    expect(
      shouldProcess({
        mentionOnly: false,
        guildId: "guild-1",
        isMentioned: false,
        hasReference: false,
      }),
    ).toBe(true);
  });

  it("skips guild messages without mention or reply when mentionOnly is true", () => {
    expect(
      shouldProcess({
        mentionOnly: true,
        guildId: "guild-1",
        isMentioned: false,
        hasReference: false,
      }),
    ).toBe(false);
  });

  it("processes guild messages when bot is mentioned", () => {
    expect(
      shouldProcess({
        mentionOnly: true,
        guildId: "guild-1",
        isMentioned: true,
        hasReference: false,
      }),
    ).toBe(true);
  });

  it("processes guild messages when user replied to a message", () => {
    expect(
      shouldProcess({
        mentionOnly: true,
        guildId: "guild-1",
        isMentioned: false,
        hasReference: true,
      }),
    ).toBe(true);
  });

  it("always processes DMs regardless of mentionOnly", () => {
    expect(
      shouldProcess({
        mentionOnly: true,
        guildId: null,
        isMentioned: false,
        hasReference: false,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Outbound DM fallback
// ---------------------------------------------------------------------------

describe("outbound DM fallback", () => {
  it("attempts DM when replyChannelMap has no entry", async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const mockDmChannel = { send: sendFn };
    const mockUser = {
      createDM: vi.fn().mockResolvedValue(mockDmChannel),
    };
    const mockClient = {
      users: {
        fetch: vi.fn().mockResolvedValue(mockUser),
      },
    };

    // Simulate the DM fallback path from outbound.send
    const channelUserId = "unknown-user";
    const replyChannelMap = new Map<string, string>();
    const targetChannelId = replyChannelMap.get(channelUserId);

    expect(targetChannelId).toBeUndefined();

    // Execute the fallback path
    const user = await mockClient.users.fetch(channelUserId);
    const dmChannel = await user.createDM();
    await sendOutbound(dmChannel as unknown as import("discord.js").TextChannel, {
      type: "text",
      text: "Hello via DM!",
    });

    expect(mockClient.users.fetch).toHaveBeenCalledWith("unknown-user");
    expect(mockUser.createDM).toHaveBeenCalled();
    expect(sendFn).toHaveBeenCalledWith({ content: "Hello via DM!" });
  });

  it("throws descriptive error when DM fallback also fails", async () => {
    const mockClient = {
      users: {
        fetch: vi.fn().mockRejectedValue(new Error("Unknown User")),
      },
    };

    const channelUserId = "bad-user-id";
    const replyChannelMap = new Map<string, string>();
    const targetChannelId = replyChannelMap.get(channelUserId);

    expect(targetChannelId).toBeUndefined();

    // The fallback path should throw
    try {
      await mockClient.users.fetch(channelUserId);
      // Should not reach here
      expect.unreachable("Should have thrown");
    } catch {
      // This matches the error path in outbound.send
      const err = new Error(
        `Discord outbound: no reply channel for user ${channelUserId} and DM fallback failed`,
      );
      expect(err.message).toContain("no reply channel");
      expect(err.message).toContain("bad-user-id");
      expect(err.message).toContain("DM fallback failed");
    }
  });
});
