/**
 * state.ts pure-helper tests.
 */
import { describe, it, expect } from "vitest";
import { channelKindFromType, describeClientState, describeGuildChannels } from "./state.js";

describe("channelKindFromType", () => {
  it("maps known Discord channel types", () => {
    expect(channelKindFromType(0)).toBe("text");
    expect(channelKindFromType(2)).toBe("voice");
    expect(channelKindFromType(4)).toBe("category");
    expect(channelKindFromType(5)).toBe("text");
    expect(channelKindFromType(13)).toBe("voice");
    expect(channelKindFromType(15)).toBe("forum");
    expect(channelKindFromType(16)).toBe("forum");
  });

  it("falls back to 'other' for unknown types", () => {
    expect(channelKindFromType(99)).toBe("other");
    expect(channelKindFromType(-1)).toBe("other");
  });
});

describe("describeGuildChannels", () => {
  it("returns empty array for empty cache", () => {
    const guild = { channels: { cache: new Map() } };
    expect(describeGuildChannels(guild as never)).toEqual([]);
  });

  it("normalizes + sorts channels by (parent, name) and excludes categories", () => {
    const cache = new Map<string, { id: string; name: string; type: number; parentId: string | null }>([
      ["cat-1", { id: "cat-1", name: "General", type: 4, parentId: null }],
      ["cat-2", { id: "cat-2", name: "Voice", type: 4, parentId: null }],
      ["ch-1", { id: "ch-1", name: "announcements", type: 5, parentId: "cat-1" }],
      ["ch-2", { id: "ch-2", name: "general", type: 0, parentId: "cat-1" }],
      ["ch-3", { id: "ch-3", name: "lobby", type: 2, parentId: "cat-2" }],
      ["ch-4", { id: "ch-4", name: "feedback", type: 15, parentId: null }],
    ]);
    const guild = { channels: { cache } };
    const out = describeGuildChannels(guild as never);
    expect(out).toEqual([
      { id: "ch-4", name: "feedback", kind: "forum", parent: undefined },
      { id: "ch-1", name: "announcements", kind: "text", parent: "General" },
      { id: "ch-2", name: "general", kind: "text", parent: "General" },
      { id: "ch-3", name: "lobby", kind: "voice", parent: "Voice" },
    ]);
  });

  it("preserves channels with null parent", () => {
    const cache = new Map<string, { id: string; name: string; type: number; parentId: string | null }>([
      ["ch-1", { id: "ch-1", name: "town-square", type: 0, parentId: null }],
    ]);
    const guild = { channels: { cache } };
    const out = describeGuildChannels(guild as never);
    expect(out[0]?.parent).toBeUndefined();
  });
});

describe("describeClientState", () => {
  it("returns disconnected state when user is null", () => {
    const out = describeClientState({ user: null, guilds: [] });
    expect(out.connected).toBe(false);
    expect(out.guilds).toEqual([]);
    expect(out.user).toBeUndefined();
    expect(typeof out.snapshotAt).toBe("string");
  });

  it("returns connected state with user + guilds when populated", () => {
    const out = describeClientState({
      user: { id: "u1", tag: "Aion#0001", avatarUrl: "https://cdn.discord/u1.png" },
      guilds: [
        {
          id: "g1",
          name: "Aionima HQ",
          memberCount: 42,
          iconUrl: "https://cdn.discord/g1.png",
          channels: [{ id: "c1", name: "general", kind: "text" }],
        },
        {
          id: "g2",
          name: "Civicognita",
          memberCount: 7,
          channels: [],
        },
      ],
    });
    expect(out.connected).toBe(true);
    expect(out.user?.id).toBe("u1");
    expect(out.user?.tag).toBe("Aion#0001");
    expect(out.user?.avatarUrl).toBe("https://cdn.discord/u1.png");
    expect(out.guilds.map((g) => g.name)).toEqual(["Aionima HQ", "Civicognita"]);
    expect(out.guilds[0]?.channels[0]?.name).toBe("general");
    expect(out.guilds[0]?.memberCount).toBe(42);
    expect(out.guilds[0]?.iconUrl).toBe("https://cdn.discord/g1.png");
    expect(out.guilds[1]?.iconUrl).toBeUndefined();
  });
});
