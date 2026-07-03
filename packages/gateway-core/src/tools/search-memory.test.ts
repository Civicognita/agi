/**
 * search_memory tool tests — active recall over episodic memory.
 */
import { describe, it, expect, vi } from "vitest";

import { createSearchMemoryHandler, SEARCH_MEMORY_MANIFEST, SEARCH_MEMORY_INPUT_SCHEMA, type MemoryEventQuerier } from "./search-memory.js";

function fakeAdapter(events: Parameters<MemoryEventQuerier["queryGraphEvents"]> extends never ? never : Array<{ id: string; summary: string; tags: string[]; confidence: number; createdAt: number | Date | string; projectPath?: string | null; coaFingerprint: string }>): { adapter: MemoryEventQuerier; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const adapter: MemoryEventQuerier = {
    queryGraphEvents: async (params) => { calls.push(params as Record<string, unknown>); return events; },
  };
  return { adapter, calls };
}

const EV = (over: Partial<{ id: string; summary: string; tags: string[]; confidence: number; createdAt: number; projectPath: string | null; coaFingerprint: string }> = {}) => ({
  id: over.id ?? "01J",
  summary: over.summary ?? "decided to ship the fix",
  tags: over.tags ?? ["decision"],
  confidence: over.confidence ?? 0.8,
  createdAt: over.createdAt ?? 1_700_000_000_000,
  projectPath: over.projectPath ?? null,
  coaFingerprint: over.coaFingerprint ?? "abc",
});

describe("search_memory tool", () => {
  it("returns formatted episodic results", async () => {
    const { adapter } = fakeAdapter([EV({ summary: "fixed the gateway" }), EV({ summary: "owner prefers X" })]);
    const handler = createSearchMemoryHandler({ graphAdapter: adapter });
    const out = JSON.parse(await handler({ query: "gateway" }) as string);
    expect(out.count).toBe(2);
    expect(out.results[0].summary).toBe("fixed the gateway");
    expect(out.results[0]).toHaveProperty("createdAt");
    expect(out.results[0].createdAt).toContain("T"); // ISO string
  });

  it("passes an empty query as semantic:undefined (most-recent recall)", async () => {
    const { adapter, calls } = fakeAdapter([EV()]);
    const handler = createSearchMemoryHandler({ graphAdapter: adapter });
    const out = JSON.parse(await handler({}) as string);
    expect(out.query).toBeNull();
    expect(calls[0]!.semantic).toBeUndefined();
  });

  it("clamps limit to [1,20] and forwards filters", async () => {
    const { adapter, calls } = fakeAdapter([EV()]);
    const handler = createSearchMemoryHandler({ graphAdapter: adapter });
    await handler({ query: "x", limit: 999, projectPath: "/p", tags: ["a"], minConfidence: 0.5 });
    expect(calls[0]!.limit).toBe(20);
    expect(calls[0]!.projectPath).toBe("/p");
    expect(calls[0]!.tags).toEqual(["a"]);
    expect(calls[0]!.minConfidence).toBe(0.5);
  });

  it("surfaces adapter errors as {error}", async () => {
    const adapter: MemoryEventQuerier = { queryGraphEvents: vi.fn().mockRejectedValue(new Error("db down")) };
    const handler = createSearchMemoryHandler({ graphAdapter: adapter });
    const out = JSON.parse(await handler({ query: "x" }) as string);
    expect(out.error).toBe("db down");
  });

  it("manifest has no state/tier gate and query is optional", () => {
    expect(SEARCH_MEMORY_MANIFEST.name).toBe("search_memory");
    expect(SEARCH_MEMORY_MANIFEST.requiresState).toEqual([]);
    expect(SEARCH_MEMORY_INPUT_SCHEMA.required).toEqual([]);
  });
});
