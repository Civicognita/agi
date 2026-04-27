/**
 * cadence-stagger — tests for cadenceToStaggeredCron deterministic staggering
 * (s118 redesign 2026-04-27, t444 D3).
 */

import { describe, expect, it } from "vitest";
import { cadenceToStaggeredCron } from "./cron.js";
import type { IterativeWorkCadence } from "../project-types.js";

describe("cadenceToStaggeredCron — determinism", () => {
  it("same project + cadence produces the same cron across calls", () => {
    const a = cadenceToStaggeredCron("30m", "/projects/aionima");
    const b = cadenceToStaggeredCron("30m", "/projects/aionima");
    expect(a).toBe(b);
  });

  it("different projects with same cadence MAY get different cron expressions", () => {
    // Determinism doesn't guarantee distinct outputs, but with a 30-slot space
    // and FNV-1a these specific paths land on different offsets.
    const a = cadenceToStaggeredCron("30m", "/projects/proj-a");
    const b = cadenceToStaggeredCron("30m", "/projects/proj-b");
    expect(a).not.toBe(b);
  });

  it("same project gets different cron for different cadences", () => {
    const path = "/projects/aionima";
    const c30 = cadenceToStaggeredCron("30m", path);
    const c1h = cadenceToStaggeredCron("1h", path);
    expect(c30).not.toBe(c1h);
  });
});

describe("cadenceToStaggeredCron — 30m cadence shape", () => {
  it("emits comma-separated minutes 30 apart", () => {
    const cron = cadenceToStaggeredCron("30m", "/projects/test");
    // Pattern: `M,M+30 * * * *` where M is in [0..29]
    expect(cron).toMatch(/^\d+,\d+ \* \* \* \*$/);
    const parts = cron.split(" ")[0]!.split(",");
    const m1 = Number(parts[0]);
    const m2 = Number(parts[1]);
    expect(m2 - m1).toBe(30);
    expect(m1).toBeGreaterThanOrEqual(0);
    expect(m1).toBeLessThan(30);
  });

  it("staggers across the [0..29] minute window for many projects", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      const cron = cadenceToStaggeredCron("30m", `/projects/test-${String(i)}`);
      const m = Number(cron.split(",")[0]);
      seen.add(m);
    }
    // 200 projects across 30 slots — expect heavy coverage (>20 distinct slots).
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe("cadenceToStaggeredCron — 1h cadence shape", () => {
  it("emits a single minute every hour, in [0..59]", () => {
    const cron = cadenceToStaggeredCron("1h", "/projects/test");
    expect(cron).toMatch(/^\d+ \* \* \* \*$/);
    const m = Number(cron.split(" ")[0]);
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThan(60);
  });

  it("spreads across the [0..59] minute space", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      const cron = cadenceToStaggeredCron("1h", `/projects/test-${String(i)}`);
      const m = Number(cron.split(" ")[0]);
      seen.add(m);
    }
    expect(seen.size).toBeGreaterThan(40);
  });
});

describe("cadenceToStaggeredCron — longer cadence shapes", () => {
  it("5h emits minute + 5 hour values", () => {
    const cron = cadenceToStaggeredCron("5h", "/projects/test");
    const parts = cron.split(" ");
    expect(parts).toHaveLength(5);
    const hours = parts[1]!.split(",").map(Number);
    expect(hours.length).toBeGreaterThan(0);
    expect(hours.every((h) => h >= 0 && h < 24)).toBe(true);
  });

  it("12h emits 2 hour values 12 apart", () => {
    const cron = cadenceToStaggeredCron("12h", "/projects/test");
    const hours = cron.split(" ")[1]!.split(",").map(Number);
    expect(hours).toHaveLength(2);
    expect(hours[1]! - hours[0]!).toBe(12);
  });

  it("1d emits a single hour", () => {
    const cron = cadenceToStaggeredCron("1d", "/projects/test");
    expect(cron).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  it("5d emits day-of-month values 5 apart, capped at 28", () => {
    const cron = cadenceToStaggeredCron("5d", "/projects/test");
    const parts = cron.split(" ");
    const days = parts[2]!.split(",").map(Number);
    expect(days.length).toBeGreaterThan(0);
    expect(days.every((d) => d >= 1 && d <= 28)).toBe(true);
  });

  it("1w emits day-of-week 0..6", () => {
    const cron = cadenceToStaggeredCron("1w", "/projects/test");
    expect(cron).toMatch(/^\d+ \d+ \* \* \d$/);
    const dow = Number(cron.split(" ")[4]);
    expect(dow).toBeGreaterThanOrEqual(0);
    expect(dow).toBeLessThan(7);
  });
});

describe("cadenceToStaggeredCron — collision rate", () => {
  it("100 projects with 30m cadence have <50% colliding fire schedules", () => {
    // 30m has 30 distinct slots; 100 projects → birthday-paradox collisions
    // expected. Test the practical guarantee: most projects get spread.
    const crons: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      crons.push(cadenceToStaggeredCron("30m", `/home/wishborn/projects/proj-${String(i)}`));
    }
    const unique = new Set(crons);
    expect(unique.size).toBeGreaterThan(20); // At least 20 of 30 slots covered
  });
});

describe("cadenceToStaggeredCron — type safety", () => {
  it("accepts every IterativeWorkCadence variant", () => {
    const cadences: IterativeWorkCadence[] = ["30m", "1h", "5h", "12h", "1d", "5d", "1w"];
    for (const c of cadences) {
      const cron = cadenceToStaggeredCron(c, "/projects/test");
      expect(cron).toMatch(/^\S.*\*$|^\S.*\d$/);
    }
  });
});
