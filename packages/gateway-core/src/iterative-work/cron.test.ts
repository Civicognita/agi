import { describe, expect, it } from "vitest";
import { nextFireAfter } from "./cron.js";

describe("nextFireAfter", () => {
  it("returns next minute for a single-minute expression on next hour", () => {
    const now = new Date("2026-04-27T05:30:00.000Z");
    const next = nextFireAfter("0 * * * *", now);
    expect(next).toEqual(new Date("2026-04-27T06:00:00.000Z"));
  });

  it("returns nearest matching minute within the same hour", () => {
    const now = new Date("2026-04-27T05:10:00.000Z");
    const next = nextFireAfter("8,38 * * * *", now);
    expect(next).toEqual(new Date("2026-04-27T05:38:00.000Z"));
  });

  it("rolls over to next hour when no minutes remain in current", () => {
    const now = new Date("2026-04-27T05:45:00.000Z");
    const next = nextFireAfter("8,38 * * * *", now);
    expect(next).toEqual(new Date("2026-04-27T06:08:00.000Z"));
  });

  it("supports * /N step expressions", () => {
    const now = new Date("2026-04-27T05:07:00.000Z");
    const next = nextFireAfter("*/15 * * * *", now);
    expect(next).toEqual(new Date("2026-04-27T05:15:00.000Z"));
  });

  it("treats current minute as in-the-past — fire is strictly after `after`", () => {
    const now = new Date("2026-04-27T05:08:00.000Z");
    const next = nextFireAfter("8,38 * * * *", now);
    expect(next).toEqual(new Date("2026-04-27T05:38:00.000Z"));
  });

  it("returns null for unsupported syntax (hour ranges, day-of-week)", () => {
    expect(nextFireAfter("0 9-17 * * *", new Date())).toBeNull();
    expect(nextFireAfter("0 0 * * 1", new Date())).toBeNull();
    expect(nextFireAfter("0 0 1 * *", new Date())).toBeNull();
  });

  it("returns null for malformed expressions", () => {
    expect(nextFireAfter("", new Date())).toBeNull();
    expect(nextFireAfter("not-a-cron", new Date())).toBeNull();
    expect(nextFireAfter("60 * * * *", new Date())).toBeNull();
    expect(nextFireAfter("-1 * * * *", new Date())).toBeNull();
    expect(nextFireAfter("*/0 * * * *", new Date())).toBeNull();
    expect(nextFireAfter("8,abc * * * *", new Date())).toBeNull();
    expect(nextFireAfter("8 * *", new Date())).toBeNull();
  });

  it("supports * (every minute) — returns next minute boundary", () => {
    const now = new Date("2026-04-27T05:30:15.000Z");
    const next = nextFireAfter("* * * * *", now);
    expect(next).toEqual(new Date("2026-04-27T05:31:00.000Z"));
  });
});
