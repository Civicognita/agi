/**
 * Project config path utilities.
 *
 * All project runtime config lives in ~/.agi/{projectSlug}/project.json.
 * Nothing is written inside project directories — the .aionima folder
 * inside projects is reserved for PRIME-only config and pending contributions.
 */

import { homedir } from "node:os";
import { join } from "node:path";

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
 * Return the absolute path to the project's runtime config file.
 * The directory ~/.agi/{slug}/ may not exist yet — callers that write
 * must mkdirSync it first (see writeProjectConfig).
 */
export function projectConfigPath(projectPath: string): string {
  return join(homedir(), ".agi", projectSlug(projectPath), "project.json");
}
