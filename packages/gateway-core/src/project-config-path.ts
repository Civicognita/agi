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

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve as resolvePath } from "node:path";
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
 * Per-project folder layout per s140 (owner clarifications 2026-04-30 +
 * cycle 156 morning: skeleton lives at `templates/.new/`):
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
 *   ├── sandbox/             # agent scratch space — keeps chat-tool cage
 *   │                          primitive from writing into repos/ or k/
 *   └── .trash/              # soft-delete buffer
 *
 * Source of truth: `<gatewayCwd>/templates/.new/`. Adding a new folder is
 * `mkdir templates/.new/<thing>/.gitkeep` — no code change. The list
 * below is a fallback used when the skeleton can't be located at runtime
 * (e.g. running inside a test fixture without the templates tree).
 */
const PROJECT_FOLDER_LAYOUT_FALLBACK: readonly string[] = Object.freeze([
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
 * @deprecated Prefer the skeleton at `templates/.new/`. This export is
 * kept for backwards compatibility with any callers that referenced it
 * from earlier slices; new code should not consume it.
 */
export const PROJECT_FOLDER_LAYOUT = PROJECT_FOLDER_LAYOUT_FALLBACK;

/**
 * Workspace-owned skeleton roots registered at boot via
 * `registerWorkspaceSkeletonRoot`. Searched first by `findProjectSkeletonRoot`
 * so owner-customizations to `<workspaceRoot>/.new/` win over the agi-shipped
 * default at `<gatewayCwd>/templates/.new/`.
 *
 * **s150 t633 (2026-05-07):** the workspace owns the skeleton so the
 * owner can customize it without forking agi. The agi-shipped templates
 * remain the seed for fresh installs (see `ensureWorkspaceSkeleton`).
 */
const preferredSkeletonRoots: string[] = [];

/**
 * Registers a workspace root whose `.new/` directory should be searched
 * before the agi-shipped templates. Idempotent.
 */
export function registerWorkspaceSkeletonRoot(workspaceRoot: string): void {
  const target = resolvePath(workspaceRoot, ".new");
  if (!preferredSkeletonRoots.includes(target)) preferredSkeletonRoots.push(target);
}

/**
 * Test-only helper to clear registered workspace skeleton roots. The
 * preferred-roots list is a module-level singleton that boot populates
 * once; tests need a way to reset it between runs.
 */
export function _resetPreferredSkeletonRootsForTest(): void {
  preferredSkeletonRoots.length = 0;
}

/**
 * Resolve the agi-shipped skeleton (the SEED for `ensureWorkspaceSkeleton`).
 * Returns null when the agi source tree isn't reachable from the runtime
 * (rare in production; happens in test fixtures + ad-hoc tooling).
 */
function findAgiTemplatesSkeleton(): string | null {
  const candidates = [
    resolvePath(process.cwd(), "templates/.new"),
    // Walk up from this module location too, in case cwd is somewhere
    // else (test fixtures, ad-hoc tooling). Two levels: src/ → packages/
    // → repo root, then templates/.new.
    resolvePath(__dirname, "../../../templates/.new"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isDirectory()) return c;
  }
  return null;
}

/**
 * Resolve the on-disk skeleton root. Lookup order:
 *   1. Workspace-owned skeletons registered via
 *      `registerWorkspaceSkeletonRoot` (s150 t633 — owner customization)
 *   2. agi-shipped templates (`<gatewayCwd>/templates/.new`,
 *      `<modulePath>/../../../templates/.new`)
 *
 * Returns null when none are findable so callers can fall through to the
 * hardcoded `PROJECT_FOLDER_LAYOUT_FALLBACK` list.
 */
function findProjectSkeletonRoot(): string | null {
  for (const root of preferredSkeletonRoots) {
    if (existsSync(root) && statSync(root).isDirectory()) return root;
  }
  return findAgiTemplatesSkeleton();
}

export interface EnsureWorkspaceSkeletonResult {
  seeded: boolean;
  /** Resolved `<workspaceRoot>/.new` target. */
  target: string;
  /** Files + dirs created when seeded; undefined when no seed occurred. */
  copied?: string[];
  /** Why a seed didn't happen (already present / no source). */
  reason?: "already-present" | "no-agi-source";
}

/**
 * Ensure `<workspaceRoot>/.new/` exists, seeding it from the agi-shipped
 * `templates/.new/` if needed. Always registers the workspace root with
 * `registerWorkspaceSkeletonRoot` so subsequent `findProjectSkeletonRoot`
 * calls prefer it.
 *
 * **s150 t633 (2026-05-07):** owner directive — the workspace owns the
 * project skeleton so it can be customized without forking agi. Boot
 * calls this once per workspace root; idempotent.
 *
 * @param workspaceRoot Absolute path to the projects workspace (e.g.
 *                      `/home/wishborn/_projects`).
 * @param sourceOverride Test-only override for the agi-templates source.
 */
export function ensureWorkspaceSkeleton(
  workspaceRoot: string,
  sourceOverride?: string,
): EnsureWorkspaceSkeletonResult {
  const target = resolvePath(workspaceRoot, ".new");
  registerWorkspaceSkeletonRoot(workspaceRoot);

  if (existsSync(target)) {
    return { seeded: false, target, reason: "already-present" };
  }

  const source = sourceOverride ?? findAgiTemplatesSkeleton();
  if (source === null || !existsSync(source) || !statSync(source).isDirectory()) {
    return { seeded: false, target, reason: "no-agi-source" };
  }

  // Make sure the parent dir exists (it might not on a fresh install).
  if (!existsSync(workspaceRoot)) mkdirSync(workspaceRoot, { recursive: true });

  const copied = copySkeletonInto(source, target);
  return { seeded: true, target, copied };
}

/**
 * Recursively copy the skeleton's directory structure into `targetPath`.
 * Idempotent: existing files and directories are left untouched. Returns
 * the absolute paths of newly-created entries (dirs + files).
 *
 * Skips `.gitkeep` files in the skeleton — those exist only so the empty
 * dirs survive git tracking; copying them into runtime projects adds
 * noise.
 */
function copySkeletonInto(skeletonRoot: string, targetPath: string): string[] {
  const created: string[] = [];
  const stack: { src: string; dst: string }[] = [{ src: skeletonRoot, dst: targetPath }];
  while (stack.length > 0) {
    const { src, dst } = stack.pop()!;
    if (!existsSync(dst)) {
      mkdirSync(dst, { recursive: true });
      created.push(dst);
    }
    const entries = readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcChild = join(src, entry.name);
      const dstChild = join(dst, entry.name);
      if (entry.isDirectory()) {
        stack.push({ src: srcChild, dst: dstChild });
      } else if (entry.isFile() && entry.name !== ".gitkeep") {
        if (!existsSync(dstChild)) {
          copyFileSync(srcChild, dstChild);
          created.push(dstChild);
        }
      }
    }
  }
  return created;
}

/**
 * Idempotently scaffold the per-project folder layout from the skeleton
 * at `templates/.new/`. Returns the list of paths newly created. Safe to
 * call repeatedly — existing entries are skipped.
 *
 * When the skeleton can't be located (test fixtures, broken installs),
 * falls back to the hardcoded directory list so existing migrations
 * don't break. The fallback path does NOT copy a starter project.json.
 */
export function scaffoldProjectFolders(projectPath: string): { created: string[] } {
  // Sacred-skip — never scaffold inside a sacred repo.
  if (isSacredProjectPath(projectPath)) {
    return { created: [] };
  }
  const skeletonRoot = findProjectSkeletonRoot();
  if (skeletonRoot) {
    return { created: copySkeletonInto(skeletonRoot, projectPath) };
  }
  // Fallback: hardcoded layout.
  const created: string[] = [];
  for (const rel of PROJECT_FOLDER_LAYOUT_FALLBACK) {
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
