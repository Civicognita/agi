/**
 * search_prime tool — keyword + optional semantic search over the PRIME corpus.
 *
 * Returns matching entries with title, category, path, and a content excerpt.
 * When EmbeddingEngine is available and entries have pre-computed embeddings,
 * results are re-ranked by cosine similarity (s197 semantic upgrade).
 */
import type { ToolHandler } from "../tool-registry.js";
import type { PrimeLoader } from "../prime-loader.js";
import type { EmbeddingEngine } from "@agi/memory";

export interface SearchPrimeConfig {
  primeLoader: PrimeLoader;
  embeddingEngine?: EmbeddingEngine;
}

export function createSearchPrimeHandler(config: SearchPrimeConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const query = String(input.query ?? "").trim();
    if (query.length === 0) {
      return JSON.stringify({ error: "query must not be empty" });
    }

    const limit = Math.min(Math.max(Number(input.limit ?? 10), 1), 50);

    try {
      const queryEmbedding = config.embeddingEngine?.isAvailable()
        ? (await config.embeddingEngine.embed(query).catch(() => null)) ?? undefined
        : undefined;
      const results = config.primeLoader.search(query, limit, queryEmbedding);

      if (results.length === 0) {
        return JSON.stringify({ results: [], count: 0, query });
      }

      const formatted = results.map((entry) => ({
        title: entry.title,
        category: entry.category,
        path: entry.path,
        excerpt: entry.content.slice(0, 500),
      }));

      return JSON.stringify({ results: formatted, count: formatted.length, query });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

export const SEARCH_PRIME_MANIFEST = {
  name: "search_prime",
  description: "Search the PRIME knowledge corpus (.aionima/) by keyword or semantic query. Returns matching entries with title, category, and content excerpt. Uses embedding-based reranking when available.",
  requiresState: ["ONLINE" as const, "LIMBO" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const SEARCH_PRIME_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", description: "Keyword query to search for in the PRIME corpus" },
    limit: { type: "number", description: "Maximum number of results to return (default: 10, max: 50)" },
  },
  required: ["query"],
};
