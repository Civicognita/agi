/**
 * Stack type definitions — composable, plugin-driven project stacks.
 *
 * A Stack bundles runtime, database, guides, requirements, tools, and optional
 * scaffolding. Projects can have multiple stacks. Database stacks share
 * containers across projects.
 */

import type { ProjectCategory, ProjectTypeTool, LogSourceDefinition } from "./project-types.js";

// ---------------------------------------------------------------------------
// Stack categories
// ---------------------------------------------------------------------------

export type StackCategory = "runtime" | "database" | "tooling" | "framework" | "workflow";

// ---------------------------------------------------------------------------
// Stack building blocks
// ---------------------------------------------------------------------------

export interface StackRequirement {
  id: string;
  label: string;
  description?: string;
  /** "provided" = this stack brings it; "expected" = must come from elsewhere. */
  type: "provided" | "expected";
}

export interface StackGuide {
  title: string;
  /** Markdown content. */
  content: string;
}

// ---------------------------------------------------------------------------
// Container context — passed to dynamic config functions
// ---------------------------------------------------------------------------

export interface StackContainerContext {
  projectPath: string;
  projectHostname: string;
  allocatedPort: number;
  databaseName?: string;
  databaseUser?: string;
  databasePassword?: string;
  mode: "production" | "development";
}

// ---------------------------------------------------------------------------
// Container config — how to run the stack's container
// ---------------------------------------------------------------------------

export interface StackContainerConfig {
  image: string;
  internalPort: number;
  /** If true, one container is shared across projects (keyed by sharedKey). */
  shared: boolean;
  /** Unique key for shared containers (e.g. "postgres-17"). */
  sharedKey?: string;
  /** Document root within the project (e.g. "public" for Laravel). */
  docRoot?: string;
  volumeMounts: (ctx: StackContainerContext) => string[];
  env: (ctx: StackContainerContext) => Record<string, string>;
  command?: (ctx: StackContainerContext) => string[] | null;
  healthCheck?: string;
}

// ---------------------------------------------------------------------------
// Database config — only for DB stacks
// ---------------------------------------------------------------------------

export interface StackDatabaseConfig {
  /** Engine identifier (e.g. "postgresql", "mariadb"). */
  engine: string;
  rootUser: string;
  rootPasswordEnvVar: string;
  /** Command to create per-project database/user (run via podman exec). */
  setupScript: (ctx: StackContainerContext) => string[];
  /** Command to drop per-project database/user. */
  teardownScript?: (ctx: StackContainerContext) => string[];
  /** Template: "postgresql://{user}:{password}@localhost:{port}/{database}" */
  connectionUrlTemplate: string;
}

// ---------------------------------------------------------------------------
// Install actions — auto-run when a stack is added, re-runnable from UI
// ---------------------------------------------------------------------------

export interface StackInstallAction {
  /** command.action format ID, e.g. "composer.require.laravel/laravel" */
  id: string;
  label: string;
  description?: string;
  /** Shell command to execute in the project directory. */
  command: string;
  /** If true, skip on error and continue with next action. */
  optional?: boolean;
  /**
   * Per-repo visibility filter (s141 t553). When set, the action only
   * surfaces for repos where `whenRepo(ctx)` returns true. When unset,
   * the action shows on every repo with the stack attached (backward
   * compat — covers the project-level intent).
   *
   * Plugin authors decide whether their actions are project-level or
   * repo-level. Examples:
   *   - "Run migrations" on a `database` stack: project-level (one DB,
   *     one set of migrations) — leave whenRepo unset.
   *   - "Restart vite dev server" on a framework stack: repo-level
   *     (each repo has its own dev server) — `whenRepo: ({ repoName })
   *     => Boolean(repoName)` shows it only when called with a real
   *     repo context.
   *
   * `repoName` is empty string when the caller is a project-level
   * surface (the legacy stack-card actions list); `repoCount` is the
   * total number of repos on the project so plugin authors can short-
   * circuit single-repo projects with `repoCount === 1`.
   */
  whenRepo?: (ctx: { projectPath: string; repoName: string; repoCount: number }) => boolean;
}

// ---------------------------------------------------------------------------
// Dev commands — well-known + custom named commands for a stack
// ---------------------------------------------------------------------------

export interface StackDevCommands {
  dev?: string;
  build?: string;
  test?: string;
  lint?: string;
  start?: string;
  /** Custom named commands beyond the well-known set. */
  [key: string]: string | undefined;
}

// ---------------------------------------------------------------------------
// Scaffolding config — optional project bootstrap
// ---------------------------------------------------------------------------

export interface StackScaffoldingConfig {
  label: string;
  description?: string;
  command: string[];
  expectedOutput?: string[];
}

/**
 * Filter a stack's install actions by per-repo predicate (s141 t553).
 *
 * Default (no `whenRepo`): action shows on every repo with the stack —
 * preserves the project-level legacy semantics.
 *
 * @param actions     The stack's `installActions` (or undefined).
 * @param ctx         Repo context: `repoName` is empty string for
 *                    project-level surfaces; `repoCount` is the total
 *                    number of repos on the project.
 */
export function filterStackActionsForRepo(
  actions: StackInstallAction[] | undefined,
  ctx: { projectPath: string; repoName: string; repoCount: number },
): StackInstallAction[] {
  if (!actions || actions.length === 0) return [];
  return actions.filter((a) => (a.whenRepo === undefined ? true : a.whenRepo(ctx)));
}

// ---------------------------------------------------------------------------
// Stack definition — the full composable unit
// ---------------------------------------------------------------------------

export interface StackDefinition {
  id: string;
  label: string;
  description: string;
  category: StackCategory;
  /** Which project categories this stack applies to. */
  projectCategories: ProjectCategory[];
  requirements: StackRequirement[];
  guides: StackGuide[];
  /** Container config (null for non-container stacks like runtimes). */
  containerConfig?: StackContainerConfig;
  /** Database config (only for DB stacks). */
  databaseConfig?: StackDatabaseConfig;
  /** Optional scaffolding for new projects. */
  scaffolding?: StackScaffoldingConfig;
  /** Actions auto-run when the stack is added; re-runnable from the UI. */
  installActions?: StackInstallAction[];
  /** Dev commands surfaced in the project toolbar. */
  devCommands?: StackDevCommands;
  /** Tools added to projects using this stack. */
  tools: ProjectTypeTool[];
  icon?: string;
  /** Runtime languages compatible with this stack (e.g. ["node"], ["php"]).
   *  When set, the runtime picker only shows matching runtimes.
   *  When omitted, all runtimes are shown (backward compatible). */
  compatibleLanguages?: string[];
  /** Log sources exposed by this stack (shown in the Logs dropdown). */
  logSources?: LogSourceDefinition[];
}

// ---------------------------------------------------------------------------
// Per-project stack instance — persisted in ~/.agi/{slug}/project.json
// ---------------------------------------------------------------------------

export interface ProjectStackInstance {
  stackId: string;
  databaseName?: string;
  databaseUser?: string;
  databasePassword?: string;
  addedAt: string;
}

// ---------------------------------------------------------------------------
// Serialized stack info — safe for API responses (no functions)
// ---------------------------------------------------------------------------

export interface StackInfo {
  id: string;
  label: string;
  description: string;
  category: StackCategory;
  projectCategories: ProjectCategory[];
  requirements: StackRequirement[];
  guides: StackGuide[];
  hasContainer: boolean;
  hasDatabase: boolean;
  hasScaffolding: boolean;
  installActions?: StackInstallAction[];
  devCommands?: StackDevCommands;
  tools: ProjectTypeTool[];
  icon?: string;
  compatibleLanguages?: string[];
  logSources?: LogSourceDefinition[];
}

// ---------------------------------------------------------------------------
// Shared container persistence
// ---------------------------------------------------------------------------

export interface SharedContainerRecord {
  port: number;
  containerName: string;
}

export interface SharedContainerInfo {
  sharedKey: string;
  containerName: string;
  port: number;
  status: "running" | "stopped" | "error";
  projectCount: number;
}
