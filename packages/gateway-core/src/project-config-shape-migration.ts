/**
 * project-config-shape-migration — s150 t632.
 *
 * One-shot, idempotent sweep that rewrites existing `<projectPath>/project.json`
 * files into the s150 shape:
 *
 *   1. Top-level `type` is the single source of truth for project
 *      classification. Ensure it is set; derive from `hosting.type` first,
 *      `category` second, falling back to `"static-site"` only if neither
 *      is available (no project today reaches that fallback).
 *   2. Drop top-level `category` (replaced by `type`; the type registry
 *      derives Desktop-served vs code-served from `type` alone).
 *   3. Drop `hosting.containerKind` (same reason — type drives container
 *      shape; the field has been redundant since t631 added `servesDesktop`).
 *   4. Remove `<projectPath>/.agi/project.json` debris left over from the
 *      s130 → s140 location migration. Empty `.agi/` dir is rmdir'd.
 *
 * Safe to call repeatedly. Disk is only touched when something actually
 * changes — a fully-migrated project returns `{ configRewritten: false,
 * agiDebrisRemoved: false }` and short-circuits.
 *
 * Sibling to `migrateProjectConfig` (project-config-path.ts), which
 * handles the s130 → s140 LOCATION migration. Shape vs. location are
 * separate axes; keeping them in different modules makes it easier to
 * retire the location migration later without disturbing the shape pass.
 */

import { existsSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isSacredProjectPath } from "./project-config-path.js";

// ---------------------------------------------------------------------------
// Category → default type map. Used only when a project.json has `category`
// but neither top-level `type` nor `hosting.type`. None of the projects on
// disk today reach this fallback; it exists to keep the migration safe for
// any older snapshots that pre-date hosting being configured.
// ---------------------------------------------------------------------------

const CATEGORY_TO_DEFAULT_TYPE: Readonly<Record<string, string>> = Object.freeze({
  literature: "writing",
  app: "web-app",
  web: "web-app",
  media: "art",
  administration: "ops",
  ops: "ops",
  monorepo: "monorepo",
});

export interface ShapeMigrationResult {
  /** True when project.json contents were rewritten. */
  configRewritten: boolean;
  /** True when `<projectPath>/.agi/project.json` was deleted. */
  agiDebrisRemoved: boolean;
  /** Populated when the migration had to set top-level `type` itself. */
  derivedType?: { value: string; source: "hosting.type" | "category" | "default" };
  /** Populated when a top-level `category` was removed. */
  droppedCategory?: string;
  /** Populated when a `hosting.containerKind` was removed. */
  droppedContainerKind?: string;
  /** s150 t635 — populated when `hosting.stacks[]` entries were stripped
   * because the project is Desktop-served (stacks don't apply). */
  strippedStacks?: string[];
  /** Populated when migration failed for the project (non-fatal). */
  error?: string;
}

export interface ShapeMigrationOptions {
  /**
   * s150 t635 — predicate that returns true when a given project type is
   * Desktop-served. When provided, the migration strips entries from
   * `hosting.stacks[]` for Desktop-served projects (stacks attach to code,
   * Desktop-served projects don't run code-stack containers). Boot wires
   * this with `(type) => servesDesktopFor(type, registry)`. Tests can pass
   * a custom predicate to verify the contract without spinning up a
   * registry.
   */
  isDesktopServedType?: (type: string) => boolean;
}

/**
 * Migrate one project's project.json into the s150 shape.
 * Idempotent and side-effect-free when nothing needs changing.
 */
export function migrateProjectConfigShape(
  projectPath: string,
  options: ShapeMigrationOptions = {},
): ShapeMigrationResult {
  const result: ShapeMigrationResult = {
    configRewritten: false,
    agiDebrisRemoved: false,
  };

  if (isSacredProjectPath(projectPath)) return result;

  // Step 1 — clean up `.agi/project.json` debris from the s130 → s140 migration.
  // Done first because if the file is present alongside the s140 project.json,
  // the legacy file is stale and should never be re-promoted.
  const agiDir = join(projectPath, ".agi");
  const agiConfigPath = join(agiDir, "project.json");
  if (existsSync(agiConfigPath)) {
    try {
      unlinkSync(agiConfigPath);
      result.agiDebrisRemoved = true;
      // Best-effort rmdir — leave the dir alone if other files live there.
      try {
        if (readdirSync(agiDir).length === 0) rmdirSync(agiDir);
      } catch { /* dir went away or has siblings — fine */ }
    } catch (e) {
      result.error = `failed to remove .agi/project.json: ${e instanceof Error ? e.message : String(e)}`;
      return result;
    }
  }

  // Step 2 — rewrite project.json contents (if it exists).
  const configPath = join(projectPath, "project.json");
  if (!existsSync(configPath)) return result;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch (e) {
    result.error = `failed to parse project.json: ${e instanceof Error ? e.message : String(e)}`;
    return result;
  }

  const next: Record<string, unknown> = { ...raw };
  let mutated = false;

  // 2a — ensure top-level `type` is set.
  if (typeof next.type !== "string" || next.type.length === 0) {
    const hosting = next.hosting as Record<string, unknown> | undefined;
    const hostingType = typeof hosting?.type === "string" && hosting.type.length > 0 ? hosting.type : undefined;
    const category = typeof next.category === "string" ? next.category : undefined;
    let derived: string;
    let source: "hosting.type" | "category" | "default";
    if (hostingType !== undefined) {
      derived = hostingType;
      source = "hosting.type";
    } else if (category !== undefined && CATEGORY_TO_DEFAULT_TYPE[category] !== undefined) {
      derived = CATEGORY_TO_DEFAULT_TYPE[category];
      source = "category";
    } else {
      derived = "static-site";
      source = "default";
    }
    next.type = derived;
    result.derivedType = { value: derived, source };
    mutated = true;
  }

  // 2b — drop top-level `category`.
  if ("category" in next) {
    result.droppedCategory = typeof next.category === "string" ? next.category : String(next.category);
    delete next.category;
    mutated = true;
  }

  // 2c — drop `hosting.containerKind`.
  const hosting = next.hosting as Record<string, unknown> | undefined;
  if (hosting !== undefined && "containerKind" in hosting) {
    result.droppedContainerKind = typeof hosting.containerKind === "string"
      ? hosting.containerKind
      : String(hosting.containerKind);
    const { containerKind: _drop, ...hostingNext } = hosting;
    next.hosting = hostingNext;
    mutated = true;
  }

  // 2d — s150 t635 — strip `hosting.stacks[]` for Desktop-served projects.
  // Stacks attach to code; Desktop-served projects (type=ops/media/etc.)
  // ignore them at dispatch (post-t634), so attached stacks are dead data
  // that misleads the dashboard "Stacks" surface.
  const isDesktopServed = options.isDesktopServedType;
  const finalType = next.type;
  if (
    isDesktopServed !== undefined
    && typeof finalType === "string"
    && finalType.length > 0
    && isDesktopServed(finalType)
  ) {
    const hostingForStacks = next.hosting as Record<string, unknown> | undefined;
    const stacks = hostingForStacks?.stacks;
    if (Array.isArray(stacks) && stacks.length > 0) {
      result.strippedStacks = stacks
        .map((s) => (typeof s === "object" && s !== null && typeof (s as { stackId?: unknown }).stackId === "string"
          ? (s as { stackId: string }).stackId
          : null))
        .filter((s): s is string => s !== null);
      next.hosting = { ...hostingForStacks, stacks: [] };
      mutated = true;
    }
  }

  if (mutated) {
    try {
      writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
      result.configRewritten = true;
    } catch (e) {
      result.error = `failed to write project.json: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return result;
}

export interface ShapeSweepResult {
  /** Total project directories scanned (after sacred-skip). */
  scanned: number;
  /** How many had their project.json rewritten. */
  rewrote: number;
  /** How many had a `.agi/project.json` debris file removed. */
  debrisRemoved: number;
  /** s150 t635 — how many had stacks stripped (Desktop-served cleanup). */
  stacksStripped: number;
  /** How many failed the migration (non-fatal). */
  errors: number;
  /** Per-project results for the boot log / dashboard. */
  projects: Array<{ projectPath: string; result: ShapeMigrationResult }>;
}

/**
 * Run the shape migration across every project directory under each entry
 * of `workspaceProjects`. Mirrors hosting-manager's
 * `migrateAllProjectsToFolderLayout` shape so the boot-time wiring reads
 * symmetrically.
 */
export function migrateAllProjectConfigShapes(
  workspaceProjects: readonly string[],
  options: ShapeMigrationOptions = {},
): ShapeSweepResult {
  const out: ShapeSweepResult = { scanned: 0, rewrote: 0, debrisRemoved: 0, stacksStripped: 0, errors: 0, projects: [] };

  for (const dir of workspaceProjects) {
    let entries: string[];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name);
    } catch {
      continue;
    }

    for (const slug of entries) {
      const projectPath = join(dir, slug);
      if (isSacredProjectPath(projectPath)) continue;
      out.scanned++;
      try {
        const result = migrateProjectConfigShape(projectPath, options);
        out.projects.push({ projectPath, result });
        if (result.configRewritten) out.rewrote++;
        if (result.agiDebrisRemoved) out.debrisRemoved++;
        if (result.strippedStacks !== undefined && result.strippedStacks.length > 0) out.stacksStripped++;
        if (result.error !== undefined) out.errors++;
      } catch (e) {
        out.errors++;
        out.projects.push({
          projectPath,
          result: {
            configRewritten: false,
            agiDebrisRemoved: false,
            error: e instanceof Error ? e.message : String(e),
          },
        });
      }
    }
  }

  return out;
}
