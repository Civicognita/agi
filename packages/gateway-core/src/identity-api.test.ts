import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerIdentityProvidersRoute } from "./identity-api.js";
import type { OAuthHandler } from "./oauth-handler.js";
import type { Db } from "@agi/db-schema/client";
import { IDENTITY_PROVIDER_ORDER, type IdentityProviderView } from "./identity-providers.js";
import { encryptToken, decryptToken } from "./crypto-tokens.js";

const ENC_KEY = Buffer.alloc(32, 9);

interface ConnRow {
  userId?: string;
  provider: string;
  accountLabel: string | null;
  role: string;
  refreshToken?: string | null;
  scopes?: string | null;
}

interface FakeDb {
  db: Db;
  updates: Array<Record<string, unknown>>;
  inserts: Array<Record<string, unknown>>;
}

/**
 * Db stub whose query builder is BOTH awaitable (resolves to all rows) and
 * chainable via .where().limit() (resolves to the first row) — matching how the
 * providers route (await from) and the refresh/upsert paths (where→limit) call it.
 */
function fakeDb(rows: ConnRow[]): FakeDb {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: () => {
        // A real Promise (awaitable → all rows) with .where()/.limit() attached
        // (→ first row). Using a Promise avoids eslint's no-thenable on a literal.
        const p = Promise.resolve(rows) as Promise<ConnRow[]> & {
          where: () => typeof p;
          limit: () => Promise<ConnRow[]>;
        };
        p.where = () => p;
        p.limit = () => Promise.resolve(rows.slice(0, 1));
        return p;
      },
    }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: () => { updates.push(v); return Promise.resolve(); } }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => { inserts.push(v); return Promise.resolve(); } }),
  };
  return { db: db as unknown as Db, updates, inserts };
}

function makeApp(opts: {
  rows?: ConnRow[];
  availableOAuth?: string[];
  federationEnabled?: boolean;
  startFlow?: (provider: string) => { authUrl: string; state: string } | null;
  refreshAccessToken?: (provider: string, rt: string) => Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number | null; scopes: string | null } | null>;
  writes?: Array<{ provider: string; creds: { clientId: string; clientSecret: string } | null }>;
  encKey?: Buffer;
  /** Make getAvailableProviders / federationEnabled throw to test #219 resilience. */
  oauthThrows?: boolean;
  federationThrows?: boolean;
}) {
  const app = Fastify({ logger: false });
  const oauthHandler = {
    getAvailableProviders: () => {
      if (opts.oauthThrows) throw new Error("config read blew up");
      return opts.availableOAuth ?? [];
    },
    startFlow: opts.startFlow ?? (() => null),
    refreshAccessToken: opts.refreshAccessToken ?? (async () => null),
  } as unknown as OAuthHandler;
  const fake = fakeDb(opts.rows ?? []);
  registerIdentityProvidersRoute(app, {
    oauthHandler,
    db: fake.db,
    encKey: opts.encKey,
    federationEnabled: () => {
      if (opts.federationThrows) throw new Error("federation read blew up");
      return opts.federationEnabled ?? false;
    },
    writeOAuthApp: (provider, creds) => {
      opts.writes?.push({ provider, creds });
      return true;
    },
  });
  return Object.assign(app, { _fake: fake });
}

async function getProviders(app: ReturnType<typeof makeApp>): Promise<IdentityProviderView[]> {
  const res = await app.inject({ method: "GET", url: "/api/auth/providers" });
  expect(res.statusCode).toBe(200);
  return (res.json() as { providers: IdentityProviderView[] }).providers;
}

describe("GET /api/auth/providers — canonical 6 + live status (s212 t774)", () => {
  it("returns all 6 canonical providers in stable order", async () => {
    const app = makeApp({});
    const providers = await getProviders(app);
    expect(providers.map((p) => p.id)).toEqual(IDENTITY_PROVIDER_ORDER);
  });

  it("defaults: GitHub available, redirect providers need-config, Civicognita federation-gated", async () => {
    const app = makeApp({});
    const providers = await getProviders(app);
    const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
    expect(byId.github!.status).toBe("available");
    expect(byId.google!.status).toBe("needs-config");
    expect(byId.x!.status).toBe("needs-config");
    expect(byId.civicognita!.status).toBe("federation-gated");
  });

  it("reflects an existing GitHub connection with its account label", async () => {
    const app = makeApp({ rows: [{ provider: "github", accountLabel: "octocat", role: "owner" }] });
    const providers = await getProviders(app);
    const gh = providers.find((p) => p.id === "github")!;
    expect(gh.status).toBe("connected");
    expect(gh.connectedLabel).toBe("octocat");
  });

  it("a configured OAuth app flips a redirect provider to 'available'", async () => {
    const app = makeApp({ availableOAuth: ["google"] });
    const providers = await getProviders(app);
    expect(providers.find((p) => p.id === "google")!.status).toBe("available");
    expect(providers.find((p) => p.id === "meta")!.status).toBe("needs-config");
  });

  it("federation online makes Civicognita connectable", async () => {
    const app = makeApp({ federationEnabled: true });
    const providers = await getProviders(app);
    expect(providers.find((p) => p.id === "civicognita")!.status).toBe("available");
  });

  // Resilience (story #219): the baked-in list must never 500 or blank — an
  // enrichment throw degrades status but still returns the canonical 6.
  it("still returns the canonical 6 (200) when getAvailableProviders throws", async () => {
    const app = makeApp({ oauthThrows: true });
    const providers = await getProviders(app); // getProviders asserts 200
    expect(providers.map((p) => p.id)).toEqual(IDENTITY_PROVIDER_ORDER);
    // GitHub is unaffected by the OAuth-app read; redirect providers fall back to needs-config.
    expect(providers.find((p) => p.id === "github")!.status).toBe("available");
    expect(providers.find((p) => p.id === "google")!.status).toBe("needs-config");
  });

  it("still returns the canonical 6 (200) when the federation check throws", async () => {
    const app = makeApp({ federationThrows: true });
    const providers = await getProviders(app);
    expect(providers.map((p) => p.id)).toEqual(IDENTITY_PROVIDER_ORDER);
    // Federation treated as offline → Civicognita stays gated rather than 500-ing.
    expect(providers.find((p) => p.id === "civicognita")!.status).toBe("federation-gated");
  });
});

describe("OAuth app credential endpoints (s212 t779)", () => {
  it("PUT /api/auth/providers/:id/app persists creds for a redirect provider", async () => {
    const writes: Array<{ provider: string; creds: { clientId: string; clientSecret: string } | null }> = [];
    const app = makeApp({ writes });
    const res = await app.inject({
      method: "PUT",
      url: "/api/auth/providers/google/app",
      payload: { clientId: "cid", clientSecret: "sec" },
    });
    expect(res.statusCode).toBe(200);
    expect(writes).toEqual([{ provider: "google", creds: { clientId: "cid", clientSecret: "sec" } }]);
  });

  it("PUT rejects missing creds (400) and non-redirect providers (400)", async () => {
    const app = makeApp({});
    const missing = await app.inject({ method: "PUT", url: "/api/auth/providers/google/app", payload: { clientId: "cid" } });
    expect(missing.statusCode).toBe(400);
    // github is device-mode, not a redirect provider that accepts an app
    const wrong = await app.inject({ method: "PUT", url: "/api/auth/providers/github/app", payload: { clientId: "a", clientSecret: "b" } });
    expect(wrong.statusCode).toBe(400);
  });

  it("DELETE /api/auth/providers/:id/app clears creds", async () => {
    const writes: Array<{ provider: string; creds: { clientId: string; clientSecret: string } | null }> = [];
    const app = makeApp({ writes });
    const res = await app.inject({ method: "DELETE", url: "/api/auth/providers/meta/app" });
    expect(res.statusCode).toBe(200);
    expect(writes).toEqual([{ provider: "meta", creds: null }]);
  });

  it("POST /api/auth/start/:provider returns the authUrl when an app is configured", async () => {
    const app = makeApp({ startFlow: (p) => ({ authUrl: `https://auth/${p}`, state: "st" }) });
    const res = await app.inject({ method: "POST", url: "/api/auth/start/google" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { authUrl: string }).authUrl).toBe("https://auth/google");
  });

  it("POST /api/auth/start/:provider is 400 when the provider isn't connectable", async () => {
    const app = makeApp({ startFlow: () => null });
    const res = await app.inject({ method: "POST", url: "/api/auth/start/meta" });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/auth/providers/:id/refresh (s213 t782)", () => {
  it("400 for a non-redirect provider (github)", async () => {
    const app = makeApp({ encKey: ENC_KEY });
    const res = await app.inject({ method: "POST", url: "/api/auth/providers/github/refresh" });
    expect(res.statusCode).toBe(400);
  });

  it("400 when there is no stored refresh token", async () => {
    const app = makeApp({ encKey: ENC_KEY, rows: [] });
    const res = await app.inject({ method: "POST", url: "/api/auth/providers/google/refresh" });
    expect(res.statusCode).toBe(400);
  });

  it("refreshes a stored token and re-persists the new one", async () => {
    const app = makeApp({
      encKey: ENC_KEY,
      rows: [{ userId: "u1", provider: "google", role: "owner", accountLabel: "a@b.com", refreshToken: encryptToken(ENC_KEY, "stored-rt"), scopes: "email" }],
      refreshAccessToken: async (_p, rt) => {
        expect(rt).toBe("stored-rt"); // the route must decrypt before calling
        return { accessToken: "fresh-access", refreshToken: "rotated-rt", expiresIn: 3600, scopes: "email" };
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/auth/providers/google/refresh" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);
    // the upsert updated the existing connection with the encrypted fresh token
    const fake = (app as unknown as { _fake: { updates: Array<Record<string, unknown>> } })._fake;
    expect(fake.updates).toHaveLength(1);
    expect(decryptToken(ENC_KEY, fake.updates[0]!.accessToken as string)).toBe("fresh-access");
    expect(decryptToken(ENC_KEY, fake.updates[0]!.refreshToken as string)).toBe("rotated-rt");
  });
});
