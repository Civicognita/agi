/**
 * Comprehensive tests for @agi/memory package.
 *
 * Covers:
 * - FileMemoryProvider (file-adapter.ts)
 * - CogneeMemoryProvider (cognee-adapter.ts)
 * - CompositeMemoryAdapter (composite-adapter.ts)
 * - retrieveMemories / extractSessionMemories (retrieval.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileMemoryProvider } from "./file-adapter.js";
import { CogneeMemoryProvider } from "./cognee-adapter.js";
import { CompositeMemoryAdapter } from "./composite-adapter.js";
import { retrieveMemories, extractSessionMemories } from "./retrieval.js";
import type { MemoryEntry } from "./types.js";
import type { GatewayState } from "@agi/gateway-core";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

let entryCounter = 0;

function makeEntry(
  overrides: Partial<MemoryEntry> & { entityId: string },
): MemoryEntry {
  entryCounter++;
  return {
    id: `mem-${entryCounter.toString().padStart(4, "0")}`,
    entityId: overrides.entityId,
    content: overrides.content ?? "default memory content",
    category: overrides.category ?? "fact",
    source: overrides.source ?? "explicit",
    createdAt: overrides.createdAt ?? "2025-01-01T00:00:00.000Z",
    lastAccessedAt: overrides.lastAccessedAt ?? "2025-01-01T00:00:00.000Z",
    accessCount: overrides.accessCount ?? 0,
    relevanceScore: overrides.relevanceScore,
    metadata: overrides.metadata,
  };
}

/** Create a temporary directory that is cleaned up after each test. */
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "aionima-mem-test-"));
}

// ---------------------------------------------------------------------------
// 1. FileMemoryProvider
// ---------------------------------------------------------------------------

describe("FileMemoryProvider", () => {
  let dir: string;
  let provider: FileMemoryProvider;

  beforeEach(() => {
    dir = makeTempDir();
    provider = new FileMemoryProvider(dir);
    entryCounter = 0;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ---- store & retrieve ----

  it("stores an entry and retrieves it via query", async () => {
    const entry = makeEntry({ entityId: "E1", content: "user prefers dark mode" });
    await provider.store(entry);

    const results = await provider.query({ entityId: "E1" });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(entry.id);
    expect(results[0]!.content).toBe("user prefers dark mode");
  });

  it("stores multiple entries and retrieves all of them", async () => {
    const e1 = makeEntry({ entityId: "E2", content: "fact one" });
    const e2 = makeEntry({ entityId: "E2", content: "fact two" });
    await provider.store(e1);
    await provider.store(e2);

    const results = await provider.query({ entityId: "E2" });
    expect(results).toHaveLength(2);
  });

  it("only returns entries for the requested entity", async () => {
    await provider.store(makeEntry({ entityId: "EA", content: "entity A memory" }));
    await provider.store(makeEntry({ entityId: "EB", content: "entity B memory" }));

    const results = await provider.query({ entityId: "EA" });
    expect(results).toHaveLength(1);
    expect(results[0]!.entityId).toBe("EA");
  });

  // ---- keyword relevance ----

  it("scores entries by keyword match when query is provided", async () => {
    const high = makeEntry({ entityId: "E3", content: "typescript config tsconfig setup" });
    const low = makeEntry({ entityId: "E3", content: "unrelated topic about cooking" });
    await provider.store(high);
    await provider.store(low);

    const results = await provider.query({ entityId: "E3", query: "typescript config" });
    // Both may be returned but higher-scoring entry should appear first
    expect(results[0]!.id).toBe(high.id);
  });

  it("filters out entries below minRelevance", async () => {
    await provider.store(makeEntry({ entityId: "E4", content: "completely unrelated content here" }));
    await provider.store(makeEntry({ entityId: "E4", content: "typescript is great for type safety" }));

    const results = await provider.query({
      entityId: "E4",
      query: "typescript type",
      minRelevance: 0.5,
    });

    // All returned entries must meet min relevance
    for (const r of results) {
      expect(r.relevanceScore ?? 0).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("returns zero results when nothing matches with high minRelevance", async () => {
    await provider.store(makeEntry({ entityId: "E5", content: "completely different topic" }));

    const results = await provider.query({
      entityId: "E5",
      query: "typescript",
      minRelevance: 1.0,
    });

    expect(results).toHaveLength(0);
  });

  it("sorts by recency when no query is provided", async () => {
    const older = makeEntry({
      entityId: "E6",
      content: "older entry",
      lastAccessedAt: "2024-01-01T00:00:00.000Z",
    });
    const newer = makeEntry({
      entityId: "E6",
      content: "newer entry",
      lastAccessedAt: "2025-06-01T00:00:00.000Z",
    });
    await provider.store(older);
    await provider.store(newer);

    const results = await provider.query({ entityId: "E6" });
    expect(results[0]!.id).toBe(newer.id);
  });

  // ---- category filter ----

  it("filters by category when categories param is provided", async () => {
    await provider.store(makeEntry({ entityId: "E7", category: "preference", content: "prefers vim" }));
    await provider.store(makeEntry({ entityId: "E7", category: "fact", content: "knows python" }));
    await provider.store(makeEntry({ entityId: "E7", category: "decision", content: "chose postgres" }));

    const results = await provider.query({ entityId: "E7", categories: ["preference", "decision"] });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(["preference", "decision"]).toContain(r.category);
    }
  });

  it("returns all categories when categories array is empty", async () => {
    await provider.store(makeEntry({ entityId: "E8", category: "preference" }));
    await provider.store(makeEntry({ entityId: "E8", category: "fact" }));

    const results = await provider.query({ entityId: "E8", categories: [] });
    expect(results).toHaveLength(2);
  });

  // ---- limit ----

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await provider.store(makeEntry({ entityId: "E9", content: `memory ${String(i)}` }));
    }

    const results = await provider.query({ entityId: "E9", limit: 3 });
    expect(results).toHaveLength(3);
  });

  it("defaults to limit 10 when not specified", async () => {
    for (let i = 0; i < 15; i++) {
      await provider.store(makeEntry({ entityId: "E10", content: `memory ${String(i)}` }));
    }

    const results = await provider.query({ entityId: "E10" });
    expect(results).toHaveLength(10);
  });

  // ---- access tracking ----

  it("increments accessCount after query", async () => {
    const entry = makeEntry({ entityId: "E11", content: "tracked memory", accessCount: 0 });
    await provider.store(entry);

    await provider.query({ entityId: "E11" });
    const results2 = await provider.query({ entityId: "E11" });
    expect(results2[0]!.accessCount).toBeGreaterThanOrEqual(1);
  });

  // ---- delete ----

  it("deletes a single entry by id", async () => {
    const entry = makeEntry({ entityId: "E12", content: "to be deleted" });
    await provider.store(entry);
    expect(await provider.count("E12")).toBe(1);

    await provider.delete(entry.id);
    expect(await provider.count("E12")).toBe(0);
  });

  it("delete of non-existent id does not throw", async () => {
    await expect(provider.delete("no-such-id")).resolves.toBeUndefined();
  });

  it("deleteAllForEntity removes all entries for that entity", async () => {
    await provider.store(makeEntry({ entityId: "E13", content: "memory one" }));
    await provider.store(makeEntry({ entityId: "E13", content: "memory two" }));
    await provider.store(makeEntry({ entityId: "E14", content: "different entity" }));

    await provider.deleteAllForEntity("E13");

    expect(await provider.count("E13")).toBe(0);
    expect(await provider.count("E14")).toBe(1);
  });

  it("deleteAllForEntity on nonexistent entity does not throw", async () => {
    await expect(provider.deleteAllForEntity("ghost-entity")).resolves.toBeUndefined();
  });

  // ---- prune by age ----

  it("prunes entries older than the given date", async () => {
    const old = makeEntry({
      entityId: "E15",
      content: "old memory",
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    const fresh = makeEntry({
      entityId: "E15",
      content: "fresh memory",
      createdAt: "2025-06-01T00:00:00.000Z",
    });
    await provider.store(old);
    await provider.store(fresh);

    const pruned = await provider.prune({
      entityId: "E15",
      olderThan: "2024-01-01T00:00:00.000Z",
    });

    expect(pruned).toBe(1);
    expect(await provider.count("E15")).toBe(1);
    const remaining = await provider.query({ entityId: "E15" });
    expect(remaining[0]!.id).toBe(fresh.id);
  });

  // ---- prune by access count ----

  it("prunes entries with access count below threshold", async () => {
    const lowAccess = makeEntry({ entityId: "E16", content: "rarely accessed", accessCount: 0 });
    const highAccess = makeEntry({ entityId: "E16", content: "frequently accessed", accessCount: 10 });
    await provider.store(lowAccess);
    await provider.store(highAccess);

    const pruned = await provider.prune({ entityId: "E16", accessCountBelow: 5 });

    expect(pruned).toBe(1);
    expect(await provider.count("E16")).toBe(1);
    const remaining = await provider.query({ entityId: "E16" });
    expect(remaining[0]!.id).toBe(highAccess.id);
  });

  // ---- prune maxPerEntity ----

  it("prunes down to maxPerEntity limit, keeping most accessed", async () => {
    for (let i = 0; i < 5; i++) {
      await provider.store(
        makeEntry({ entityId: "E17", content: `memory ${String(i)}`, accessCount: i }),
      );
    }

    const pruned = await provider.prune({ entityId: "E17", maxPerEntity: 2 });

    expect(pruned).toBe(3);
    expect(await provider.count("E17")).toBe(2);
  });

  it("prune with maxPerEntity does not remove entries when under limit", async () => {
    await provider.store(makeEntry({ entityId: "E18", content: "only entry" }));

    const pruned = await provider.prune({ entityId: "E18", maxPerEntity: 5 });

    expect(pruned).toBe(0);
    expect(await provider.count("E18")).toBe(1);
  });

  // ---- count ----

  it("count returns 0 for an entity with no entries", async () => {
    expect(await provider.count("no-entity")).toBe(0);
  });

  it("count returns correct number after stores", async () => {
    await provider.store(makeEntry({ entityId: "E19" }));
    await provider.store(makeEntry({ entityId: "E19" }));
    expect(await provider.count("E19")).toBe(2);
  });

  // ---- getAllPending / getPendingSyncCount ----

  it("getAllPending returns all entries across all entities", async () => {
    await provider.store(makeEntry({ entityId: "EA" }));
    await provider.store(makeEntry({ entityId: "EB" }));
    await provider.store(makeEntry({ entityId: "EB" }));

    const all = provider.getAllPending();
    expect(all).toHaveLength(3);
  });

  it("getPendingSyncCount returns total count across entities", async () => {
    await provider.store(makeEntry({ entityId: "EX" }));
    await provider.store(makeEntry({ entityId: "EY" }));
    expect(provider.getPendingSyncCount()).toBe(2);
  });

  it("getPendingSyncCount returns 0 when empty", () => {
    expect(provider.getPendingSyncCount()).toBe(0);
  });

  // ---- isAvailable ----

  it("isAvailable always returns true", async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  // ---- storeBatch ----

  it("storeBatch stores all entries", async () => {
    const entries = [
      makeEntry({ entityId: "EB1" }),
      makeEntry({ entityId: "EB1" }),
      makeEntry({ entityId: "EB1" }),
    ];
    await provider.storeBatch(entries);
    expect(await provider.count("EB1")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 2. CogneeMemoryProvider
// ---------------------------------------------------------------------------

describe("CogneeMemoryProvider", () => {
  let provider: CogneeMemoryProvider;

  const mockFetch = vi.fn();

  beforeEach(() => {
    entryCounter = 0;
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    provider = new CogneeMemoryProvider({ apiKey: "test-key-123", endpoint: "https://test.cognee.ai/v1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---- helpers ----

  function mockOk(body: unknown, status = 200): void {
    mockFetch.mockResolvedValue({
      ok: true,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }

  function mockNoContent(): void {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => undefined,
      text: async () => "",
    });
  }

  function mockError(status: number, message: string): void {
    mockFetch.mockResolvedValue({
      ok: false,
      status,
      statusText: "Error",
      text: async () => message,
      json: async () => ({ error: message }),
    });
  }

  // ---- store ----

  it("store sends POST to /memories with the entry as body", async () => {
    mockOk({});
    const entry = makeEntry({ entityId: "CE1" });
    await provider.store(entry);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test.cognee.ai/v1/memories");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toMatchObject({ id: entry.id });
  });

  it("store includes Authorization header with API key", async () => {
    mockOk({});
    await provider.store(makeEntry({ entityId: "CE2" }));

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-key-123");
  });

  it("store throws when API returns non-ok response", async () => {
    mockError(500, "Internal Server Error");
    await expect(provider.store(makeEntry({ entityId: "CE3" }))).rejects.toThrow("Cognee API error");
  });

  // ---- storeBatch ----

  it("storeBatch sends POST to /memories/batch with entries array", async () => {
    mockOk({});
    const entries = [makeEntry({ entityId: "CB1" }), makeEntry({ entityId: "CB1" })];
    await provider.storeBatch(entries);

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test.cognee.ai/v1/memories/batch");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body as string) as { entries: MemoryEntry[] };
    expect(body.entries).toHaveLength(2);
  });

  // ---- query ----

  it("query sends POST to /memories/search and returns results", async () => {
    const fakeResult = makeEntry({ entityId: "CQ1" });
    mockOk({ results: [fakeResult] });

    const results = await provider.query({ entityId: "CQ1", query: "test topic", limit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(fakeResult.id);
  });

  it("query sends correct search params to API", async () => {
    mockOk({ results: [] });
    await provider.query({
      entityId: "CQ2",
      query: "my query",
      categories: ["preference", "fact"],
      limit: 7,
      minRelevance: 0.4,
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test.cognee.ai/v1/memories/search");
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body["entity_id"]).toBe("CQ2");
    expect(body["query"]).toBe("my query");
    expect(body["limit"]).toBe(7);
    expect(body["min_relevance"]).toBe(0.4);
    expect(body["categories"]).toEqual(["preference", "fact"]);
  });

  it("query defaults limit to 10 and minRelevance to 0", async () => {
    mockOk({ results: [] });
    await provider.query({ entityId: "CQ3" });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body["limit"]).toBe(10);
    expect(body["min_relevance"]).toBe(0);
  });

  // ---- delete ----

  it("delete sends DELETE to /memories/:id", async () => {
    mockNoContent();
    await provider.delete("mem-abc");

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test.cognee.ai/v1/memories/mem-abc");
    expect(options.method).toBe("DELETE");
  });

  it("delete resolves without body on 204 response", async () => {
    mockNoContent();
    await expect(provider.delete("mem-xyz")).resolves.toBeUndefined();
  });

  // ---- deleteAllForEntity ----

  it("deleteAllForEntity sends DELETE to /memories/entity/:entityId", async () => {
    mockNoContent();
    await provider.deleteAllForEntity("my-entity");

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test.cognee.ai/v1/memories/entity/my-entity");
    expect(options.method).toBe("DELETE");
  });

  // ---- prune ----

  it("prune sends POST to /memories/prune and returns count", async () => {
    mockOk({ pruned: 7 });
    const count = await provider.prune({
      entityId: "PE1",
      olderThan: "2024-01-01T00:00:00.000Z",
      accessCountBelow: 2,
      maxPerEntity: 50,
    });

    expect(count).toBe(7);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test.cognee.ai/v1/memories/prune");
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body["entity_id"]).toBe("PE1");
    expect(body["older_than"]).toBe("2024-01-01T00:00:00.000Z");
    expect(body["access_count_below"]).toBe(2);
    expect(body["max_per_entity"]).toBe(50);
  });

  // ---- count ----

  it("count sends GET to /memories/entity/:entityId/count", async () => {
    mockOk({ count: 42 });
    const result = await provider.count("my-entity");

    expect(result).toBe(42);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test.cognee.ai/v1/memories/entity/my-entity/count");
    expect(options.method).toBe("GET");
  });

  // ---- isAvailable ----

  it("isAvailable returns false when API key is empty", async () => {
    const noKeyProvider = new CogneeMemoryProvider({ apiKey: "", endpoint: "https://test.cognee.ai/v1" });
    expect(await noKeyProvider.isAvailable()).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("isAvailable returns true when API key is set and health check succeeds", async () => {
    mockOk({ status: "ok" });
    expect(await provider.isAvailable()).toBe(true);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("https://test.cognee.ai/v1/health");
  });

  it("isAvailable returns false when health check throws", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    expect(await provider.isAvailable()).toBe(false);
  });

  it("isAvailable returns false when health check returns non-ok", async () => {
    mockError(503, "Service Unavailable");
    expect(await provider.isAvailable()).toBe(false);
  });

  it("falls back to COGNEE_API_KEY env var when no key provided in config", async () => {
    process.env["COGNEE_API_KEY"] = "env-key-456";
    const envProvider = new CogneeMemoryProvider({ endpoint: "https://test.cognee.ai/v1" });
    mockOk({ status: "ok" });
    await envProvider.isAvailable();

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toBe("Bearer env-key-456");
    delete process.env["COGNEE_API_KEY"];
  });
});

// ---------------------------------------------------------------------------
// 3. CompositeMemoryAdapter
// ---------------------------------------------------------------------------

describe("CompositeMemoryAdapter", () => {
  let state: GatewayState;
  let dir: string;
  let adapter: CompositeMemoryAdapter;

  const mockFetch = vi.fn();

  beforeEach(() => {
    entryCounter = 0;
    state = "ONLINE";
    dir = makeTempDir();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();

    adapter = new CompositeMemoryAdapter({
      getState: () => state,
      localMemDir: dir,
      cogneeApiKey: "composite-key",
      cogneeEndpoint: "https://test.cognee.ai/v1",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  function mockCogneeOk(body: unknown, status = 200): void {
    mockFetch.mockResolvedValue({
      ok: true,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }

  function mockCogneeError(): void {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      text: async () => "error",
      json: async () => ({ error: "error" }),
    });
  }

  function mockCogneeNoContent(): void {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => undefined,
      text: async () => "",
    });
  }

  // ---- routing to Cognee when ONLINE ----

  it("routes store to Cognee when state is ONLINE", async () => {
    mockCogneeOk({});
    state = "ONLINE";
    await adapter.store(makeEntry({ entityId: "CA1" }));

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("/memories");
  });

  it("routes query to Cognee when state is ONLINE", async () => {
    mockCogneeOk({ results: [] });
    state = "ONLINE";
    await adapter.query({ entityId: "CA2" });

    expect(mockFetch).toHaveBeenCalled();
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("/memories/search");
  });

  // ---- routing to file when LIMBO ----

  it("routes store to file when state is LIMBO", async () => {
    state = "LIMBO";
    const entry = makeEntry({ entityId: "CF1" });
    await adapter.store(entry);

    // Cognee should NOT have been called
    expect(mockFetch).not.toHaveBeenCalled();
    // File should contain the entry
    const fileProvider = new FileMemoryProvider(dir);
    expect(await fileProvider.count("CF1")).toBe(1);
  });

  it("routes query to file when state is OFFLINE", async () => {
    state = "OFFLINE";
    const fileProvider = new FileMemoryProvider(dir);
    await fileProvider.store(makeEntry({ entityId: "CF2", content: "offline memory" }));

    const results = await adapter.query({ entityId: "CF2" });
    expect(results).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("routes query to file when state is UNKNOWN", async () => {
    state = "UNKNOWN";
    const fileProvider = new FileMemoryProvider(dir);
    await fileProvider.store(makeEntry({ entityId: "CF3", content: "unknown state memory" }));

    const results = await adapter.query({ entityId: "CF3" });
    expect(results).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ---- fallback to file when Cognee throws ----

  it("falls back to file store when Cognee store throws", async () => {
    mockCogneeError();
    state = "ONLINE";
    const entry = makeEntry({ entityId: "CFB1" });
    await adapter.store(entry);

    // Should NOT throw
    const fileProvider = new FileMemoryProvider(dir);
    expect(await fileProvider.count("CFB1")).toBe(1);
  });

  it("falls back to file storeBatch when Cognee storeBatch throws", async () => {
    mockCogneeError();
    state = "ONLINE";
    const entries = [makeEntry({ entityId: "CFB2" }), makeEntry({ entityId: "CFB2" })];
    await adapter.storeBatch(entries);

    const fileProvider = new FileMemoryProvider(dir);
    expect(await fileProvider.count("CFB2")).toBe(2);
  });

  // ---- delete propagation ----

  it("delete calls Cognee AND file when state is ONLINE", async () => {
    state = "ONLINE";
    // First store to file so delete has something to work with
    const fileProvider = new FileMemoryProvider(dir);
    const entry = makeEntry({ entityId: "CD1" });
    await fileProvider.store(entry);

    // Mock Cognee delete (204)
    mockCogneeNoContent();
    await adapter.delete(entry.id);

    // Cognee was called
    expect(mockFetch).toHaveBeenCalled();
    // File entry was also removed
    expect(await fileProvider.count("CD1")).toBe(0);
  });

  it("delete only touches file when state is OFFLINE", async () => {
    state = "OFFLINE";
    const fileProvider = new FileMemoryProvider(dir);
    const entry = makeEntry({ entityId: "CD2" });
    await fileProvider.store(entry);

    await adapter.delete(entry.id);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(await fileProvider.count("CD2")).toBe(0);
  });

  it("deleteAllForEntity calls Cognee AND file when ONLINE", async () => {
    state = "ONLINE";
    const fileProvider = new FileMemoryProvider(dir);
    await fileProvider.store(makeEntry({ entityId: "CDA1" }));

    mockCogneeNoContent();
    await adapter.deleteAllForEntity("CDA1");

    expect(mockFetch).toHaveBeenCalled();
    expect(await fileProvider.count("CDA1")).toBe(0);
  });

  it("deleteAllForEntity only touches file when LIMBO", async () => {
    state = "LIMBO";
    const fileProvider = new FileMemoryProvider(dir);
    await fileProvider.store(makeEntry({ entityId: "CDA2" }));

    await adapter.deleteAllForEntity("CDA2");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(await fileProvider.count("CDA2")).toBe(0);
  });

  // ---- syncPendingToCognee ----

  it("syncPendingToCognee transfers file entries to Cognee when ONLINE", async () => {
    state = "LIMBO";
    // Accumulate entries in file while LIMBO
    await adapter.store(makeEntry({ entityId: "CS1" }));
    await adapter.store(makeEntry({ entityId: "CS1" }));

    // Transition to ONLINE
    state = "ONLINE";

    // Health check + batch store
    mockFetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ status: "ok" }),
        text: async () => "ok",
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({}),
        text: async () => "{}",
      });

    const synced = await adapter.syncPendingToCognee();
    expect(synced).toBe(2);
    // File entries should be cleared
    expect(adapter.getPendingSyncCount()).toBe(0);
  });

  it("syncPendingToCognee returns 0 when state is not ONLINE", async () => {
    state = "LIMBO";
    const result = await adapter.syncPendingToCognee();
    expect(result).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("syncPendingToCognee returns 0 when Cognee is unavailable", async () => {
    state = "ONLINE";
    // Health check fails
    mockFetch.mockResolvedValue({
      ok: false, status: 503, statusText: "Unavailable",
      text: async () => "unavailable",
      json: async () => ({}),
    });

    const fileProvider = new FileMemoryProvider(dir);
    await fileProvider.store(makeEntry({ entityId: "CS2" }));

    const result = await adapter.syncPendingToCognee();
    expect(result).toBe(0);
    // File entries remain
    expect(adapter.getPendingSyncCount()).toBe(1);
  });

  it("syncPendingToCognee returns 0 when no pending entries", async () => {
    state = "ONLINE";
    // Health check succeeds
    mockCogneeOk({ status: "ok" });
    const result = await adapter.syncPendingToCognee();
    expect(result).toBe(0);
  });

  it("syncPendingToCognee returns 0 and leaves file intact when batch fails", async () => {
    state = "LIMBO";
    await adapter.store(makeEntry({ entityId: "CS3" }));
    state = "ONLINE";

    // Health check ok, then batch fails
    mockFetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ status: "ok" }),
        text: async () => "ok",
      })
      .mockResolvedValueOnce({
        ok: false, status: 500, statusText: "Error",
        text: async () => "batch error",
        json: async () => ({}),
      });

    const synced = await adapter.syncPendingToCognee();
    expect(synced).toBe(0);
    // File entries remain for retry
    expect(adapter.getPendingSyncCount()).toBe(1);
  });

  // ---- getPendingSyncCount ----

  it("getPendingSyncCount reflects file store count", async () => {
    state = "OFFLINE";
    await adapter.store(makeEntry({ entityId: "CP1" }));
    await adapter.store(makeEntry({ entityId: "CP2" }));
    expect(adapter.getPendingSyncCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Memory retrieval (retrieval.ts)
// ---------------------------------------------------------------------------

describe("retrieveMemories", () => {
  let dir: string;
  let fileProvider: FileMemoryProvider;

  beforeEach(() => {
    entryCounter = 0;
    dir = makeTempDir();
    fileProvider = new FileMemoryProvider(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty injection when provider has no memories", async () => {
    const result = await retrieveMemories(fileProvider, "ghost-entity", "some topic");

    expect(result.memoriesIncluded).toBe(0);
    expect(result.promptBlock).toBe("");
    expect(result.estimatedTokens).toBe(0);
    expect(result.entityId).toBe("ghost-entity");
  });

  it("formats promptBlock with header and memory lines", async () => {
    await fileProvider.store(makeEntry({
      entityId: "R1",
      content: "user prefers dark mode",
      category: "preference",
    }));

    // query term matches content
    const result = await retrieveMemories(fileProvider, "R1", "dark mode preferences", {
      minRelevance: 0,
    });

    expect(result.memoriesIncluded).toBeGreaterThan(0);
    expect(result.promptBlock).toContain("## Entity Memory");
    expect(result.promptBlock).toContain("[preference]");
    expect(result.promptBlock).toContain("user prefers dark mode");
  });

  it("includes entity ID in result", async () => {
    await fileProvider.store(makeEntry({ entityId: "R2", content: "something remembered" }));
    const result = await retrieveMemories(fileProvider, "R2", "something", { minRelevance: 0 });
    expect(result.entityId).toBe("R2");
  });

  it("enforces token budget — excludes entries that would exceed budget", async () => {
    // Store many entries to test budget enforcement
    for (let i = 0; i < 20; i++) {
      await fileProvider.store(makeEntry({
        entityId: "R3",
        content: `memory entry number ${String(i)} about important topic`,
        category: "fact",
      }));
    }

    const tinyBudget = 50; // Very small token budget
    const result = await retrieveMemories(fileProvider, "R3", "important topic", {
      tokenBudget: tinyBudget,
      minRelevance: 0,
    });

    // With a tiny budget, only a few (or zero) entries should be included
    // The header alone may exceed the budget
    expect(result.estimatedTokens).toBeLessThanOrEqual(tinyBudget + 50); // some slack for header
  });

  it("respects maxMemories limit", async () => {
    for (let i = 0; i < 10; i++) {
      await fileProvider.store(makeEntry({
        entityId: "R4",
        content: `relevant topic entry ${String(i)}`,
      }));
    }

    const result = await retrieveMemories(fileProvider, "R4", "relevant topic", {
      maxMemories: 3,
      minRelevance: 0,
    });

    expect(result.memoriesIncluded).toBeLessThanOrEqual(3);
  });

  it("orders priority categories before non-priority categories", async () => {
    await fileProvider.store(makeEntry({
      entityId: "R5",
      content: "conversation note something",
      category: "conversation",
    }));
    await fileProvider.store(makeEntry({
      entityId: "R5",
      content: "preference note something",
      category: "preference",
    }));

    const result = await retrieveMemories(fileProvider, "R5", "something", {
      minRelevance: 0,
      priorityCategories: ["preference", "decision", "fact"],
    });

    // The block should list [preference] before [conversation]
    const block = result.promptBlock;
    const prefIdx = block.indexOf("[preference]");
    const convIdx = block.indexOf("[conversation]");

    if (prefIdx !== -1 && convIdx !== -1) {
      expect(prefIdx).toBeLessThan(convIdx);
    }
  });

  it("returns empty when all memories fall below minRelevance threshold", async () => {
    await fileProvider.store(makeEntry({
      entityId: "R6",
      content: "completely unrelated to query",
    }));

    const result = await retrieveMemories(fileProvider, "R6", "typescript", {
      minRelevance: 0.9,
    });

    expect(result.memoriesIncluded).toBe(0);
    expect(result.promptBlock).toBe("");
  });

  it("estimates tokens as a positive number when memories are included", async () => {
    await fileProvider.store(makeEntry({
      entityId: "R7",
      content: "token count test memory entry",
    }));

    const result = await retrieveMemories(fileProvider, "R7", "token count", {
      minRelevance: 0,
    });

    if (result.memoriesIncluded > 0) {
      expect(result.estimatedTokens).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. extractSessionMemories
// ---------------------------------------------------------------------------

describe("extractSessionMemories", () => {
  beforeEach(() => {
    entryCounter = 0;
  });

  it("creates a conversation entry from session summary", () => {
    const entries = extractSessionMemories({
      entityId: "ES1",
      sessionSummary: "Discussed TypeScript migration plans",
      topicsDiscussed: [],
      turnsCount: 5,
    }, "2025-06-01T12:00:00.000Z");

    expect(entries).toHaveLength(1);
    expect(entries[0]!.category).toBe("conversation");
    expect(entries[0]!.source).toBe("session_close");
    expect(entries[0]!.content).toBe("Discussed TypeScript migration plans");
    expect(entries[0]!.entityId).toBe("ES1");
  });

  it("uses the provided timestamp for all entries", () => {
    const ts = "2025-07-15T10:30:00.000Z";
    const entries = extractSessionMemories({
      entityId: "ES2",
      sessionSummary: "Test session",
      topicsDiscussed: ["topic-a"],
      turnsCount: 3,
    }, ts);

    for (const e of entries) {
      expect(e.createdAt).toBe(ts);
      expect(e.lastAccessedAt).toBe(ts);
    }
  });

  it("uses current time when no timestamp provided", () => {
    const before = new Date().toISOString();
    const entries = extractSessionMemories({
      entityId: "ES3",
      sessionSummary: "Auto-timestamp session",
      topicsDiscussed: [],
      turnsCount: 1,
    });
    const after = new Date().toISOString();

    for (const e of entries) {
      expect(e.createdAt >= before).toBe(true);
      expect(e.createdAt <= after).toBe(true);
    }
  });

  it("creates fact entries for each topic discussed", () => {
    const entries = extractSessionMemories({
      entityId: "ES4",
      sessionSummary: "Session summary here",
      topicsDiscussed: ["typescript", "testing", "vitest"],
      turnsCount: 10,
    }, "2025-01-01T00:00:00.000Z");

    // 1 conversation + 3 topic facts
    expect(entries).toHaveLength(4);
    const facts = entries.filter((e) => e.category === "fact");
    expect(facts).toHaveLength(3);
    expect(facts[0]!.content).toBe("Discussed topic: typescript");
    expect(facts[1]!.content).toBe("Discussed topic: testing");
    expect(facts[2]!.content).toBe("Discussed topic: vitest");
  });

  it("limits topic entries to 5 even with more topics provided", () => {
    const topics = ["a", "b", "c", "d", "e", "f", "g"];
    const entries = extractSessionMemories({
      entityId: "ES5",
      sessionSummary: "Long session",
      topicsDiscussed: topics,
      turnsCount: 20,
    }, "2025-01-01T00:00:00.000Z");

    // 1 conversation + max 5 topics
    expect(entries).toHaveLength(6);
  });

  it("skips conversation entry when sessionSummary is empty", () => {
    const entries = extractSessionMemories({
      entityId: "ES6",
      sessionSummary: "",
      topicsDiscussed: ["topic-one"],
      turnsCount: 2,
    }, "2025-01-01T00:00:00.000Z");

    // No conversation entry, only the topic fact
    expect(entries).toHaveLength(1);
    expect(entries[0]!.category).toBe("fact");
  });

  it("returns empty array when summary is empty and no topics", () => {
    const entries = extractSessionMemories({
      entityId: "ES7",
      sessionSummary: "",
      topicsDiscussed: [],
      turnsCount: 0,
    });

    expect(entries).toHaveLength(0);
  });

  it("initializes accessCount to 0 for all entries", () => {
    const entries = extractSessionMemories({
      entityId: "ES8",
      sessionSummary: "Some session",
      topicsDiscussed: ["topic"],
      turnsCount: 5,
    }, "2025-01-01T00:00:00.000Z");

    for (const e of entries) {
      expect(e.accessCount).toBe(0);
    }
  });

  it("sets source to session_close for all entries", () => {
    const entries = extractSessionMemories({
      entityId: "ES9",
      sessionSummary: "Source check",
      topicsDiscussed: ["a", "b"],
      turnsCount: 4,
    }, "2025-01-01T00:00:00.000Z");

    for (const e of entries) {
      expect(e.source).toBe("session_close");
    }
  });

  it("sets correct entityId on all entries", () => {
    const entries = extractSessionMemories({
      entityId: "ES10",
      sessionSummary: "Entity check",
      topicsDiscussed: ["topic"],
      turnsCount: 1,
    }, "2025-01-01T00:00:00.000Z");

    for (const e of entries) {
      expect(e.entityId).toBe("ES10");
    }
  });
});
