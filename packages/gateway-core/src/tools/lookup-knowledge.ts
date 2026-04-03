/**
 * lookup_knowledge tool — read a specific file from the PRIME knowledge corpus by path.
 *
 * Validates the path to prevent directory traversal outside .aionima/.
 */
import type { ToolHandler } from "../tool-registry.js";
import type { PrimeLoader } from "../prime-loader.js";

export interface LookupKnowledgeConfig {
  primeLoader: PrimeLoader;
}

export function createLookupKnowledgeHandler(config: LookupKnowledgeConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const filePath = String(input.path ?? "").trim();
    if (filePath.length === 0) {
      return JSON.stringify({ error: "path must not be empty" });
    }

    // Security: reject path traversal
    const normalized = filePath.replace(/\\/g, "/");
    if (normalized.includes("..") || normalized.startsWith("/")) {
      return JSON.stringify({ error: "Invalid path: must be a relative path within the PRIME corpus" });
    }

    try {
      const content = config.primeLoader.getByPath(normalized);

      if (content === undefined) {
        return JSON.stringify({ error: `File not found: ${normalized}` });
      }

      return JSON.stringify({ path: normalized, content, bytes: content.length });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

export const LOOKUP_KNOWLEDGE_MANIFEST = {
  name: "lookup_knowledge",
  description: "Read a specific file from the PRIME knowledge corpus by relative path (e.g. 'core/truth/.persona.md', 'knowledge/0K-baif-framework.md').",
  requiresState: ["ONLINE" as const, "LIMBO" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const LOOKUP_KNOWLEDGE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", description: "Relative path within the PRIME corpus (e.g. 'core/truth/.persona.md')" },
  },
  required: ["path"],
};
