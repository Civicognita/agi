/**
 * file_write tool — write file contents within workspace boundary.
 *
 * s130 t515 slice 6c: gates path access via the shared cage-gate helper.
 * s134 cycle 198: root-write protection — when caged, refuses to create
 * files at the project root EXCEPT `project.json` (the manifest). Aion
 * may freely write files inside subfolders (k/, repos/, sandbox/, etc.).
 * Owner directive 2026-05-11: "Aion should not be able to create files
 * directly in the project root, we want to keep that clean with only
 * the folders and project.json file in the root."
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, basename } from "node:path";
import type { ToolHandler } from "../tool-registry.js";
import { gatePath, resolveCagedPath, type PathGateConfig } from "./cage-gate.js";

export interface FileWriteConfig extends PathGateConfig {}

/** File names permitted at the project root level (caged project only).
 *  Anything else is rejected with a clear error pointing at subfolders. */
const ROOT_FILE_ALLOWLIST = new Set<string>(["project.json"]);

/**
 * When a project cage is active, returns a denial string if `absPath`
 * would land a file directly at the project root with a name not in the
 * root allowlist. Returns null when the write is permitted.
 *
 * Folders at the project root are unaffected (this check only fires for
 * direct file writes at the root level).
 */
function denyRootFileWrite(config: PathGateConfig, absPath: string): string | null {
  if (config.cageProvider === undefined) return null;
  const cage = config.cageProvider();
  if (cage === null || cage.allowedPrefixes.length === 0) return null;
  const projectRoot = cage.allowedPrefixes[0]!;
  // Project root is always the first allowedPrefix (PROJECT_CAGE_DIRS
  // empty-string entry). If absPath's parent IS the project root and the
  // filename isn't in the root allowlist, refuse.
  if (dirname(absPath) === projectRoot && !ROOT_FILE_ALLOWLIST.has(basename(absPath))) {
    return `Access denied: writing files directly at the project root is not allowed (only ${[...ROOT_FILE_ALLOWLIST].join(", ")} permitted). Place this file under a subfolder like k/, repos/<repo>/, or sandbox/.`;
  }
  return null;
}

export function createFileWriteHandler(config: FileWriteConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const filePath = String(input.path ?? "");
    const content = String(input.content ?? "");
    const createDirs = Boolean(input.create_dirs ?? false);

    const absPath = resolveCagedPath(config, filePath);

    const denial = gatePath(config, absPath);
    if (denial !== null) {
      return JSON.stringify({ error: denial });
    }

    const rootDenial = denyRootFileWrite(config, absPath);
    if (rootDenial !== null) {
      return JSON.stringify({ error: rootDenial });
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
