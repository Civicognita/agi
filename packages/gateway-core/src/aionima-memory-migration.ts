/**
 * aionima-memory-migration — s119 t704.
 *
 * One-shot, idempotent migration that moves Aion's memory files from
 * the legacy global location (`~/.agi/memory/`) into the per-project
 * canonical location (`<workspaceRoot>/_aionima/k/memory/`) so memory
 * lives with the project that owns it (per s160 + owner directive
 * 2026-05-09: "the _aionima folder is where memory and user-generated
 * system knowledge lives").
 *
 * Sibling to:
 *   - mcp-config-migration (s131 t681)
 *   - project-config-shape-migration (s150 t632)
 *   - aionima-system-migration (s119 t703)
 *
 * Same shape: idempotent, per-item atomic, error-captured. Differs in
 * that source is `~/.agi/memory/` (homedir, not workspace) and items
 * are individual `.md` files (not directories).
 *
 * Safety:
 *   - Moves only files (NOT directories). If a memory subdir ever
 *     appears, it's left untouched for owner inspection.
 *   - Files already at target are skipped silently (idempotent).
 *   - Source files NOT present at target are atomically renamed.
 *   - Errors are captured per-file and reported via the result.
 *
 * The legacy `~/.agi/memory/` directory is NOT deleted even after all
 * files migrate — leaves a recovery anchor and avoids surprising the
 * owner if they have unrelated tooling that reads from there.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { aionimaSystemProjectPath } from "./project-config-path.js";
import type { ComponentLogger } from "./logger.js";

/**
 * Legacy memory location — fixed by Aion's memory protocol; predates
 * the universal-monorepo layout.
 */
export function legacyMemoryDir(): string {
  return join(homedir(), ".agi", "memory");
}

/**
 * Canonical memory location — one of the `_aionima/k/<area>` knowledge
 * subdirs created by the t701 scaffolder.
 */
export function aionimaMemoryDir(workspaceRoot: string): string {
  return join(aionimaSystemProjectPath(workspaceRoot), "k", "memory");
}

export interface AionimaMemoryMigrationResult {
  /** Total entries scanned at the legacy location. */
  scanned: number;
  /** Files moved this call. */
  moved: number;
  /** Files already at the canonical location (no-op). */
  alreadyMigrated: number;
  /** Entries skipped because they're directories (we only move files). */
  skippedNonFile: number;
  /** Per-file errors. */
  errors: { name: string; reason: string }[];
}

/**
 * Move memory `.md` files from `~/.agi/memory/` into
 * `<workspaceRoot>/_aionima/k/memory/`. Idempotent + atomic per file.
 */
export function migrateAionimaMemoryDir(
  workspaceRoot: string,
  logger?: ComponentLogger,
): AionimaMemoryMigrationResult {
  const result: AionimaMemoryMigrationResult = {
    scanned: 0,
    moved: 0,
    alreadyMigrated: 0,
    skippedNonFile: 0,
    errors: [],
  };

  const src = legacyMemoryDir();
  const dst = aionimaMemoryDir(workspaceRoot);

  // Source-absent is a clean-install case — nothing to migrate.
  if (!existsSync(src)) {
    return result;
  }

  // Target-absent precondition: t701 scaffolder must run first.
  // Rather than refusing the migration outright we create the dir
  // ourselves — t701 may not have run yet on this boot if `_aionima`
  // is being set up for the first time, and we don't want a chicken-
  // and-egg dependency between two boot helpers. mkdirSync recursive
  // is a no-op if the dir already exists.
  try {
    mkdirSync(dst, { recursive: true });
  } catch (err) {
    result.errors.push({
      name: "(precondition)",
      reason: `failed to ensure target dir ${dst}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return result;
  }

  let entries: string[];
  try {
    entries = readdirSync(src);
  } catch (err) {
    result.errors.push({
      name: "(scan)",
      reason: `failed to read ${src}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return result;
  }

  result.scanned = entries.length;

  for (const name of entries) {
    const oldPath = join(src, name);
    const newPath = join(dst, name);

    let isFile = false;
    try {
      isFile = statSync(oldPath).isFile();
    } catch (err) {
      result.errors.push({
        name,
        reason: `stat failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    if (!isFile) {
      result.skippedNonFile++;
      continue;
    }

    if (existsSync(newPath)) {
      result.alreadyMigrated++;
      continue;
    }

    try {
      renameSync(oldPath, newPath);
      result.moved++;
      logger?.info(`migrated memory file: ${oldPath} → ${newPath}`);
    } catch (err) {
      result.errors.push({
        name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
