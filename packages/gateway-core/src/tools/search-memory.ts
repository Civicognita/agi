/**
 * search_memory tool — active recall over Aion's episodic memory (memory_events).
 *
 * Closes the gap behind "Aion says it has memories but no way to search them":
 * episodic memories were only ever injected PASSIVELY at prompt-assembly time
 * (recall-on-inbound). With no tool, Aion could not query its own past
 * observations/decisions on demand. This delegates to the same GraphMemoryAdapter
 * the /api/memory/events browser uses, so the dashboard and the agent read one
 * shared memory.
 *
 * No state/tier gate — recall is always available regardless of gateway state.
 */

import type { ToolHandler, ToolExecutionContext } from "../tool-registry.js";

/** Minimal slice of GraphMemoryAdapter this tool depends on. */
export interface MemoryEventQuerier {
  queryGraphEvents(params: {
    entityId?: string;
    projectPath?: string | null;
    scopes?: string[];
    semantic?: string;
    tags?: string[];
    minConfidence?: number;
    limit?: number;
  }): Promise<Array<{
    id: string;
    summary: string;
    tags: string[];
    confidence: number;
    createdAt: number | Date | string;
    projectPath?: string | null;
    scope?: string | null;
    coaFingerprint: string;
  }>>;
}

export interface SearchMemoryConfig {
  graphAdapter: MemoryEventQuerier;
}

function isoOf(v: number | Date | string): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  const n = Number(v);
  return Number.isFinite(n) ? new Date(n).toISOString() : String(v);
}

export function createSearchMemoryHandler(config: SearchMemoryConfig): ToolHandler {
  return async (input: Record<string, unknown>, ctx?: ToolExecutionContext): Promise<string> => {
    const query = String(input.query ?? "").trim();
    const limit = Math.min(Math.max(Number(input.limit ?? 5), 1), 20);
    const projectPath = typeof input.projectPath === "string" && input.projectPath.length > 0
      ? input.projectPath
      : undefined;
    const tags = Array.isArray(input.tags) ? input.tags.map(String) : undefined;
    const minConfidence = typeof input.minConfidence === "number" ? input.minConfidence : undefined;
    // s234 — locality confinement. An explicit `scope`/`scopes` arg lets the
    // agent narrow within its own stack. When OMITTED, we DON'T search
    // everything (that bled one channel's memories into another) — we default to
    // the invocation's scope-stack (ctx.memoryScopes), the same confinement
    // passive recall uses. Only a truly context-free call (no ctx) searches all.
    const explicitScopes = Array.isArray(input.scopes)
      ? input.scopes.map(String)
      : typeof input.scope === "string" && input.scope.length > 0
        ? [input.scope]
        : undefined;
    // The OWNER's in-app console is the unified "one mind" view: an unscoped
    // search there spans ALL scopes (so the console can search Discord/channel
    // memories). Everywhere else, an omitted scope stays confined to the request
    // stack (no cross-channel bleed). Explicit scope always wins.
    const scopes = explicitScopes
      ?? (ctx?.ownerConsole === true
        ? undefined
        : (ctx?.memoryScopes !== undefined && ctx.memoryScopes.length > 0 ? ctx.memoryScopes : undefined));

    try {
      const events = await config.graphAdapter.queryGraphEvents({
        semantic: query.length > 0 ? query : undefined,
        projectPath,
        scopes,
        tags,
        minConfidence,
        limit,
      });

      const results = events.map((e) => ({
        summary: e.summary,
        tags: e.tags,
        confidence: e.confidence,
        createdAt: isoOf(e.createdAt),
        projectPath: e.projectPath ?? null,
        scope: e.scope ?? null,
      }));

      return JSON.stringify({ results, count: results.length, query: query || null });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

export const SEARCH_MEMORY_MANIFEST = {
  name: "search_memory",
  description:
    "Search your own episodic memory — prior observations, decisions, and facts. By default this is CONFINED to the current conversation's locality (this room/channel plus the broader machine-wide/project layers that cascade down); memories from OTHER channels/rooms stay private and are not returned. Returns matching memories with summary, tags, confidence, and timestamp. Use when recalled context in the prompt is insufficient and you need to look further back.",
  requiresState: [] as string[],
  requiresTier: [] as string[],
};

export const SEARCH_MEMORY_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", description: "Natural-language query — what to recall. Empty returns the most recent memories." },
    limit: { type: "number", description: "Maximum results (default: 5, max: 20)" },
    projectPath: { type: "string", description: "Absolute project path — scope recall to one project's memories" },
    scope: { type: "string", description: "Filter to one locality scope: 'gestalt', 'project:<path>', 'provider:<channelId>', or 'room:<channelId>:<roomId>'" },
    scopes: { type: "array", items: { type: "string" }, description: "Filter to any of these locality scopes (the recall scope-stack)" },
    tags: { type: "array", items: { type: "string" }, description: "Filter to memories carrying any of these tags" },
    minConfidence: { type: "number", description: "Only return memories at or above this confidence (0..1)" },
  },
  required: [] as string[],
};
