/**
 * OAuth Handler — manages OAuth2 flows for local identity binding.
 *
 * Supports Google and GitHub as OAuth providers. Each node operator
 * registers their own OAuth apps — no central dependency on id.aionima.ai.
 */

import { randomBytes } from "node:crypto";

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
}

export interface OAuthSession {
  state: string;
  provider: string;
  redirectUri: string;
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
// Constants
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

// ---------------------------------------------------------------------------
// OAuthHandler
// ---------------------------------------------------------------------------

export class OAuthHandler {
  private readonly config: OAuthConfig;
  private readonly sessions = new Map<string, OAuthSession>();
  private readonly baseUrl: string;

  constructor(config: OAuthConfig, baseUrl: string) {
    this.config = config;
    this.baseUrl = baseUrl;
  }

  /**
   * Get available OAuth providers.
   */
  getAvailableProviders(): string[] {
    const providers: string[] = [];
    if (this.config.google) providers.push("google");
    if (this.config.github) providers.push("github");
    return providers;
  }

  /**
   * Start an OAuth flow — returns the authorization URL to redirect the user to.
   */
  startFlow(provider: string): { authUrl: string; state: string } | null {
    const providerConfig = this.getProviderConfig(provider);
    if (!providerConfig) return null;

    const state = randomBytes(32).toString("hex");
    const redirectUri = `${this.baseUrl}/api/auth/callback/${provider}`;

    const session: OAuthSession = {
      state,
      provider,
      redirectUri,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(state, session);

    // Cleanup expired sessions
    this.cleanupExpired();

    let authUrl: string;
    if (provider === "google") {
      const params = new URLSearchParams({
        client_id: providerConfig.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: (providerConfig.scopes ?? ["openid", "email", "profile"]).join(" "),
        state,
        access_type: "offline",
        prompt: "consent",
      });
      authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;
    } else if (provider === "github") {
      const params = new URLSearchParams({
        client_id: providerConfig.clientId,
        redirect_uri: redirectUri,
        scope: (providerConfig.scopes ?? ["read:user", "user:email"]).join(" "),
        state,
      });
      authUrl = `${GITHUB_AUTH_URL}?${params.toString()}`;
    } else {
      return null;
    }

    return { authUrl, state };
  }

  /**
   * Handle OAuth callback — exchange code for token and fetch user info.
   */
  async handleCallback(
    provider: string,
    code: string,
    state: string,
  ): Promise<OAuthUserInfo | null> {
    const session = this.sessions.get(state);
    if (!session || session.provider !== provider || Date.now() > session.expiresAt) {
      return null;
    }
    this.sessions.delete(state);

    const providerConfig = this.getProviderConfig(provider);
    if (!providerConfig) return null;

    if (provider === "google") {
      return this.handleGoogleCallback(providerConfig, code, session.redirectUri);
    } else if (provider === "github") {
      return this.handleGithubCallback(providerConfig, code, session.redirectUri);
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Provider-specific handlers
  // -------------------------------------------------------------------------

  private async handleGoogleCallback(
    config: OAuthProviderConfig,
    code: string,
    redirectUri: string,
  ): Promise<OAuthUserInfo | null> {
    // Exchange code for token
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) return null;
    const tokenData = (await tokenRes.json()) as { access_token: string };

    // Fetch user info
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) return null;
    const user = (await userRes.json()) as {
      id: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    return {
      provider: "google",
      providerUserId: user.id,
      email: user.email ?? null,
      displayName: user.name ?? null,
      avatarUrl: user.picture ?? null,
    };
  }

  private async handleGithubCallback(
    config: OAuthProviderConfig,
    code: string,
    redirectUri: string,
  ): Promise<OAuthUserInfo | null> {
    // Exchange code for token
    const tokenRes = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) return null;
    const tokenData = (await tokenRes.json()) as { access_token: string };

    // Fetch user info
    const userRes = await fetch(GITHUB_USER_URL, {
      headers: {
        authorization: `Bearer ${tokenData.access_token}`,
        accept: "application/vnd.github+json",
      },
    });

    if (!userRes.ok) return null;
    const user = (await userRes.json()) as {
      id: number;
      login: string;
      name?: string;
      email?: string;
      avatar_url?: string;
    };

    return {
      provider: "github",
      providerUserId: String(user.id),
      email: user.email ?? null,
      displayName: user.name ?? user.login,
      avatarUrl: user.avatar_url ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private getProviderConfig(provider: string): OAuthProviderConfig | undefined {
    if (provider === "google") return this.config.google;
    if (provider === "github") return this.config.github;
    return undefined;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(key);
      }
    }
  }
}
