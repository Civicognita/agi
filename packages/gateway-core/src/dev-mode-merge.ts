/**
 * Dev-Mode merge helpers — git operations for the core-fork Repository tab.
 *
 * Keeps the git plumbing out of server-runtime-state.ts so the route
 * handlers stay thin: each exported function does one thing (compare,
 * fetch, merge, push) and returns a structured result.
 *
 * All operations run against the five `_aionima/<slug>/` workspace
 * clones that Dev Mode provisions. Every clone has two remotes:
 *   - origin   → wishborn/<repo>   (owner's fork)
 *   - upstream → Civicognita/<repo> (canonical release channel)
 *
 * The merge workflow is always "pull upstream into origin" — the
 * reverse direction (fork → upstream) happens via GitHub PR, not here.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentLogger } from "./logger.js";
import { CORE_REPOS, upstreamRemoteUrl, type CoreRepoSpec } from "./dev-mode-forks.js";
import type { AionMicroManager } from "./aion-micro-manager.js";

const FETCH_TIMEOUT_MS = 20_000;
const MERGE_TIMEOUT_MS = 30_000;
const PUSH_TIMEOUT_MS = 30_000;
const REV_LIST_TIMEOUT_MS = 5_000;

export interface CoreForkStatus {
  slug: CoreRepoSpec["slug"];
  displayName: string;
  branch: string;
  currentSha: string | null;
  upstreamSha: string | null;
  /** Commits present on origin/<branch> but not on upstream/<branch>. */
  ahead: number;
  /** Commits on upstream/<branch> not yet pulled into the fork. */
  behind: number;
  lastFetchedAt: string;
  error?: string;
}

export interface MergeResultOk {
  ok: true;
  ff: boolean;
  agentic: boolean;
  newSha: string;
  pushed: boolean;
}

export interface MergeResultConflict {
  ok: false;
  conflict: true;
  agentic: boolean;
  /** When true, aion-micro tried and couldn't confidently resolve — user must review. */
  reviewNeeded?: boolean;
  files: string[];
  aionSummary?: string;
  reason?: string;
}

export interface MergeResultError {
  ok: false;
  conflict: false;
  reason: string;
}

export type MergeResult = MergeResultOk | MergeResultConflict | MergeResultError;

function gitSilent(args: string[], cwd: string, timeoutMs = MERGE_TIMEOUT_MS): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("git", args, { cwd, stdio: "pipe", timeout: timeoutMs }).toString();
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    return {
      ok: false,
      stdout: e.stdout ? e.stdout.toString() : "",
      stderr: e.stderr ? e.stderr.toString() : (err instanceof Error ? err.message : String(err)),
    };
  }
}

/**
 * Fetch `upstream <branch>` and compute ahead/behind relative to HEAD.
 * `git rev-list --left-right --count A...B` emits `<left>\t<right>`
 * where left = commits unique to A and right = commits unique to B.
 * We request `upstream/<branch>...HEAD`, so:
 *   left  = behind (commits on upstream we don't have)
 *   right = ahead  (commits on our fork upstream doesn't have)
 */
export async function computeForkStatus(
  targetDir: string,
  spec: CoreRepoSpec,
  branch: string,
): Promise<CoreForkStatus> {
  const base: CoreForkStatus = {
    slug: spec.slug,
    displayName: spec.displayName,
    branch,
    currentSha: null,
    upstreamSha: null,
    ahead: 0,
    behind: 0,
    lastFetchedAt: new Date().toISOString(),
  };

  if (!existsSync(join(targetDir, ".git"))) {
    return { ...base, error: `not a git repo: ${targetDir}` };
  }

  const fetchRes = gitSilent(["fetch", "--no-tags", "upstream", branch], targetDir, FETCH_TIMEOUT_MS);
  if (!fetchRes.ok) {
    return { ...base, error: fetchRes.stderr.slice(0, 500) };
  }

  const headSha = gitSilent(["rev-parse", "HEAD"], targetDir, REV_LIST_TIMEOUT_MS);
  const upstreamSha = gitSilent(["rev-parse", `upstream/${branch}`], targetDir, REV_LIST_TIMEOUT_MS);
  const counts = gitSilent(
    ["rev-list", "--left-right", "--count", `upstream/${branch}...HEAD`],
    targetDir,
    REV_LIST_TIMEOUT_MS,
  );

  if (!counts.ok) {
    return { ...base, error: counts.stderr.slice(0, 500) };
  }

  const [behindStr, aheadStr] = counts.stdout.trim().split(/\s+/);
  return {
    ...base,
    currentSha: headSha.ok ? headSha.stdout.trim() : null,
    upstreamSha: upstreamSha.ok ? upstreamSha.stdout.trim() : null,
    behind: Number.parseInt(behindStr ?? "0", 10) || 0,
    ahead: Number.parseInt(aheadStr ?? "0", 10) || 0,
  };
}

/**
 * Aggregate status for every core fork in the workspace. Missing dirs
 * are reported with an error rather than omitted, so the UI can tell
 * "fork not provisioned yet" apart from "everything synced".
 */
export async function getAllCoreForkStatuses(
  coreCollectionDir: string,
  branch: string,
): Promise<CoreForkStatus[]> {
  const out: CoreForkStatus[] = [];
  for (const spec of CORE_REPOS) {
    const targetDir = join(coreCollectionDir, spec.slug);
    if (!existsSync(targetDir)) {
      out.push({
        slug: spec.slug,
        displayName: spec.displayName,
        branch,
        currentSha: null,
        upstreamSha: null,
        ahead: 0,
        behind: 0,
        lastFetchedAt: new Date().toISOString(),
        error: "fork not provisioned — toggle Dev Mode to provision",
      });
      continue;
    }
    out.push(await computeForkStatus(targetDir, spec, branch));
  }
  return out;
}

/**
 * Ensure the `upstream` remote is configured, but don't overwrite a
 * pre-existing one. The authoritative place that sets `upstream` is
 * `/api/dev/switch` (retrofit loop) — this is a belt-and-braces step
 * for clones that somehow ended up without the remote. Rewriting a
 * valid existing remote would break local overrides (e.g. tests that
 * pin `upstream` to a tmp bare repo, or owners who fork-of-fork).
 */
function ensureUpstreamRemote(targetDir: string, spec: CoreRepoSpec, log: ComponentLogger): void {
  const current = gitSilent(["remote", "get-url", "upstream"], targetDir, REV_LIST_TIMEOUT_MS);
  if (current.ok) return; // remote already exists — trust it
  const expected = upstreamRemoteUrl(spec);
  gitSilent(["remote", "add", "upstream", expected], targetDir, REV_LIST_TIMEOUT_MS);
  log.info(`dev-merge: added ${spec.slug} upstream remote (was missing)`);
}

/**
 * Merge `upstream/<branch>` into the current branch, pushing to origin
 * on success. Escalation order:
 *   1. ff-only merge — works when the fork has no divergent commits.
 *   2. Three-way merge commit — works when no textual conflicts.
 *   3. Surface conflict files (caller decides: return to user OR escalate
 *      to aion-micro when `strategy === "agentic"`).
 */
export interface AttemptMergeOptions {
  targetDir: string;
  spec: CoreRepoSpec;
  branch: string;
  strategy: "ff-only" | "agentic";
  aionMicro?: AionMicroManager;
  log: ComponentLogger;
}

export async function attemptMerge(opts: AttemptMergeOptions): Promise<MergeResult> {
  const { targetDir, spec, branch, strategy, aionMicro, log } = opts;

  if (!existsSync(join(targetDir, ".git"))) {
    return { ok: false, conflict: false, reason: `not a git repo: ${targetDir}` };
  }

  ensureUpstreamRemote(targetDir, spec, log);

  // Refuse to operate on a dirty tree — merging on top of uncommitted
  // work could entangle the user's changes with upstream's. Better to
  // surface the state and let them commit/stash first.
  const statusRes = gitSilent(["status", "--porcelain"], targetDir);
  if (!statusRes.ok) {
    return { ok: false, conflict: false, reason: statusRes.stderr.slice(0, 300) };
  }
  if (statusRes.stdout.trim().length > 0) {
    return {
      ok: false,
      conflict: false,
      reason: "Working tree has uncommitted changes — commit or stash them before merging upstream.",
    };
  }

  const fetchRes = gitSilent(["fetch", "--no-tags", "upstream", branch], targetDir, FETCH_TIMEOUT_MS);
  if (!fetchRes.ok) {
    return { ok: false, conflict: false, reason: `fetch failed: ${fetchRes.stderr.slice(0, 300)}` };
  }

  // Step 1 — ff-only.
  const ffRes = gitSilent(
    ["merge", "--ff-only", `upstream/${branch}`],
    targetDir,
    MERGE_TIMEOUT_MS,
  );
  if (ffRes.ok) {
    const newSha = gitSilent(["rev-parse", "HEAD"], targetDir, REV_LIST_TIMEOUT_MS);
    const pushed = pushToOrigin(targetDir, branch, log);
    log.info(`dev-merge: ff-merged ${spec.slug} → ${newSha.stdout.trim().slice(0, 7)}`);
    return { ok: true, ff: true, agentic: false, newSha: newSha.stdout.trim(), pushed };
  }

  // Step 2 — non-ff merge commit.
  const mergeRes = gitSilent(
    ["merge", "--no-ff", "--no-commit", `upstream/${branch}`],
    targetDir,
    MERGE_TIMEOUT_MS,
  );
  const conflictFiles = listConflictFiles(targetDir);

  if (conflictFiles.length === 0 && mergeRes.ok) {
    gitSilent(
      ["commit", "-m", `Merge upstream/${branch} into ${branch}`],
      targetDir,
      MERGE_TIMEOUT_MS,
    );
    const newSha = gitSilent(["rev-parse", "HEAD"], targetDir, REV_LIST_TIMEOUT_MS);
    const pushed = pushToOrigin(targetDir, branch, log);
    log.info(`dev-merge: merge-commit ${spec.slug} → ${newSha.stdout.trim().slice(0, 7)}`);
    return { ok: true, ff: false, agentic: false, newSha: newSha.stdout.trim(), pushed };
  }

  // Step 3 — conflicts. Aion-micro only engages when asked.
  if (strategy !== "agentic" || !aionMicro) {
    gitSilent(["merge", "--abort"], targetDir, MERGE_TIMEOUT_MS);
    return { ok: false, conflict: true, agentic: false, files: conflictFiles };
  }

  const agenticResult = await resolveConflictsWithAion(targetDir, conflictFiles, aionMicro, log);
  if (!agenticResult.ok) {
    gitSilent(["merge", "--abort"], targetDir, MERGE_TIMEOUT_MS);
    return {
      ok: false,
      conflict: true,
      agentic: true,
      reviewNeeded: true,
      files: conflictFiles,
      aionSummary: agenticResult.summary,
      reason: agenticResult.reason,
    };
  }

  // All conflicts resolved with high confidence — commit + push.
  gitSilent(["add", ...conflictFiles], targetDir, MERGE_TIMEOUT_MS);
  gitSilent(
    ["commit", "-m", `Merge upstream/${branch} (aion-micro resolved)`],
    targetDir,
    MERGE_TIMEOUT_MS,
  );
  const newSha = gitSilent(["rev-parse", "HEAD"], targetDir, REV_LIST_TIMEOUT_MS);
  const pushed = pushToOrigin(targetDir, branch, log);
  log.info(`dev-merge: agentic-merge ${spec.slug} → ${newSha.stdout.trim().slice(0, 7)}`);
  return { ok: true, ff: false, agentic: true, newSha: newSha.stdout.trim(), pushed };
}

function listConflictFiles(targetDir: string): string[] {
  const res = gitSilent(["diff", "--name-only", "--diff-filter=U"], targetDir, REV_LIST_TIMEOUT_MS);
  if (!res.ok) return [];
  return res.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function pushToOrigin(targetDir: string, branch: string, log: ComponentLogger): boolean {
  const res = gitSilent(["push", "origin", branch], targetDir, PUSH_TIMEOUT_MS);
  if (!res.ok) {
    log.warn(`dev-merge: push to origin/${branch} failed: ${res.stderr.slice(0, 200)}`);
    return false;
  }
  return true;
}

/**
 * Delegate per-file conflict resolution to aion-micro. The caller
 * already attempted a 3-way merge and left the conflict markers in
 * the working tree, so we read each file as-is and ask aion-micro for
 * a full resolved version. Only commits if EVERY file comes back with
 * `confidence === "high"` and no unresolved hunks.
 */
interface ResolveOutcome {
  ok: boolean;
  reason?: string;
  summary?: string;
}

async function resolveConflictsWithAion(
  targetDir: string,
  conflictFiles: string[],
  aionMicro: AionMicroManager,
  log: ComponentLogger,
): Promise<ResolveOutcome> {
  const available = await aionMicro.ensureAvailable();
  if (!available) {
    return { ok: false, reason: "aion-micro unavailable — enable the aion-micro container or resolve manually" };
  }

  const summaries: string[] = [];
  for (const relPath of conflictFiles) {
    const absPath = join(targetDir, relPath);
    let conflictText: string;
    try {
      conflictText = readFileSync(absPath, "utf8");
    } catch (err) {
      return { ok: false, reason: `cannot read ${relPath}: ${err instanceof Error ? err.message : String(err)}` };
    }

    const result = await aionMicro.resolveMergeConflict(relPath, "fork", "upstream", conflictText);
    if (!result) {
      return { ok: false, reason: `aion-micro did not respond for ${relPath}` };
    }
    if (result.confidence !== "high" || result.unresolvedHunks.length > 0) {
      summaries.push(
        `${relPath}: confidence=${result.confidence}` +
          (result.unresolvedHunks.length > 0 ? `, unresolved=${String(result.unresolvedHunks.length)}` : ""),
      );
      return {
        ok: false,
        reason: `low-confidence resolution for ${relPath}`,
        summary: summaries.join("; "),
      };
    }

    try {
      writeFileSync(absPath, result.resolvedText, "utf8");
    } catch (err) {
      return { ok: false, reason: `cannot write resolved ${relPath}: ${err instanceof Error ? err.message : String(err)}` };
    }
    summaries.push(`${relPath}: resolved`);
    log.info(`dev-merge: aion-micro resolved ${relPath}`);
  }

  return { ok: true, summary: summaries.join("; ") };
}
