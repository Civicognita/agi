/**
 * search_docs tool — semantic / keyword search over AGI docs and k/ knowledge files (s112 Phase 3).
 *
 * No state/tier gate — always available regardless of gateway state.
 * Delegates to DocIndexer which handles FTS5 + optional Ollama embedding reranking.
 */

import type { ToolHandler } from "../tool-registry.js";
import type { DocIndexer } from "../doc-indexer.js";

export interface SearchDocsConfig {
  docIndexer: DocIndexer;
}

export function createSearchDocsHandler(config: SearchDocsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const query = String(input.query ?? "").trim();
    if (query.length === 0) {
      return JSON.stringify({ error: "query must not be empty" });
    }

    const scopeInput = String(input.scope ?? "all");
    const limit = Math.min(Math.max(Number(input.limit ?? 5), 1), 20);

    // Scope: 'global' | 'project' (uses current project path) | 'all' (no filter)
    const scope = scopeInput === "all" ? undefined : scopeInput;
    const projectPath = typeof input.projectPath === "string" ? input.projectPath : undefined;
    const resolvedScope = scope === "project" && projectPath
      ? `project:${projectPath}`
      : scope === "project"
        ? undefined // can't filter without project path
        : scope;

    try {
      const results = await config.docIndexer.query({
        query,
        scope: resolvedScope,
        limit,
      });

      if (results.length === 0) {
        return JSON.stringify({ results: [], count: 0, query });
      }

      const formatted = results.map((r) => ({
        heading: r.heading ?? null,
        sourcePath: r.sourcePath,
        scope: r.scope,
        excerpt: r.content.slice(0, 600),
      }));

      return JSON.stringify({ results: formatted, count: formatted.length, query });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

export const SEARCH_DOCS_MANIFEST = {
  name: "search_docs",
  description: "Search AGI platform documentation and project knowledge files (k/ folders). Returns matching chunks with heading, source path, and content excerpt.",
  requiresState: [] as string[],
  requiresTier: [] as string[],
};

export const SEARCH_DOCS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query — supports natural language or keywords" },
    scope: {
      type: "string",
      enum: ["global", "project", "all"],
      description: "Scope: 'global' = agi/docs/ + global k/, 'project' = current project k/, 'all' = everything. Default: 'all'",
    },
    limit: { type: "number", description: "Maximum results (default: 5, max: 20)" },
    projectPath: { type: "string", description: "Absolute project path — required when scope is 'project'" },
  },
  required: ["query"],
};
