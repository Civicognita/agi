/**
 * OAuth Handler — OAuth2 authorization-code (redirect) flows for identity
 * providers that require an owner-supplied OAuth app.
 *
 * Registry-driven (story #212, Slice 2): provider endpoints + scopes + PKCE /
 * token-auth rules come from identity-providers.ts (the SSOT). Supports the
 * canonical redirect providers — Google, Meta, X (PKCE + Basic auth), Tynn.ai.
 * GitHub uses the separate device-flow path (public client, no secret).
 *
 * Credentials are read HOT (per call) via a config thunk so a freshly-pasted
 * OAuth app takes effect without a gateway restart — each node operator
 * registers their own OAuth apps; no central dependency.
 */

import { randomBytes, createHash } from "node:crypto";
import { getIdentityProvider } from "./identity-providers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  scopes?: string[];
}

export interface OAuthConfig {
  google?: OAuthProviderConfig;
  github?: OAuthProviderConfig;
  meta?: OAuthProviderConfig;
  x?: OAuthProviderConfig;
  tynn?: OAuthProviderConfig;
}

/** Static config or a hot thunk read on every call. */
export type OAuthConfigSource = OAuthConfig | (() => OAuthConfig);

export interface OAuthSession {
  state: string;
  provider: string;
  redirectUri: string;
  codeVerifier?: string;
  createdAt: number;
  expiresAt: number;
}

export interface OAuthUserInfo {
  provider: string;
  providerUserId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// OAuthHandler
// ---------------------------------------------------------------------------

export class OAuthHandler {
  private readonly getConfig: () => OAuthConfig;
  private readonly sessions = new Map<string, OAuthSession>();
  private readonly baseUrl: string;

  constructor(config: OAuthConfigSource, baseUrl: string) {
    this.getConfig = typeof config === "function" ? config : () => config;
    this.baseUrl = baseUrl;
  }

  /** Providers with owner OAuth-app credentials configured (clientId present). */
  getAvailableProviders(): string[] {
    const cfg = this.getConfig() ?? {};
    return Object.keys(cfg).filter((k) => (cfg as Record<string, OAuthProviderConfig | undefined>)[k]?.clientId);
  }

  /**
   * Start a redirect OAuth flow — returns the authorization URL to send the
   * user to. Null if the provider isn't a known redirect provider or has no
   * configured app.
   */
  startFlow(provider: string): { authUrl: string; state: string } | null {
    const spec = getIdentityProvider(provider);
    if (!spec || spec.authMode !== "redirect" || !spec.endpoints?.authUrl) return null;

    const providerConfig = this.getProviderConfig(provider);
    if (!providerConfig?.clientId) return null;

    const state = randomBytes(32).toString("hex");
    const redirectUri = `${this.baseUrl}/api/auth/callback/${provider}`;
    const scope = (providerConfig.scopes ?? spec.scopes).join(" ");

    const params = new URLSearchParams({
      client_id: providerConfig.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope,
      state,
    });

    let codeVerifier: string | undefined;
    if (spec.usesPkce) {
      codeVerifier = base64url(randomBytes(32));
      const challenge = base64url(createHash("sha256").update(codeVerifier).digest());
      params.set("code_challenge", challenge);
      params.set("code_challenge_method", "S256");
    }
    if (provider === "google") {
      params.set("access_type", "offline");
      params.set("prompt", "consent");
    }

    this.sessions.set(state, {
      state,
      provider,
      redirectUri,
      codeVerifier,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    this.cleanupExpired();

    return { authUrl: `${spec.endpoints.authUrl}?${params.toString()}`, state };
  }

  /**
   * Handle the OAuth callback — exchange the code for a token and fetch the
   * user's profile. Returns the access token alongside the profile so the
   * caller can persist a connection.
   */
  async handleCallback(
    provider: string,
    code: string,
    state: string,
  ): Promise<(OAuthUserInfo & { accessToken: string; refreshToken: string | null; scopes: string | null; expiresIn: number | null }) | null> {
    const session = this.sessions.get(state);
    if (!session || session.provider !== provider || Date.now() > session.expiresAt) {
      return null;
    }
    this.sessions.delete(state);

    const spec = getIdentityProvider(provider);
    const providerConfig = this.getProviderConfig(provider);
    if (!spec || spec.authMode !== "redirect" || !spec.endpoints?.tokenUrl || !providerConfig) {
      return null;
    }

    // --- Token exchange -----------------------------------------------------
    const body = new URLSearchParams({
      code,
      redirect_uri: session.redirectUri,
      grant_type: "authorization_code",
    });
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    };
    if (spec.tokenAuth === "basic") {
      const basic = Buffer.from(`${providerConfig.clientId}:${providerConfig.clientSecret}`).toString("base64");
      headers.authorization = `Basic ${basic}`;
      body.set("client_id", providerConfig.clientId);
    } else {
      body.set("client_id", providerConfig.clientId);
      body.set("client_secret", providerConfig.clientSecret);
    }
    if (session.codeVerifier) body.set("code_verifier", session.codeVerifier);

    const tokenRes = await fetch(spec.endpoints.tokenUrl, { method: "POST", headers, body });
    if (!tokenRes.ok) return null;
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
      expires_in?: number;
    };
    if (!tokenData.access_token) return null;

    // --- User info ----------------------------------------------------------
    const profile = spec.endpoints.userInfoUrl
      ? await this.fetchProfile(provider, spec.endpoints.userInfoUrl, tokenData.access_token)
      : { providerUserId: "", email: null, displayName: null, avatarUrl: null };

    return {
      provider,
      providerUserId: profile.providerUserId,
      email: profile.email,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      scopes: tokenData.scope ?? null,
      expiresIn: tokenData.expires_in ?? null,
    };
  }

  /**
   * Exchange a stored refresh token for a fresh access token (story #213).
   * Returns null if the provider isn't a configured redirect provider or the
   * exchange fails. Note: some providers (e.g. X) rotate the refresh token, so
   * the caller must persist `refreshToken` when present.
   */
  async refreshAccessToken(
    provider: string,
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number | null; scopes: string | null } | null> {
    const spec = getIdentityProvider(provider);
    const providerConfig = this.getProviderConfig(provider);
    if (!spec || spec.authMode !== "redirect" || !spec.endpoints?.tokenUrl || !providerConfig) {
      return null;
    }

    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    };
    if (spec.tokenAuth === "basic") {
      const basic = Buffer.from(`${providerConfig.clientId}:${providerConfig.clientSecret}`).toString("base64");
      headers.authorization = `Basic ${basic}`;
      body.set("client_id", providerConfig.clientId);
    } else {
      body.set("client_id", providerConfig.clientId);
      body.set("client_secret", providerConfig.clientSecret);
    }

    const res = await fetch(spec.endpoints.tokenUrl, { method: "POST", headers, body });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!data.access_token) return null;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresIn: data.expires_in ?? null,
      scopes: data.scope ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Provider-specific profile parsing
  // -------------------------------------------------------------------------

  private async fetchProfile(
    provider: string,
    userInfoUrl: string,
    accessToken: string,
  ): Promise<Pick<OAuthUserInfo, "providerUserId" | "email" | "displayName" | "avatarUrl">> {
    try {
      // Meta accepts the token as a query param; others use the Bearer header.
      const url = provider === "meta"
        ? `${userInfoUrl}${userInfoUrl.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(accessToken)}`
        : userInfoUrl;
      const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
      if (!res.ok) return { providerUserId: "", email: null, displayName: null, avatarUrl: null };
      const u = (await res.json()) as Record<string, unknown>;

      if (provider === "x") {
        const d = (u.data ?? {}) as { id?: string; username?: string; name?: string; profile_image_url?: string };
        return {
          providerUserId: d.id ?? "",
          email: null,
          displayName: d.name ?? (d.username ? `@${d.username}` : null),
          avatarUrl: d.profile_image_url ?? null,
        };
      }
      // google / meta / tynn share a flat shape (id|sub, email, name, picture)
      return {
        providerUserId: String(u.id ?? u.sub ?? ""),
        email: (u.email as string | undefined) ?? null,
        displayName: (u.name as string | undefined) ?? (u.email as string | undefined) ?? null,
        avatarUrl: (u.picture as string | undefined) ?? (u.avatar_url as string | undefined) ?? null,
      };
    } catch {
      return { providerUserId: "", email: null, displayName: null, avatarUrl: null };
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private getProviderConfig(provider: string): OAuthProviderConfig | undefined {
    return (this.getConfig() ?? {} as OAuthConfig)[provider as keyof OAuthConfig];
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now > session.expiresAt) this.sessions.delete(key);
    }
  }
}
