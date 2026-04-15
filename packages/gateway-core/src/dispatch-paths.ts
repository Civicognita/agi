/**
 * Shared project-slug + runtime-dir derivation for per-project storage under
 * ~/.agi/{projectSlug}/*.
 *
 * Plans and TaskMaster dispatch jobs both live in ~/.agi/{projectSlug}/, so
 * the slugifier has to agree across both stores. One canonical helper here;
 * PlanStore imports it, TaskMaster tool handlers + worker runtime import it.
 */
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Convert an absolute project path to a filesystem-safe slug used as the
 * subdirectory name under ~/.agi/.
 *
 * Strips the leading slash, collapses remaining path separators into dashes,
 * and replaces every other unsafe character with underscores. Empty input
 * (or a bare "/") maps to "general" — the fallback bucket used by chats that
 * aren't scoped to any project.
 */
export function projectSlug(projectPath: string): string {
  return (
    projectPath
      .replace(/^\//, "")
      .replace(/\//g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "_") || "general"
  );
}

/**
 * Base directory for a project's TaskMaster dispatch files.
 * Jobs land at `${dispatchDir(projectPath)}/jobs/{jobId}.json`.
 */
export function dispatchDir(projectPath: string): string {
  return join(homedir(), ".agi", projectSlug(projectPath), "dispatch");
}

/** `${dispatchDir(projectPath)}/jobs` — where the dispatch JSON files live. */
export function dispatchJobsDir(projectPath: string): string {
  return join(dispatchDir(projectPath), "jobs");
}
