import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase } from "./db.js";
import type { Database } from "./db.js";
import { ImpactRecorder, BOOL_VALUES } from "./impact.js";
import { EntityStore } from "./store.js";

// COAChainLogger lives in the coa-chain package but the coa_chains table is
// created by entity-model's createDatabase(). We wire it up manually here to
// satisfy the FK constraint on impact_interactions.coa_fingerprint.
// Rather than importing the logger (cross-package in test), we just insert a
// valid coa_chains row directly via raw SQL, which keeps this file self-contained.

let db: Database;
let recorder: ImpactRecorder;
let entityId: string;
let coaFingerprint: string;

beforeEach(() => {
  db = createDatabase(":memory:");
  recorder = new ImpactRecorder(db);

  // Create an entity so FK constraints on entity_id pass.
  const store = new EntityStore(db);
  const entity = store.createEntity({ type: "E", displayName: "Test Entity" });
  entityId = entity.id;

  // Insert a coa_chains row so the FK on impact_interactions.coa_fingerprint passes.
  coaFingerprint = "$A0.#E0.@A0.C001";
  db.prepare(`
    INSERT INTO coa_chains (fingerprint, resource_id, entity_id, node_id, chain_counter, work_type, created_at)
    VALUES (?, '$A0', ?, '@A0', 1, 'message_in', ?)
  `).run(coaFingerprint, entityId, new Date().toISOString());
});

// ---------------------------------------------------------------------------
// 0SCALE formula
// ---------------------------------------------------------------------------

describe("ImpactRecorder.record — 0SCALE formula", () => {
  it("boolLabel 'TRUE': $imp = 1 * 0.5 * (1 + 0) = 0.5", () => {
    const result = recorder.record({
      entityId,
      coaFingerprint,
      quant: 1,
      boolLabel: "TRUE",
    });
    expect(result.impScore).toBeCloseTo(0.5);
    expect(result.value0bool).toBe(0.5);
    expect(result.bonus).toBe(0);
  });

  it("boolLabel '0TRUE': $imp = 1 * 1.0 * (1 + 0) = 1.0", () => {
    const result = recorder.record({
      entityId,
      coaFingerprint,
      quant: 1,
      boolLabel: "0TRUE",
    });
    expect(result.impScore).toBeCloseTo(1.0);
    expect(result.value0bool).toBe(1.0);
  });

  it("boolLabel '0FALSE': $imp = 1 * -1.0 * (1 + 0) = -1.0", () => {
    const result = recorder.record({
      entityId,
      coaFingerprint,
      quant: 1,
      boolLabel: "0FALSE",
    });
    expect(result.impScore).toBeCloseTo(-1.0);
    expect(result.value0bool).toBe(-1.0);
  });

  it("boolLabel 'NEUTRAL': $imp = 1 * 0 * (1 + 0) = 0", () => {
    const result = recorder.record({
      entityId,
      coaFingerprint,
      quant: 1,
      boolLabel: "NEUTRAL",
    });
    expect(result.impScore).toBeCloseTo(0);
    expect(result.value0bool).toBe(0);
  });

  it("with bonus: $imp = 2 * 0.5 * (1 + 0.1) = 1.1", () => {
    const result = recorder.record({
      entityId,
      coaFingerprint,
      quant: 2,
      boolLabel: "TRUE",
      bonus: 0.1,
    });
    expect(result.impScore).toBeCloseTo(1.1);
    expect(result.bonus).toBe(0.1);
  });

  it("optional fields channel and workType default to null", () => {
    const result = recorder.record({
      entityId,
      coaFingerprint,
      quant: 1,
      boolLabel: "TRUE",
    });
    expect(result.channel).toBeNull();
    expect(result.workType).toBeNull();
  });

  it("optional fields channel and workType are stored when provided", () => {
    const result = recorder.record({
      entityId,
      coaFingerprint,
      quant: 1,
      boolLabel: "TRUE",
      channel: "telegram",
      workType: "message_in",
    });
    expect(result.channel).toBe("telegram");
    expect(result.workType).toBe("message_in");
  });

  it("returns an interaction with a ULID id", () => {
    const result = recorder.record({
      entityId,
      coaFingerprint,
      quant: 1,
      boolLabel: "TRUE",
    });
    expect(result.id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("stores entityId and coaFingerprint correctly", () => {
    const result = recorder.record({
      entityId,
      coaFingerprint,
      quant: 1,
      boolLabel: "TRUE",
    });
    expect(result.entityId).toBe(entityId);
    expect(result.coaFingerprint).toBe(coaFingerprint);
  });
});

// ---------------------------------------------------------------------------
// Balance queries
// ---------------------------------------------------------------------------

describe("ImpactRecorder.getBalance", () => {
  it("returns 0 for entity with no interactions", () => {
    expect(recorder.getBalance(entityId)).toBe(0);
  });

  it("returns sum of all impScores for entity", () => {
    recorder.record({ entityId, coaFingerprint, quant: 1, boolLabel: "TRUE" }); // 0.5
    recorder.record({ entityId, coaFingerprint, quant: 1, boolLabel: "0TRUE" }); // 1.0
    recorder.record({ entityId, coaFingerprint, quant: 1, boolLabel: "FALSE" }); // -0.5
    expect(recorder.getBalance(entityId)).toBeCloseTo(1.0);
  });

  it("only sums for the given entity", () => {
    // Create a second entity
    const store = new EntityStore(db);
    const other = store.createEntity({ type: "E", displayName: "Other" });
    const fp2 = "$A0.#E0.@A0.C002";
    db.prepare(
      `INSERT INTO coa_chains (fingerprint, resource_id, entity_id, node_id, chain_counter, work_type, created_at)
       VALUES (?, '$A0', ?, '@A0', 2, 'message_in', ?)`
    ).run(fp2, other.id, new Date().toISOString());

    recorder.record({ entityId, coaFingerprint, quant: 1, boolLabel: "0TRUE" }); // 1.0
    recorder.record({ entityId: other.id, coaFingerprint: fp2, quant: 1, boolLabel: "0FALSE" }); // -1.0

    expect(recorder.getBalance(entityId)).toBeCloseTo(1.0);
    expect(recorder.getBalance(other.id)).toBeCloseTo(-1.0);
  });
});

describe("ImpactRecorder.getBalanceSince", () => {
  it("returns 0 if no interactions match the since filter", async () => {
    recorder.record({ entityId, coaFingerprint, quant: 1, boolLabel: "TRUE" }); // 0.5
    await new Promise((r) => setTimeout(r, 5));
    const future = new Date().toISOString();
    expect(recorder.getBalanceSince(entityId, future)).toBe(0);
  });

  it("filters by created_at >= since", async () => {
    recorder.record({ entityId, coaFingerprint, quant: 1, boolLabel: "0FALSE" }); // -1.0
    await new Promise((r) => setTimeout(r, 5));
    const cutoff = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    recorder.record({ entityId, coaFingerprint, quant: 1, boolLabel: "0TRUE" }); // 1.0

    // Only the second record is >= cutoff
    expect(recorder.getBalanceSince(entityId, cutoff)).toBeCloseTo(1.0);
  });

  it("returns 0 for entity with no interactions at all", () => {
    const since = new Date(Date.now() - 10000).toISOString();
    expect(recorder.getBalanceSince(entityId, since)).toBe(0);
  });
});

describe("ImpactRecorder.getDistinctEventCount", () => {
  it("counts distinct work_type values", () => {
    recorder.record({ entityId, coaFingerprint, quant: 1, boolLabel: "TRUE", workType: "vote" });
    recorder.record({ entityId, coaFingerprint, quant: 1, boolLabel: "TRUE", workType: "vote" });
    recorder.record({ entityId, coaFingerprint, quant: 1, boolLabel: "TRUE", workType: "comment" });
    expect(recorder.getDistinctEventCount(entityId)).toBe(2);
  });

  it("returns 0 for entity with no interactions", () => {
    expect(recorder.getDistinctEventCount(entityId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe("ImpactRecorder.getHistory", () => {
  it("returns interactions ordered by created_at DESC", async () => {
    recorder.record({ entityId, coaFingerprint, quant: 1, boolLabel: "TRUE" });
    await new Promise((r) => setTimeout(r, 5));
    recorder.record({ entityId, coaFingerprint, quant: 2, boolLabel: "0TRUE" });
    await new Promise((r) => setTimeout(r, 5));
    recorder.record({ entityId, coaFingerprint, quant: 3, boolLabel: "NEUTRAL" });

    const history = recorder.getHistory(entityId);
    expect(history.length).toBe(3);
    // DESC order: newest first
    expect(history[0]!.quant).toBe(3);
    expect(history[1]!.quant).toBe(2);
    expect(history[2]!.quant).toBe(1);
  });

  it("pagination with limit and offset works", async () => {
    for (let i = 0; i < 5; i++) {
      recorder.record({ entityId, coaFingerprint, quant: i + 1, boolLabel: "TRUE" });
      await new Promise((r) => setTimeout(r, 5));
    }

    const page1 = recorder.getHistory(entityId, { limit: 2, offset: 0 });
    const page2 = recorder.getHistory(entityId, { limit: 2, offset: 2 });
    const page3 = recorder.getHistory(entityId, { limit: 2, offset: 4 });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page3.length).toBe(1);

    const ids = [...page1, ...page2, ...page3].map((i) => i.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("returns empty array for entity with no interactions", () => {
    expect(recorder.getHistory(entityId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BOOL_VALUES constant
// ---------------------------------------------------------------------------

describe("BOOL_VALUES", () => {
  it("contains all 7 expected labels with correct precision factors", () => {
    expect(BOOL_VALUES["0FALSE"]).toBe(-1.0);
    expect(BOOL_VALUES["FALSE"]).toBe(-0.5);
    expect(BOOL_VALUES["0-"]).toBe(-0.25);
    expect(BOOL_VALUES["NEUTRAL"]).toBe(0);
    expect(BOOL_VALUES["0+"]).toBe(0.25);
    expect(BOOL_VALUES["TRUE"]).toBe(0.5);
    expect(BOOL_VALUES["0TRUE"]).toBe(1.0);
  });

  it("has exactly 7 entries", () => {
    expect(Object.keys(BOOL_VALUES).length).toBe(7);
  });
});
