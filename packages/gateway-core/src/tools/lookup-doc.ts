/**
 * lookup_doc tool — read a specific AGI platform doc by relative path (s197).
 *
 * No state/tier gate — always available. Lets Aion fetch the full content
 * of a known doc (e.g. "human/taskmaster.md") after discovering it via
 * search_docs or the doc topic index in the system prompt.
 */

import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import type { ToolHandler } from "../tool-registry.js";

export interface LookupDocConfig {
  /** Absolute path to agi/docs/ directory. */
  docsDir: string;
}

export function createLookupDocHandler(config: LookupDocConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const rawPath = String(input.path ?? "").trim();
    if (rawPath.length === 0) {
      return JSON.stringify({ error: "path must not be empty" });
    }

    // Resolve relative to docsDir and ensure no path traversal outside it
    const resolved = resolve(config.docsDir, rawPath);
    const rel = relative(config.docsDir, resolved);
    if (rel.startsWith("..") || !resolved.startsWith(config.docsDir)) {
      return JSON.stringify({ error: "path must be within agi/docs/" });
    }

    if (!existsSync(resolved)) {
      return JSON.stringify({ error: `doc not found: ${rawPath}`, available_hint: "Use search_docs to find available docs" });
    }

    try {
      const content = await readFile(resolved, "utf-8");
      // Truncate very long docs to 8k chars to stay within context budget
      const truncated = content.length > 8_000;
      return JSON.stringify({
        path: rel,
        content: truncated ? content.slice(0, 8_000) + "\n\n[truncated — use search_docs to find specific sections]" : content,
        truncated,
        length: content.length,
      });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

export const LOOKUP_DOC_MANIFEST = {
  name: "lookup_doc",
  description: "Read the full content of an AGI platform documentation file by its relative path within agi/docs/ (e.g. 'human/taskmaster.md', 'agents/adding-a-plugin.md'). Use after search_docs to fetch the complete doc for a heading you found.",
  requiresState: [] as string[],
  requiresTier: [] as string[],
};

export const LOOKUP_DOC_INPUT_SCHEMA = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Relative path within agi/docs/ (e.g. 'human/taskmaster.md' or 'agents/adding-a-plugin.md')",
    },
  },
  required: ["path"],
};
