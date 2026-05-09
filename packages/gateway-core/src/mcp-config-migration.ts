/**
 * mcp-config-migration — s131 t681.
 *
 * One-shot, idempotent migration: walks each workspace project, and when
 * `project.json` carries a non-empty `mcp.servers[]` block AND
 * `<projectPath>/.mcp.json` does NOT exist, writes `.mcp.json` from the
 * block (Claude Code shape) and removes the `mcp` field from
 * `project.json`. Already-migrated projects (with `.mcp.json` present)
 * are left alone.
 *
 * Sibling to `project-config-shape-migration.ts` (s150 t632) which
 * handles the type/category shape pass. Shape vs. mcp-storage are
 * different axes; keeping them in separate modules keeps the boot
 * sweep narrow + each axis retirable independently.
 *
 * Safe to call repeatedly. Disk is only touched when something
 * actually changes.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isSacredProjectPath } from "./project-config-path.js";
import { projectMcpPath, serverToMcpEntry, type DotMcpJson, type McpServerEntry } from "./mcp-config-store.js";
import type { ProjectMcpServer } from "@agi/config";

// Re-export for back-compat — t681 originally landed serverToMcpEntry in
// this module; t682 moved it to mcp-config-store.ts to avoid a circular
// import when adding write helpers. Existing callers continue working.
export { serverToMcpEntry };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpMigrationResult {
  /** Whether `.mcp.json` was written this pass. */
  dotMcpWritten: boolean;
  /** Whether `project.json` had its `mcp` field removed this pass. */
  projectJsonStripped: boolean;
  /** Number of servers migrated (mirrors `.mcp.json` server count). */
  serverCount: number;
  /** Reason for skipping when neither flag is true. */
  skippedReason?: "no-project-json" | "no-mcp-block" | "already-migrated" | "sacred-path";
  /** Captured error message when the migration threw mid-flight. */
  error?: string;
}

export interface McpSweepResult {
  scanned: number;
  migrated: number;
  errors: number;
  totalServers: number;
  projects: { projectPath: string; result: McpMigrationResult }[];
}

// ---------------------------------------------------------------------------
// Per-project migration
// ---------------------------------------------------------------------------

const PROJECT_JSON_NAME = "project.json";

/**
 * Migrate one project's MCP config. Idempotent + side-effect-free when
 * nothing needs changing.
 */
export function migrateProjectMcpConfig(projectPath: string): McpMigrationResult {
  const result: McpMigrationResult = {
    dotMcpWritten: false,
    projectJsonStripped: false,
    serverCount: 0,
  };

  if (isSacredProjectPath(projectPath)) {
    result.skippedReason = "sacred-path";
    return result;
  }

  const projectJsonPath = join(projectPath, PROJECT_JSON_NAME);
  if (!existsSync(projectJsonPath)) {
    result.skippedReason = "no-project-json";
    return result;
  }

  // Already migrated — `.mcp.json` is the source of truth; leave it alone
  // even if `project.json mcp` somehow still has values (the dual-read
  // gives `.mcp.json` priority anyway). A future cycle can prune the
  // stale `mcp` field from project.json on its own pass.
  const dotMcp = projectMcpPath(projectPath);
  if (existsSync(dotMcp)) {
    result.skippedReason = "already-migrated";
    return result;
  }

  let raw: string;
  let parsed: { mcp?: { servers?: ProjectMcpServer[] } } & Record<string, unknown>;
  try {
    raw = readFileSync(projectJsonPath, "utf-8");
    parsed = JSON.parse(raw) as { mcp?: { servers?: ProjectMcpServer[] } } & Record<string, unknown>;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }

  const servers = parsed.mcp?.servers ?? [];
  if (servers.length === 0) {
    result.skippedReason = "no-mcp-block";
    // Still null out an empty mcp block so future reads don't trip on
    // `mcp: { servers: [] }` debris.
    if (parsed.mcp !== undefined) {
      const { mcp: _drop, ...rest } = parsed;
      void _drop;
      try {
        writeFileSync(projectJsonPath, JSON.stringify(rest, null, 2) + "\n", "utf-8");
        result.projectJsonStripped = true;
      } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
      }
    }
    return result;
  }

  // Build .mcp.json contents.
  const mcpServers: Record<string, McpServerEntry> = {};
  for (const server of servers) {
    mcpServers[server.id] = serverToMcpEntry(server);
  }
  const dotMcpContent: DotMcpJson = { mcpServers };

  try {
    writeFileSync(dotMcp, JSON.stringify(dotMcpContent, null, 2) + "\n", "utf-8");
    result.dotMcpWritten = true;
    result.serverCount = servers.length;

    // Strip the `mcp` field from project.json now that the data is
    // mirrored in `.mcp.json`.
    const { mcp: _drop, ...rest } = parsed;
    void _drop;
    writeFileSync(projectJsonPath, JSON.stringify(rest, null, 2) + "\n", "utf-8");
    result.projectJsonStripped = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Workspace sweep
// ---------------------------------------------------------------------------

/**
 * Walk every project directory under each workspace root and migrate
 * its MCP config. Mirrors `migrateAllProjectConfigShapes` shape so the
 * boot wiring reads symmetrically.
 */
export function migrateAllProjectMcpConfigs(workspaceProjects: readonly string[]): McpSweepResult {
  const out: McpSweepResult = { scanned: 0, migrated: 0, errors: 0, totalServers: 0, projects: [] };

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
      const result = migrateProjectMcpConfig(projectPath);
      out.projects.push({ projectPath, result });
      if (result.dotMcpWritten) {
        out.migrated++;
        out.totalServers += result.serverCount;
      }
      if (result.error !== undefined) out.errors++;
    }
  }

  return out;
}
