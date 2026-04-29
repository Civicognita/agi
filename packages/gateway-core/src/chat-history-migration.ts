/**
 * chat-history-migration — moves project-scoped chat sessions from the
 * global `~/.agi/chat-history/` to per-project `<projectPath>/k/chat/`.
 *
 * **s130 t518 slice 1 (2026-04-29):** the smallest viable migration
 * primitive. Doesn't refactor ChatPersistence — that's a follow-up
 * slice. This module just provides a copy-only helper that
 * ProjectConfigManager / migrateProjectConfig can call when a project
 * gets migrated to its new layout.
 *
 * **What this does:**
 *   1. Walks `~/.agi/chat-history/` for `<id>.json` files
 *   2. For each, parses the session and checks `session.context`
 *   3. If `session.context === projectPath`, copies to
 *      `<projectPath>/k/chat/<id>.json` (idempotent — skip if target
 *      exists)
 *   4. Returns count of sessions migrated + per-session details
 *
 * **What this does NOT do:**
 *   - Delete the global session (preserved as backup; cleanup is a
 *     later slice once stable across upgrades)
 *   - Refactor ChatPersistence to be project-aware (that's slice 2 of
 *     t518 — readers still hit the global dir; sessions land at both
 *     locations during the transitional period)
 *   - Migrate non-project-scoped sessions (those stay global; only
 *     `session.context` matching `projectPath` are project-scoped)
 *
 * Per Q-3 (cycle 88 owner answer): per-project chat history lives at
 * `<projectPath>/k/chat/`, alongside k/plans, k/knowledge, k/pm, and
 * k/memory.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface ChatSessionLike {
  id: string;
  context?: string;
}

export interface ChatMigrationResult {
  /** How many session files matched + were copied this call. */
  migrated: number;
  /** How many session files were skipped because the target already
   *  existed at the per-project path (idempotent re-runs). */
  skipped: number;
  /** How many session files in `~/.agi/chat-history/` did NOT match
   *  the requested projectPath (left at global). */
  notMatching: number;
  /** Session ids that were successfully copied to the project. */
  migratedIds: string[];
  /** Errors encountered during migration (per-file; non-fatal). */
  errors: Array<{ file: string; reason: string }>;
}

interface MigrateOptions {
  /** Override the global chat-history dir. Defaults to
   *  `~/.agi/chat-history/`. Mostly for tests. */
  globalChatDir?: string;
  /** Override the per-project chat dir under the project. Defaults to
   *  `<projectPath>/k/chat/`. */
  projectChatDir?: string;
}

/**
 * Idempotently migrate project-scoped chat sessions from the global
 * `~/.agi/chat-history/` directory into `<projectPath>/k/chat/`.
 *
 * Safe to call repeatedly — sessions already at the target are skipped,
 * not re-copied. Sessions whose `context` doesn't match `projectPath`
 * are left at the global location.
 */
export function migrateChatSessionsForProject(
  projectPath: string,
  options: MigrateOptions = {},
): ChatMigrationResult {
  const result: ChatMigrationResult = {
    migrated: 0,
    skipped: 0,
    notMatching: 0,
    migratedIds: [],
    errors: [],
  };

  const globalDir = options.globalChatDir ?? join(homedir(), ".agi", "chat-history");
  const projectDir = options.projectChatDir ?? join(projectPath, "k", "chat");

  if (!existsSync(globalDir)) {
    // No global chat-history yet — nothing to migrate. (Brand-new
    // gateway, or chat-history was already swept.)
    return result;
  }

  let files: string[];
  try {
    files = readdirSync(globalDir).filter((f) => f.endsWith(".json"));
  } catch (e) {
    result.errors.push({
      file: globalDir,
      reason: e instanceof Error ? e.message : String(e),
    });
    return result;
  }

  for (const file of files) {
    const sourcePath = join(globalDir, file);
    let session: ChatSessionLike;
    try {
      session = JSON.parse(readFileSync(sourcePath, "utf-8")) as ChatSessionLike;
    } catch (e) {
      result.errors.push({
        file,
        reason: `parse failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    // Only migrate sessions whose context is exactly this project.
    // Sessions without a context, or context pointing elsewhere, stay
    // global.
    if (session.context !== projectPath) {
      result.notMatching += 1;
      continue;
    }

    const targetPath = join(projectDir, file);
    if (existsSync(targetPath)) {
      // Already migrated on a previous call — idempotent skip.
      result.skipped += 1;
      continue;
    }

    try {
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(targetPath, readFileSync(sourcePath, "utf-8"), "utf-8");
      result.migrated += 1;
      result.migratedIds.push(session.id);
    } catch (e) {
      result.errors.push({
        file,
        reason: `copy failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return result;
}
