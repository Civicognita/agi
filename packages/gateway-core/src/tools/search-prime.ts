/**
 * search_prime tool — keyword search over the PRIME knowledge corpus (.aionima/).
 *
 * Returns matching entries with title, category, path, and a content excerpt.
 */
import type { ToolHandler } from "../tool-registry.js";
import type { PrimeLoader } from "../prime-loader.js";

export interface SearchPrimeConfig {
  primeLoader: PrimeLoader;
}

export function createSearchPrimeHandler(config: SearchPrimeConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const query = String(input.query ?? "").trim();
    if (query.length === 0) {
      return JSON.stringify({ error: "query must not be empty" });
    }

    const limit = Math.min(Math.max(Number(input.limit ?? 10), 1), 50);

    try {
      const results = config.primeLoader.search(query, limit);

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
  description: "Search the PRIME knowledge corpus (.aionima/) by keyword query. Returns matching entries with title, category, and content excerpt.",
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
