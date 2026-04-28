/**
 * Dev-Mode fork resolution.
 *
 * When Dev Mode is enabled, each of the five canonical Civicognita
 * repos needs an owner-scoped fork at `{ownerLogin}/{repo}`. Owners
 * expect the toggle to "just work" — they shouldn't have to visit
 * github.com and click Fork five times.
 *
 * For each canonical repo:
 *   1. Look up the fork via GitHub's API. If it exists, use it.
 *   2. If it's missing, POST to /repos/{owner}/{repo}/forks to create it.
 *      (The `repo` scope — which our owner token has — allows this.)
 *   3. Return the resolved fork URL (or a failure entry if steps 1 + 2
 *      both fail).
 *
 * Newly-created forks appear in the caller's account within a few
 * seconds. We return the expected `clone_url` even if it hasn't
 * propagated yet — the caller should tolerate a transient 404 on the
 * first clone attempt and retry.
 */

export interface CoreRepoSpec {
  /** Stable slug used in config + UI. */
  slug: "agi" | "prime" | "id" | "marketplace" | "mapp-marketplace";
  /** Civicognita repo name on GitHub (NOT the slug). */
  upstream: string;
  /** Human display name. */
  displayName: string;
  /** Config key in `dev.*` that holds the fork URL. */
  configKey: "agiRepo" | "primeRepo" | "idRepo" | "marketplaceRepo" | "mappMarketplaceRepo";
}

export const CORE_REPOS: readonly CoreRepoSpec[] = Object.freeze([
  { slug: "agi",              upstream: "agi",                  displayName: "AGI",              configKey: "agiRepo" },
  { slug: "prime",            upstream: "aionima",              displayName: "PRIME",            configKey: "primeRepo" },
  { slug: "id",               upstream: "agi-local-id",         displayName: "ID",               configKey: "idRepo" },
  { slug: "marketplace",      upstream: "agi-marketplace",      displayName: "Marketplace",      configKey: "marketplaceRepo" },
  { slug: "mapp-marketplace", upstream: "agi-mapp-marketplace", displayName: "MApp Marketplace", configKey: "mappMarketplaceRepo" },
] as const);

export interface ForkResolveResult {
  slug: CoreRepoSpec["slug"];
  /** HTTPS clone URL for the owner's fork. Populated on success. */
  cloneUrl?: string;
  /** The upstream the fork was made from, for display. */
  upstreamUrl: string;
  /** Whether we created the fork in this pass (vs reusing an existing one). */
  created: boolean;
  /** Populated on failure. */
  error?: string;
}

export const CANONICAL_OWNER = "Civicognita";

/** Full `upstream` remote URL for a given core-repo spec. */
export function upstreamRemoteUrl(spec: CoreRepoSpec): string {
  return `https://github.com/${CANONICAL_OWNER}/${spec.upstream}.git`;
}

/**
 * Resolve (or create) the owner's fork for every core repo.
 */
export async function resolveOrCreateForks(
  ownerToken: string,
  ownerLogin: string,
): Promise<ForkResolveResult[]> {
  const results: ForkResolveResult[] = [];
  for (const spec of CORE_REPOS) {
    const upstreamUrl = upstreamRemoteUrl(spec);
    try {
      const existing = await lookupFork(ownerToken, ownerLogin, spec.upstream);
      if (existing) {
        results.push({ slug: spec.slug, cloneUrl: existing, upstreamUrl, created: false });
        continue;
      }

      const created = await createFork(ownerToken, CANONICAL_OWNER, spec.upstream);
      if (created) {
        results.push({ slug: spec.slug, cloneUrl: created, upstreamUrl, created: true });
      } else {
        results.push({
          slug: spec.slug,
          upstreamUrl,
          created: false,
          error: "GitHub rejected fork creation — confirm your token has the `repo` scope and that the upstream is public",
        });
      }
    } catch (e) {
      results.push({
        slug: spec.slug,
        upstreamUrl,
        created: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

/**
 * HEAD the owner's fork. Returns its `clone_url` if it exists, null if
 * it 404s. Any other non-2xx response is thrown as an error so the
 * caller can report it.
 */
async function lookupFork(
  token: string,
  ownerLogin: string,
  upstream: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${ownerLogin}/${upstream}`;
  const res = await fetch(url, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET ${url} → ${String(res.status)} ${res.statusText}`);
  }
  const body = (await res.json()) as { clone_url?: string; html_url?: string };
  return body.clone_url ?? (body.html_url ? `${body.html_url}.git` : null);
}

/**
 * Create a fork of `{canonicalOwner}/{repo}` into the owner's account
 * (implicit — the token identifies the fork destination). Returns the
 * new fork's clone_url.
 */
async function createFork(
  token: string,
  canonicalOwner: string,
  repo: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${canonicalOwner}/${repo}/forks`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...githubHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}), // no options — default behavior forks into the authenticated user's account
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${url} → ${String(res.status)}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { clone_url?: string; html_url?: string };
  return body.clone_url ?? (body.html_url ? `${body.html_url}.git` : null);
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "aionima-agi",
  };
}
