/**
 * knowledge-dir-migration — owner directive 2026-06-09.
 *
 * One-shot, idempotent boot migration that renames each project's legacy
 * knowledge directory `k/` to the new `.ai/` name (KNOWLEDGE_DIR). The new
 * name matches emerging AI-workflow conventions (`.cursor/`, `.aider/`, …).
 *
 * Sibling to the other boot migrations (aionima-memory-migration,
 * project-config-shape-migration, …): idempotent, per-project atomic,
 * error-captured, never fatal.
 *
 * ORDERING (critical): this sweep MUST run BEFORE any scaffolder or data
 * migration that targets the knowledge dir (the `_aionima` scaffolder, the
 * memory/plans/chat migrations). Those now write into `.ai/` via
 * KNOWLEDGE_DIR; if they ran first they would create a fresh empty `.ai/`
 * and strand the real data in the old `k/`, which this sweep would then
 * refuse to merge (conflict). Rename first, then everything downstream sees
 * `.ai/`.
 *
 * Safety:
 *   - Atomic single rename per project (renameSync of the dir node).
 *   - `.ai/` already present + no `k/` → no-op ("absent").
 *   - BOTH `k/` and `.ai/` present → leave BOTH untouched, report "conflict"
 *     for owner inspection. NEVER merges or clobbers.
 */

import { existsSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

import { KNOWLEDGE_DIR } from "./project-config-path.js";
import type { ComponentLogger } from "./logger.js";

export type KnowledgeDirMigrationStatus =
  /** Renamed k/ → .ai/ this call. */
  | "renamed"
  /** No legacy k/ to migrate (clean install or already on .ai/). */
  | "absent"
  /** Both k/ and .ai/ exist — left untouched for owner inspection. */
  | "conflict"
  /** Rename attempted but failed (see `error`). */
  | "error";

export interface KnowledgeDirMigrationResult {
  status: KnowledgeDirMigrationStatus;
  /** Legacy source dir checked. */
  from: string;
  /** Canonical target dir. */
  to: string;
  /** Present when status is "error". */
  error?: string;
}

/**
 * Rename a single project's `k/` → `.ai/`. Idempotent + atomic; never
 * clobbers an existing `.ai/`.
 */
export function migrateKnowledgeDirName(
  projectDir: string,
  logger?: ComponentLogger,
): KnowledgeDirMigrationResult {
  const from = join(projectDir, "k");
  const to = join(projectDir, KNOWLEDGE_DIR);

  if (!existsSync(from)) {
    return { status: "absent", from, to };
  }
  if (existsSync(to)) {
    logger?.warn(
      `knowledge-dir migration: BOTH ${from} and ${to} exist — leaving both untouched for inspection`,
    );
    return { status: "conflict", from, to };
  }

  try {
    renameSync(from, to);
    logger?.info(`migrated knowledge dir: ${from} → ${to}`);
    return { status: "renamed", from, to };
  } catch (err) {
    return {
      status: "error",
      from,
      to,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface KnowledgeDirSweepResult {
  /** Project dirs scanned across all collections. */
  scanned: number;
  /** Projects renamed this call. */
  renamed: number;
  /** Projects skipped because both k/ and .ai/ exist. */
  conflicts: number;
  /** Per-project rename errors. */
  errors: { dir: string; reason: string }[];
}

/**
 * Sweep every project directory under the given collection dirs and rename
 * `k/` → `.ai/`. Walks ALL immediate child directories of each collection —
 * including dot-prefixed (`.new` skeleton seed) and underscore-prefixed
 * (`_aionima` meta-project) — because both carry a knowledge layer.
 *
 * Idempotent and non-fatal: per-project errors are captured, never thrown.
 */
export function migrateAllKnowledgeDirs(
  collectionDirs: string[],
  logger?: ComponentLogger,
): KnowledgeDirSweepResult {
  const result: KnowledgeDirSweepResult = {
    scanned: 0,
    renamed: 0,
    conflicts: 0,
    errors: [],
  };

  for (const collectionDir of collectionDirs) {
    let entries: string[];
    try {
      entries = readdirSync(collectionDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      // Collection dir unreadable / absent — skip.
      continue;
    }

    for (const name of entries) {
      const projectDir = join(collectionDir, name);
      result.scanned++;
      const r = migrateKnowledgeDirName(projectDir, logger);
      switch (r.status) {
        case "renamed":
          result.renamed++;
          break;
        case "conflict":
          result.conflicts++;
          break;
        case "error":
          result.errors.push({ dir: projectDir, reason: r.error ?? "unknown" });
          break;
        case "absent":
          break;
      }
    }
  }

  return result;
}
