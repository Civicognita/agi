/**
 * grep_search tool — regex search across files within workspace.
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import type { ToolHandler } from "../tool-registry.js";

const DEFAULT_MAX_RESULTS = 50;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", ".cache"]);

export interface GrepSearchConfig {
  workspaceRoot: string;
}

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

async function searchDir(
  dir: string,
  regex: RegExp,
  rootDir: string,
  globPattern: string | undefined,
  matches: GrepMatch[],
  maxResults: number,
): Promise<void> {
  if (matches.length >= maxResults) return;

  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (matches.length >= maxResults) return;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await searchDir(fullPath, regex, rootDir, globPattern, matches, maxResults);
    } else if (entry.isFile()) {
      // Simple glob match on filename
      if (globPattern !== undefined) {
        const globRegex = new RegExp(
          "^" + globPattern.replace(/\*\*/g, "DOUBLESTAR").replace(/\*/g, "[^/]*").replace(/DOUBLESTAR/g, ".*").replace(/\?/g, ".") + "$"
        );
        if (!globRegex.test(entry.name) && !globRegex.test(relative(rootDir, fullPath))) continue;
      }

      try {
        const content = await readFile(fullPath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxResults) return;
          // Reset lastIndex before each test (regex has /g flag)
          regex.lastIndex = 0;
          if (regex.test(lines[i]!)) {
            matches.push({
              file: relative(rootDir, fullPath),
              line: i + 1,
              content: lines[i]!.slice(0, 200),
            });
          }
        }
      } catch {
        // Skip binary/unreadable files
      }
    }
  }
}

export function createGrepSearchHandler(config: GrepSearchConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const pattern = String(input.pattern ?? "");
    const searchPath = input.path ? String(input.path) : ".";
    const glob = input.glob ? String(input.glob) : undefined;
    const maxResults = Number(input.max_results ?? DEFAULT_MAX_RESULTS);

    if (pattern === "") {
      return JSON.stringify({ error: "Pattern is required" });
    }

    // Basic ReDoS protection: reject patterns with nested quantifiers
    const reDoSPattern = /(\+|\*|\{)\s*\)(\+|\*|\{)/;
    if (reDoSPattern.test(pattern)) {
      return JSON.stringify({ error: "Pattern rejected: nested quantifiers may cause excessive backtracking" });
    }

    const absPath = resolve(config.workspaceRoot, searchPath);

    if (!absPath.startsWith(config.workspaceRoot)) {
      return JSON.stringify({ error: "Access denied: path escapes workspace boundary" });
    }

    try {
      const regex = new RegExp(pattern, "g");
      const matches: GrepMatch[] = [];
      await searchDir(absPath, regex, config.workspaceRoot, glob, matches, maxResults);

      return JSON.stringify({
        matches,
        count: matches.length,
        truncated: matches.length >= maxResults,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: msg });
    }
  };
}

export const GREP_SEARCH_MANIFEST = {
  name: "grep_search",
  description: "Search files for regex pattern matches. Returns file paths, line numbers, and matching content.",
  requiresState: ["ONLINE" as const, "LIMBO" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const GREP_SEARCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    pattern: { type: "string", description: "Regular expression pattern to search for" },
    path: { type: "string", description: "Directory to search in (absolute or relative)" },
    glob: { type: "string", description: "File glob pattern filter (e.g., '*.ts', '**/*.test.ts')" },
    max_results: { type: "number", description: "Maximum number of results (default: 50)" },
  },
  required: ["pattern"],
};
