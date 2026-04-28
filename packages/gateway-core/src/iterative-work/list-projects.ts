/**
 * Project enumeration for iterative-work scheduling.
 *
 * Walks the gateway's workspace directories (config.workspace.projects) and
 * returns the absolute paths of every immediate subdirectory that has a
 * corresponding `~/.agi/{slug}/project.json`. The mere existence of the
 * project.json is the "is this a registered project?" signal — content
 * inspection (e.g. iterativeWork.enabled) is the scheduler's job, not this
 * function's.
 *
 * Why a separate file (vs. a method on ProjectConfigManager): the manager
 * is a per-project read/write service, not a workspace-walker. Mixing the
 * two concerns made the manager's API inconsistent (read takes a project
 * path; listAll would take a workspace dir). Keeping the walker here means
 * the manager's surface stays focused.
 */

import { existsSync, readdirSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { projectConfigPath } from "../project-config-path.js";

/**
 * Returns the absolute paths of all projects with a configured project.json
 * across the supplied workspace directories. Errors during directory reads
 * are swallowed (a missing or unreadable workspace dir contributes nothing
 * rather than aborting enumeration). Order is workspace-dir order, then
 * subdirectory enumeration order (filesystem-defined, not sorted).
 */
export function listProjectsWithConfig(workspaceDirs: readonly string[]): string[] {
  const out: string[] = [];
  for (const dir of workspaceDirs) {
    if (!existsSync(dir)) continue;
    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectPath = resolvePath(dir, entry.name);
      if (existsSync(projectConfigPath(projectPath))) {
        out.push(projectPath);
      }
    }
  }
  return out;
}
