/**
 * ProjectTypeRegistry — extensible registry of project type definitions.
 *
 * Replaces hardcoded CONTAINER_IMAGES / CONTAINER_INTERNAL_PORTS constants
 * in hosting-manager.ts with a registry that supports built-in types and
 * plugin-registered custom types.
 */

import type { ProjectHostingMeta } from "./hosting-manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectCategory = "literature" | "app" | "web" | "media" | "administration" | "ops" | "monorepo";

export const PROJECT_CATEGORIES: { id: ProjectCategory; label: string }[] = [
  { id: "web", label: "Web" },
  { id: "app", label: "App" },
  { id: "literature", label: "Literature" },
  { id: "media", label: "Media" },
  { id: "monorepo", label: "Monorepo" },
  { id: "ops", label: "Ops" },
  { id: "administration", label: "Administration" },
];

export interface ProjectTypeTool {
  id: string;
  label: string;
  description: string;
  action: "shell" | "api" | "ui";
  command?: string;
  endpoint?: string;
}

export interface LogSourceDefinition {
  id: string;
  label: string;
  /** "container" = podman logs stdout/stderr; "container-file" = file inside the container */
  type: "container" | "container-file";
  /** For "container-file": absolute path inside the container */
  containerPath?: string;
}

export interface ContainerConfig {
  image: string;
  internalPort: number;
  volumeMounts: (projectPath: string, meta: ProjectHostingMeta) => string[];
  env: (meta: ProjectHostingMeta) => Record<string, string>;
  command?: (meta: ProjectHostingMeta) => string[] | null;
}

export interface ProjectTypeDefinition {
  id: string;
  label: string;
  category: ProjectCategory;
  hostable: boolean;
  /** Whether this project type contains code (vs. content like literature/media). */
  hasCode: boolean;
  /**
   * Whether this project type can have an iterative-work loop (s118).
   * Only `app`/`web` (dev) and `ops`/`administration` (ops) categories are
   * eligible per owner spec 2026-04-27. When undefined, inferred from
   * category via ITERATIVE_WORK_ELIGIBLE_CATEGORIES.
   */
  iterativeWorkEligible?: boolean;
  containerConfig?: ContainerConfig;
  defaultMeta: Partial<ProjectHostingMeta>;
  tools: ProjectTypeTool[];
  logSources?: LogSourceDefinition[];
}

/** Categories that default to hasCode: true when not explicitly set. */
const CODE_CATEGORIES: ReadonlySet<ProjectCategory> = new Set(["web", "app", "monorepo", "ops"]);

/**
 * Categories eligible for iterative-work loops (s118 redesign 2026-04-27).
 *
 * - **dev/app** (web + app categories): cadence options 30m, 1h
 * - **ops/admin** (ops + administration categories): cadence options 30m,
 *   1h, 5h, 12h, 1d, 5d, 1w
 *
 * Other categories (literature/media/monorepo) cannot host iterative-work
 * loops — UI hides the tab; API returns 403.
 */
export const ITERATIVE_WORK_ELIGIBLE_CATEGORIES: ReadonlySet<ProjectCategory> = new Set([
  "web",
  "app",
  "ops",
  "administration",
]);

/**
 * Cadence option identifier — keys for the type-aware dropdown the user picks
 * from. The actual cron expression is computed at save time by the auto-stagger
 * logic (D3 / iterative-work/cron.ts). Storing the cadence key separately
 * lets us re-stagger across restarts deterministically.
 */
export type IterativeWorkCadence = "30m" | "1h" | "5h" | "12h" | "1d" | "5d" | "1w";

/** Cadence options offered for "dev" categories (web + app). */
export const DEV_CADENCE_OPTIONS: readonly IterativeWorkCadence[] = ["30m", "1h"];

/** Cadence options offered for "ops" categories (ops + administration). */
export const OPS_CADENCE_OPTIONS: readonly IterativeWorkCadence[] = ["30m", "1h", "5h", "12h", "1d", "5d", "1w"];

/**
 * Cadence options visible in the per-project iterative-work tab dropdown,
 * narrowed by category. Returns empty array when the category is not eligible.
 */
export function cadenceOptionsFor(category: ProjectCategory): readonly IterativeWorkCadence[] {
  if (!ITERATIVE_WORK_ELIGIBLE_CATEGORIES.has(category)) return [];
  if (category === "ops" || category === "administration") return OPS_CADENCE_OPTIONS;
  return DEV_CADENCE_OPTIONS;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ProjectTypeRegistry {
  private readonly types = new Map<string, ProjectTypeDefinition>();

  register(def: ProjectTypeDefinition): void {
    // Infer hasCode from category if not explicitly provided
    let resolved = def.hasCode !== undefined
      ? def
      : { ...def, hasCode: CODE_CATEGORIES.has(def.category) };
    // Infer iterativeWorkEligible from category if not explicitly provided
    if (resolved.iterativeWorkEligible === undefined) {
      resolved = { ...resolved, iterativeWorkEligible: ITERATIVE_WORK_ELIGIBLE_CATEGORIES.has(resolved.category) };
    }
    this.types.set(resolved.id, resolved);
  }

  /** All registered project types eligible for iterative-work loops. */
  getIterativeWorkEligible(): ProjectTypeDefinition[] {
    return this.getAll().filter((t) => t.iterativeWorkEligible);
  }

  get(id: string): ProjectTypeDefinition | undefined {
    return this.types.get(id);
  }

  has(id: string): boolean {
    return this.types.has(id);
  }

  unregister(id: string): boolean {
    return this.types.delete(id);
  }

  getAll(): ProjectTypeDefinition[] {
    return Array.from(this.types.values());
  }

  getHostable(): ProjectTypeDefinition[] {
    return this.getAll().filter((t) => t.hostable);
  }

  getByCategory(category: ProjectCategory): ProjectTypeDefinition[] {
    return this.getAll().filter((t) => t.category === category);
  }

  toJSON(): Record<string, unknown>[] {
    return this.getAll().map((def) => ({
      id: def.id,
      label: def.label,
      category: def.category,
      hostable: def.hostable,
      hasCode: def.hasCode,
      iterativeWorkEligible: def.iterativeWorkEligible ?? false,
      tools: def.tools,
      logSources: def.logSources,
      defaultMeta: def.defaultMeta,
    }));
  }
}

// ---------------------------------------------------------------------------
// Factory — "production" (Administrative) is the only built-in project type.
// All other project types are registered by plugins.
// ---------------------------------------------------------------------------

export function createProjectTypeRegistry(): ProjectTypeRegistry {
  const registry = new ProjectTypeRegistry();

  // Administrative projects are NOT locally hosted — only production-based
  // projects (web, writing, art, etc.) get hosted.
  registry.register({
    id: "production",
    label: "General Production",
    category: "administration",
    hostable: false,
    hasCode: false,
    defaultMeta: {
      type: "production",
      mode: "production",
      internalPort: null,
    },
    tools: [
      { id: "status-board", label: "Status Board", description: "View project status dashboard", action: "ui" },
      { id: "timeline", label: "Timeline", description: "View project timeline", action: "ui" },
    ],
  });

  // Aionima Core — reserved type for AGI core repo forks.
  // Non-hostable, no code tabs — only Repository, Editor, and Details (read-only).
  registry.register({
    id: "aionima",
    label: "Aionima Core",
    category: "monorepo",
    hostable: false,
    hasCode: false,
    defaultMeta: {
      type: "aionima",
      mode: "production",
      internalPort: null,
    },
    tools: [],
  });

  return registry;
}
