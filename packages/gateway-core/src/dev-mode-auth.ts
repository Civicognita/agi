/**
 * Dev-Mode auth helpers — retrieve the owner's OAuth token from Local-ID
 * and inject it into outbound git URLs so owner forks clone over HTTPS
 * without requiring SSH keys.
 *
 * Local-ID exposes `GET /api/auth/device-flow/token?provider=github` which
 * returns a decrypted access token if the owner has completed the device
 * flow. AGI (running in the private network) is trusted to call this —
 * the endpoint is `identity.isOwner`-gated.
 *
 * This module is **Dev-Mode only**. In production (dev disabled), the
 * clone paths use the original repoUrl unchanged.
 */

/** Bearer-capable token payload returned by Local-ID. */
export interface OwnerTokenResponse {
  provider: string;
  role: string;
  accountLabel: string | null;
  accessToken: string;
  tokenType: string;
  tokenExpiresAt: string | null;
  scopes: string | null;
}

export interface FetchOwnerTokenOptions {
  /** Default: "https://id.ai.on". Override for tests / alt deployments. */
  localIdBaseUrl?: string;
  /** Default: "github". */
  provider?: string;
  /** Default: "owner". */
  role?: string;
  /** Default: 4 seconds. */
  timeoutMs?: number;
}

/**
 * Fetch the owner's token for the given provider from Local-ID.
 * Returns null on any failure (unauthenticated, connection missing, Local-ID
 * offline) — callers should fall back to an unauthenticated clone, not
 * hard-fail.
 */
export async function fetchOwnerToken(
  opts: FetchOwnerTokenOptions = {},
): Promise<OwnerTokenResponse | null> {
  const base = opts.localIdBaseUrl ?? "https://id.ai.on";
  const provider = opts.provider ?? "github";
  const role = opts.role ?? "owner";
  const timeout = opts.timeoutMs ?? 4_000;

  const url = `${base}/api/auth/device-flow/token?provider=${encodeURIComponent(provider)}&role=${encodeURIComponent(role)}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      // Local-ID trusts the private network for owner calls — no header auth
      // required when AGI hits it over the LAN.
    });
    if (!res.ok) return null;
    const body = (await res.json()) as OwnerTokenResponse;
    if (!body.accessToken) return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * Inject the owner's token into an HTTPS git URL so clones authenticate
 * as the fork owner. GitHub's convention: `https://x-access-token:TOKEN@host/...`.
 *
 * Returns the original URL unchanged if:
 *   - repoUrl is not HTTPS
 *   - repoUrl already contains credentials (has `@` before the host)
 *   - repoUrl doesn't target github.com (unsupported token shape elsewhere)
 */
export function injectTokenIntoCloneUrl(
  repoUrl: string,
  token: string,
): string {
  if (!repoUrl.startsWith("https://")) return repoUrl;
  // If the URL already has user@host shape, don't double-inject.
  const afterScheme = repoUrl.slice("https://".length);
  const slash = afterScheme.indexOf("/");
  if (slash < 0) return repoUrl;
  const authority = afterScheme.slice(0, slash);
  if (authority.includes("@")) return repoUrl;

  // Only GitHub uses the x-access-token scheme; other hosts need different
  // injection patterns which aren't covered here.
  if (!authority.endsWith("github.com")) return repoUrl;

  return `https://x-access-token:${encodeURIComponent(token)}@${authority}${afterScheme.slice(slash)}`;
}
