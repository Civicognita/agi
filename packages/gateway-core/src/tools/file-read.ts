/**
 * file_read tool — read file contents within workspace boundary.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolHandler } from "../tool-registry.js";

const DEFAULT_LINE_LIMIT = 2000;

export interface FileReadConfig {
  workspaceRoot: string;
}

export function createFileReadHandler(config: FileReadConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const filePath = String(input.path ?? "");
    const offset = Number(input.offset ?? 0);
    const limit = Number(input.limit ?? DEFAULT_LINE_LIMIT);

    const absPath = resolve(config.workspaceRoot, filePath);

    if (!absPath.startsWith(config.workspaceRoot)) {
      return JSON.stringify({ error: "Access denied: path escapes workspace boundary" });
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
