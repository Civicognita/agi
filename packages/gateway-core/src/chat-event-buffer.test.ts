/**
 * ChatEventBuffer tests — the per-session ring buffer powering chat:resume.
 */

import { describe, it, expect } from "vitest";
import { ChatEventBuffer } from "./chat-event-buffer.js";

describe("ChatEventBuffer", () => {
  it("assigns monotonic seq numbers per session", () => {
    const buf = new ChatEventBuffer();
    const a = buf.record("s1", "chat:thinking", { foo: 1 });
    const b = buf.record("s1", "chat:thought", { foo: 2 });
    const c = buf.record("s1", "chat:tool_start", { foo: 3 });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(c.seq).toBe(3);
  });

  it("seq numbers are independent per session", () => {
    const buf = new ChatEventBuffer();
    expect(buf.record("s1", "t", {}).seq).toBe(1);
    expect(buf.record("s2", "t", {}).seq).toBe(1);
    expect(buf.record("s1", "t", {}).seq).toBe(2);
    expect(buf.record("s2", "t", {}).seq).toBe(2);
  });

  it("since(sessionId, lastSeq) returns events newer than lastSeq", () => {
    const buf = new ChatEventBuffer();
    buf.record("s1", "a", {});
    buf.record("s1", "b", {});
    buf.record("s1", "c", {});
    buf.record("s1", "d", {});
    buf.record("s1", "e", {});
    const res = buf.since("s1", 2);
    expect(res.missed).toBe(false);
    expect(res.events.map((e) => e.type)).toEqual(["c", "d", "e"]);
    expect(res.currentSeq).toBe(5);
  });

  it("since(sessionId, currentSeq) returns empty (client is caught up)", () => {
    const buf = new ChatEventBuffer();
    buf.record("s1", "a", {});
    buf.record("s1", "b", {});
    const res = buf.since("s1", 2);
    expect(res.missed).toBe(false);
    expect(res.events).toEqual([]);
    expect(res.currentSeq).toBe(2);
  });

  it("since(unknownSession, _) returns missed:true", () => {
    const buf = new ChatEventBuffer();
    const res = buf.since("never-seen", 0);
    expect(res.missed).toBe(true);
    expect(res.events).toEqual([]);
  });

  it("since(sessionId, lastSeq) with lastSeq=0 returns everything in the buffer", () => {
    const buf = new ChatEventBuffer();
    buf.record("s1", "a", {});
    buf.record("s1", "b", {});
    const res = buf.since("s1", 0);
    expect(res.missed).toBe(false);
    expect(res.events.map((e) => e.type)).toEqual(["a", "b"]);
  });

  it("ring-buffer evicts events older than TTL", () => {
    let now = 1_000_000;
    const buf = new ChatEventBuffer({ now: () => now });
    buf.record("s1", "ancient", {});
    now += 6 * 60 * 1000; // 6 minutes later — past the 5-minute TTL
    buf.record("s1", "fresh", {});
    expect(buf.sizeOf("s1")).toBe(1);
    const res = buf.since("s1", 0);
    expect(res.events.map((e) => e.type)).toEqual(["fresh"]);
  });

  it("ring-buffer evicts by size when more than 500 events are recorded", () => {
    const buf = new ChatEventBuffer();
    for (let i = 0; i < 600; i++) {
      buf.record("s1", `e${String(i)}`, { i });
    }
    expect(buf.sizeOf("s1")).toBe(500);
    // Oldest 100 are gone
    const res = buf.since("s1", 0);
    expect(res.events).toHaveLength(500);
    expect(res.events[0]!.type).toBe("e100");
    expect(res.events.at(-1)!.type).toBe("e599");
  });

  it("drop(sessionId) forgets the session entirely", () => {
    const buf = new ChatEventBuffer();
    buf.record("s1", "a", {});
    expect(buf.since("s1", 0).missed).toBe(false);
    buf.drop("s1");
    expect(buf.since("s1", 0).missed).toBe(true);
  });

  it("record returns the enriched event with the assigned seq", () => {
    const buf = new ChatEventBuffer();
    const ev = buf.record("s1", "chat:thinking", { foo: "bar" });
    expect(ev.seq).toBe(1);
    expect(ev.type).toBe("chat:thinking");
    expect(ev.payload).toEqual({ foo: "bar" });
    expect(typeof ev.ts).toBe("number");
  });
});
