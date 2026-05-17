/**
 * aion-tools-logic pure-helper tests.
 */
import { describe, it, expect } from "vitest";
import { buildSearchOptions, normalizeUserPresence, normalizeMemberRoles } from "./aion-tools-logic.js";

describe("buildSearchOptions", () => {
  it("requires channelId", () => {
    expect(() => buildSearchOptions({})).toThrow(/channelId is required/);
    expect(() => buildSearchOptions({ channelId: "" })).toThrow(/channelId is required/);
  });

  it("defaults limit to 50", () => {
    expect(buildSearchOptions({ channelId: "c1" }).limit).toBe(50);
  });

  it("clamps limit to [1, 100]", () => {
    expect(buildSearchOptions({ channelId: "c1", limit: 0 }).limit).toBe(1);
    expect(buildSearchOptions({ channelId: "c1", limit: 500 }).limit).toBe(100);
    expect(buildSearchOptions({ channelId: "c1", limit: 50 }).limit).toBe(50);
  });

  it("falls back to 50 for non-finite limit", () => {
    expect(buildSearchOptions({ channelId: "c1", limit: "not a number" }).limit).toBe(50);
    expect(buildSearchOptions({ channelId: "c1", limit: NaN }).limit).toBe(50);
  });

  it("passes through optional fields", () => {
    const opts = buildSearchOptions({
      channelId: "c1",
      fromTs: "2026-05-13T00:00:00Z",
      toTs: "2026-05-13T23:59:59Z",
      cursor: "msg-abc",
    });
    expect(opts.fromTs).toBe("2026-05-13T00:00:00Z");
    expect(opts.toTs).toBe("2026-05-13T23:59:59Z");
    expect(opts.cursor).toBe("msg-abc");
  });

  it("drops empty cursor string", () => {
    expect(buildSearchOptions({ channelId: "c1", cursor: "" }).cursor).toBeUndefined();
  });
});

describe("normalizeUserPresence", () => {
  it("returns nulls for missing presence", () => {
    expect(normalizeUserPresence(null)).toEqual({ presence: null, activity: null, status: null });
    expect(normalizeUserPresence(undefined)).toEqual({ presence: null, activity: null, status: null });
  });

  it("returns just status when no activities", () => {
    expect(normalizeUserPresence({ status: "online", activities: [] })).toEqual({
      presence: "online",
      activity: null,
      status: null,
    });
  });

  it("formats Playing activity (type 0)", () => {
    expect(
      normalizeUserPresence({
        status: "online",
        activities: [{ type: 0, name: "Factorio" }],
      }),
    ).toEqual({ presence: "online", activity: "Playing Factorio", status: null });
  });

  it("formats Listening to (type 2) with details fallback", () => {
    expect(
      normalizeUserPresence({
        status: "idle",
        activities: [{ type: 2, name: "Spotify", details: "Some Song" }],
      }),
    ).toEqual({ presence: "idle", activity: "Listening to Some Song", status: null });
  });

  it("renders Custom Status (type 4) state separately", () => {
    expect(
      normalizeUserPresence({
        status: "online",
        activities: [{ type: 4, state: "Coding agi" }],
      }),
    ).toEqual({ presence: "online", activity: "Coding agi", status: "Coding agi" });
  });

  it("Watching (type 3)", () => {
    expect(
      normalizeUserPresence({
        status: "online",
        activities: [{ type: 3, name: "YouTube", state: "A video" }],
      }),
    ).toEqual({ presence: "online", activity: "Watching A video", status: null });
  });
});

describe("normalizeMemberRoles", () => {
  it("returns empty for empty iterable", () => {
    expect(normalizeMemberRoles([] as Array<{ id: string; name: string }>)).toEqual([]);
  });

  it("sorts roles by position desc (top role first)", () => {
    const roles = [
      { id: "1", name: "Member", position: 1 },
      { id: "3", name: "Admin", position: 10 },
      { id: "2", name: "Mod", position: 5 },
    ];
    const out = normalizeMemberRoles(roles);
    expect(out.map((r) => r.name)).toEqual(["Admin", "Mod", "Member"]);
  });

  it("preserves all per-role fields", () => {
    const out = normalizeMemberRoles([{ id: "r1", name: "Test", color: 0xff0000, position: 7 }]);
    expect(out).toEqual([{ id: "r1", name: "Test", color: 0xff0000, position: 7 }]);
  });

  it("handles Map-shaped input (Discord Collection)", () => {
    const m = new Map<string, { id: string; name: string; position: number }>([
      ["a", { id: "a", name: "Aye", position: 2 }],
      ["b", { id: "b", name: "Bee", position: 1 }],
    ]);
    expect(normalizeMemberRoles(m).map((r) => r.name)).toEqual(["Aye", "Bee"]);
  });
});

// ---------------------------------------------------------------------------
// CHN-G (s168) slice 1 — aggregate_stats helpers
// ---------------------------------------------------------------------------

import {
  buildAggregateStatsOptions,
  aggregateChannelStats,
  filterAvailableRooms,
  type MessageForStats,
  type RoomForFilter,
} from "./aion-tools-logic.js";

describe("buildAggregateStatsOptions", () => {
  it("requires channelId", () => {
    expect(() => buildAggregateStatsOptions({})).toThrow(/channelId is required/);
    expect(() => buildAggregateStatsOptions({ channelId: "" })).toThrow(/channelId is required/);
  });

  it("defaults days to 7 + limit to 500", () => {
    const opts = buildAggregateStatsOptions({ channelId: "c1" });
    expect(opts.days).toBe(7);
    expect(opts.limit).toBe(500);
  });

  it("clamps days to [1, 90]", () => {
    expect(buildAggregateStatsOptions({ channelId: "c1", days: 0 }).days).toBe(1);
    expect(buildAggregateStatsOptions({ channelId: "c1", days: 500 }).days).toBe(90);
    expect(buildAggregateStatsOptions({ channelId: "c1", days: 30 }).days).toBe(30);
  });

  it("clamps limit to [1, 1000]", () => {
    expect(buildAggregateStatsOptions({ channelId: "c1", limit: 0 }).limit).toBe(1);
    expect(buildAggregateStatsOptions({ channelId: "c1", limit: 10000 }).limit).toBe(1000);
  });

  it("floors fractional days/limit", () => {
    expect(buildAggregateStatsOptions({ channelId: "c1", days: 7.9, limit: 100.5 }).days).toBe(7);
    expect(buildAggregateStatsOptions({ channelId: "c1", days: 7.9, limit: 100.5 }).limit).toBe(100);
  });
});

describe("aggregateChannelStats", () => {
  function makeMessage(authorId: string, authorName: string, daysAgo: number, isBot = false): MessageForStats {
    return {
      authorId,
      authorName,
      createdAtMs: Date.now() - daysAgo * 24 * 60 * 60 * 1000,
      isBot,
    };
  }

  it("returns zeros for empty input", () => {
    const out = aggregateChannelStats("c1", 7, []);
    expect(out.messageCount).toBe(0);
    expect(out.uniqueAuthors).toBe(0);
    expect(out.topAuthors).toEqual([]);
    expect(out.firstMessageAt).toBeNull();
    expect(out.lastMessageAt).toBeNull();
    expect(out.botMessagesExcluded).toBe(0);
  });

  it("filters out messages outside the day window", () => {
    const msgs = [
      makeMessage("u1", "Alice", 1),  // in
      makeMessage("u1", "Alice", 5),  // in
      makeMessage("u1", "Alice", 10), // OUT — beyond 7 days
    ];
    const out = aggregateChannelStats("c1", 7, msgs);
    expect(out.messageCount).toBe(2);
  });

  it("excludes bot messages + counts them separately", () => {
    const msgs = [
      makeMessage("u1", "Alice", 1),
      makeMessage("bot1", "Aionima", 1, true),
      makeMessage("bot1", "Aionima", 2, true),
    ];
    const out = aggregateChannelStats("c1", 7, msgs);
    expect(out.messageCount).toBe(1);
    expect(out.uniqueAuthors).toBe(1);
    expect(out.botMessagesExcluded).toBe(2);
  });

  it("ranks topAuthors by messageCount desc, ties broken by name", () => {
    const msgs = [
      makeMessage("u1", "Alice", 1),
      makeMessage("u1", "Alice", 1),
      makeMessage("u1", "Alice", 1),
      makeMessage("u2", "Bob", 1),
      makeMessage("u2", "Bob", 1),
      makeMessage("u3", "Carol", 1),
      makeMessage("u4", "Charlie", 1),
      makeMessage("u4", "Charlie", 1),
      makeMessage("u4", "Charlie", 1),
    ];
    const out = aggregateChannelStats("c1", 7, msgs);
    expect(out.topAuthors.map((a) => a.authorName)).toEqual(["Alice", "Charlie", "Bob", "Carol"]);
  });

  it("caps topAuthors at 5", () => {
    const msgs = ["u1", "u2", "u3", "u4", "u5", "u6", "u7"].map((id, i) => makeMessage(id, `User ${String(i)}`, 1));
    const out = aggregateChannelStats("c1", 7, msgs);
    expect(out.topAuthors.length).toBe(5);
    expect(out.uniqueAuthors).toBe(7);
  });

  it("populates dayRange string (last N day(s))", () => {
    expect(aggregateChannelStats("c1", 1, []).dayRange).toBe("last 1 day");
    expect(aggregateChannelStats("c1", 7, []).dayRange).toBe("last 7 days");
    expect(aggregateChannelStats("c1", 30, []).dayRange).toBe("last 30 days");
  });

  it("first/lastMessageAt reflect window-filtered messages", () => {
    const msgs = [
      makeMessage("u1", "Alice", 0.1),
      makeMessage("u1", "Alice", 6),
      makeMessage("u1", "Alice", 100),
    ];
    const out = aggregateChannelStats("c1", 7, msgs);
    expect(out.firstMessageAt).not.toBeNull();
    expect(out.lastMessageAt).not.toBeNull();
    const diffMs = new Date(out.lastMessageAt!).getTime() - new Date(out.firstMessageAt!).getTime();
    expect(diffMs).toBeGreaterThan(5 * 24 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThan(7 * 24 * 60 * 60 * 1000);
  });
});

describe("filterAvailableRooms", () => {
  const sample: RoomForFilter[] = [
    { channelId: "discord", roomId: "g1:c1", label: "general", kind: "channel", privacy: "public", group: "Aionima HQ" },
    { channelId: "discord", roomId: "g1:c2", label: "dev/backend", kind: "channel", privacy: "public", group: "Aionima HQ", parent: "dev" },
    { channelId: "discord", roomId: "g1:c3", label: "dev/frontend", kind: "channel", privacy: "public", group: "Aionima HQ", parent: "dev" },
    { channelId: "discord", roomId: "g2:c1", label: "lobby", kind: "channel", privacy: "public", group: "Civicognita" },
  ];

  it("returns all rooms when no filter passed", () => {
    expect(filterAvailableRooms(sample, {}).length).toBe(4);
  });

  it("matches query substring (case-insensitive)", () => {
    expect(filterAvailableRooms(sample, { query: "DEV" }).map((r) => r.roomId)).toEqual(["g1:c2", "g1:c3"]);
  });

  it("tolerates leading '#' in query", () => {
    expect(filterAvailableRooms(sample, { query: "#general" }).map((r) => r.roomId)).toEqual(["g1:c1"]);
  });

  it("matches against group name", () => {
    expect(filterAvailableRooms(sample, { query: "civic" }).map((r) => r.roomId)).toEqual(["g2:c1"]);
  });

  it("restricts to a single group when `group` passed", () => {
    expect(filterAvailableRooms(sample, { group: "Civicognita" }).map((r) => r.roomId)).toEqual(["g2:c1"]);
  });

  it("combines group + query (AND)", () => {
    expect(filterAvailableRooms(sample, { group: "Aionima HQ", query: "dev" }).map((r) => r.roomId)).toEqual(["g1:c2", "g1:c3"]);
  });

  it("returns empty when query matches nothing", () => {
    expect(filterAvailableRooms(sample, { query: "nonexistent" })).toEqual([]);
  });

  it("ignores whitespace-only query/group", () => {
    expect(filterAvailableRooms(sample, { query: "   ", group: "   " }).length).toBe(4);
  });
});
