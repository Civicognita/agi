/**
 * dir_create tool — make a directory within the cage.
 *
 * s134 cycle 198 (2026-05-11): owner directive — "Aion is unable to write
 * files or folders into its k/* folders, it should be able to do both."
 * `file_write` covers the file case via `create_dirs: true` (auto-mkdir
 * of parents). Until now there was no standalone tool for creating an
 * EMPTY directory (e.g., scaffold `k/plans/` before any plan file exists).
 *
 * This tool fills that gap. Cage-gated via the shared cage-gate helper
 * (same surface as file_read / file_write / dir_list / grep_search).
 * `recursive: true` mirrors `mkdir -p` semantics — parent directories
 * are created on demand. Owner directive only restricts FILES at the
 * project root; folders at the root are permitted (Aion may scaffold
 * new k/<sub>/ subfolders, new repos/<repo>/ checkouts, etc.).
 */

import { mkdir } from "node:fs/promises";
import type { ToolHandler } from "../tool-registry.js";
import { gatePath, resolveCagedPath, type PathGateConfig } from "./cage-gate.js";

export interface DirCreateConfig extends PathGateConfig {}

export function createDirCreateHandler(config: DirCreateConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const dirPath = String(input.path ?? "").trim();
    if (dirPath.length === 0) {
      return JSON.stringify({ error: "path is required" });
    }
    const recursive = Boolean(input.recursive ?? true);

    const absPath = resolveCagedPath(config, dirPath);
    const denial = gatePath(config, absPath);
    if (denial !== null) {
      return JSON.stringify({ error: denial });
    }

    try {
      await mkdir(absPath, { recursive });
      return JSON.stringify({ path: absPath, recursive });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: msg });
    }
  };
}

export const DIR_CREATE_MANIFEST = {
  name: "dir_create",
  description:
    "Create a directory within the project cage. Mirrors `mkdir -p` semantics when `recursive` is true (default). Use this when scaffolding empty folders (e.g., `k/plans/`) before any file lives in them; for files that just need a missing parent, prefer `file_write` with `create_dirs: true`.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const DIR_CREATE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Directory path (absolute or relative). When the chat is project-caged, relative paths resolve against the project root.",
    },
    recursive: {
      type: "boolean",
      description: "Create parent directories as needed. Defaults to true.",
    },
  },
  required: ["path"],
};
