/**
 * Pure unit tests for epochMsToIso — the createdAt serialization used by
 * GET /api/memory/events. No DB / test-VM required.
 *
 * Regression: memory_events.created_at is a Unix-ms bigint. The endpoint used to
 * emit `String(e.createdAt)` (e.g. "1719792000000"). The dashboard renders it via
 * `new Date(str)`, which parses ISO-8601 but NOT a numeric string, so every row
 * showed "Invalid Date". epochMsToIso must emit an ISO string that `new Date()`
 * round-trips.
 */

import { describe, it, expect } from "vitest";
import { epochMsToIso } from "./graph-adapter.js";

describe("epochMsToIso", () => {
  it("emits an ISO-8601 string that new Date() parses back to the same instant", () => {
    const ms = Date.UTC(2024, 5, 30, 12, 0, 0); // 2024-06-30T12:00:00Z
    const iso = epochMsToIso(ms);
    expect(iso).toBe("2024-06-30T12:00:00.000Z");
    expect(new Date(iso).getTime()).toBe(ms); // round-trips
  });

  it("produces a value new Date() can parse (guards the 'Invalid Date' regression)", () => {
    const ms = 1719792000000;
    const iso = epochMsToIso(ms);
    // The dashboard does `new Date(ev.createdAt)`. Must NOT be Invalid Date.
    expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
    // ...whereas the old `String(ms)` form is exactly what broke the UI:
    expect(Number.isNaN(new Date(String(ms)).getTime())).toBe(true);
  });

  it("falls back to the Unix epoch for a non-finite value rather than emitting Invalid Date", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const iso = epochMsToIso(bad);
      expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
      expect(iso).toBe("1970-01-01T00:00:00.000Z");
    }
  });

  it("handles the Unix epoch (0) itself", () => {
    expect(epochMsToIso(0)).toBe("1970-01-01T00:00:00.000Z");
  });
});
