/**
 * Stack type definitions — composable, plugin-driven project stacks.
 *
 * A Stack bundles runtime, database, guides, requirements, tools, and optional
 * scaffolding. Projects can have multiple stacks. Database stacks share
 * containers across projects.
 */

import type { ProjectCategory, ProjectTypeTool } from "./project-types.js";

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
