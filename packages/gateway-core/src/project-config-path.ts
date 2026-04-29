/**
 * Project config path utilities.
 *
 * **s130 t514 slice 1 (2026-04-28):** project runtime config has moved
 * from `~/.agi/{projectSlug}/project.json` to
 * `<projectPath>/.agi/project.json`. The `<projectPath>/` location makes
 * the project's authoritative state live with the project, alongside its
 * `k/` knowledge layer, `repos/` multi-repo mounts, and `.trash/`
 * soft-delete buffer — the s130 architecture.
 *
 * This refactor uses **transparent auto-migration** inside
 * `projectConfigPath()`: every call checks if the new path exists, and
 * if not, copies the legacy file before returning the new path. The
 * existsSync early-exit makes repeat calls cheap; once all projects
 * have been touched, the side-effect becomes a no-op.
 *
 * **What's NOT yet migrated** (separate slices under t514):
 *   - `~/.agi/{slug}/plans/` → `<projectPath>/k/plans/`
 *   - `~/.agi/{slug}/dispatch/` → likely stays gateway-owned
 *   - `~/.agi/chat-history/` → `<projectPath>/k/chat/`
 *   - `~/.agi/{slug}/tunnel.json` → likely stays gateway-owned
 *
 * The legacy file at `~/.agi/{slug}/project.json` is preserved as
 * backup; cleanup happens in a later slice once we've confirmed the
 * new location is stable across a few upgrades.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Convert an absolute project path to a filesystem-safe slug.
 * Mirrors the slug convention used by PlanStore for ~/.agi/{slug}/plans/.
 *
 * Examples:
 *   /home/user/myproject → home-user-myproject
 *   /srv/projects/my app → srv-projects-my_app
 */
export function projectSlug(projectPath: string): string {
  return projectPath.replace(/^\//, "").replace(/\//g, "-").replace(/[^a-zA-Z0-9._-]/g, "_") || "general";
}

/**
 * Path under `<projectPath>/.agi/project.json` — the s130-canonical
 * location.
 */
export function newProjectConfigPath(projectPath: string): string {
  return join(projectPath, ".agi", "project.json");
}

/**
 * Path under `~/.agi/{slug}/project.json` — the pre-s130 location.
 * Kept exported for the migration helper + diagnostic surfaces.
 */
export function legacyProjectConfigPath(projectPath: string): string {
  return join(homedir(), ".agi", projectSlug(projectPath), "project.json");
}

/**
 * Per-project folder layout per s130 (Q-3 owner answer 2026-04-28):
 *
 *   <projectPath>/
 *   ├── .agi/                # runtime config (project.json + future)
 *   ├── k/                   # knowledge layer
 *   │   ├── plans/           # per-project plans (replaces _plans/_next/)
 *   │   ├── knowledge/       # markdown notes, design docs, references
 *   │   ├── pm/              # PM provider config (Tynn token, etc)
 *   │   ├── memory/          # per-project Aion memory
 *   │   └── chat/            # per-project chat history
 *   ├── repos/               # bind-mounted git checkouts (multi-repo)
 *   └── .trash/              # soft-delete buffer
 *
 * Subfolders ordered for deterministic creation logging.
 */
export const PROJECT_FOLDER_LAYOUT: readonly string[] = Object.freeze([
  ".agi",
  "k/plans",
  "k/knowledge",
  "k/pm",
  "k/memory",
  "k/chat",
  ".trash",
  "repos",
]);

/**
 * Idempotently scaffold the s130 per-project folder layout. Returns
 * the list of dirs newly created (empty when everything already
 * existed). Safe to call repeatedly — `mkdirSync` with `recursive: true`
 * is a no-op when the dir exists.
 */
export function scaffoldProjectFolders(projectPath: string): { created: string[] } {
  const created: string[] = [];
  for (const rel of PROJECT_FOLDER_LAYOUT) {
    const abs = join(projectPath, rel);
    if (!existsSync(abs)) {
      mkdirSync(abs, { recursive: true });
      created.push(abs);
    }
  }
  return { created };
}

/**
 * Idempotent migration helper. If the legacy config exists and the new
 * one doesn't, copy the file (creating `<projectPath>/.agi/` if needed)
 * and scaffold the s130 folder layout. Returns details about what
 * happened so callers can log the migration.
 *
 * The legacy file is NOT deleted — a follow-up slice will sweep them
 * once the new location has been validated across a few upgrades.
 */
export function migrateProjectConfig(projectPath: string): {
  migrated: boolean;
  from?: string;
  to: string;
  error?: string;
  scaffolded?: string[];
} {
  const newPath = newProjectConfigPath(projectPath);
  const oldPath = legacyProjectConfigPath(projectPath);
  if (existsSync(newPath)) return { migrated: false, to: newPath };
  if (!existsSync(oldPath)) return { migrated: false, to: newPath };
  try {
    mkdirSync(dirname(newPath), { recursive: true });
    writeFileSync(newPath, readFileSync(oldPath, "utf-8"), "utf-8");
    // Scaffold the s130 folder layout so consumers (plan-store,
    // chat-history, knowledge index, etc.) always find their target
    // dirs ready.
    const { created } = scaffoldProjectFolders(projectPath);
    return { migrated: true, from: oldPath, to: newPath, scaffolded: created };
  } catch (e) {
    return {
      migrated: false,
      to: newPath,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Return the absolute path to the project's runtime config file.
 *
 * **Auto-migrating:** on every call, if the new path doesn't exist but
 * the legacy path does, the legacy file is copied to the new location
 * first. Callers don't need to know — they always receive a path that
 * either points at a valid file OR at where a future write should land.
 *
 * If migration fails (read-only fs, permission errors, etc.), the
 * legacy path is returned as a fallback so callers continue working
 * against pre-s130 state. This is rare in practice (the project root
 * is gateway-owned), but ensures we never lose the ability to read.
 */
export function projectConfigPath(projectPath: string): string {
  const newPath = newProjectConfigPath(projectPath);
  if (existsSync(newPath)) return newPath;
  const oldPath = legacyProjectConfigPath(projectPath);
  if (!existsSync(oldPath)) {
    // Neither exists — return the new path so writers create it
    // canonically.
    return newPath;
  }
  // Legacy exists, new doesn't — migrate transparently. Idempotent
  // because of the `existsSync(newPath)` early-exit at the top.
  try {
    mkdirSync(dirname(newPath), { recursive: true });
    writeFileSync(newPath, readFileSync(oldPath, "utf-8"), "utf-8");
    return newPath;
  } catch {
    // Migration failed — fall back to legacy so reads still work.
    return oldPath;
  }
}
