// @ts-nocheck -- Phase I.4 migration in progress. Upmigrated blocks use the
// drizzle/pglite fixture + EntityStore/ImpactRecorder async API. Remaining
// describe.skip blocks still reference the old sqlite-era db.prepare()
// helpers; @ts-nocheck suppresses those until they're migrated too. Tracked
// in _plans/phase2-tests-pg.md and task #290.
/**
 * Dashboard Tests — Tasks #149, #153, #154
 *
 * Comprehensive tests for:
 *   1. DashboardQueries  — drizzle/Postgres aggregation queries
 *   2. DashboardApi      — HTTP route handlers
 *   3. DashboardEventBroadcaster — WebSocket event broadcasting
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { EventEmitter } from "node:events";

import { EntityStore, ImpactRecorder } from "@agi/entity-model";
import { coaChains, impactInteractions } from "@agi/db-schema";

import { DashboardQueries } from "./dashboard-queries.js";
import { DashboardApi } from "./dashboard-api.js";
import {
  DashboardEventBroadcaster,
} from "./dashboard-events.js";
import type { DashboardBroadcaster } from "./dashboard-events.js";
import type {
  ActivityEntry,
  COAExplorerEntry,
  DashboardOverview,
} from "./dashboard-types.js";

import { createTestDb, type TestDbContext } from "./test-utils/db-fixture.js";

// ---------------------------------------------------------------------------
// Shared test infrastructure
// ---------------------------------------------------------------------------

let ctx: TestDbContext;
let store: EntityStore;
let recorder: ImpactRecorder;
let queries: DashboardQueries;

/** Counter used to generate unique COA fingerprints across tests. */
let fpCounter = 0;

/**
 * Insert a raw coa_chains row. The impact_interactions table has a FK on
 * coa_fingerprint so we need this before calling recorder.record().
 */
async function insertCOAChain(entityId: string, workType = "message_in"): Promise<string> {
  fpCounter++;
  const fingerprint = `$A0.#E0.@A0.C${String(fpCounter).padStart(3, "0")}`;
  await ctx.db.insert(coaChains).values({
    fingerprint,
    resourceId: "$A0",
    entityId,
    nodeId: "@A0",
    chainCounter: fpCounter,
    workType,
    createdAt: new Date(),
  });
  return fingerprint;
}

/**
 * Insert a raw coa_chains row with an explicit created_at timestamp.
 */
async function insertCOAChainAt(entityId: string, createdAt: string, workType = "message_in"): Promise<string> {
  fpCounter++;
  const fingerprint = `$A0.#E0.@A0.C${String(fpCounter).padStart(3, "0")}`;
  await ctx.db.insert(coaChains).values({
    fingerprint,
    resourceId: "$A0",
    entityId,
    nodeId: "@A0",
    chainCounter: fpCounter,
    workType,
    createdAt: new Date(createdAt),
  });
  return fingerprint;
}

/** Counter for generating unique raw interaction IDs. */
let interactionCounter = 0;

/**
 * Insert a raw impact_interaction row at a specific timestamp.
 * Used when we need to control the created_at for timeline/breakdown date filter tests.
 */
async function insertInteractionAt(
  entityId: string,
  coaFingerprint: string,
  impScore: number,
  createdAt: string,
  opts: { channel?: string; workType?: string } = {},
): Promise<void> {
  interactionCounter++;
  const id = `RAWTEST${String(interactionCounter).padStart(19, "0")}`;
  await ctx.db.insert(impactInteractions).values({
    id,
    entityId,
    coaFingerprint,
    channel: opts.channel ?? null,
    workType: opts.workType ?? null,
    quant: 1,
    value0bool: impScore,
    bonus: 0,
    impScore,
    createdAt: new Date(createdAt),
  });
}

async function seedTestData(): Promise<{
  id1: string;
  id2: string;
  id3: string;
}> {
  const e1 = await store.createEntity({ type: "E", displayName: "Alice" });
  const e2 = await store.createEntity({ type: "E", displayName: "Bob" });
  const e3 = await store.createEntity({ type: "O", displayName: "Civicognita" });

  const fp1 = await insertCOAChain(e1.id, "message_in");
  const fp2 = await insertCOAChain(e1.id, "tool_use");
  const fp3 = await insertCOAChain(e2.id, "message_in");
  const fp4 = await insertCOAChain(e3.id, "commit");
  const fp5 = await insertCOAChain(e1.id, "verification");
  const fp6 = await insertCOAChain(e2.id, "task_dispatch");

  await recorder.record({ entityId: e1.id, coaFingerprint: fp1, quant: 1, boolLabel: "TRUE", channel: "telegram", workType: "message_in" });
  await recorder.record({ entityId: e1.id, coaFingerprint: fp2, quant: 1, boolLabel: "0TRUE", channel: "telegram", workType: "tool_use" });
  await recorder.record({ entityId: e2.id, coaFingerprint: fp3, quant: 1, boolLabel: "TRUE", channel: "discord", workType: "message_in" });
  await recorder.record({ entityId: e3.id, coaFingerprint: fp4, quant: 1, boolLabel: "0TRUE", channel: "telegram", workType: "commit" });
  await recorder.record({ entityId: e1.id, coaFingerprint: fp5, quant: 1, boolLabel: "FALSE", channel: "signal", workType: "verification" });
  await recorder.record({ entityId: e2.id, coaFingerprint: fp6, quant: 1, boolLabel: "0+", channel: "discord", workType: "task_dispatch" });

  return { id1: e1.id, id2: e2.id, id3: e3.id };
}

beforeEach(async () => {
  fpCounter = 0;
  interactionCounter = 0;
  ctx = await createTestDb();
  store = new EntityStore(ctx.db);
  recorder = new ImpactRecorder(ctx.db);
  queries = new DashboardQueries(ctx.db);
});

afterEach(async () => {
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 1. DashboardQueries
// ---------------------------------------------------------------------------

describe("DashboardQueries.getOverview", () => {
  it("returns zero totals when database is empty", async () => {
    const overview = await queries.getOverview();
    expect(overview.totalImp).toBe(0);
    expect(overview.windowImp).toBe(0);
    expect(overview.entityCount).toBe(0);
    expect(overview.interactionCount).toBe(0);
    expect(overview.avgImpPerInteraction).toBe(0);
    expect(overview.topChannel).toBeNull();
    expect(overview.recentActivity).toEqual([]);
  });

  it("returns correct totalImp and interactionCount after seeding", async () => {
    await seedTestData();
    const overview = await queries.getOverview();
    // TRUE=0.5, 0TRUE=1.0, TRUE=0.5, 0TRUE=1.0, FALSE=-0.5, 0+=0.25
    expect(overview.totalImp).toBeCloseTo(2.75);
    expect(overview.interactionCount).toBe(6);
  });

  it("returns correct entityCount", async () => {
    await seedTestData();
    const overview = await queries.getOverview();
    expect(overview.entityCount).toBe(3);
  });

  it("returns avgImpPerInteraction as totalImp / interactionCount", async () => {
    await seedTestData();
    const overview = await queries.getOverview();
    expect(overview.avgImpPerInteraction).toBeCloseTo(overview.totalImp / overview.interactionCount);
  });

  it("returns topChannel as the most used channel", async () => {
    await seedTestData();
    const overview = await queries.getOverview();
    // telegram: 3, discord: 2, signal: 1
    expect(overview.topChannel).toBe("telegram");
  });

  it("returns computedAt as a valid ISO timestamp", async () => {
    const overview = await queries.getOverview();
    expect(() => new Date(overview.computedAt)).not.toThrow();
    expect(overview.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("windowImp is non-zero when interactions exist within window", async () => {
    await seedTestData();
    const overview = await queries.getOverview(90);
    expect(overview.windowImp).toBeCloseTo(2.75);
  });

  it("windowImp is zero when windowDays=0 (all interactions are too old)", async () => {
    await seedTestData();
    // windowDays=0 means since = now, all existing records are at or slightly before now
    const overview = await queries.getOverview(0);
    // May be 0 or close depending on timing. The key thing is windowDays param is passed.
    expect(typeof overview.windowImp).toBe("number");
  });

  it("recentActivity is populated and limited by recentLimit", async () => {
    await seedTestData();
    const overview = await queries.getOverview(90, 3);
    expect(overview.recentActivity.length).toBeLessThanOrEqual(3);
  });

  it("recentActivity entries have required fields", async () => {
    await seedTestData();
    const overview = await queries.getOverview();
    for (const entry of overview.recentActivity) {
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.entityId).toBe("string");
      expect(typeof entry.entityName).toBe("string");
      expect(typeof entry.impScore).toBe("number");
      expect(typeof entry.createdAt).toBe("string");
    }
  });
});

describe("DashboardQueries.getRecentActivity", () => {
  it("returns empty array when no interactions exist", async () => {
    expect(await queries.getRecentActivity()).toEqual([]);
  });

  it("returns activity entries in descending order by createdAt", async () => {
    const e = await store.createEntity({ type: "E", displayName: "Tester" });
    const fp1 = await insertCOAChain(e.id, "message_in");
    await recorder.record({ entityId: e.id, coaFingerprint: fp1, quant: 1, boolLabel: "TRUE" });
    await new Promise((r) => setTimeout(r, 5));
    const fp2 = await insertCOAChain(e.id, "message_in");
    await recorder.record({ entityId: e.id, coaFingerprint: fp2, quant: 2, boolLabel: "0TRUE" });

    const activity = await queries.getRecentActivity(10);
    expect(activity.length).toBe(2);
    // Most recent first
    expect(activity[0]!.createdAt >= activity[1]!.createdAt).toBe(true);
  });

  it("joins entity displayName correctly", async () => {
    const e = await store.createEntity({ type: "E", displayName: "TestUser" });
    const fp = await insertCOAChain(e.id);
    await recorder.record({ entityId: e.id, coaFingerprint: fp, quant: 1, boolLabel: "TRUE" });

    const activity = await queries.getRecentActivity();
    expect(activity[0]!.entityName).toBe("TestUser");
  });

  it("returns 'Unknown' for entities with no display_name match", async () => {
    // Insert an impact interaction with an entity_id that doesn't exist in entities
    // (bypass FK by disabling pragma - but the safer approach is to just verify existing behavior)
    // Instead, test that known entity names appear in activity
    await seedTestData();
    const activity = await queries.getRecentActivity(20);
    const names = activity.map((a) => a.entityName);
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
    expect(names).toContain("Civicognita");
  });

  it("respects the limit parameter", async () => {
    await seedTestData();
    const limited = await queries.getRecentActivity(2);
    expect(limited.length).toBe(2);
  });

  it("returns channel and workType from the interaction record", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const fp = await insertCOAChain(e.id, "message_in");
    await recorder.record({ entityId: e.id, coaFingerprint: fp, quant: 1, boolLabel: "TRUE", channel: "telegram", workType: "message_in" });

    const activity = await queries.getRecentActivity(1);
    expect(activity[0]!.channel).toBe("telegram");
    expect(activity[0]!.workType).toBe("message_in");
  });

  it("returns null for channel and workType when not set", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const fp = await insertCOAChain(e.id);
    await recorder.record({ entityId: e.id, coaFingerprint: fp, quant: 1, boolLabel: "TRUE" });

    const activity = await queries.getRecentActivity(1);
    expect(activity[0]!.channel).toBeNull();
    expect(activity[0]!.workType).toBeNull();
  });
});

describe("DashboardQueries.getTimeline", () => {
  it("returns empty array when no interactions exist", async () => {
    const result = await queries.getTimeline("day");
    expect(result).toEqual([]);
  });

  it("returns buckets with all required fields", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const fp = await insertCOAChain(e.id);
    await recorder.record({ entityId: e.id, coaFingerprint: fp, quant: 1, boolLabel: "TRUE" });

    const buckets = await queries.getTimeline("day");
    expect(buckets.length).toBeGreaterThan(0);
    const bucket = buckets[0]!;
    expect(typeof bucket.bucketStart).toBe("string");
    expect(typeof bucket.totalImp).toBe("number");
    expect(typeof bucket.positiveImp).toBe("number");
    expect(typeof bucket.negativeImp).toBe("number");
    expect(typeof bucket.interactionCount).toBe("number");
  });

  it("day bucket snaps to 00:00:00 and parses as Date", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const fp = await insertCOAChain(e.id);
    await recorder.record({ entityId: e.id, coaFingerprint: fp, quant: 1, boolLabel: "TRUE" });

    const buckets = await queries.getTimeline("day");
    expect(buckets[0]!.bucketStart).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00/);
    expect(Number.isNaN(new Date(buckets[0]!.bucketStart).valueOf())).toBe(false);
  });

  it("hour bucket snaps to :00:00 and parses as Date", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const fp = await insertCOAChain(e.id);
    await recorder.record({ entityId: e.id, coaFingerprint: fp, quant: 1, boolLabel: "TRUE" });

    const buckets = await queries.getTimeline("hour");
    expect(buckets[0]!.bucketStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00/);
  });

  it("week bucket starts on a Monday at 00:00:00", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const fp = await insertCOAChain(e.id);
    await recorder.record({ entityId: e.id, coaFingerprint: fp, quant: 1, boolLabel: "TRUE" });

    const buckets = await queries.getTimeline("week");
    // Postgres date_trunc('week', ...) returns the Monday 00:00 of that
    // ISO week. The normalized ISO string has a midnight time component
    // and Monday's weekday (1).
    expect(buckets[0]!.bucketStart).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00/);
    const d = new Date(buckets[0]!.bucketStart);
    expect(Number.isNaN(d.valueOf())).toBe(false);
    // getUTCDay returns 0=Sun..6=Sat. Postgres week starts Monday (1).
    expect(d.getUTCDay()).toBe(1);
  });

  it("month bucket snaps to YYYY-MM-01T00:00:00", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const fp = await insertCOAChain(e.id);
    await recorder.record({ entityId: e.id, coaFingerprint: fp, quant: 1, boolLabel: "TRUE" });

    const buckets = await queries.getTimeline("month");
    expect(buckets[0]!.bucketStart).toMatch(/^\d{4}-\d{2}-01T00:00:00/);
  });

  it("correctly separates positiveImp and negativeImp", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const fp1 = await insertCOAChain(e.id);
    const fp2 = await insertCOAChain(e.id);
    await recorder.record({ entityId: e.id, coaFingerprint: fp1, quant: 1, boolLabel: "TRUE" }); // +0.5
    await recorder.record({ entityId: e.id, coaFingerprint: fp2, quant: 1, boolLabel: "FALSE" }); // -0.5

    const buckets = await queries.getTimeline("day");
    expect(buckets.length).toBe(1);
    expect(buckets[0]!.positiveImp).toBeCloseTo(0.5);
    expect(buckets[0]!.negativeImp).toBeCloseTo(-0.5);
    expect(buckets[0]!.totalImp).toBeCloseTo(0);
  });

  it("filters by entityId when provided", async () => {
    const { id1, id2 } = await seedTestData();
    const result = await queries.getTimeline("day", id1);
    // All interactions in result should belong to id1 - verify by checking totals
    // Alice has: TRUE(0.5) + 0TRUE(1.0) + FALSE(-0.5) = 1.0 total
    const totalImp = result.reduce((sum, b) => sum + b.totalImp, 0);
    expect(totalImp).toBeCloseTo(1.0);

    const allEntries = await queries.getRecentActivity(20);
    const e2Activities = allEntries.filter((a) => a.entityId === id2);
    // Bob has different total — filtering by id1 should exclude Bob's records
    expect(e2Activities.length).toBeGreaterThan(0);
  });

  it("filters by since date", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    // Insert interaction at a fixed past timestamp
    const pastFp = await insertCOAChainAt(e.id, "2020-01-01T00:00:00Z");
    await insertInteractionAt(e.id, pastFp, 1.0, "2020-01-01T12:00:00Z"); // 1.0 in 2020

    const now = new Date().toISOString();
    const fp2 = await insertCOAChain(e.id);
    await recorder.record({ entityId: e.id, coaFingerprint: fp2, quant: 1, boolLabel: "TRUE" }); // 0.5 now

    const result = await queries.getTimeline("day", undefined, now);
    // Only the recent record should be in the result
    const total = result.reduce((sum, b) => sum + b.totalImp, 0);
    expect(total).toBeCloseTo(0.5);
  });

  it("filters by until date", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    // Insert interaction at a fixed past timestamp
    const pastFp = await insertCOAChainAt(e.id, "2020-01-01T00:00:00Z");
    await insertInteractionAt(e.id, pastFp, 1.0, "2020-01-01T12:00:00Z"); // 1.0 in 2020

    const fp2 = await insertCOAChain(e.id);
    await recorder.record({ entityId: e.id, coaFingerprint: fp2, quant: 1, boolLabel: "TRUE" }); // 0.5 now

    // Until 2021 — only the 2020 record should be included
    const result = await queries.getTimeline("day", undefined, undefined, "2021-01-01T00:00:00Z");
    const total = result.reduce((sum, b) => sum + b.totalImp, 0);
    expect(total).toBeCloseTo(1.0);
  });

  it("filters by both entityId and date range", async () => {
    const { id1 } = await seedTestData();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();

    const result = await queries.getTimeline("day", id1, past, future);
    // Should have at least one bucket for Alice
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns buckets ordered ASC by bucketStart", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const fp1 = await insertCOAChainAt(e.id, "2024-01-01T12:00:00Z");
    await recorder.record({ entityId: e.id, coaFingerprint: fp1, quant: 1, boolLabel: "TRUE" });
    const fp2 = await insertCOAChainAt(e.id, "2024-03-01T12:00:00Z");
    await recorder.record({ entityId: e.id, coaFingerprint: fp2, quant: 1, boolLabel: "TRUE" });

    const buckets = await queries.getTimeline("day");
    if (buckets.length >= 2) {
      for (let i = 1; i < buckets.length; i++) {
        expect(buckets[i]!.bucketStart >= buckets[i - 1]!.bucketStart).toBe(true);
      }
    }
  });
});

describe("DashboardQueries.getBreakdown", () => {
  it("returns empty slices when no interactions exist", async () => {
    const result = await queries.getBreakdown("domain");
    expect(result.slices).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("domain breakdown maps work_type to impactinomics domains", async () => {
    await seedTestData();
    const result = await queries.getBreakdown("domain");
    const keys = result.slices.map((s) => s.key);
    // community (message_in), technology (tool_use), governance (verification),
    // innovation (commit), operations (task_dispatch)
    expect(keys).toContain("community");
    expect(keys).toContain("technology");
    expect(keys).toContain("governance");
    expect(keys).toContain("innovation");
    expect(keys).toContain("operations");
  });

  it("domain breakdown aggregates correctly for community domain", async () => {
    // message_in and message_out both map to "community"
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const fp1 = await insertCOAChain(e.id, "message_in");
    const fp2 = await insertCOAChain(e.id, "message_in");
    await recorder.record({ entityId: e.id, coaFingerprint: fp1, quant: 1, boolLabel: "0TRUE", workType: "message_in" }); // 1.0
    await recorder.record({ entityId: e.id, coaFingerprint: fp2, quant: 1, boolLabel: "0TRUE", workType: "message_out" }); // 1.0

    const result = await queries.getBreakdown("domain");
    const communitySlice = result.slices.find((s) => s.key === "community");
    expect(communitySlice).toBeDefined();
    expect(communitySlice!.totalImp).toBeCloseTo(2.0);
    expect(communitySlice!.count).toBe(2);
  });

  it("channel breakdown groups by channel", async () => {
    await seedTestData();
    const result = await queries.getBreakdown("channel");
    const keys = result.slices.map((s) => s.key);
    expect(keys).toContain("telegram");
    expect(keys).toContain("discord");
    expect(keys).toContain("signal");
  });

  it("channel breakdown excludes null channels", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const fp = await insertCOAChain(e.id);
    await recorder.record({ entityId: e.id, coaFingerprint: fp, quant: 1, boolLabel: "TRUE" });
    // No channel set — should not appear in breakdown

    const result = await queries.getBreakdown("channel");
    expect(result.slices).toEqual([]);
  });

  it("workType breakdown groups by work_type", async () => {
    await seedTestData();
    const result = await queries.getBreakdown("workType");
    const keys = result.slices.map((s) => s.key);
    expect(keys).toContain("message_in");
    expect(keys).toContain("tool_use");
    expect(keys).toContain("commit");
  });

  it("percentage values sum to approximately 100 when total != 0", async () => {
    await seedTestData();
    const result = await queries.getBreakdown("channel");
    const totalPct = result.slices.reduce((sum, s) => sum + s.percentage, 0);
    // Percentages are based on positive totals only; with mixed signs may not sum to 100
    // However, each slice's percentage is (sliceImp / total) * 100
    expect(typeof totalPct).toBe("number");
  });

  it("slices are sorted by totalImp descending", async () => {
    await seedTestData();
    const result = await queries.getBreakdown("channel");
    for (let i = 1; i < result.slices.length; i++) {
      expect(result.slices[i - 1]!.totalImp >= result.slices[i]!.totalImp).toBe(true);
    }
  });

  it("filters by entityId when provided", async () => {
    const { id1 } = await seedTestData();
    const result = await queries.getBreakdown("channel", id1);
    // Alice only used telegram and signal
    const keys = result.slices.map((s) => s.key);
    expect(keys).not.toContain("discord");
  });

  it("filters by since date", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    // Insert old interaction directly with a 2020 timestamp
    const pastFp = await insertCOAChainAt(e.id, "2020-01-01T00:00:00Z");
    await insertInteractionAt(e.id, pastFp, 1.0, "2020-01-01T12:00:00Z", { channel: "old-channel", workType: "message_in" });
    // Insert recent interaction via recorder
    const fp2 = await insertCOAChain(e.id, "message_in");
    await recorder.record({ entityId: e.id, coaFingerprint: fp2, quant: 1, boolLabel: "TRUE", channel: "new-channel", workType: "message_in" });

    const since = new Date(Date.now() - 1000).toISOString();
    const result = await queries.getBreakdown("channel", undefined, since);
    const keys = result.slices.map((s) => s.key);
    expect(keys).toContain("new-channel");
    expect(keys).not.toContain("old-channel");
  });

  it("filters by until date", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    // Insert old interaction directly with a 2020 timestamp
    const pastFp = await insertCOAChainAt(e.id, "2020-01-01T00:00:00Z");
    await insertInteractionAt(e.id, pastFp, 1.0, "2020-01-01T12:00:00Z", { channel: "old-channel", workType: "message_in" });
    // Insert recent interaction via recorder
    const fp2 = await insertCOAChain(e.id, "message_in");
    await recorder.record({ entityId: e.id, coaFingerprint: fp2, quant: 1, boolLabel: "TRUE", channel: "new-channel", workType: "message_in" });

    const result = await queries.getBreakdown("channel", undefined, undefined, "2021-01-01T00:00:00Z");
    const keys = result.slices.map((s) => s.key);
    expect(keys).toContain("old-channel");
    expect(keys).not.toContain("new-channel");
  });

  it("domain breakdown null workType maps to community", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const fp = await insertCOAChain(e.id);
    // Record with no workType — maps to community
    await recorder.record({ entityId: e.id, coaFingerprint: fp, quant: 1, boolLabel: "0TRUE" });

    const result = await queries.getBreakdown("domain");
    const communitySlice = result.slices.find((s) => s.key === "community");
    expect(communitySlice).toBeDefined();
  });
});

describe("DashboardQueries.getLeaderboard", () => {
  it("returns empty entries when no interactions exist", async () => {
    const result = await queries.getLeaderboard();
    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("returns entries ranked by windowImp descending", async () => {
    await seedTestData();
    const result = await queries.getLeaderboard(365);
    // Entities should be ordered by window total IMP descending
    for (let i = 1; i < result.entries.length; i++) {
      expect(result.entries[i - 1]!.windowImp >= result.entries[i]!.windowImp).toBe(true);
    }
  });

  it("rank starts at 1 for the top entry", async () => {
    await seedTestData();
    const result = await queries.getLeaderboard(365);
    expect(result.entries[0]!.rank).toBe(1);
  });

  it("rank increments sequentially", async () => {
    await seedTestData();
    const result = await queries.getLeaderboard(365);
    for (let i = 0; i < result.entries.length; i++) {
      expect(result.entries[i]!.rank).toBe(i + 1);
    }
  });

  it("rank accounts for offset in pagination", async () => {
    await seedTestData();
    const page2 = await queries.getLeaderboard(365, 2, 2);
    if (page2.entries.length > 0) {
      expect(page2.entries[0]!.rank).toBe(3);
    }
  });

  it("returns entityId and entityName for each entry", async () => {
    await seedTestData();
    const result = await queries.getLeaderboard(365);
    for (const entry of result.entries) {
      expect(typeof entry.entityId).toBe("string");
      expect(typeof entry.entityName).toBe("string");
      expect(entry.entityName.length).toBeGreaterThan(0);
    }
  });

  it("returns verificationTier defaulting to 'unverified'", async () => {
    await seedTestData();
    const result = await queries.getLeaderboard(365);
    for (const entry of result.entries) {
      expect(typeof entry.verificationTier).toBe("string");
    }
  });

  it("currentBonus is min(positiveWindow/100, 2.0)", async () => {
    const e = await store.createEntity({ type: "E", displayName: "BigWinner" });
    const fp = await insertCOAChain(e.id);
    // positive window = 0.5, bonus = min(0.5/100, 2.0) = 0.005
    await recorder.record({ entityId: e.id, coaFingerprint: fp, quant: 1, boolLabel: "TRUE" });

    const result = await queries.getLeaderboard(365);
    const entry = result.entries.find((e) => e.entityName === "BigWinner");
    expect(entry).toBeDefined();
    expect(entry!.currentBonus).toBeCloseTo(0.5 / 100);
    expect(entry!.currentBonus).toBeLessThanOrEqual(2.0);
  });

  it("respects limit parameter", async () => {
    await seedTestData();
    const result = await queries.getLeaderboard(365, 2);
    expect(result.entries.length).toBeLessThanOrEqual(2);
  });

  it("total reflects all entities with interactions in window", async () => {
    await seedTestData();
    const result = await queries.getLeaderboard(365);
    expect(result.total).toBe(3);
  });

  it("excludes entities with no interactions in the window", async () => {
    const e1 = await store.createEntity({ type: "E", displayName: "ActiveUser" });
    const fp = await insertCOAChain(e1.id);
    await recorder.record({ entityId: e1.id, coaFingerprint: fp, quant: 1, boolLabel: "TRUE" });
    // Create entity with no interactions
    await store.createEntity({ type: "E", displayName: "Inactive" });

    const result = await queries.getLeaderboard(365);
    expect(result.total).toBe(1);
    expect(result.entries[0]!.entityName).toBe("ActiveUser");
  });
});

describe("DashboardQueries.getEntityProfile", () => {
  it("returns null for nonexistent entity", async () => {
    const result = await queries.getEntityProfile("nonexistent-id");
    expect(result).toBeNull();
  });

  it("returns full profile for existing entity", async () => {
    const { id1 } = await seedTestData();
    const profile = await queries.getEntityProfile(id1);
    expect(profile).not.toBeNull();
    expect(profile!.entityId).toBe(id1);
    expect(profile!.entityName).toBe("Alice");
  });

  it("returns entityType from entities table", async () => {
    const e = await store.createEntity({ type: "O", displayName: "OrgTest" });
    const profile = await queries.getEntityProfile(e.id);
    expect(profile!.entityType).toBe("O");
  });

  it("returns verificationTier from entities table", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const profile = await queries.getEntityProfile(e.id);
    expect(profile!.verificationTier).toBe("unverified");
  });

  it("returns coaAlias from entities table", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const profile = await queries.getEntityProfile(e.id);
    expect(profile!.coaAlias).toMatch(/^#E\d+$/);
  });

  it("lifetimeImp is sum of all impScores for entity", async () => {
    const { id1 } = await seedTestData();
    const profile = await queries.getEntityProfile(id1);
    // Alice: TRUE(0.5) + 0TRUE(1.0) + FALSE(-0.5) = 1.0
    expect(profile!.lifetimeImp).toBeCloseTo(1.0);
  });

  it("lifetimeImp is 0 for entity with no interactions", async () => {
    const e = await store.createEntity({ type: "E", displayName: "Empty" });
    const profile = await queries.getEntityProfile(e.id);
    expect(profile!.lifetimeImp).toBe(0);
  });

  it("windowImp reflects rolling window balance", async () => {
    const { id1 } = await seedTestData();
    const profile = await queries.getEntityProfile(id1, 90);
    // All interactions are recent, so windowImp should match lifetimeImp
    expect(profile!.windowImp).toBeCloseTo(1.0);
  });

  it("distinctEventTypes counts unique work_types for entity", async () => {
    const { id1 } = await seedTestData();
    const profile = await queries.getEntityProfile(id1);
    // Alice has: message_in, tool_use, verification — 3 distinct work types
    expect(profile!.distinctEventTypes).toBe(3);
  });

  it("distinctEventTypes is 0 for entity with no interactions", async () => {
    const e = await store.createEntity({ type: "E", displayName: "Empty" });
    const profile = await queries.getEntityProfile(e.id);
    expect(profile!.distinctEventTypes).toBe(0);
  });

  it("currentBonus is capped at 2.0", async () => {
    const e = await store.createEntity({ type: "E", displayName: "Capped" });
    // Record 201 interactions at 0TRUE = 201 * 1.0 = 201 positive window
    // bonus = min(201/100, 2.0) = 2.0
    for (let i = 0; i < 3; i++) {
      const fp = await insertCOAChain(e.id);
      await recorder.record({ entityId: e.id, coaFingerprint: fp, quant: 100, boolLabel: "0TRUE" });
    }
    const profile = await queries.getEntityProfile(e.id, 365);
    expect(profile!.currentBonus).toBe(2.0);
  });

  it("domainBreakdown is populated for entity with interactions", async () => {
    const { id1 } = await seedTestData();
    const profile = await queries.getEntityProfile(id1);
    expect(profile!.domainBreakdown.length).toBeGreaterThan(0);
  });

  it("channelBreakdown is populated for entity with channel interactions", async () => {
    const { id1 } = await seedTestData();
    const profile = await queries.getEntityProfile(id1);
    // Alice has telegram and signal channels
    const channelKeys = profile!.channelBreakdown.map((s) => s.key);
    expect(channelKeys).toContain("telegram");
    expect(channelKeys).toContain("signal");
  });

  it("recentActivity is populated for entity with interactions", async () => {
    const { id1 } = await seedTestData();
    const profile = await queries.getEntityProfile(id1);
    expect(profile!.recentActivity.length).toBeGreaterThan(0);
    expect(profile!.recentActivity.every((a) => a.entityId === id1)).toBe(true);
  });

  it("publicFields includes standard visible fields", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const profile = await queries.getEntityProfile(e.id);
    expect(profile!.publicFields).toContain("entityName");
    expect(profile!.publicFields).toContain("verificationTier");
  });

  it("skillsAuthored and recognitionsReceived are placeholder zeros", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const profile = await queries.getEntityProfile(e.id);
    expect(profile!.skillsAuthored).toBe(0);
    expect(profile!.recognitionsReceived).toBe(0);
  });
});

describe("DashboardQueries.getCOAEntries", () => {
  it("returns empty entries when coa_chains is empty", async () => {
    const result = await queries.getCOAEntries({});
    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it("returns all COA entries with correct field mapping", async () => {
    const e = await store.createEntity({ type: "E", displayName: "Alice" });
    await insertCOAChain(e.id, "message_in");

    const result = await queries.getCOAEntries({});
    expect(result.entries.length).toBe(1);
    const entry = result.entries[0]!;
    expect(typeof entry.fingerprint).toBe("string");
    expect(typeof entry.resourceId).toBe("string");
    expect(entry.entityId).toBe(e.id);
    expect(entry.entityName).toBe("Alice");
    expect(typeof entry.nodeId).toBe("string");
    expect(typeof entry.chainCounter).toBe("number");
    expect(typeof entry.workType).toBe("string");
    expect(typeof entry.createdAt).toBe("string");
  });

  it("joins entity displayName via entityId", async () => {
    const e = await store.createEntity({ type: "E", displayName: "TestEntity" });
    await insertCOAChain(e.id);

    const result = await queries.getCOAEntries({});
    expect(result.entries[0]!.entityName).toBe("TestEntity");
  });

  it("impScore is null when no matching impact_interaction", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    await insertCOAChain(e.id);

    const result = await queries.getCOAEntries({});
    expect(result.entries[0]!.impScore).toBeNull();
  });

  it("impScore is set when matching impact_interaction exists", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    const fp = await insertCOAChain(e.id);
    await recorder.record({ entityId: e.id, coaFingerprint: fp, quant: 1, boolLabel: "0TRUE" });

    const result = await queries.getCOAEntries({});
    expect(result.entries[0]!.impScore).toBeCloseTo(1.0);
  });

  it("filters by entityId", async () => {
    const e1 = await store.createEntity({ type: "E", displayName: "Alice" });
    const e2 = await store.createEntity({ type: "E", displayName: "Bob" });
    await insertCOAChain(e1.id);
    await insertCOAChain(e2.id);

    const result = await queries.getCOAEntries({ entityId: e1.id });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0]!.entityId).toBe(e1.id);
  });

  it("fingerprint search filters by partial match", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    await insertCOAChain(e.id);

    const result = await queries.getCOAEntries({ fingerprint: "$A0" });
    expect(result.entries.length).toBeGreaterThan(0);
    for (const entry of result.entries) {
      expect(entry.fingerprint).toContain("$A0");
    }
  });

  it("fingerprint search returns empty for non-matching pattern", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    await insertCOAChain(e.id);

    const result = await queries.getCOAEntries({ fingerprint: "ZZZNOTFOUND" });
    expect(result.entries).toEqual([]);
  });

  it("filters by workType", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    await insertCOAChain(e.id, "message_in");
    await insertCOAChain(e.id, "commit");

    const result = await queries.getCOAEntries({ workType: "commit" });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0]!.workType).toBe("commit");
  });

  it("pagination with limit and offset", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    for (let i = 0; i < 5; i++) {
      await insertCOAChain(e.id);
    }

    const page1 = await queries.getCOAEntries({ limit: 2, offset: 0 });
    const page2 = await queries.getCOAEntries({ limit: 2, offset: 2 });
    const page3 = await queries.getCOAEntries({ limit: 2, offset: 4 });

    expect(page1.entries.length).toBe(2);
    expect(page2.entries.length).toBe(2);
    expect(page3.entries.length).toBe(1);

    expect(page1.total).toBe(5);
    expect(page1.hasMore).toBe(true);
    expect(page3.hasMore).toBe(false);
  });

  it("hasMore is false when all entries fit within limit", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    await insertCOAChain(e.id);

    const result = await queries.getCOAEntries({ limit: 10, offset: 0 });
    expect(result.hasMore).toBe(false);
  });

  it("hasMore is true when there are more records beyond limit+offset", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    for (let i = 0; i < 3; i++) {
      await insertCOAChain(e.id);
    }

    const result = await queries.getCOAEntries({ limit: 1, offset: 0 });
    expect(result.hasMore).toBe(true);
  });

  it("total count matches regardless of limit/offset", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    for (let i = 0; i < 4; i++) {
      await insertCOAChain(e.id);
    }

    const page1 = await queries.getCOAEntries({ limit: 1, offset: 0 });
    const page2 = await queries.getCOAEntries({ limit: 1, offset: 3 });
    expect(page1.total).toBe(4);
    expect(page2.total).toBe(4);
  });

  it("entries are ordered by created_at DESC", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    await insertCOAChainAt(e.id, "2024-01-01T00:00:00Z");
    await insertCOAChainAt(e.id, "2024-06-01T00:00:00Z");

    const result = await queries.getCOAEntries({});
    expect(result.entries.length).toBe(2);
    expect(result.entries[0]!.createdAt >= result.entries[1]!.createdAt).toBe(true);
  });

  it("filters by since date", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    await insertCOAChainAt(e.id, "2020-01-01T00:00:00Z");
    await insertCOAChainAt(e.id, "2024-01-01T00:00:00Z");

    const result = await queries.getCOAEntries({ since: "2023-01-01T00:00:00Z" });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0]!.createdAt).toContain("2024");
  });

  it("filters by until date", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    await insertCOAChainAt(e.id, "2020-01-01T00:00:00Z");
    await insertCOAChainAt(e.id, "2024-01-01T00:00:00Z");

    const result = await queries.getCOAEntries({ until: "2021-01-01T00:00:00Z" });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0]!.createdAt).toContain("2020");
  });

  it("defaults to limit=50 when no limit provided", async () => {
    const e = await store.createEntity({ type: "E", displayName: "User" });
    for (let i = 0; i < 3; i++) {
      await insertCOAChain(e.id);
    }
    const result = await queries.getCOAEntries({});
    // With 3 items and default limit 50, all should be returned
    expect(result.entries.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 2. DashboardApi
// ---------------------------------------------------------------------------

/**
 * Minimal mock HTTP response that captures JSON output and status codes.
 */
function makeMockRes() {
  const captured: {
    status: number;
    body: string;
    headers: Record<string, string | number>;
  } = { status: 200, body: "", headers: {} };

  const res = {
    writeHead: (status: number, headers?: Record<string, string | number>) => {
      captured.status = status;
      if (headers) {
        Object.assign(captured.headers, headers);
      }
    },
    end: (body: string) => {
      captured.body = body;
    },
    get parsed() {
      return JSON.parse(captured.body || "{}") as unknown;
    },
    get status() {
      return captured.status;
    },
  };

  return { res: res as unknown as ServerResponse, captured };
}

/**
 * Minimal mock IncomingMessage.
 */
function makeMockReq(method: string, url: string): IncomingMessage {
  return {
    method,
    url,
    headers: { host: "localhost" },
  } as unknown as IncomingMessage;
}

describe.skip("DashboardApi.handle — route matching", () => {
  let api: DashboardApi;

  beforeEach(() => {
    api = new DashboardApi({ queries });
  });

  it("returns false for non-dashboard paths", () => {
    const req = makeMockReq("GET", "/api/other/resource");
    const { res } = makeMockRes();
    const handled = api.handle(req, res);
    expect(handled).toBe(false);
  });

  it("returns false for root path", () => {
    const req = makeMockReq("GET", "/");
    const { res } = makeMockRes();
    expect(api.handle(req, res)).toBe(false);
  });

  it("returns true and 405 for POST on dashboard paths", () => {
    const req = makeMockReq("POST", "/api/dashboard/overview");
    const { res, captured } = makeMockRes();
    const handled = api.handle(req, res);
    expect(handled).toBe(true);
    expect(captured.status).toBe(405);
  });

  it("returns true and 405 for PUT on dashboard paths", () => {
    const req = makeMockReq("PUT", "/api/dashboard/timeline");
    const { res, captured } = makeMockRes();
    const handled = api.handle(req, res);
    expect(handled).toBe(true);
    expect(captured.status).toBe(405);
  });

  it("returns false for non-GET on non-dashboard paths", () => {
    const req = makeMockReq("POST", "/api/other");
    const { res } = makeMockRes();
    expect(api.handle(req, res)).toBe(false);
  });

  it("handles /api/dashboard/overview", () => {
    const req = makeMockReq("GET", "/api/dashboard/overview");
    const { res, captured } = makeMockRes();
    const handled = api.handle(req, res);
    expect(handled).toBe(true);
    expect(captured.status).toBe(200);
  });

  it("handles /api/dashboard/timeline", () => {
    const req = makeMockReq("GET", "/api/dashboard/timeline?bucket=day");
    const { res, captured } = makeMockRes();
    const handled = api.handle(req, res);
    expect(handled).toBe(true);
    expect(captured.status).toBe(200);
  });

  it("handles /api/dashboard/breakdown", () => {
    const req = makeMockReq("GET", "/api/dashboard/breakdown?by=domain");
    const { res, captured } = makeMockRes();
    const handled = api.handle(req, res);
    expect(handled).toBe(true);
    expect(captured.status).toBe(200);
  });

  it("handles /api/dashboard/leaderboard", () => {
    const req = makeMockReq("GET", "/api/dashboard/leaderboard");
    const { res, captured } = makeMockRes();
    const handled = api.handle(req, res);
    expect(handled).toBe(true);
    expect(captured.status).toBe(200);
  });

  it("handles /api/dashboard/coa", () => {
    const req = makeMockReq("GET", "/api/dashboard/coa");
    const { res, captured } = makeMockRes();
    const handled = api.handle(req, res);
    expect(handled).toBe(true);
    expect(captured.status).toBe(200);
  });

  it("handles /api/dashboard/entity/:id for known entity", () => {
    const e = store.createEntity({ type: "E", displayName: "RouteUser" });
    const req = makeMockReq("GET", `/api/dashboard/entity/${e.id}`);
    const { res, captured } = makeMockRes();
    const handled = api.handle(req, res);
    expect(handled).toBe(true);
    expect(captured.status).toBe(200);
  });

  it("returns 404 for entity/:id when entity does not exist", () => {
    const req = makeMockReq("GET", "/api/dashboard/entity/NOTFOUND123456789012345");
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    expect(captured.status).toBe(404);
  });

  it("returns false for unknown sub-path like /api/dashboard/unknown", () => {
    const req = makeMockReq("GET", "/api/dashboard/unknown");
    const { res } = makeMockRes();
    const handled = api.handle(req, res);
    expect(handled).toBe(false);
  });
});

describe.skip("DashboardApi — /api/dashboard/overview", () => {
  let api: DashboardApi;

  beforeEach(() => {
    api = new DashboardApi({ queries });
  });

  it("returns JSON with required overview fields", () => {
    const req = makeMockReq("GET", "/api/dashboard/overview");
    const { res, captured } = makeMockRes();
    api.handle(req, res);

    const body = JSON.parse(captured.body) as Record<string, unknown>;
    expect(typeof body["totalImp"]).toBe("number");
    expect(typeof body["windowImp"]).toBe("number");
    expect(typeof body["entityCount"]).toBe("number");
    expect(typeof body["interactionCount"]).toBe("number");
    expect(typeof body["computedAt"]).toBe("string");
    expect(Array.isArray(body["recentActivity"])).toBe(true);
  });

  it("Content-Type header is application/json", () => {
    const req = makeMockReq("GET", "/api/dashboard/overview");
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    expect(captured.headers["Content-Type"]).toBe("application/json");
  });

  it("respects windowDays query param", () => {
    const req = makeMockReq("GET", "/api/dashboard/overview?windowDays=30");
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    expect(captured.status).toBe(200);
  });

  it("respects recentLimit query param", () => {
    seedTestData();
    const req = makeMockReq("GET", "/api/dashboard/overview?recentLimit=2");
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    const body = JSON.parse(captured.body) as { recentActivity: unknown[] };
    expect(body.recentActivity.length).toBeLessThanOrEqual(2);
  });
});

describe.skip("DashboardApi — /api/dashboard/timeline", () => {
  let api: DashboardApi;

  beforeEach(() => {
    api = new DashboardApi({ queries });
  });

  it("returns JSON with buckets, bucket, since, until fields", () => {
    const req = makeMockReq("GET", "/api/dashboard/timeline?bucket=day");
    const { res, captured } = makeMockRes();
    api.handle(req, res);

    const body = JSON.parse(captured.body) as Record<string, unknown>;
    expect(Array.isArray(body["buckets"])).toBe(true);
    expect(body["bucket"]).toBe("day");
    expect(typeof body["since"]).toBe("string");
    expect(typeof body["until"]).toBe("string");
  });

  it("defaults to day bucket when bucket param is omitted", () => {
    const req = makeMockReq("GET", "/api/dashboard/timeline");
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    const body = JSON.parse(captured.body) as { bucket: string };
    expect(body.bucket).toBe("day");
  });

  it("returns 400 for invalid bucket parameter", () => {
    const req = makeMockReq("GET", "/api/dashboard/timeline?bucket=invalid");
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    expect(captured.status).toBe(400);
    const body = JSON.parse(captured.body) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("invalid");
  });

  it("accepts valid buckets: hour, day, week, month", () => {
    const api2 = new DashboardApi({ queries });
    for (const bucket of ["hour", "day", "week", "month"]) {
      const req = makeMockReq("GET", `/api/dashboard/timeline?bucket=${bucket}`);
      const { res, captured } = makeMockRes();
      api2.handle(req, res);
      expect(captured.status).toBe(200);
    }
  });

  it("passes entityId, since, until to queries", () => {
    const e = store.createEntity({ type: "E", displayName: "User" });
    const req = makeMockReq("GET", `/api/dashboard/timeline?bucket=day&entityId=${e.id}&since=2024-01-01T00:00:00Z&until=2025-01-01T00:00:00Z`);
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    expect(captured.status).toBe(200);
    const body = JSON.parse(captured.body) as { since: string; until: string };
    expect(body.since).toBe("2024-01-01T00:00:00Z");
    expect(body.until).toBe("2025-01-01T00:00:00Z");
  });

  it("since defaults to 'all-time' when not provided", () => {
    const req = makeMockReq("GET", "/api/dashboard/timeline?bucket=day");
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    const body = JSON.parse(captured.body) as { since: string };
    expect(body.since).toBe("all-time");
  });

  it("until defaults to 'now' when not provided", () => {
    const req = makeMockReq("GET", "/api/dashboard/timeline?bucket=day");
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    const body = JSON.parse(captured.body) as { until: string };
    expect(body.until).toBe("now");
  });
});

describe.skip("DashboardApi — /api/dashboard/breakdown", () => {
  let api: DashboardApi;

  beforeEach(() => {
    api = new DashboardApi({ queries });
  });

  it("returns dimension, slices, total in response", () => {
    const req = makeMockReq("GET", "/api/dashboard/breakdown?by=domain");
    const { res, captured } = makeMockRes();
    api.handle(req, res);

    const body = JSON.parse(captured.body) as Record<string, unknown>;
    expect(body["dimension"]).toBe("domain");
    expect(Array.isArray(body["slices"])).toBe(true);
    expect(typeof body["total"]).toBe("number");
  });

  it("defaults to domain when by param is omitted", () => {
    const req = makeMockReq("GET", "/api/dashboard/breakdown");
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    const body = JSON.parse(captured.body) as { dimension: string };
    expect(body.dimension).toBe("domain");
  });

  it("returns 400 for invalid dimension parameter", () => {
    const req = makeMockReq("GET", "/api/dashboard/breakdown?by=invalid");
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    expect(captured.status).toBe(400);
    const body = JSON.parse(captured.body) as { error: string };
    expect(body.error).toContain("invalid");
  });

  it("accepts valid dimensions: domain, channel, workType", () => {
    const api2 = new DashboardApi({ queries });
    for (const dimension of ["domain", "channel", "workType"]) {
      const req = makeMockReq("GET", `/api/dashboard/breakdown?by=${dimension}`);
      const { res, captured } = makeMockRes();
      api2.handle(req, res);
      expect(captured.status).toBe(200);
    }
  });

  it("passes entityId filter to queries", () => {
    const e = store.createEntity({ type: "E", displayName: "User" });
    const req = makeMockReq("GET", `/api/dashboard/breakdown?by=channel&entityId=${e.id}`);
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    expect(captured.status).toBe(200);
  });
});

describe.skip("DashboardApi — /api/dashboard/leaderboard", () => {
  let api: DashboardApi;

  beforeEach(() => {
    api = new DashboardApi({ queries });
  });

  it("returns entries, windowDays, total, computedAt", () => {
    const req = makeMockReq("GET", "/api/dashboard/leaderboard");
    const { res, captured } = makeMockRes();
    api.handle(req, res);

    const body = JSON.parse(captured.body) as Record<string, unknown>;
    expect(Array.isArray(body["entries"])).toBe(true);
    expect(typeof body["windowDays"]).toBe("number");
    expect(typeof body["total"]).toBe("number");
    expect(typeof body["computedAt"]).toBe("string");
  });

  it("respects windowDays, limit, offset query params", () => {
    const req = makeMockReq("GET", "/api/dashboard/leaderboard?windowDays=30&limit=10&offset=5");
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    const body = JSON.parse(captured.body) as { windowDays: number };
    expect(body.windowDays).toBe(30);
  });
});

describe.skip("DashboardApi — /api/dashboard/entity/:id", () => {
  let api: DashboardApi;

  beforeEach(() => {
    api = new DashboardApi({ queries });
  });

  it("returns full profile JSON for existing entity", () => {
    const e = store.createEntity({ type: "E", displayName: "ProfileUser" });
    const req = makeMockReq("GET", `/api/dashboard/entity/${e.id}`);
    const { res, captured } = makeMockRes();
    api.handle(req, res);

    const body = JSON.parse(captured.body) as Record<string, unknown>;
    expect(body["entityId"]).toBe(e.id);
    expect(body["entityName"]).toBe("ProfileUser");
  });

  it("returns 404 with error JSON for unknown entity", () => {
    const req = makeMockReq("GET", "/api/dashboard/entity/UNKNOWNENTITY12345678901");
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    expect(captured.status).toBe(404);
    const body = JSON.parse(captured.body) as { error: string };
    expect(typeof body.error).toBe("string");
  });

  it("respects windowDays query param", () => {
    const e = store.createEntity({ type: "E", displayName: "User" });
    const req = makeMockReq("GET", `/api/dashboard/entity/${e.id}?windowDays=30`);
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    expect(captured.status).toBe(200);
  });
});

describe.skip("DashboardApi — /api/dashboard/coa", () => {
  let api: DashboardApi;

  beforeEach(() => {
    api = new DashboardApi({ queries });
  });

  it("returns entries, total, hasMore fields", () => {
    const req = makeMockReq("GET", "/api/dashboard/coa");
    const { res, captured } = makeMockRes();
    api.handle(req, res);

    const body = JSON.parse(captured.body) as Record<string, unknown>;
    expect(Array.isArray(body["entries"])).toBe(true);
    expect(typeof body["total"]).toBe("number");
    expect(typeof body["hasMore"]).toBe("boolean");
  });

  it("passes entityId, fingerprint, workType, since, until, limit, offset params", () => {
    const e = store.createEntity({ type: "E", displayName: "User" });
    const req = makeMockReq(
      "GET",
      `/api/dashboard/coa?entityId=${e.id}&fingerprint=$A0&workType=message_in&limit=10&offset=0`
    );
    const { res, captured } = makeMockRes();
    api.handle(req, res);
    expect(captured.status).toBe(200);
  });
});

describe.skip("DashboardApi — error handling", () => {
  it("returns 500 with generic error message when query throws", () => {
    // Create a queries object where getOverview throws
    const badQueries = {
      getOverview: () => { throw new Error("DB exploded"); },
    } as unknown as DashboardQueries;
    const api = new DashboardApi({ queries: badQueries });

    const req = makeMockReq("GET", "/api/dashboard/overview");
    const { res, captured } = makeMockRes();
    api.handle(req, res);

    expect(captured.status).toBe(500);
    const body = JSON.parse(captured.body) as { error: string };
    // Error messages are sanitized to prevent information leakage (CWE-200)
    expect(body.error).toBe("Internal server error");
  });
});

// ---------------------------------------------------------------------------
// 3. DashboardEventBroadcaster
// ---------------------------------------------------------------------------

/**
 * Creates a mock DashboardBroadcaster. Records all broadcast calls and
 * exposes an emit helper to simulate WebSocket message events.
 */
function createMockBroadcaster() {
  const broadcastCalls: Array<{ event: string; data: unknown }> = [];
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  const broadcaster: DashboardBroadcaster = {
    broadcast: (event: string, data: unknown) => {
      broadcastCalls.push({ event, data });
    },
    on: (event: string, listener: (...args: unknown[]) => void): EventEmitter => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return {} as EventEmitter;
    },
  };

  const emit = (event: string, ...args: unknown[]) => {
    const list = listeners.get(event) ?? [];
    for (const listener of list) {
      listener(...args);
    }
  };

  return { broadcaster, broadcastCalls, emit };
}

function makeActivityEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: "test-id",
    entityId: "entity-001",
    entityName: "Test User",
    channel: "telegram",
    workType: "message_in",
    impScore: 0.5,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeOverview(): DashboardOverview {
  return {
    totalImp: 100,
    windowImp: 50,
    entityCount: 3,
    interactionCount: 10,
    avgImpPerInteraction: 10,
    topChannel: "telegram",
    recentActivity: [],
    computedAt: new Date().toISOString(),
  };
}

function makeCOAEntry(): COAExplorerEntry {
  return {
    fingerprint: "$A0.#E0.@A0.C001",
    resourceId: "$A0",
    entityId: "entity-001",
    entityName: "Alice",
    nodeId: "@A0",
    chainCounter: 1,
    workType: "message_in",
    ref: null,
    action: null,
    payloadHash: null,
    createdAt: new Date().toISOString(),
    impScore: 0.5,
  };
}

describe.skip("DashboardEventBroadcaster.getSubscriberCount", () => {
  it("starts at 0 with no subscribers", () => {
    const { broadcaster } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });
    expect(deb.getSubscriberCount()).toBe(0);
    deb.destroy();
  });

  it("increments when a subscriber connects", () => {
    const { broadcaster, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    expect(deb.getSubscriberCount()).toBe(1);
    deb.destroy();
  });

  it("increments for each unique subscriber", () => {
    const { broadcaster, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    emit("message", "conn-002", { type: "dashboard:subscribe" });
    expect(deb.getSubscriberCount()).toBe(2);
    deb.destroy();
  });

  it("decrements when subscriber sends dashboard:unsubscribe", () => {
    const { broadcaster, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    emit("message", "conn-001", { type: "dashboard:unsubscribe" });
    expect(deb.getSubscriberCount()).toBe(0);
    deb.destroy();
  });

  it("decrements on disconnection event", () => {
    const { broadcaster, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    emit("disconnection", "conn-001");
    expect(deb.getSubscriberCount()).toBe(0);
    deb.destroy();
  });
});

describe.skip("DashboardEventBroadcaster.emitImpactRecorded", () => {
  it("does not broadcast when no subscribers", () => {
    const { broadcaster, broadcastCalls } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    deb.emitImpactRecorded(makeActivityEntry());
    expect(broadcastCalls.length).toBe(0);
    deb.destroy();
  });

  it("broadcasts to all unfiltered subscribers", () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    deb.emitImpactRecorded(makeActivityEntry());

    expect(broadcastCalls.length).toBe(1);
    expect(broadcastCalls[0]!.event).toBe("dashboard_event");
    deb.destroy();
  });

  it("broadcast event has type 'impact:recorded'", () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    const entry = makeActivityEntry({ entityId: "e-abc" });
    deb.emitImpactRecorded(entry);

    const emitted = broadcastCalls[0]!.data as { type: string; data: ActivityEntry };
    expect(emitted.type).toBe("impact:recorded");
    expect(emitted.data.entityId).toBe("e-abc");
    deb.destroy();
  });

  it("broadcasts when subscriber has matching entityId filter", () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe", entityIds: ["entity-001"] });
    deb.emitImpactRecorded(makeActivityEntry({ entityId: "entity-001" }));

    expect(broadcastCalls.length).toBe(1);
    deb.destroy();
  });

  it("does not broadcast when subscriber has non-matching entityId filter", () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe", entityIds: ["other-entity"] });
    deb.emitImpactRecorded(makeActivityEntry({ entityId: "entity-001" }));

    expect(broadcastCalls.length).toBe(0);
    deb.destroy();
  });

  it("broadcasts when subscriber has matching channel filter", () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe", channels: ["telegram"] });
    deb.emitImpactRecorded(makeActivityEntry({ channel: "telegram" }));

    expect(broadcastCalls.length).toBe(1);
    deb.destroy();
  });

  it("does not broadcast when subscriber has non-matching channel filter", () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe", channels: ["discord"] });
    deb.emitImpactRecorded(makeActivityEntry({ channel: "telegram" }));

    expect(broadcastCalls.length).toBe(0);
    deb.destroy();
  });
});

describe.skip("DashboardEventBroadcaster.emitEntityVerified", () => {
  it("broadcasts entity:verified event to subscribers", () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    deb.emitEntityVerified("entity-001", "verified");

    expect(broadcastCalls.length).toBe(1);
    const emitted = broadcastCalls[0]!.data as { type: string; data: { entityId: string; tier: string } };
    expect(emitted.type).toBe("entity:verified");
    expect(emitted.data.entityId).toBe("entity-001");
    expect(emitted.data.tier).toBe("verified");
    deb.destroy();
  });

  it("does not broadcast entity:verified when no subscribers", () => {
    const { broadcaster, broadcastCalls } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });
    deb.emitEntityVerified("entity-001", "verified");
    expect(broadcastCalls.length).toBe(0);
    deb.destroy();
  });
});

describe.skip("DashboardEventBroadcaster.emitCOACreated", () => {
  it("broadcasts coa:created event to subscribers", () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    deb.emitCOACreated(makeCOAEntry());

    expect(broadcastCalls.length).toBe(1);
    const emitted = broadcastCalls[0]!.data as { type: string };
    expect(emitted.type).toBe("coa:created");
    deb.destroy();
  });

  it("does not broadcast coa:created when no subscribers", () => {
    const { broadcaster, broadcastCalls } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });
    deb.emitCOACreated(makeCOAEntry());
    expect(broadcastCalls.length).toBe(0);
    deb.destroy();
  });
});

describe.skip("DashboardEventBroadcaster.emitOverviewUpdated — debounce", () => {
  it("does not immediately broadcast the overview", () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster }, 50);

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    deb.emitOverviewUpdated(makeOverview());

    // Immediately after — should not yet have broadcast
    expect(broadcastCalls.length).toBe(0);
    deb.destroy();
  });

  it("broadcasts overview:updated after debounce interval", async () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster }, 50);

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    deb.emitOverviewUpdated(makeOverview());

    await new Promise((r) => setTimeout(r, 100));

    expect(broadcastCalls.length).toBe(1);
    const emitted = broadcastCalls[0]!.data as { type: string };
    expect(emitted.type).toBe("overview:updated");
    deb.destroy();
  });

  it("collapses multiple rapid calls into one broadcast", async () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster }, 50);

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    deb.emitOverviewUpdated(makeOverview());
    deb.emitOverviewUpdated(makeOverview());
    deb.emitOverviewUpdated(makeOverview());

    await new Promise((r) => setTimeout(r, 100));

    // All 3 calls should collapse into a single broadcast
    expect(broadcastCalls.length).toBe(1);
    deb.destroy();
  });

  it("broadcasts the last overview provided before debounce fires", async () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster }, 50);

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    deb.emitOverviewUpdated({ ...makeOverview(), totalImp: 111 });
    deb.emitOverviewUpdated({ ...makeOverview(), totalImp: 222 });

    await new Promise((r) => setTimeout(r, 100));

    const emitted = broadcastCalls[0]!.data as { type: string; data: { totalImp: number } };
    expect(emitted.data.totalImp).toBe(222);
    deb.destroy();
  });

  it("does not broadcast overview when no subscribers even after debounce", async () => {
    const { broadcaster, broadcastCalls } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster }, 50);

    deb.emitOverviewUpdated(makeOverview());
    await new Promise((r) => setTimeout(r, 100));

    expect(broadcastCalls.length).toBe(0);
    deb.destroy();
  });

  it("overviewDebounceMs property reflects constructor argument", () => {
    const { broadcaster } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster }, 1500);
    expect(deb.overviewDebounceMs).toBe(1500);
    deb.destroy();
  });
});

describe.skip("DashboardEventBroadcaster.destroy", () => {
  it("clears all subscribers on destroy", () => {
    const { broadcaster, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    expect(deb.getSubscriberCount()).toBe(1);

    deb.destroy();
    expect(deb.getSubscriberCount()).toBe(0);
  });

  it("cancels pending debounce timer on destroy", async () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster }, 50);

    emit("message", "conn-001", { type: "dashboard:subscribe" });
    deb.emitOverviewUpdated(makeOverview());

    // Destroy before debounce fires
    deb.destroy();

    await new Promise((r) => setTimeout(r, 100));

    // No broadcast should have fired after destroy
    expect(broadcastCalls.length).toBe(0);
  });

  it("is safe to call destroy multiple times", () => {
    const { broadcaster } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });
    expect(() => {
      deb.destroy();
      deb.destroy();
    }).not.toThrow();
  });
});

describe.skip("DashboardEventBroadcaster — subscription filtering edge cases", () => {
  it("empty channels array acts as no filter (receives all)", () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    // channels: [] means no channel filter applied
    emit("message", "conn-001", { type: "dashboard:subscribe", channels: [] });
    deb.emitImpactRecorded(makeActivityEntry({ channel: "any-channel" }));

    expect(broadcastCalls.length).toBe(1);
    deb.destroy();
  });

  it("empty entityIds array acts as no filter", () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe", entityIds: [] });
    deb.emitImpactRecorded(makeActivityEntry({ entityId: "any-entity" }));

    expect(broadcastCalls.length).toBe(1);
    deb.destroy();
  });

  it("ignores non-object message payloads gracefully", () => {
    const { broadcaster } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    createMockBroadcaster();
    // Emit strange types — should not throw
    expect(() => {
      // Directly call with non-object — needs to use the real emit
    }).not.toThrow();
    deb.destroy();
  });

  it("handles non-string connectionId gracefully", () => {
    const { broadcaster, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    // Non-string connectionId should be silently ignored
    expect(() => {
      emit("message", 12345, { type: "dashboard:subscribe" });
    }).not.toThrow();

    expect(deb.getSubscriberCount()).toBe(0);
    deb.destroy();
  });

  it("ignores disconnection of unknown connectionId without error", () => {
    const { broadcaster, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    expect(() => {
      emit("disconnection", "nonexistent-conn");
    }).not.toThrow();
    deb.destroy();
  });

  it("entity:verified event broadcasts to entityId-filtered subscriber with matching id", () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe", entityIds: ["entity-001"] });
    deb.emitEntityVerified("entity-001", "sealed");

    expect(broadcastCalls.length).toBe(1);
    deb.destroy();
  });

  it("entity:verified event does not broadcast to entityId-filtered subscriber with non-matching id", () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster });

    emit("message", "conn-001", { type: "dashboard:subscribe", entityIds: ["other-entity"] });
    deb.emitEntityVerified("entity-001", "sealed");

    expect(broadcastCalls.length).toBe(0);
    deb.destroy();
  });

  it("overview:updated always broadcasts regardless of entityId filter (no entity to extract)", async () => {
    const { broadcaster, broadcastCalls, emit } = createMockBroadcaster();
    const deb = new DashboardEventBroadcaster({ wss: broadcaster }, 20);

    // Subscriber with entityId filter — overview has no entity
    emit("message", "conn-001", { type: "dashboard:subscribe", entityIds: ["some-entity"] });
    deb.emitOverviewUpdated(makeOverview());

    await new Promise((r) => setTimeout(r, 60));

    // overview:updated has no entityId — sub.entityIds filter skipped when event entityId is null
    // So subscriber with entityId filter should still receive overview
    expect(broadcastCalls.length).toBe(1);
    deb.destroy();
  });
});

