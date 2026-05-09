/**
 * aionima-system-migration — s119 t703.
 *
 * One-shot, idempotent migration that moves the Aionima fork repos
 * from their legacy flat layout (`<workspaceRoot>/_aionima/<name>`)
 * into the universal monorepo layout (`<workspaceRoot>/_aionima/repos/<name>`)
 * so `_aionima` becomes a single project per s119 t702.
 *
 * Owner directive 2026-05-09: hard-move + rewrite symlinks (one-shot
 * cutover). This module handles the disk side. The `~/temp_core/<name>`
 * Claude-Code-workspace symlinks (owner's local dev setup) are NOT
 * touched here — those are owner-side scaffolding, rewritten manually
 * after the migration runs.
 *
 * Sibling to project-config-shape-migration (s150 t632) and
 * mcp-config-migration (s131 t681). Same pattern: allow-listed names,
 * atomic mv per fork, idempotent.
 *
 * Safe to call repeatedly. Disk is only touched when something
 * actually changes. A fully-migrated install returns
 * `{ scanned: 11, moved: 0, alreadyMigrated: N, errors: [] }`.
 */

import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

import { aionimaSystemProjectPath } from "./project-config-path.js";
import type { ComponentLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Allow-list of fork names that belong inside `_aionima/repos/`
// ---------------------------------------------------------------------------

/**
 * Known Aionima system forks. Migration ONLY moves directories whose
 * basename matches this list, leaving any non-fork directories at the
 * `_aionima/` root alone (they get hand-investigated, never auto-moved).
 *
 * Order:
 *   - 5 Civicognita-owned cores
 *   - 6 Particle-Academy ADF UI primitives (PAx)
 */
export const AIONIMA_SYSTEM_FORK_NAMES: readonly string[] = Object.freeze([
  "agi",
  "prime",
  "id",
  "marketplace",
  "mapp-marketplace",
  "react-fancy",
  "fancy-code",
  "fancy-sheets",
  "fancy-echarts",
  "fancy-3d",
  "fancy-screens",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AionimaForkMigrationResult {
  /** Total fork names checked (= AIONIMA_SYSTEM_FORK_NAMES.length). */
  scanned: number;
  /** Forks moved this call. */
  moved: number;
  /** Forks already at the new location (no-op). */
  alreadyMigrated: number;
  /** Forks not present at either location (skipped). */
  notPresent: number;
  /** Per-fork error capture. */
  errors: { name: string; reason: string }[];
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Move forks from legacy flat layout into `_aionima/repos/`. Idempotent
 * + atomic per fork.
 *
 * Pre-conditions:
 *   - `_aionima/repos/` already exists (created by t701 scaffolder)
 *   - Forks at the legacy location have a `.git/` dir (sanity check —
 *     otherwise we refuse to move because the dir is not a git repo)
 *
 * Post-conditions:
 *   - Each known fork lives at `_aionima/repos/<name>/`
 *   - Already-migrated forks unchanged
 *   - Forks not present in this install (e.g. fancy-3d / fancy-screens
 *     before they're cloned) skipped silently
 *
 * Errors are captured per-fork rather than thrown — partial migration
 * is preferable to total halt because operator inspection is needed
 * either way and we want to surface every issue at once.
 */
export function migrateAionimaSystemForks(
  workspaceRoot: string,
  logger?: ComponentLogger,
): AionimaForkMigrationResult {
  const result: AionimaForkMigrationResult = {
    scanned: AIONIMA_SYSTEM_FORK_NAMES.length,
    moved: 0,
    alreadyMigrated: 0,
    notPresent: 0,
    errors: [],
  };

  const projectPath = aionimaSystemProjectPath(workspaceRoot);
  const reposDir = join(projectPath, "repos");

  // _aionima/ must exist (scaffolded by t701). repos/ likewise.
  // If neither is present, the t701 scaffolder didn't run — abort
  // gracefully so the boot caller can log the situation without
  // exploding.
  if (!existsSync(projectPath) || !existsSync(reposDir)) {
    result.errors.push({
      name: "(precondition)",
      reason: `_aionima or repos/ missing — t701 scaffolder must run first (projectPath=${projectPath}, reposDir=${reposDir})`,
    });
    return result;
  }

  for (const name of AIONIMA_SYSTEM_FORK_NAMES) {
    const oldPath = join(projectPath, name);
    const newPath = join(reposDir, name);

    if (existsSync(newPath)) {
      result.alreadyMigrated++;
      continue;
    }

    if (!existsSync(oldPath)) {
      result.notPresent++;
      continue;
    }

    // Sanity check — refuse to move a directory that doesn't look like
    // a git repo. Forks all have .git/ dirs; if it's missing, this is
    // not the fork we expected and we shouldn't auto-move.
    if (!existsSync(join(oldPath, ".git"))) {
      result.errors.push({
        name,
        reason: `${oldPath} has no .git/ — refusing to auto-move (operator should investigate)`,
      });
      continue;
    }

    try {
      renameSync(oldPath, newPath);
      result.moved++;
      logger?.info(`migrated fork: ${oldPath} → ${newPath}`);
    } catch (err) {
      result.errors.push({
        name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
