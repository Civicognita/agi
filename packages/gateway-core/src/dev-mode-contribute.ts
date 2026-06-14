/**
 * dev-mode-contribute — outbound contribution path (fork → upstream PRs).
 *
 * The inbound side (upstream → fork merges) lives in dev-mode-merge.ts. This
 * module is the mirror: it surfaces, per core fork, how many commits the
 * owner's fork is ahead of the upstream `dev` branch, and opens a cross-repo
 * pull request `<ownerLogin>:<branch> → <upstreamOrg>:dev` with an AI-drafted
 * body.
 *
 * Owner directive: PRs ALWAYS target the upstream `dev` branch (never `main`).
 * Stable releases are promoted dev → main separately. Per the entity model,
 * the PRIME corpus (slug `prime`) is the "Learnings" repo; every other core
 * repo is "Mechanics". Handlers stay thin: each exported function does one
 * thing so server-runtime-state.ts can compose them.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  CORE_REPOS,
  coreForkDir,
  specUpstreamOrg,
  githubHeaders,
  type CoreRepoSpec,
} from "./dev-mode-forks.js";
import type { AionMicroManager } from "./aion-micro-manager.js";
import type { ComponentLogger } from "./logger.js";

// Branch every outbound PR targets upstream.
const TARGET_BASE = "dev";

const FETCH_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContributeKind = "learnings" | "mechanics";

export interface RepoContributeInfo {
  slug: string;
  displayName: string;
  kind: ContributeKind;
  /** The fork's current local branch (the PR head). */
  branch: string;
  /** Commits on the fork's branch not yet in upstream/dev. */
  commitsAhead: number;
  /** GitHub repo name + owning org of the canonical upstream. */
  upstream: string;
  upstreamOrg: string;
  /** Latest commit subjects the fork is ahead by (most-recent first, capped). */
  aheadCommits: string[];
  /** An already-open PR for this head→base, if any. */
  existingPrUrl: string | null;
  existingPrNumber: number | null;
  /** Set when status could not be computed (not provisioned, no upstream dev, …). */
  error?: string;
}

export interface ContributeStatus {
  ownerLogin: string | null;
  learnings: RepoContributeInfo[];
  mechanics: RepoContributeInfo[];
}

export interface CreatePrResult {
  ok: boolean;
  prUrl?: string;
  prNumber?: number;
  /** True when an existing PR was returned instead of creating a new one. */
  alreadyOpen?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// git helpers (mirror dev-mode-merge.ts gitSilent)
// ---------------------------------------------------------------------------

function gitSilent(
  args: string[],
  cwd: string,
  timeoutMs = GIT_TIMEOUT_MS,
): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("git", args, { cwd, stdio: "pipe", timeout: timeoutMs }).toString();
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    return {
      ok: false,
      stdout: e.stdout ? e.stdout.toString() : "",
      stderr: e.stderr ? e.stderr.toString() : err instanceof Error ? err.message : String(err),
    };
  }
}

function kindForSlug(slug: string): ContributeKind {
  // PRIME (slug "prime", upstream "aionima") is the knowledge corpus → Learnings.
  return slug === "prime" ? "learnings" : "mechanics";
}

// ---------------------------------------------------------------------------
// Status — per-fork ahead-of-upstream-dev + existing PR
// ---------------------------------------------------------------------------

/**
 * Compute the outbound-contribution status for every core fork beneath
 * `coreCollectionDir` (the `_aionima/` collection). `ownerLogin` + `token`
 * are used only to detect already-open PRs; status still computes (minus PR
 * detection) when they are absent.
 */
export async function computeContributeStatus(
  coreCollectionDir: string,
  ownerLogin: string | null,
  token: string | null,
): Promise<ContributeStatus> {
  const learnings: RepoContributeInfo[] = [];
  const mechanics: RepoContributeInfo[] = [];

  for (const spec of CORE_REPOS) {
    const info = await computeRepoContribute(coreCollectionDir, spec, ownerLogin, token);
    (info.kind === "learnings" ? learnings : mechanics).push(info);
  }

  return { ownerLogin, learnings, mechanics };
}

async function computeRepoContribute(
  coreCollectionDir: string,
  spec: CoreRepoSpec,
  ownerLogin: string | null,
  token: string | null,
): Promise<RepoContributeInfo> {
  const org = specUpstreamOrg(spec);
  const base: RepoContributeInfo = {
    slug: spec.slug,
    displayName: spec.displayName,
    kind: kindForSlug(spec.slug),
    branch: "",
    commitsAhead: 0,
    upstream: spec.upstream,
    upstreamOrg: org,
    aheadCommits: [],
    existingPrUrl: null,
    existingPrNumber: null,
  };

  const targetDir = coreForkDir(coreCollectionDir, spec.slug);
  if (!existsSync(join(targetDir, ".git"))) {
    return { ...base, error: "fork not provisioned — enable Contributing Mode" };
  }

  const branchRes = gitSilent(["rev-parse", "--abbrev-ref", "HEAD"], targetDir);
  if (!branchRes.ok) {
    return { ...base, error: branchRes.stderr.slice(0, 300) };
  }
  base.branch = branchRes.stdout.trim();

  // Fetch upstream dev so the count reflects the latest upstream state.
  const fetchRes = gitSilent(["fetch", "--no-tags", "upstream", TARGET_BASE], targetDir, FETCH_TIMEOUT_MS);
  if (!fetchRes.ok) {
    // Most common cause: upstream has no `dev` branch (only `main`).
    return { ...base, error: `upstream/${TARGET_BASE} unavailable: ${fetchRes.stderr.slice(0, 200)}` };
  }

  const countRes = gitSilent(
    ["rev-list", "--count", `upstream/${TARGET_BASE}..HEAD`],
    targetDir,
  );
  if (!countRes.ok) {
    return { ...base, error: countRes.stderr.slice(0, 300) };
  }
  base.commitsAhead = Number.parseInt(countRes.stdout.trim(), 10) || 0;

  if (base.commitsAhead > 0) {
    const logRes = gitSilent(
      ["log", "--format=%s", "-n", "10", `upstream/${TARGET_BASE}..HEAD`],
      targetDir,
    );
    if (logRes.ok) {
      base.aheadCommits = logRes.stdout.trim().split("\n").filter(Boolean);
    }
  }

  // Detect an already-open PR for head=<owner>:<branch> base=dev.
  if (ownerLogin && token && base.branch) {
    const existing = await findOpenPr(org, spec.upstream, ownerLogin, base.branch, token);
    if (existing) {
      base.existingPrUrl = existing.url;
      base.existingPrNumber = existing.number;
    }
  }

  return base;
}

async function findOpenPr(
  org: string,
  repo: string,
  ownerLogin: string,
  branch: string,
  token: string,
): Promise<{ url: string; number: number } | null> {
  const url = `https://api.github.com/repos/${org}/${repo}/pulls?head=${ownerLogin}:${branch}&base=${TARGET_BASE}&state=open`;
  try {
    const res = await fetch(url, { headers: githubHeaders(token), signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as Array<{ html_url?: string; number?: number }>;
    const first = body[0];
    if (first?.html_url && typeof first.number === "number") {
      return { url: first.html_url, number: first.number };
    }
  } catch {
    /* best-effort — absence of PR detection is non-fatal */
  }
  return null;
}

// ---------------------------------------------------------------------------
// PR body drafting — AI-drafted with a deterministic fallback
// ---------------------------------------------------------------------------

/**
 * Draft a PR body for `spec` from the commit subjects the fork is ahead by.
 * Uses the local floor model (aion-micro) so it works off-grid; falls back to
 * a commit-list markdown template when the model is unavailable.
 */
export async function draftPrBody(
  spec: CoreRepoSpec,
  aheadCommits: string[],
  aionMicro: AionMicroManager | undefined,
  log?: ComponentLogger,
): Promise<string> {
  const kind = kindForSlug(spec.slug);
  const fallback = renderFallbackBody(spec, kind, aheadCommits);

  if (!aionMicro || aheadCommits.length === 0) return fallback;

  try {
    const available = await aionMicro.ensureAvailable();
    if (!available) return fallback;

    const drafted = await aionMicro.complete({
      system:
        "You write concise, professional GitHub pull-request descriptions. " +
        "Summarize the changes in 2-4 short paragraphs or a tight bullet list. " +
        "No preamble, no sign-off, Markdown only.",
      prompt:
        `Repository: ${spec.displayName} (${spec.upstream}). ` +
        `This PR (${kind}) targets the upstream \`${TARGET_BASE}\` branch.\n\n` +
        `Commits being contributed:\n${aheadCommits.map((c) => `- ${c}`).join("\n")}\n\n` +
        "Write the PR description.",
      maxTokens: 600,
      temperature: 0.4,
    });

    if (drafted && drafted.trim().length > 0) {
      return `${drafted.trim()}\n\n${prFooter(kind)}`;
    }
  } catch (err) {
    log?.warn(`dev-contribute: aion-micro body draft failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return fallback;
}

function renderFallbackBody(spec: CoreRepoSpec, kind: ContributeKind, aheadCommits: string[]): string {
  const commits = aheadCommits.length > 0
    ? aheadCommits.map((c) => `- ${c}`).join("\n")
    : "_(no commit subjects available)_";
  return `## ${kind === "learnings" ? "Learnings" : "Mechanics"} contribution to ${spec.displayName}\n\n${commits}\n\n${prFooter(kind)}`;
}

function prFooter(kind: ContributeKind): string {
  return `> ${kind === "learnings" ? "Learnings" : "Mechanics"} PR opened from the Aionima dashboard, targeting \`${TARGET_BASE}\`.`;
}

export function defaultPrTitle(spec: CoreRepoSpec, aheadCommits: string[]): string {
  const kind = kindForSlug(spec.slug);
  const prefix = kind === "learnings" ? "Learnings" : "Mechanics";
  if (aheadCommits.length === 1 && aheadCommits[0]) return `${prefix}: ${aheadCommits[0]}`;
  return `${prefix}: ${aheadCommits.length} commit${aheadCommits.length !== 1 ? "s" : ""} → ${spec.displayName}`;
}

// ---------------------------------------------------------------------------
// PR creation — cross-repo, fork:branch → upstream:dev
// ---------------------------------------------------------------------------

export async function createUpstreamPr(
  spec: CoreRepoSpec,
  token: string,
  ownerLogin: string,
  branch: string,
  title: string,
  body: string,
): Promise<CreatePrResult> {
  const org = specUpstreamOrg(spec);
  const url = `https://api.github.com/repos/${org}/${spec.upstream}/pulls`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        head: `${ownerLogin}:${branch}`,
        base: TARGET_BASE,
        body,
        maintainer_can_modify: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (res.ok) {
      const created = (await res.json()) as { html_url?: string; number?: number };
      return { ok: true, prUrl: created.html_url, prNumber: created.number };
    }

    // 422 commonly means a PR already exists for this head/base, or there is
    // no diff between them. Resolve the existing PR rather than erroring.
    if (res.status === 422) {
      const existing = await findOpenPr(org, spec.upstream, ownerLogin, branch, token);
      if (existing) {
        return { ok: true, prUrl: existing.url, prNumber: existing.number, alreadyOpen: true };
      }
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `No PR opened — there may be no commits between ${ownerLogin}:${branch} and ${org}/${spec.upstream}:${TARGET_BASE}, or upstream has no \`${TARGET_BASE}\` branch. (${text.slice(0, 160)})`,
      };
    }

    const text = await res.text().catch(() => "");
    return { ok: false, error: `GitHub ${String(res.status)}: ${text.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export { kindForSlug };
