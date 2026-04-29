/**
 * dir_list tool — list directory contents within workspace boundary.
 *
 * s130 t515 slice 6c: gates path access via the shared cage-gate helper.
 */
import { readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { ToolHandler } from "../tool-registry.js";
import { gatePath, type PathGateConfig } from "./cage-gate.js";

export interface DirListConfig extends PathGateConfig {}

export function createDirListHandler(config: DirListConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const dirPath = String(input.path ?? ".");
    const pattern = input.pattern ? String(input.pattern) : undefined;

    const absPath = resolve(config.workspaceRoot, dirPath);

    const denial = gatePath(config, absPath);
    if (denial !== null) {
      return JSON.stringify({ error: denial });
    }

    try {
      const entries = await readdir(absPath, { withFileTypes: true });
      let results = entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" as const : "file" as const,
        path: join(absPath, entry.name),
      }));

      // Simple glob-like pattern matching
      if (pattern !== undefined) {
        const regex = new RegExp(
          "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
        );
        results = results.filter((r) => regex.test(r.name));
      }

      return JSON.stringify({ entries: results, count: results.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: msg });
    }
  };
}

export const DIR_LIST_MANIFEST = {
  name: "dir_list",
  description: "List directory contents with optional glob pattern filtering.",
  requiresState: ["ONLINE" as const, "LIMBO" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const DIR_LIST_INPUT_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", description: "Directory path (absolute or relative)" },
    pattern: { type: "string", description: "Glob pattern to filter entries (e.g., '*.ts')" },
  },
  required: [],
};
