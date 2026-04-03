import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase } from "@aionima/entity-model";
import type { Database } from "@aionima/entity-model";
import { COAChainLogger } from "./logger.js";

// The COAChainLogger uses coa_chains.entity_id which:
//   1. Must satisfy formatFingerprint's entity validation: /^#[A-Z]\d+$/
//   2. Has a FK reference to entities(id)
//
// So in tests we insert entity rows whose id IS the COA notation (#E0, #O0),
// satisfying both constraints at once. This matches the intent of LogEntryParams
// where entityId is documented as "#E0 (entity ULID from store)".

let db: Database;
let logger: COAChainLogger;

// COA notation IDs — these are both the entity primary key AND the COA entity segment.
const ENTITY_A = "#E0";
const ENTITY_B = "#O0";
const RESOURCE = "$A0";
const NODE = "@A0";

function insertEntityRow(database: Database, id: string, displayName: string): void {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO entities (id, type, display_name, verification_tier, coa_alias, created_at, updated_at)
    VALUES (?, 'E', ?, 'unverified', ?, ?, ?)
  `).run(id, displayName, id, now, now);
}

beforeEach(() => {
  db = createDatabase(":memory:");
  logger = new COAChainLogger(db);

  // Insert entity rows with COA-notation IDs to satisfy FK constraints.
  insertEntityRow(db, ENTITY_A, "Entity A");
  insertEntityRow(db, ENTITY_B, "Entity B");
});

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

describe("COAChainLogger.log", () => {
  it("returns a fingerprint string in format $RESOURCE.ENTITY.NODE.C001", () => {
    const fp = logger.log({
      resourceId: RESOURCE,
      entityId: ENTITY_A,
      nodeId: NODE,
      workType: "message_in",
    });
    expect(fp).toBe("$A0.#E0.@A0.C001");
  });

  it("sequential log() calls increment counter: C001, C002, C003", () => {
    const fp1 = logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_in" });
    const fp2 = logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_in" });
    const fp3 = logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_in" });

    expect(fp1).toBe("$A0.#E0.@A0.C001");
    expect(fp2).toBe("$A0.#E0.@A0.C002");
    expect(fp3).toBe("$A0.#E0.@A0.C003");
  });

  it("different entities get separate counters starting from C001", () => {
    const fpA = logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_in" });
    const fpB = logger.log({ resourceId: RESOURCE, entityId: ENTITY_B, nodeId: NODE, workType: "message_in" });

    expect(fpA).toBe("$A0.#E0.@A0.C001");
    expect(fpB).toBe("$A0.#O0.@A0.C001");
  });

  it("returns a fingerprint that can be retrieved by getRecord", () => {
    const fp = logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "tool_use" });
    const record = logger.getRecord(fp);
    expect(record).not.toBeNull();
    expect(record!.fingerprint).toBe(fp);
  });

  it("stores workType correctly", () => {
    const fp = logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "commit" });
    const record = logger.getRecord(fp);
    expect(record!.workType).toBe("commit");
  });

  it("stores optional ref, action, payloadHash when provided", () => {
    const fp = logger.log({
      resourceId: RESOURCE,
      entityId: ENTITY_A,
      nodeId: NODE,
      workType: "artifact",
      ref: "ref-abc",
      action: "create",
      payloadHash: "deadbeef",
    });
    const record = logger.getRecord(fp);
    expect(record!.ref).toBe("ref-abc");
    expect(record!.action).toBe("create");
    expect(record!.payloadHash).toBe("deadbeef");
  });

  it("optional fields default to null when not provided", () => {
    const fp = logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_out" });
    const record = logger.getRecord(fp);
    expect(record!.ref).toBeNull();
    expect(record!.action).toBeNull();
    expect(record!.payloadHash).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Counter atomicity
// ---------------------------------------------------------------------------

describe("COAChainLogger counter atomicity", () => {
  it("logs 100 entries rapidly and all chain_counters are unique and sequential 1..100", () => {
    const fingerprints: string[] = [];

    for (let i = 0; i < 100; i++) {
      const fp = logger.log({
        resourceId: RESOURCE,
        entityId: ENTITY_A,
        nodeId: NODE,
        workType: "message_in",
      });
      fingerprints.push(fp);
    }

    // All fingerprints must be unique
    expect(new Set(fingerprints).size).toBe(100);

    // Retrieve all chain records and verify counters are 1..100
    const chain = logger.getChain(ENTITY_A, { limit: 200 });
    expect(chain.length).toBe(100);

    const counters = chain.map((r) => r.chainCounter).sort((a, b) => a - b);
    for (let i = 0; i < 100; i++) {
      expect(counters[i]).toBe(i + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

describe("COAChainLogger.getLatestCounter", () => {
  it("returns 0 when no records exist", () => {
    expect(logger.getLatestCounter(RESOURCE, ENTITY_A)).toBe(0);
  });

  it("returns max counter after logging", () => {
    logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_in" });
    logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_in" });
    logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_in" });

    expect(logger.getLatestCounter(RESOURCE, ENTITY_A)).toBe(3);
  });

  it("is scoped to (resourceId, entityId) pair", () => {
    logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_in" });
    logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_in" });
    logger.log({ resourceId: RESOURCE, entityId: ENTITY_B, nodeId: NODE, workType: "message_in" });

    expect(logger.getLatestCounter(RESOURCE, ENTITY_A)).toBe(2);
    expect(logger.getLatestCounter(RESOURCE, ENTITY_B)).toBe(1);
  });
});

describe("COAChainLogger.getChain", () => {
  it("returns records ordered by chain_counter ASC", () => {
    logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_in" });
    logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "tool_use" });
    logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "commit" });

    const chain = logger.getChain(ENTITY_A);
    expect(chain.length).toBe(3);
    expect(chain[0]!.chainCounter).toBe(1);
    expect(chain[1]!.chainCounter).toBe(2);
    expect(chain[2]!.chainCounter).toBe(3);
  });

  it("pagination works with limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_in" });
    }

    const page1 = logger.getChain(ENTITY_A, { limit: 2, offset: 0 });
    const page2 = logger.getChain(ENTITY_A, { limit: 2, offset: 2 });
    const page3 = logger.getChain(ENTITY_A, { limit: 2, offset: 4 });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page3.length).toBe(1);

    const counters = [...page1, ...page2, ...page3].map((r) => r.chainCounter);
    expect(new Set(counters).size).toBe(5);
  });

  it("returns empty array for entity with no records", () => {
    expect(logger.getChain(ENTITY_A)).toEqual([]);
  });

  it("only returns records for the given entity", () => {
    logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_in" });
    logger.log({ resourceId: RESOURCE, entityId: ENTITY_B, nodeId: NODE, workType: "message_in" });

    const chainA = logger.getChain(ENTITY_A);
    const chainB = logger.getChain(ENTITY_B);

    expect(chainA.length).toBe(1);
    expect(chainB.length).toBe(1);
    expect(chainA[0]!.entityId).toBe(ENTITY_A);
    expect(chainB[0]!.entityId).toBe(ENTITY_B);
  });
});

describe("COAChainLogger.getRecord", () => {
  it("returns single record by fingerprint", () => {
    const fp = logger.log({ resourceId: RESOURCE, entityId: ENTITY_A, nodeId: NODE, workType: "message_in" });
    const record = logger.getRecord(fp);

    expect(record).not.toBeNull();
    expect(record!.fingerprint).toBe(fp);
    expect(record!.resourceId).toBe(RESOURCE);
    expect(record!.entityId).toBe(ENTITY_A);
    expect(record!.nodeId).toBe(NODE);
    expect(record!.chainCounter).toBe(1);
  });

  it("returns null for non-existent fingerprint", () => {
    const result = logger.getRecord("$A0.#E0.@A0.C999");
    expect(result).toBeNull();
  });

  it("correctly maps all fields from the raw row", () => {
    const fp = logger.log({
      resourceId: RESOURCE,
      entityId: ENTITY_A,
      nodeId: NODE,
      workType: "verification",
      ref: "my-ref",
      action: "update",
      payloadHash: "abc123",
    });

    const record = logger.getRecord(fp)!;
    expect(record.workType).toBe("verification");
    expect(record.ref).toBe("my-ref");
    expect(record.action).toBe("update");
    expect(record.payloadHash).toBe("abc123");
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
