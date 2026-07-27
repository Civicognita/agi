/**
 * channelSessionKey tests — guards the "Discord channels bleed into one chat"
 * bug. Channel messages used to fall back to a bare `entity.id` session key, so
 * every channel/thread/DM for a user shared one turn history (and two concurrent
 * channels raced on the same session). The key must include the room dimension.
 */
import { describe, it, expect } from "vitest";
import { channelSessionKey } from "./agent-session.js";

describe("channelSessionKey", () => {
  const ENTITY = "discord:123456789";

  it("isolates two different channels of the same entity (the bleed regression)", () => {
    const a = channelSessionKey(ENTITY, "discord", "channel-A");
    const b = channelSessionKey(ENTITY, "discord", "channel-B");
    expect(a).not.toBe(b);
    // ...and neither collapses to the bare entity (the old buggy key)
    expect(a).not.toBe(ENTITY);
    expect(b).not.toBe(ENTITY);
  });

  it("is stable for the same channel+room (same conversation serializes correctly)", () => {
    expect(channelSessionKey(ENTITY, "discord", "chan-1"))
      .toBe(channelSessionKey(ENTITY, "discord", "chan-1"));
  });

  it("includes entity, channel, and room in the key", () => {
    expect(channelSessionKey(ENTITY, "discord", "chan-1")).toBe(`${ENTITY}:discord:chan-1`);
  });

  it("separates a DM/thread from a channel (distinct room ids → distinct keys)", () => {
    const chan = channelSessionKey(ENTITY, "discord", "guild-chan");
    const dm = channelSessionKey(ENTITY, "discord", "dm-room");
    const thread = channelSessionKey(ENTITY, "discord", "thread-42");
    expect(new Set([chan, dm, thread]).size).toBe(3);
  });

  it("separates two platforms for the same user even with no room id", () => {
    // No roomId → still separated by platform, NOT collapsed to bare entity.
    const dc = channelSessionKey(ENTITY, "discord");
    const tg = channelSessionKey(ENTITY, "telegram");
    expect(dc).not.toBe(tg);
    expect(dc).toBe(`${ENTITY}:discord`);
    expect(dc).not.toBe(ENTITY);
  });

  it("treats empty-string roomId the same as absent (no dangling separator)", () => {
    expect(channelSessionKey(ENTITY, "discord", "")).toBe(`${ENTITY}:discord`);
  });
});
