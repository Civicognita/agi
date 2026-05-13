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
