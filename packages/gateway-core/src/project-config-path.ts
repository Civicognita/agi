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
import { basename, join } from "node:path";
import { migrateChatSessionsForProject } from "./chat-history-migration.js";

/**
 * Sacred project names — Aionima five (Civicognita-owned core) + PAx four
 * (Particle-Academy ADF UI primitives). These are workspace-managed repos
 * the gateway must NEVER auto-migrate to the s140 layout. They are source
 * trees the owner contributes PRs against, not deployable projects.
 *
 * Mirrors SACRED_PROJECT_NAMES in server-runtime-state.ts + the union in
 * scripts/migrate-projects-s140.sh. Kept in sync by being the same lower-
 * cased basename set.
 *
 * Defense-in-depth: every code path that touches per-project config
 * (migrateProjectConfig, scaffoldProjectFolders) checks this before
 * scaffolding or moving files. Cycle 150 hotfix after the boot-time
 * migration was observed creating .agi/project.json + project.json
 * inside the agi repo itself.
 */
const SACRED_PROJECT_NAMES = new Set([
  // Workspace-grouping container (cycle 150 owner clarification): the
  // _aionima/ dir at the root of the workspace holds the 5 Aionima cores
  // + 4-soon-5 PAx packages. The container ITSELF is sacred — it should
  // never be auto-migrated to the s140 layout.
  "_aionima",
  // Civicognita-owned core five
  "agi", "prime", "id", "marketplace", "mapp-marketplace",
  // Particle-Academy ADF UI primitives
  "react-fancy", "fancy-code", "fancy-sheets", "fancy-echarts", "fancy-3d",
]);

export function isSacredProjectPath(projectPath: string): boolean {
  return SACRED_PROJECT_NAMES.has(basename(projectPath).toLowerCase());
}

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
 * Path under `<projectPath>/project.json` — the s140-canonical location
 * (root of the project folder).
 *
 * Owner directive 2026-04-30: "all config for projects and repos is in the
 * root of the project folder in the project.json file." Per-repo config
 * lives inside this single file under `repos[name]`.
 */
export function newProjectConfigPath(projectPath: string): string {
  return join(projectPath, "project.json");
}

/**
 * Path under `<projectPath>/.agi/project.json` — the s130 transitional
 * location (cycles 88-91, before the s140 reframe). Kept exported so
 * migrateProjectConfig + projectConfigPath can transparently flip
 * existing projects from this to the s140 root location.
 */
export function legacyAgiProjectConfigPath(projectPath: string): string {
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
 * Per-project folder layout per s140 (owner clarifications 2026-04-30):
 *
 *   <projectPath>/
 *   ├── project.json         # ROOT runtime config (project + per-repo combined)
 *   ├── k/                   # knowledge layer
 *   │   ├── plans/           # per-project plans (replaces _plans/_next/)
 *   │   ├── knowledge/       # markdown notes, design docs, references
 *   │   ├── pm/              # PM-Lite kanban data (s139)
 *   │   ├── memory/          # per-project Aion memory
 *   │   └── chat/            # per-project chat sessions
 *   ├── repos/               # bind-mounted git checkouts (multi-repo)
 *   ├── sandbox/             # agent scratch space (NEW in s140 — keeps chat-tool
 *   │                          cage primitive from writing into repos/ or k/)
 *   └── .trash/              # soft-delete buffer (kept for back-compat)
 *
 * Diffs from the s130 layout: project.json moves to root (was .agi/),
 * sandbox/ added. chat/ stays at k/chat/.
 *
 * Subfolders ordered for deterministic creation logging.
 */
export const PROJECT_FOLDER_LAYOUT: readonly string[] = Object.freeze([
  "k/plans",
  "k/knowledge",
  "k/pm",
  "k/memory",
  "k/chat",
  "repos",
  "sandbox",
  ".trash",
]);

/**
 * Idempotently scaffold the s130 per-project folder layout. Returns
 * the list of dirs newly created (empty when everything already
 * existed). Safe to call repeatedly — `mkdirSync` with `recursive: true`
 * is a no-op when the dir exists.
 */
export function scaffoldProjectFolders(projectPath: string): { created: string[] } {
  // Sacred-skip — never scaffold inside a sacred repo.
  if (isSacredProjectPath(projectPath)) {
    return { created: [] };
  }
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
  /** Count of chat sessions migrated from `~/.agi/chat-history/` to
   *  `<projectPath>/k/chat/`. Populated only when project config
   *  migration occurred (s130 t518 slice 1). */
  chatSessionsMigrated?: number;
} {
  // Sacred-skip: Aionima 5 + PAx 4 are source trees the owner contributes
  // PRs against, not deployable projects. The gateway must never auto-
  // migrate them to the s140 layout (no scaffold, no file moves).
  // Cycle 150 hotfix after boot-time migration was observed creating
  // .agi/project.json + project.json inside the agi repo itself.
  if (isSacredProjectPath(projectPath)) {
    return { migrated: false, to: newProjectConfigPath(projectPath) };
  }

  const newPath = newProjectConfigPath(projectPath);                      // s140: <projectPath>/project.json
  const agiPath = legacyAgiProjectConfigPath(projectPath);                // s130: <projectPath>/.agi/project.json
  const oldPath = legacyProjectConfigPath(projectPath);                   // pre-s130: ~/.agi/{slug}/project.json

  // Already-migrated case: still ensure the s140 folder layout exists.
  if (existsSync(newPath)) {
    const { created } = scaffoldProjectFolders(projectPath);
    return { migrated: false, to: newPath, scaffolded: created.length > 0 ? created : undefined };
  }

  // Choose the latest available legacy source (s130 .agi/project.json
  // takes precedence over the older ~/.agi one if both exist).
  const sourcePath = existsSync(agiPath) ? agiPath : (existsSync(oldPath) ? oldPath : null);

  if (sourcePath === null) {
    // No config either way — scaffold the layout for a fresh project.
    const { created } = scaffoldProjectFolders(projectPath);
    return { migrated: false, to: newPath, scaffolded: created.length > 0 ? created : undefined };
  }

  try {
    // s140: project.json lives at the root, so no .agi/ mkdir needed.
    writeFileSync(newPath, readFileSync(sourcePath, "utf-8"), "utf-8");
    // Scaffold the s140 folder layout (k/, repos/, chat/, sandbox/, .trash/).
    const { created } = scaffoldProjectFolders(projectPath);
    // Migrate project-scoped chat sessions into <projectPath>/k/chat/.
    // Idempotent — re-runs skip already-copied sessions.
    const chatResult = migrateChatSessionsForProject(projectPath);
    return {
      migrated: true,
      from: sourcePath,
      to: newPath,
      scaffolded: created,
      chatSessionsMigrated: chatResult.migrated,
    };
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
  // Sacred-skip: never auto-write a project.json into a sacred repo. Reads
  // still resolve via legacy fallback if a config happens to exist.
  if (isSacredProjectPath(projectPath)) {
    const agiPath = legacyAgiProjectConfigPath(projectPath);
    const oldPath = legacyProjectConfigPath(projectPath);
    if (existsSync(agiPath)) return agiPath;
    if (existsSync(oldPath)) return oldPath;
    return newProjectConfigPath(projectPath); // points at canonical, but no auto-create
  }

  const newPath = newProjectConfigPath(projectPath);                      // s140: <projectPath>/project.json
  if (existsSync(newPath)) return newPath;
  const agiPath = legacyAgiProjectConfigPath(projectPath);                // s130: <projectPath>/.agi/project.json
  const oldPath = legacyProjectConfigPath(projectPath);                   // pre-s130: ~/.agi/{slug}/project.json
  // Pick the latest existing legacy source. Empty string when neither.
  const sourcePath = existsSync(agiPath) ? agiPath : (existsSync(oldPath) ? oldPath : "");
  if (sourcePath === "") {
    // Neither exists — return the new path so writers create it canonically.
    return newPath;
  }
  // Legacy exists, new doesn't — migrate transparently to root.
  try {
    writeFileSync(newPath, readFileSync(sourcePath, "utf-8"), "utf-8");
    return newPath;
  } catch {
    // Migration failed — fall back to whatever legacy worked so reads still succeed.
    return sourcePath;
  }
}
