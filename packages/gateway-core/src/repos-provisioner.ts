/**
 * repos-provisioner — clones a project's `repos[]` entries into
 * `<projectPath>/repos/<name>/` on demand.
 *
 * **s130 t515 slice 2 (2026-04-29):** the smallest viable provisioning
 * primitive. Doesn't yet wire into ProjectConfigManager (that's slice 3);
 * this module just provides a pure function ProjectConfigManager can
 * call when a project's repos[] is non-empty.
 *
 * **What this does:**
 *   1. Walks the repos[] array
 *   2. For each entry, computes target path (default `<projectPath>/repos/<name>/`)
 *   3. If target exists already → skip (idempotent)
 *   4. If missing → call cloneFn (default = real `git clone`)
 *   5. Returns per-repo provisioned/skipped/error result
 *
 * **What this does NOT do:**
 *   - Update existing clones (no `git pull`) — that's a separate concern
 *   - Manage write permissions — `repos[].writable` defaults false but
 *     enforcement lives in the chat-tool cage (slices 5+6)
 *   - Multi-repo bind mounts for hosting (that's slice 4)
 *
 * **Security:** the git invocation uses execFileSync (no shell), array
 * args. Repo URLs come from validated zod schema (string field, no
 * injection check), and the path arg is computed server-side so user
 * input doesn't reach the shell. Same pattern as dev-mode-forks
 * provisioning at server-runtime-state.ts:2950.
 */

import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { ProjectRepo } from "@agi/config";

export interface RepoCloneResult {
  /** Repo name (matches ProjectRepo.name). */
  name: string;
  /** Target dir the clone landed in. */
  targetDir: string;
  /** What happened. */
  outcome: "provisioned" | "skipped" | "error";
  /** Populated when outcome === "error". */
  error?: string;
}

export interface ProvisionResult {
  /** Per-repo outcomes. */
  repos: RepoCloneResult[];
  /** Quick summary counts. */
  provisioned: number;
  skipped: number;
  errors: number;
}

/** Function shape for cloning a repo. Default (`defaultCloneFn`) shells
 *  out to `git clone`; tests inject a mock that records calls. */
export type CloneFn = (
  url: string,
  targetDir: string,
  branch?: string,
) => { ok: boolean; error?: string };

/** Real git-clone implementation. Uses execFileSync (no shell) for
 *  security — repo URLs from project config never reach a shell. */
export const defaultCloneFn: CloneFn = (url, targetDir, branch) => {
  try {
    const args = ["clone"];
    if (branch) args.push("--branch", branch);
    args.push(url, targetDir);
    execFileSync("git", args, {
      stdio: "pipe",
      timeout: 120_000,
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

/** Resolve the target dir for a repo entry. Honors the optional
 *  `path` override; defaults to `<projectPath>/repos/<name>/`. */
export function resolveRepoTargetDir(projectPath: string, repo: ProjectRepo): string {
  return repo.path ?? join(projectPath, "repos", repo.name);
}

/**
 * Idempotently provision all entries in a project's `repos[]` array.
 * Existing clones are skipped; missing ones get cloned via cloneFn.
 *
 * Returns per-repo outcomes plus aggregate counts. Errors are captured
 * per-repo (non-fatal) so one bad URL doesn't block the others.
 */
export function provisionProjectRepos(
  projectPath: string,
  repos: ProjectRepo[],
  options: { cloneFn?: CloneFn } = {},
): ProvisionResult {
  const cloneFn = options.cloneFn ?? defaultCloneFn;
  const result: ProvisionResult = {
    repos: [],
    provisioned: 0,
    skipped: 0,
    errors: 0,
  };

  for (const repo of repos) {
    const targetDir = resolveRepoTargetDir(projectPath, repo);

    // Idempotent skip: if the target already exists, leave it alone.
    // (Future slice could add `git pull` to keep current; for now
    // we treat existing clones as immutable from the provisioner's
    // perspective.)
    if (existsSync(targetDir)) {
      result.repos.push({ name: repo.name, targetDir, outcome: "skipped" });
      result.skipped += 1;
      continue;
    }

    // Ensure parent dir exists. The clone itself creates targetDir,
    // but its parent (e.g. `<projectPath>/repos/`) may not exist if
    // the project hasn't been scaffoldProjectFolders'd yet.
    try {
      mkdirSync(join(targetDir, ".."), { recursive: true });
    } catch (e) {
      result.repos.push({
        name: repo.name,
        targetDir,
        outcome: "error",
        error: `parent dir setup failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      result.errors += 1;
      continue;
    }

    const cloneOutcome = cloneFn(repo.url, targetDir, repo.branch);
    if (cloneOutcome.ok) {
      result.repos.push({ name: repo.name, targetDir, outcome: "provisioned" });
      result.provisioned += 1;
    } else {
      result.repos.push({
        name: repo.name,
        targetDir,
        outcome: "error",
        error: cloneOutcome.error,
      });
      result.errors += 1;
    }
  }

  return result;
}
