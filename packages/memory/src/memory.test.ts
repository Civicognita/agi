/**
 * Tests for @agi/memory — GraphMemoryAdapter (s112 CoALA+TiMem, Postgres).
 *
 * Tests run against the test VM's real agi_data Postgres (story #106 pattern).
 * Isolation via unique entity IDs per test — no shared mutable state.
 * Requires the test VM running: `agi test-vm create` + `agi test-vm services-start`.
 *
 * Migration 0004_special_bishop creates the memory_* tables.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ulid } from "ulid";
import { createDbClient, type DbClient } from "@agi/db-schema";
import { GraphMemoryAdapter } from "./graph-adapter.js";
import type { EpisodicRecord } from "./episodic.js";
import type { GraphEventRecord, RelationshipRecord } from "./graph-adapter.js";

// ---------------------------------------------------------------------------
// Test setup — one shared pool for the file (cheaper than per-test)
// ---------------------------------------------------------------------------

let dbClient: DbClient;
let adapter: GraphMemoryAdapter;

beforeAll(() => {
  dbClient = createDbClient();
  adapter = new GraphMemoryAdapter({ db: dbClient.db });
});

afterAll(async () => {
  await dbClient.pool.end();
});

let episodeCounter = 0;

function uid(): string {
  return ulid();
}

function makeEpisodic(entityId: string, overrides: Partial<EpisodicRecord> = {}): EpisodicRecord {
  episodeCounter++;
  const id = uid();
  return {
    id,
    timestamp: new Date().toISOString(),
    actor: { entityId, coaAlias: entityId },
    summary: overrides.summary ?? `episode summary ${String(episodeCounter)}`,
    tags: overrides.tags ?? ["test"],
    confidence: overrides.confidence ?? 0.8,
    sourceLinks: overrides.sourceLinks ?? ["session:test"],
    coaFingerprint: overrides.coaFingerprint ?? "test-fp",
    modelVersion: overrides.modelVersion ?? "test-model",
    hash: overrides.hash ?? `hash-${id}`,
    primeAlignment: overrides.primeAlignment,
  };
}

function makeGraphEvent(entityId: string, overrides: Partial<GraphEventRecord> = {}): GraphEventRecord {
  episodeCounter++;
  const id = uid();
  return {
    id,
    entityId,
    projectPath: overrides.projectPath ?? null,
    summary: overrides.summary ?? `graph event ${String(episodeCounter)}`,
    tags: overrides.tags ?? ["test"],
    confidence: overrides.confidence ?? 0.8,
    sourceLinks: overrides.sourceLinks ?? [],
    coaFingerprint: overrides.coaFingerprint ?? "fp",
    hash: overrides.hash ?? `hash-${id}`,
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

// ---------------------------------------------------------------------------
// 1. MemoryProvider interface
// ---------------------------------------------------------------------------

describe("GraphMemoryAdapter — MemoryProvider interface", () => {
  it("stores a MemoryEntry (legacy shape) and retrieves it via query()", async () => {
    const entityId = `E-mem-${uid()}`;
    await adapter.store({
      id: uid(),
      entityId,
      content: "user prefers dark mode",
      category: "preference",
      source: "explicit",
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0,
    });

    const results = await adapter.query({ entityId });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.content).toBe("user prefers dark mode");
  });

  it("stores an EpisodicRecord (rich shape) and retrieves it via query()", async () => {
    const entityId = `E-ep-${uid()}`;
    const ep = makeEpisodic(entityId, { summary: "completed scheduler rewrite" });
    await adapter.store(ep);

    const results = await adapter.query({ entityId });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.content).toContain("completed scheduler rewrite");
  });

  it("only returns entries for the requested entity", async () => {
    const eaId = `EA-${uid()}`;
    const ebId = `EB-${uid()}`;
    await adapter.store({ id: uid(), entityId: eaId, content: "entity A", category: "fact", source: "explicit", createdAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(), accessCount: 0 });
    await adapter.store({ id: uid(), entityId: ebId, content: "entity B", category: "fact", source: "explicit", createdAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(), accessCount: 0 });

    const results = await adapter.query({ entityId: eaId });
    expect(results.every((r) => r.entityId === eaId)).toBe(true);
  });

  it("respects the limit parameter", async () => {
    const entityId = `E-lim-${uid()}`;
    for (let i = 0; i < 8; i++) {
      await adapter.store({ id: uid(), entityId, content: `memory ${String(i)}`, category: "fact", source: "explicit", createdAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(), accessCount: 0 });
    }

    const results = await adapter.query({ entityId, limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("isAvailable always returns true (Postgres is always local)", () => {
    expect(adapter.isAvailable()).toBe(true);
  });

  it("count returns 0 for unknown entity", async () => {
    expect(await adapter.count(`ghost-${uid()}`)).toBe(0);
  });

  it("count returns correct number after stores", async () => {
    const entityId = `EC-${uid()}`;
    await adapter.store({ id: uid(), entityId, content: "a", category: "fact", source: "explicit", createdAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(), accessCount: 0 });
    await adapter.store({ id: uid(), entityId, content: "b", category: "fact", source: "explicit", createdAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(), accessCount: 0 });
    expect(await adapter.count(entityId)).toBe(2);
  });

  it("delete removes the entry and decrements count", async () => {
    const entityId = `ED-${uid()}`;
    const id = uid();
    await adapter.store({ id, entityId, content: "to delete", category: "fact", source: "explicit", createdAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(), accessCount: 0 });
    expect(await adapter.count(entityId)).toBe(1);
    await adapter.delete(id);
    expect(await adapter.count(entityId)).toBe(0);
  });

  it("deleteAllForEntity removes all entries for that entity only", async () => {
    const eaId = `DA-${uid()}`;
    const ebId = `DB-${uid()}`;
    await adapter.store({ id: uid(), entityId: eaId, content: "a1", category: "fact", source: "explicit", createdAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(), accessCount: 0 });
    await adapter.store({ id: uid(), entityId: eaId, content: "a2", category: "fact", source: "explicit", createdAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(), accessCount: 0 });
    await adapter.store({ id: uid(), entityId: ebId, content: "b1", category: "fact", source: "explicit", createdAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(), accessCount: 0 });
    await adapter.deleteAllForEntity(eaId);
    expect(await adapter.count(eaId)).toBe(0);
    expect(await adapter.count(ebId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. EpisodicRecord + graph methods
// ---------------------------------------------------------------------------

describe("GraphMemoryAdapter — episodic + graph methods", () => {
  it("stores and retrieves a GraphEventRecord via storeEpisodicEvent", async () => {
    const entityId = `GE-${uid()}`;
    const ev = makeGraphEvent(entityId, { summary: "fixed scheduler deadlock" });
    await adapter.storeEpisodicEvent(ev);

    const events = await adapter.queryGraphEvents({ entityId, limit: 10 });
    expect(events.length).toBe(1);
    expect(events[0]!.summary).toBe("fixed scheduler deadlock");
  });

  it("queryGraphEvents filters by projectPath", async () => {
    const entityId = `GPP-${uid()}`;
    const global = makeGraphEvent(entityId, { summary: "global event", projectPath: null });
    const proj = makeGraphEvent(entityId, { summary: "project event", projectPath: "/my/project" });
    await adapter.storeEpisodicEvent(global);
    await adapter.storeEpisodicEvent(proj);

    const globalOnly = await adapter.queryGraphEvents({ entityId, projectPath: null, limit: 10 });
    expect(globalOnly.every((e) => e.projectPath === null || e.projectPath === undefined)).toBe(true);
    expect(globalOnly.some((e) => e.summary === "global event")).toBe(true);

    const projOnly = await adapter.queryGraphEvents({ entityId, projectPath: "/my/project", limit: 10 });
    expect(projOnly.some((e) => e.summary === "project event")).toBe(true);
  });

  it("does not store duplicate hashes (idempotent on same hash)", async () => {
    const entityId = `GDH-${uid()}`;
    const ev = makeGraphEvent(entityId);
    await adapter.storeEpisodicEvent(ev);
    await adapter.storeEpisodicEvent(ev); // same hash → onConflictDoNothing
    const events = await adapter.queryGraphEvents({ entityId, limit: 10 });
    expect(events.length).toBe(1);
  });

  it("getUnconsolidated returns events without consolidated_at", async () => {
    const entityId = `GUC-${uid()}`;
    const ev1 = makeGraphEvent(entityId);
    const ev2 = makeGraphEvent(entityId);
    await adapter.storeEpisodicEvent(ev1);
    await adapter.storeEpisodicEvent(ev2);

    const unconsolidated = await adapter.getUnconsolidated(entityId, undefined, 10);
    expect(unconsolidated.length).toBe(2);
  });

  it("markConsolidated sets consolidated_at and removes from getUnconsolidated", async () => {
    const entityId = `GMC-${uid()}`;
    const ev = makeGraphEvent(entityId);
    await adapter.storeEpisodicEvent(ev);
    expect((await adapter.getUnconsolidated(entityId, undefined, 10)).length).toBe(1);

    await adapter.markConsolidated([ev.id]);
    expect((await adapter.getUnconsolidated(entityId, undefined, 10)).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Relationships
// ---------------------------------------------------------------------------

describe("GraphMemoryAdapter — relationships", () => {
  const now = Date.now();

  function makeRel(entityId: string, overrides: Partial<RelationshipRecord> = {}): RelationshipRecord {
    return {
      id: uid(),
      subjectEntityId: entityId,
      predicate: overrides.predicate ?? "worked_on",
      objectEntityId: null,
      objectLiteral: overrides.objectLiteral ?? "some task",
      projectPath: overrides.projectPath ?? null,
      validFrom: overrides.validFrom ?? now,
      validUntil: overrides.validUntil ?? null,
      confidence: overrides.confidence ?? 0.9,
      sourceEventIds: overrides.sourceEventIds ?? [],
      createdAt: overrides.createdAt ?? now,
    };
  }

  it("stores and retrieves a relationship", async () => {
    const entityId = `RL-${uid()}`;
    const rel = makeRel(entityId, { objectLiteral: "memory system rewrite" });
    await adapter.storeRelationship(rel);

    const results = await adapter.queryRelationships({ subjectEntityId: entityId, limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0]!.objectLiteral).toBe("memory system rewrite");
  });

  it("queryRelationships filters by predicate", async () => {
    const entityId = `RP-${uid()}`;
    await adapter.storeRelationship(makeRel(entityId, { predicate: "completed", objectLiteral: "task A" }));
    await adapter.storeRelationship(makeRel(entityId, { predicate: "learned", objectLiteral: "insight B" }));

    const completed = await adapter.queryRelationships({ subjectEntityId: entityId, predicate: "completed" });
    expect(completed.length).toBe(1);
    expect(completed[0]!.objectLiteral).toBe("task A");
  });

  it("queryRelationships respects validAt — excludes expired relationships", async () => {
    const entityId = `RVA-${uid()}`;
    const past = now - 1000;
    await adapter.storeRelationship(makeRel(entityId, { validFrom: past, validUntil: past + 100, objectLiteral: "expired" }));
    await adapter.storeRelationship(makeRel(entityId, { validFrom: past, validUntil: null, objectLiteral: "active" }));

    const results = await adapter.queryRelationships({ subjectEntityId: entityId, validAt: new Date(now) });
    const literals = results.map((r) => r.objectLiteral);
    expect(literals).not.toContain("expired");
    expect(literals).toContain("active");
  });

  it("invalidatePriorRelationship sets validUntil on open relationships", async () => {
    const entityId = `RI-${uid()}`;
    const rel = makeRel(entityId, { predicate: "worked_on", objectLiteral: "old task" });
    await adapter.storeRelationship(rel);

    await adapter.invalidatePriorRelationship(entityId, "worked_on", null, now + 5000);

    const active = await adapter.queryRelationships({
      subjectEntityId: entityId,
      predicate: "worked_on",
      validAt: new Date(now + 6000),
    });
    expect(active.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Doc chunks
// ---------------------------------------------------------------------------

describe("GraphMemoryAdapter — doc chunks", () => {
  it("stores and retrieves a doc chunk by scope", async () => {
    const id = uid();
    await adapter.storeDocChunk({
      id,
      sourcePath: `/agi/docs/memory-${id}.md`,
      scope: "global",
      heading: "Memory System",
      content: "The memory system uses Postgres with pgvector.",
      chunkIndex: 0,
      contentHash: `hash-${id}`,
      indexedAt: Date.now(),
    });

    const results = await adapter.queryDocChunks({ scope: "global", limit: 50 });
    expect(results.some((r) => r.id === id)).toBe(true);
  });

  it("getDocChunkHash returns null for unknown path", async () => {
    expect(await adapter.getDocChunkHash("/unknown/path-nonexistent.md")).toBe(null);
  });

  it("getDocChunkHash returns hash after storing", async () => {
    const id = uid();
    const path = `/k/notes-${id}.md`;
    await adapter.storeDocChunk({
      id,
      sourcePath: path,
      scope: "global",
      heading: null,
      content: "some content",
      chunkIndex: 0,
      contentHash: "myhash456",
      indexedAt: Date.now(),
    });

    expect(await adapter.getDocChunkHash(path)).toBe("myhash456");
  });

  it("deleteDocChunksForPath removes all chunks for that path", async () => {
    const id1 = uid();
    const id2 = uid();
    const path = `/agi/docs/test-${id1}.md`;
    await adapter.storeDocChunk({ id: id1, sourcePath: path, scope: "global", heading: null, content: "chunk 1", chunkIndex: 0, contentHash: "h1", indexedAt: Date.now() });
    await adapter.storeDocChunk({ id: id2, sourcePath: path, scope: "global", heading: null, content: "chunk 2", chunkIndex: 1, contentHash: "h1", indexedAt: Date.now() });

    await adapter.deleteDocChunksForPath(path);

    expect(await adapter.getDocChunkHash(path)).toBe(null);
  });

  it("queryDocChunks filters by scope", async () => {
    const gId = uid();
    const pId = uid();
    const gScope = `global-test-${gId}`;
    const pScope = `project:/my/proj-${pId}`;
    await adapter.storeDocChunk({ id: gId, sourcePath: `/g-${gId}.md`, scope: gScope, heading: "Global", content: "global knowledge content", chunkIndex: 0, contentHash: "gh", indexedAt: Date.now() });
    await adapter.storeDocChunk({ id: pId, sourcePath: `/p-${pId}.md`, scope: pScope, heading: "Project", content: "project knowledge content", chunkIndex: 0, contentHash: "ph", indexedAt: Date.now() });

    const globalResults = await adapter.queryDocChunks({ scope: gScope, limit: 10 });
    expect(globalResults.every((c) => c.scope === gScope)).toBe(true);

    const projResults = await adapter.queryDocChunks({ scope: pScope, limit: 10 });
    expect(projResults.every((c) => c.scope === pScope)).toBe(true);
  });
});
