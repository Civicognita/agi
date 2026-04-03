/**
 * CatalogFetcher — fetch marketplace.json from GitHub repos, git URLs, or direct URLs.
 *
 * Claude Code marketplaces store their catalog at .claude-plugin/marketplace.json.
 * Aionima also checks for marketplace.json at the repo root as a fallback.
 *
 * Trust fields (trustTier, integrityHash, signedBy) are passed through from the
 * catalog JSON as-is. Signature verification against the ID service certificate
 * is intentionally deferred.
 * TODO: Verify signedBy against ID service certificates once the cert endpoint is live.
 * TODO: Cross-check integrityHash against a server-side manifest once the catalog
 *       signing pipeline is in place.
 */

import type { MarketplaceCatalog, MarketplaceSourceType, TrustTier } from "./types.js";

export interface FetchCatalogResult {
  ok: boolean;
  catalog?: MarketplaceCatalog;
  error?: string;
}

/**
 * Parse a marketplace reference into a source type and fetch URL.
 *
 * Supported formats:
 * - "owner/repo"          → GitHub repo (fetch via GitHub API)
 * - "https://.../*.json"  → Direct JSON URL
 * - "https://.../*.git"   → Git repo URL (fetch via GitHub-style API if possible)
 * - "./path" or "/path"   → Local path (not handled here)
 */
export function parseSourceRef(ref: string): { type: MarketplaceSourceType; fetchUrl: string } {
  // Local paths
  if (ref.startsWith("./") || ref.startsWith("/") || ref.startsWith("~")) {
    return { type: "local", fetchUrl: ref };
  }

  // Direct URL to a JSON file
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    if (ref.endsWith(".json")) {
      return { type: "url", fetchUrl: ref };
    }
    // Git URL — try to extract GitHub owner/repo
    const ghMatch = ref.match(/github\.com\/([^/]+\/[^/.]+)/);
    if (ghMatch?.[1]) {
      return { type: "github", fetchUrl: githubRawUrl(ghMatch[1]) };
    }
    // Other git URLs — append raw marketplace.json path
    return { type: "url", fetchUrl: ref.replace(/\.git$/, "") + "/raw/main/.claude-plugin/marketplace.json" };
  }

  // GitHub shorthand: "owner/repo" or "owner/repo#ref"
  const [repoPath, gitRef] = ref.split("#");
  if (repoPath && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repoPath)) {
    return { type: "github", fetchUrl: githubRawUrl(repoPath, gitRef) };
  }

  return { type: "url", fetchUrl: ref };
}

/** Build GitHub raw content URL for the marketplace.json. */
function githubRawUrl(repo: string, ref = "main"): string {
  return `https://raw.githubusercontent.com/${repo}/${ref}/.claude-plugin/marketplace.json`;
}

/** Fetch and validate a marketplace catalog. */
export async function fetchCatalog(ref: string): Promise<FetchCatalogResult> {
  const { fetchUrl, type } = parseSourceRef(ref);

  if (type === "local") {
    return { ok: false, error: "Local marketplace sources are not supported for remote sync" };
  }

  try {
    // Try primary location (.claude-plugin/marketplace.json)
    let result = await fetchJson(fetchUrl);

    // Fallback: try marketplace.json at repo root (for Aionima-native marketplaces)
    if (!result.ok && type === "github") {
      const fallbackUrl = fetchUrl.replace("/.claude-plugin/marketplace.json", "/marketplace.json");
      result = await fetchJson(fallbackUrl);
    }

    if (!result.ok) return result;

    const validation = validateCatalog(result.data);
    if (!validation.ok) return { ok: false, error: validation.error };

    // Pass through trust fields from catalog entries (trustTier, integrityHash, signedBy).
    // These are optional fields in MarketplacePluginEntry and will be stored as-is.
    // Future: validate signedBy against ID service certs and verify integrityHash.
    const catalog = result.data as MarketplaceCatalog;
    const normalised: MarketplaceCatalog = {
      ...catalog,
      plugins: catalog.plugins.map((p) => ({
        ...p,
        trustTier: (p.trustTier as TrustTier | undefined) ?? undefined,
        integrityHash: p.integrityHash ?? undefined,
        signedBy: p.signedBy ?? undefined,
      })),
    };

    return { ok: true, catalog: normalised };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchJson(url: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
  }
  const data = await res.json() as unknown;
  return { ok: true, data };
}

function validateCatalog(data: unknown): { ok: boolean; error?: string } {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Catalog must be a JSON object" };
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.name !== "string") {
    return { ok: false, error: "Catalog must have a 'name' field" };
  }
  if (!obj.owner || typeof obj.owner !== "object" || typeof (obj.owner as Record<string, unknown>).name !== "string") {
    return { ok: false, error: "Catalog must have an 'owner' with a 'name'" };
  }
  if (!Array.isArray(obj.plugins)) {
    return { ok: false, error: "Catalog must have a 'plugins' array" };
  }
  for (const plugin of obj.plugins) {
    if (!plugin || typeof plugin !== "object") {
      return { ok: false, error: "Each plugin must be an object" };
    }
    const p = plugin as Record<string, unknown>;
    if (typeof p.name !== "string") {
      return { ok: false, error: `Plugin missing required 'name' field` };
    }
    if (p.source === undefined) {
      return { ok: false, error: `Plugin "${p.name}" missing required 'source' field` };
    }
  }
  return { ok: true };
}
