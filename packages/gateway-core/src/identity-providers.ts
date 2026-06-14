/**
 * Identity Providers — canonical registry (single source of truth).
 *
 * Every consumer (device-flow-api's GitHub creds, oauth-handler redirect flows,
 * the `/api/auth/providers` endpoint, and the System ▸ Identity UI) derives the
 * provider set + metadata from this list, so the providers Aionima exposes never
 * drift across surfaces.
 *
 * Owner directive 2026-06-12 (story #212): Identity Management lives in ONE place
 * (System ▸ Identity), with these common providers first-class:
 *   GitHub · Google · Meta · X · Tynn.ai · Civicognita (formerly Hive-ID).
 *
 * Credential model (owner decision, AskUserQuestion 2026-06-12):
 *   - Providers Aionima operates a hosted OAuth app for ship a public client id
 *     in code (memory: feedback_no_config_in_production). Today only GitHub
 *     (RFC 8628 device flow — a public client needs no secret).
 *   - The rest (Google, Meta, X, Tynn.ai) require the owner to supply their own
 *     OAuth app (clientId/secret) — wired in Slice 2.
 *   - Civicognita is gated on the HIVE federation network coming online.
 *
 * NOTE: `discord` is intentionally absent — it is a *channel* provider used by
 * the Discord adapter (device-flow-api), not an identity-page provider.
 */

export type IdentityProviderId =
  | "github"
  | "google"
  | "meta"
  | "x"
  | "tynn"
  | "civicognita";

/** How a provider's connection is established. */
export type IdentityAuthMode =
  | "device" // RFC 8628 device-authorization grant (no redirect)
  | "redirect" // standard OAuth2 authorization-code redirect
  | "federation"; // brokered through Civicognita / HIVE federation

/** Capability a provider is gated behind before it can connect at all. */
export type IdentityGate = "federation";

export interface IdentityProviderEndpoints {
  /** Device-authorization endpoint (device mode). */
  deviceCodeUrl?: string;
  /** Authorization endpoint the owner is redirected to (redirect mode). */
  authUrl?: string;
  /** Token-exchange endpoint. */
  tokenUrl: string;
  /** User-info endpoint used to derive an account label. */
  userInfoUrl?: string;
}

export interface IdentityProviderSpec {
  id: IdentityProviderId;
  displayName: string;
  authMode: IdentityAuthMode;
  /**
   * Public OAuth client id shipped with Aionima. Present only for providers
   * Aionima operates a hosted app for; undefined => owner must supply their own
   * OAuth app (see `requiresOwnerApp`).
   */
  hostedClientId?: string;
  /** True when the owner must paste their own OAuth client id/secret to enable. */
  requiresOwnerApp: boolean;
  /** Capability this provider is gated behind (e.g. federation for Civicognita). */
  gatedOn?: IdentityGate;
  /** Redirect providers that require PKCE (S256) on the authorization-code flow (e.g. X). */
  usesPkce?: boolean;
  /**
   * Token-endpoint client authentication for redirect providers:
   *   "body"  → client_id/client_secret in the form body (Google, Meta, Tynn)
   *   "basic" → HTTP Basic `Authorization: Basic base64(id:secret)` header (X)
   */
  tokenAuth?: "body" | "basic";
  /** OAuth scopes requested. */
  scopes: string[];
  /** OAuth endpoints (absent for federation-only providers). */
  endpoints?: IdentityProviderEndpoints;
  /** Short brand hint for the UI (icon / colour selection). */
  brandHint: string;
  /** One-line description shown on the provider card. */
  blurb: string;
}

/** GitHub ships a public OAuth client id (device flow needs no secret). */
const GITHUB_HOSTED_CLIENT_ID = "Ov23liMC3zFFaNwtg58t";

export const IDENTITY_PROVIDERS: Record<IdentityProviderId, IdentityProviderSpec> = {
  github: {
    id: "github",
    displayName: "GitHub",
    authMode: "device",
    hostedClientId: GITHUB_HOSTED_CLIENT_ID,
    requiresOwnerApp: false,
    scopes: ["repo", "read:user", "user:email"],
    endpoints: {
      deviceCodeUrl: "https://github.com/login/device/code",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userInfoUrl: "https://api.github.com/user",
    },
    brandHint: "github",
    blurb: "Repos, issues, and PRs — connects instantly via device flow.",
  },
  google: {
    id: "google",
    displayName: "Google",
    authMode: "redirect",
    requiresOwnerApp: true,
    scopes: [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    endpoints: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    },
    brandHint: "google",
    blurb: "Gmail, Calendar, and Workspace — add your OAuth app to enable.",
  },
  meta: {
    id: "meta",
    displayName: "Meta",
    authMode: "redirect",
    requiresOwnerApp: true,
    scopes: ["public_profile", "email"],
    endpoints: {
      authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
      tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
      userInfoUrl: "https://graph.facebook.com/me?fields=id,name,email",
    },
    brandHint: "meta",
    blurb: "Facebook & Instagram identity — add your OAuth app to enable.",
  },
  x: {
    id: "x",
    displayName: "X",
    authMode: "redirect",
    requiresOwnerApp: true,
    usesPkce: true,
    tokenAuth: "basic",
    scopes: ["users.read", "tweet.read", "offline.access"],
    endpoints: {
      authUrl: "https://twitter.com/i/oauth2/authorize",
      tokenUrl: "https://api.twitter.com/2/oauth2/token",
      userInfoUrl: "https://api.twitter.com/2/users/me",
    },
    brandHint: "x",
    blurb: "X (Twitter) identity — add your OAuth app to enable.",
  },
  tynn: {
    id: "tynn",
    displayName: "Tynn.ai",
    authMode: "redirect",
    requiresOwnerApp: true,
    scopes: ["openid", "profile", "email"],
    endpoints: {
      authUrl: "https://tynn.ai/oauth/authorize",
      tokenUrl: "https://tynn.ai/oauth/token",
      userInfoUrl: "https://tynn.ai/api/userinfo",
    },
    brandHint: "tynn",
    blurb: "Tynn project management — part of the Civicognita ecosystem.",
  },
  civicognita: {
    id: "civicognita",
    displayName: "Civicognita",
    authMode: "federation",
    requiresOwnerApp: false,
    gatedOn: "federation",
    scopes: [],
    brandHint: "civicognita",
    blurb: "Civicognita Identity (formerly Hive-ID) — available when federation is online.",
  },
};

/** Stable display order for the provider grid. */
export const IDENTITY_PROVIDER_ORDER: IdentityProviderId[] = [
  "github",
  "google",
  "meta",
  "x",
  "tynn",
  "civicognita",
];

/** All providers in stable display order. */
export function listIdentityProviders(): IdentityProviderSpec[] {
  return IDENTITY_PROVIDER_ORDER.map((id) => IDENTITY_PROVIDERS[id]);
}

/** Look up a provider spec by id (undefined for unknown / channel-only ids). */
export function getIdentityProvider(id: string): IdentityProviderSpec | undefined {
  return (IDENTITY_PROVIDERS as Record<string, IdentityProviderSpec>)[id];
}

/** Type guard: is `id` one of the canonical identity providers? */
export function isKnownIdentityProvider(id: string): id is IdentityProviderId {
  return id in IDENTITY_PROVIDERS;
}

// ---------------------------------------------------------------------------
// Live status — what the System ▸ Identity page renders per provider
// ---------------------------------------------------------------------------

/**
 * - connected        → a connection row exists for this provider
 * - available        → connectable right now (hosted, or owner app configured)
 * - needs-config     → owner must supply an OAuth app first (redirect providers)
 * - federation-gated → blocked until the gated capability is online (Civicognita)
 */
export type IdentityProviderStatus =
  | "connected"
  | "available"
  | "needs-config"
  | "federation-gated";

/** Provider spec + computed live status — the shape the UI grid consumes. */
export interface IdentityProviderView {
  id: IdentityProviderId;
  displayName: string;
  authMode: IdentityAuthMode;
  requiresOwnerApp: boolean;
  gatedOn?: IdentityGate;
  brandHint: string;
  blurb: string;
  status: IdentityProviderStatus;
  /** Account label of an existing connection (e.g. GitHub login), if connected. */
  connectedLabel: string | null;
}

export interface IdentityProviderStatusInput {
  /** provider id → account label (null if unknown) for existing connections. */
  connectedProviders: Map<string, string | null>;
  /** redirect-provider ids that have owner OAuth-app credentials configured. */
  appConfigured: Set<string>;
  /** whether the HIVE federation network is online (gates Civicognita). */
  federationOnline: boolean;
}

/**
 * Compute the per-provider view (spec + live status) for all 6 canonical
 * providers, in stable display order. Pure — the endpoint gathers the inputs
 * (DB connections, configured apps, federation state) and calls this.
 */
export function computeIdentityProviderViews(
  input: IdentityProviderStatusInput,
): IdentityProviderView[] {
  return listIdentityProviders().map((p) => {
    const hasConnection = input.connectedProviders.has(p.id);
    let status: IdentityProviderStatus;
    if (hasConnection) {
      status = "connected";
    } else if (p.gatedOn === "federation" && !input.federationOnline) {
      status = "federation-gated";
    } else if (p.requiresOwnerApp) {
      status = input.appConfigured.has(p.id) ? "available" : "needs-config";
    } else {
      // Hosted provider (e.g. GitHub) — connectable right now.
      status = "available";
    }
    return {
      id: p.id,
      displayName: p.displayName,
      authMode: p.authMode,
      requiresOwnerApp: p.requiresOwnerApp,
      gatedOn: p.gatedOn,
      brandHint: p.brandHint,
      blurb: p.blurb,
      status,
      connectedLabel: input.connectedProviders.get(p.id) ?? null,
    };
  });
}
