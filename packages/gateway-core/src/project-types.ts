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
  /**
   * @deprecated s150 t639 (2026-05-07) — `category` is being phased out.
   * `id` is now the single classifier; `servesDesktop` derives the container
   * binary; iterative-work / testing-UX eligibility are inferred from
   * type-id sets instead. Kept optional for back-compat with plugin
   * manifests that still set it; new manifests should omit it.
   */
  category?: ProjectCategory;
  hostable: boolean;
  /**
   * @deprecated s150 (2026-05-07) — use `servesDesktop` (inverted polarity).
   * `hasCode` was the binary "code-served-or-not" knob inferred from category.
   * Per the universal monorepo directive, every project HAS code in repos/ even
   * if it's content-only. The right binary is whether the Aion Desktop serves
   * the project's network face (vs the project's repos producing the served
   * output). Consumers should migrate to `servesDesktop`. Kept as a field for
   * back-compat until t634 (hosting-manager refactor) lands.
   */
  hasCode: boolean;
  /**
   * s150 (2026-05-07) — single source of truth for the code-served-vs-Desktop-
   * served binary. When `true`, hosting-manager runs the Aion Desktop bundle
   * (light Caddy + nginx:alpine + per-project hosting.mapps[]). When `false`,
   * the project's repos produce the served output via stack-driven container
   * (npm start, nginx-on-dist, etc.). When undefined, falls back to
   * `servesDesktopFor(id)` which uses a known type-id set (with category as
   * a final-fallback heuristic). Hosting-manager reads via the helper, not
   * this field directly, so plugin contributors don't have to set it for
   * recognized types.
   */
  servesDesktop?: boolean;
  /**
   * Whether this project type can have an iterative-work loop (s118).
   * Only `app`/`web` (dev) and `ops`/`administration` (ops) categories are
   * eligible per owner spec 2026-04-27. When undefined, inferred from
   * category via ITERATIVE_WORK_ELIGIBLE_CATEGORIES.
   */
  iterativeWorkEligible?: boolean;
  /**
   * Whether this project type exposes the testing suite UX (s121).
   * Only `app` + `web` are eligible. When undefined, inferred from
   * category via TESTING_UX_ELIGIBLE_CATEGORIES.
   */
  testingUxEligible?: boolean;
  containerConfig?: ContainerConfig;
  defaultMeta: Partial<ProjectHostingMeta>;
  tools: ProjectTypeTool[];
  logSources?: LogSourceDefinition[];
}

/** Categories that default to hasCode: true when not explicitly set. */
const CODE_CATEGORIES: ReadonlySet<ProjectCategory> = new Set(["web", "app", "monorepo", "ops"]);

/**
 * Project type IDs that serve their network face from Aion Desktop (light
 * Caddy + nginx:alpine + per-project hosting.mapps[]). Per s150 directive,
 * this is the canonical discriminator — `type` drives container shape.
 *
 * Updates land here when new Desktop-served types ship (e.g., backup-aggregator).
 * For types not in this set + not in CODE_SERVED_TYPES, the fallback is
 * category-based (CODE_CATEGORIES inverted).
 */
export const DESKTOP_SERVED_TYPES: ReadonlySet<string> = new Set([
  "ops",
  "media",
  "literature",
  "documentation",
  "backup-aggregator",
  // s151 (2026-05-09) — owner UX call unified single-viewer projects under
  // Desktop-served. `writing` (e.g. bliss_chronicles) and `art` projects
  // now render the Aion Desktop with their configured `magicApps[]` as
  // tiles instead of inlining a single MApp at /. The hosting.type is
  // what dispatch reads, so projects whose hosting.type stays "static-site"
  // (my_art's case) remain code-served.
  "writing",
  "art",
]);

/**
 * Project type IDs that produce their network face from the project's own
 * repos (npm start, nginx-on-dist, apache-on-php, etc.) — image + mounts
 * driven by stacks. Counterpart to DESKTOP_SERVED_TYPES.
 */
export const CODE_SERVED_TYPES: ReadonlySet<string> = new Set([
  "web-app",
  "static-site",
  "api-service",
  "php-app",
  // s150 t640 (2026-05-07) — "monorepo" REMOVED. Every project is a monorepo
  // per the universal-monorepo directive; a sibling "monorepo" type as a
  // peer of web-app/static-site/etc. contradicts the model. The s150 t632
  // shape sweep remaps existing type="monorepo" projects to "web-app".
  // s151 (2026-05-09) — "art" + "writing" MOVED to DESKTOP_SERVED_TYPES.
  // Owner UX call unified single-viewer projects under the Desktop+tiles
  // dispatch path. Projects whose hosting.type is "static-site" still
  // route here (my_art's case).
]);

/**
 * Returns whether the given project type serves its network face from Aion
 * Desktop (true) vs its own code (false). Resolution precedence:
 *   1. Explicit `servesDesktop` on the registered ProjectTypeDefinition
 *   2. DESKTOP_SERVED_TYPES set membership
 *   3. CODE_SERVED_TYPES set membership (returns false)
 *   4. Category fallback via CODE_CATEGORIES (returns false for code categories,
 *      true for everything else)
 *
 * The registry parameter is optional — when omitted, the function uses just
 * the type-id sets + a default category heuristic. Callers with access to a
 * ProjectTypeRegistry should pass it for the most accurate answer.
 */
export function servesDesktopFor(
  typeId: string | undefined | null,
  registry?: ProjectTypeRegistry,
): boolean {
  if (!typeId) return false;
  const def = registry?.get(typeId);
  if (def?.servesDesktop !== undefined) return def.servesDesktop;
  if (DESKTOP_SERVED_TYPES.has(typeId)) return true;
  if (CODE_SERVED_TYPES.has(typeId)) return false;
  // Final fallback: derive from category if registered, else assume code-served.
  if (def && def.category !== undefined && CODE_CATEGORIES.has(def.category)) return false;
  return def !== undefined; // unknown type with non-code category → Desktop-served
}

/**
 * Categories eligible for the testing suite UX (s121 — Tests / Spot / E2E
 * surfaces). Only app + web project types host code in the testable sense;
 * other categories (literature, media, ops, administration, monorepo)
 * don't expose testing tabs/buttons. Mirrors the iterative-work eligibility
 * pattern but with a narrower set.
 */
/**
 * s150 t639 — type-id sets for inference paths that previously routed
 * through `category`. Plugins now express eligibility by registering with
 * a known id; falling back to the category set keeps legacy paths working.
 */
export const ITERATIVE_WORK_ELIGIBLE_TYPE_IDS: ReadonlySet<string> = new Set([
  "web-app",
  "api-service",
  "static-site",
  "php-app",
  "ops",
]);

export const TESTING_UX_ELIGIBLE_TYPE_IDS: ReadonlySet<string> = new Set([
  "web-app",
  "static-site",
  "api-service",
  "php-app",
]);

export const TESTING_UX_ELIGIBLE_CATEGORIES: ReadonlySet<ProjectCategory> = new Set([
  "app",
  "web",
]);

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
    // s150 t639 — defaults derive from `id` first, then category fallback for
    // legacy plugins that still pass it. The id-based maps (DESKTOP_SERVED_TYPES
    // / CODE_SERVED_TYPES / ITERATIVE_WORK_ELIGIBLE_TYPE_IDS / TESTING_UX_ELIGIBLE_TYPE_IDS)
    // are the single source of truth.
    let resolved = def.hasCode !== undefined
      ? def
      : { ...def, hasCode: !servesDesktopFor(def.id) };
    if (resolved.iterativeWorkEligible === undefined) {
      const idEligible = ITERATIVE_WORK_ELIGIBLE_TYPE_IDS.has(resolved.id);
      const catEligible = resolved.category !== undefined && ITERATIVE_WORK_ELIGIBLE_CATEGORIES.has(resolved.category);
      resolved = { ...resolved, iterativeWorkEligible: idEligible || catEligible };
    }
    if (resolved.testingUxEligible === undefined) {
      const idEligible = TESTING_UX_ELIGIBLE_TYPE_IDS.has(resolved.id);
      const catEligible = resolved.category !== undefined && TESTING_UX_ELIGIBLE_CATEGORIES.has(resolved.category);
      resolved = { ...resolved, testingUxEligible: idEligible || catEligible };
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
      testingUxEligible: def.testingUxEligible ?? false,
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
