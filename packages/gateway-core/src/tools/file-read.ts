/**
 * file_read tool — read file contents within workspace boundary.
 *
 * s130 t515 slice 6c: gates path access via the shared cage-gate helper.
 * When `cageProvider` is set on the config, paths must be in-cage; when
 * absent or null, falls back to the workspaceRoot boundary check.
 */
import { readFile } from "node:fs/promises";
import type { ToolHandler } from "../tool-registry.js";
import { gatePath, resolveCagedPath, type PathGateConfig } from "./cage-gate.js";

const DEFAULT_LINE_LIMIT = 2000;

export interface FileReadConfig extends PathGateConfig {}

export function createFileReadHandler(config: FileReadConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const filePath = String(input.path ?? "");
    const offset = Number(input.offset ?? 0);
    const limit = Number(input.limit ?? DEFAULT_LINE_LIMIT);

    const absPath = resolveCagedPath(config, filePath);

    const denial = gatePath(config, absPath);
    if (denial !== null) {
      return JSON.stringify({ error: denial });
    }

    try {
      const content = await readFile(absPath, "utf-8");
      const lines = content.split("\n");
      const totalLines = lines.length;
      const sliced = lines.slice(offset, offset + limit);
      const truncated = offset + limit < totalLines;

      return JSON.stringify({
        content: sliced.join("\n"),
        totalLines,
        truncated,
        offset,
        linesReturned: sliced.length,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: msg });
    }
  };
}

export const FILE_READ_MANIFEST = {
  name: "file_read",
  description: "Read file contents. Supports offset and line limit for large files.",
  requiresState: ["ONLINE" as const, "LIMBO" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const FILE_READ_INPUT_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", description: "File path (absolute or relative)" },
    offset: { type: "number", description: "Line offset to start reading from (0-indexed)" },
    limit: { type: "number", description: "Maximum lines to return (default: 2000)" },
  },
  required: ["path"],
};
