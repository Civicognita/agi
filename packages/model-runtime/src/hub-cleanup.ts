/**
 * HubCleanup — evicts orphaned model directories from ~/.agi/models/hub/.
 *
 * The HF cache layout used here stores each model as:
 *   hub/models--<org>--<name>/snapshots/<revision>/  ← actual model files
 *
 * Orphaned directories accumulate when:
 *   a) A download was interrupted (snapshots/ dir exists but is empty, or has
 *      an empty revision dir).
 *   b) A model was removed from the DB but the directory deletion failed or was
 *      skipped (e.g. filePath pointed to a subdirectory, leaving the parent).
 *
 * Safety guard: only removes directories whose mtime is older than 24 hours to
 * avoid racing with in-progress downloads.
 */

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ModelStore } from "./model-store.js";

const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface HubCleanupResult {
  scanned: number;
  removed: string[];
  skippedTooNew: string[];
  errors: string[];
}

/**
 * Walk ~/.agi/models/hub/ and remove model directories that are not backed by
 * any installed model in the DB, provided they are old enough.
 */
export async function cleanupHubOrphans(
  cacheDir: string,
  modelStore: ModelStore,
): Promise<HubCleanupResult> {
  const result: HubCleanupResult = {
    scanned: 0,
    removed: [],
    skippedTooNew: [],
    errors: [],
  };

  const hubDir = join(cacheDir, "hub");
  if (!existsSync(hubDir)) return result;

  let modelDirs: string[];
  try {
    modelDirs = readdirSync(hubDir).filter((d) => d.startsWith("models--"));
  } catch {
    return result;
  }

  // Build a set of all model IDs that exist in the DB.
  const installedModels = await modelStore.getAll();
  const knownModelIds = new Set(installedModels.map((m) => m.id));

  const now = Date.now();

  for (const dir of modelDirs) {
    result.scanned++;

    // Derive the model ID from the directory name (models--org--name → org/name).
    const withoutPrefix = dir.slice("models--".length);
    const parts = withoutPrefix.split("--");
    if (parts.length < 2) continue;
    const modelId = parts.join("/");

    const modelCacheDir = join(hubDir, dir);

    // Skip directories that are still tracked in the DB — the DB row is the
    // authoritative reference; don't touch live models.
    if (knownModelIds.has(modelId)) continue;

    // Age guard: if the directory is too new, skip to avoid racing with an
    // active download that hasn't written its DB row yet.
    let dirMtime: number;
    try {
      dirMtime = statSync(modelCacheDir).mtimeMs;
    } catch {
      continue;
    }

    if (now - dirMtime < ORPHAN_AGE_MS) {
      result.skippedTooNew.push(modelId);
      continue;
    }

    // The directory is not in the DB and is old enough — it is an orphan.
    try {
      rmSync(modelCacheDir, { recursive: true, force: true });
      result.removed.push(modelId);
    } catch (err) {
      result.errors.push(
        `${modelId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}

/**
 * Scan a single model's snapshot directory for stale (empty) revision
 * subdirectories that indicate an interrupted download. Removes them if older
 * than 24 hours.
 *
 * This targets the pattern:
 *   hub/models--org--name/snapshots/<revision>/   ← exists but empty
 */
export function cleanupStaleSnapshots(
  modelCacheDir: string,
  modelId: string,
): { removed: string[]; errors: string[] } {
  const removed: string[] = [];
  const errors: string[] = [];

  const snapshotsDir = join(modelCacheDir, "snapshots");
  if (!existsSync(snapshotsDir)) return { removed, errors };

  const now = Date.now();

  let revisions: string[];
  try {
    revisions = readdirSync(snapshotsDir).filter(
      (r) => statSync(join(snapshotsDir, r)).isDirectory(),
    );
  } catch {
    return { removed, errors };
  }

  for (const rev of revisions) {
    const revDir = join(snapshotsDir, rev);

    let files: string[];
    try {
      files = readdirSync(revDir);
    } catch {
      continue;
    }

    if (files.length > 0) continue; // Non-empty — may be in use.

    // Empty revision dir — check age.
    let mtime: number;
    try {
      mtime = statSync(revDir).mtimeMs;
    } catch {
      continue;
    }

    if (now - mtime < ORPHAN_AGE_MS) continue;

    try {
      rmSync(revDir, { recursive: true, force: true });
      removed.push(`${modelId}/snapshots/${rev}`);
    } catch (err) {
      errors.push(
        `${modelId}/snapshots/${rev}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { removed, errors };
}
