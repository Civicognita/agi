/**
 * dev-mode-incoming — inbound contribution review (personal forks → upstream PRs).
 *
 * The mirror of dev-mode-contribute (which opens outbound fork → upstream PRs).
 * The owner is the First Custodian of Upstream (e.g. Civicognita/agi); other
 * contributors PR their personal forks — possibly forks-of-forks — INTO the
 * upstream `dev` branch. This module lists those open PRs per core repo so the
 * dashboard can present a review queue. The owner is the only one who merges to
 * `dev`/`main`, and merging stays on GitHub (an irreversible write we never
 * automate). Testing a PR before merge lives in the test-VM flow (separate slice).
 *
 * Handlers stay thin: each exported function does one thing so
 * server-runtime-state.ts can compose them.
 */

import {
  CORE_REPOS,
  specUpstreamOrg,
  githubHeaders,
  type CoreRepoSpec,
} from "./dev-mode-forks.js";

// Branch contributors target on upstream. Same convention as the outbound side.
const TARGET_BASE = "dev";
const FETCH_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IncomingPrInfo {
  /** Which core repo this PR targets (CORE_REPOS slug). */
  slug: string;
  number: number;
  title: string;
  /** GitHub login of the PR author. */
  authorLogin: string;
  /** Full name of the head repo (the contributor fork; may be a fork-of-fork). */
  headRepoFullName: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  /** True when the head repo is NOT the upstream itself (a real cross-fork PR). */
  isCrossRepo: boolean;
}

export interface IncomingRepoStatus {
  slug: string;
  displayName: string;
  upstream: string;
  upstreamOrg: string;
  prs: IncomingPrInfo[];
  error?: string;
}

export interface IncomingStatus {
  ownerLogin: string | null;
  repos: IncomingRepoStatus[];
}

// ---------------------------------------------------------------------------
// Mapping — a GitHub pulls[] entry → IncomingPrInfo
// ---------------------------------------------------------------------------

/** The subset of the GitHub PR list payload we read. */
interface GhPull {
  number: number;
  title: string;
  user?: { login?: string } | null;
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null } | null;
  base?: { ref?: string } | null;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  draft?: boolean;
}

/**
 * Flatten a GitHub PR list entry into IncomingPrInfo for repo `slug`. The
 * upstream's own full name is resolved from CORE_REPOS so we can mark whether
 * the PR comes from a different repo (a cross-fork PR) vs an upstream branch.
 * A head repo can be null when the contributor deleted their fork after opening
 * the PR — surfaced explicitly rather than crashing.
 */
export function mapPullToIncoming(pull: GhPull, slug: string): IncomingPrInfo {
  const spec = CORE_REPOS.find((s) => s.slug === slug);
  const upstreamFullName = spec ? `${specUpstreamOrg(spec)}/${spec.upstream}` : "";
  const headRepoFullName = pull.head?.repo?.full_name ?? "(deleted fork)";
  return {
    slug,
    number: pull.number,
    title: pull.title,
    authorLogin: pull.user?.login ?? "(unknown)",
    headRepoFullName,
    headRef: pull.head?.ref ?? "",
    headSha: pull.head?.sha ?? "",
    baseRef: pull.base?.ref ?? TARGET_BASE,
    htmlUrl: pull.html_url ?? "",
    createdAt: pull.created_at ?? "",
    updatedAt: pull.updated_at ?? "",
    isDraft: pull.draft === true,
    isCrossRepo: headRepoFullName.toLowerCase() !== upstreamFullName.toLowerCase(),
  };
}

// ---------------------------------------------------------------------------
// Per-repo + aggregate listing
// ---------------------------------------------------------------------------

/**
 * List open PRs targeting `<upstreamOrg>/<upstream>:dev`. Best-effort: a GitHub
 * error (missing repo, no dev branch, rate limit) yields [] rather than throwing,
 * so one bad repo never blanks the whole queue.
 */
export async function listIncomingPrs(spec: CoreRepoSpec, token: string): Promise<IncomingPrInfo[]> {
  const org = specUpstreamOrg(spec);
  const url =
    `https://api.github.com/repos/${org}/${spec.upstream}/pulls` +
    `?base=${TARGET_BASE}&state=open&per_page=50&sort=updated&direction=desc`;
  try {
    const res = await fetch(url, { headers: githubHeaders(token), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return [];
    const body = (await res.json()) as GhPull[];
    if (!Array.isArray(body)) return [];
    return body.map((p) => mapPullToIncoming(p, spec.slug));
  } catch {
    return [];
  }
}

/**
 * Aggregate the incoming-PR queue across every core repo. `token` is required
 * (the upstream repos may be private and the list endpoint is rate-limited
 * unauthenticated); `ownerLogin` is passed through for the caller's display.
 */
export async function computeIncomingStatus(
  token: string,
  ownerLogin: string | null,
): Promise<IncomingStatus> {
  const repos = await Promise.all(
    CORE_REPOS.map(async (spec): Promise<IncomingRepoStatus> => {
      const prs = await listIncomingPrs(spec, token);
      return {
        slug: spec.slug,
        displayName: spec.displayName,
        upstream: spec.upstream,
        upstreamOrg: specUpstreamOrg(spec),
        prs,
      };
    }),
  );
  return { ownerLogin, repos };
}
