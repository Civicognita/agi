/**
 * file_write tool — write file contents within workspace boundary.
 *
 * s130 t515 slice 6c: gates path access via the shared cage-gate helper.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { ToolHandler } from "../tool-registry.js";
import { gatePath, type PathGateConfig } from "./cage-gate.js";

export interface FileWriteConfig extends PathGateConfig {}

export function createFileWriteHandler(config: FileWriteConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const filePath = String(input.path ?? "");
    const content = String(input.content ?? "");
    const createDirs = Boolean(input.create_dirs ?? false);

    const absPath = resolve(config.workspaceRoot, filePath);

    const denial = gatePath(config, absPath);
    if (denial !== null) {
      return JSON.stringify({ error: denial });
    }

    try {
      if (createDirs) {
        await mkdir(dirname(absPath), { recursive: true });
      }

      await writeFile(absPath, content, "utf-8");
      const bytesWritten = Buffer.byteLength(content, "utf-8");

      return JSON.stringify({ path: absPath, bytesWritten });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: msg });
    }
  };
}

export const FILE_WRITE_MANIFEST = {
  name: "file_write",
  description: "Write or create a file. Optionally creates parent directories.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const FILE_WRITE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", description: "File path (absolute or relative)" },
    content: { type: "string", description: "File content to write" },
    create_dirs: { type: "boolean", description: "Create parent directories if missing" },
  },
  required: ["path", "content"],
};
