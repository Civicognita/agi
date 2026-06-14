import { describe, expect, it, vi, afterEach } from "vitest";
import { OAuthHandler, type OAuthConfig } from "./oauth-handler.js";

const BASE = "https://node.example.com";
const APP = { clientId: "cid-123", clientSecret: "secret-xyz" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OAuthHandler — registry-driven redirect flow (s212 t778)", () => {
  it("getAvailableProviders reflects config HOT (thunk re-read each call)", () => {
    let cfg: OAuthConfig = {};
    const h = new OAuthHandler(() => cfg, BASE);
    expect(h.getAvailableProviders()).toEqual([]);
    cfg = { google: APP };
    expect(h.getAvailableProviders()).toEqual(["google"]);
  });

  it("startFlow builds a Google auth URL with state + offline access", () => {
    const h = new OAuthHandler({ google: APP }, BASE);
    const res = h.startFlow("google");
    expect(res).not.toBeNull();
    const u = new URL(res!.authUrl);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe("cid-123");
    expect(u.searchParams.get("state")).toBe(res!.state);
    expect(u.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/google`);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("code_challenge")).toBeNull(); // google is not PKCE here
  });

  it("X uses PKCE (S256 code_challenge)", () => {
    const h = new OAuthHandler({ x: APP }, BASE);
    const res = h.startFlow("x");
    const u = new URL(res!.authUrl);
    expect(u.origin + u.pathname).toBe("https://twitter.com/i/oauth2/authorize");
    expect(u.searchParams.get("code_challenge")).toBeTruthy();
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("Meta and Tynn resolve to their authorization endpoints", () => {
    const h = new OAuthHandler({ meta: APP, tynn: APP }, BASE);
    expect(new URL(h.startFlow("meta")!.authUrl).hostname).toBe("www.facebook.com");
    expect(new URL(h.startFlow("tynn")!.authUrl).hostname).toBe("tynn.ai");
  });

  it("returns null for device-only (github), unconfigured, and unknown providers", () => {
    const h = new OAuthHandler({ google: APP }, BASE);
    expect(h.startFlow("github")).toBeNull(); // device mode, not redirect
    expect(h.startFlow("meta")).toBeNull(); // no app configured
    expect(h.startFlow("nope")).toBeNull();
  });

  it("handleCallback rejects an unknown/expired state", async () => {
    const h = new OAuthHandler({ google: APP }, BASE);
    expect(await h.handleCallback("google", "code", "bogus-state")).toBeNull();
  });

  it("handleCallback exchanges the code and returns token + profile (google)", async () => {
    const h = new OAuthHandler({ google: APP }, BASE);
    const { state } = h.startFlow("google")!;

    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      const s = url.toString();
      if (s.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "tok-abc", refresh_token: "ref-def", scope: "email", expires_in: 3600 }), { status: 200 });
      }
      // userinfo
      return new Response(JSON.stringify({ id: "g-1", email: "a@b.com", name: "Ada", picture: "http://x/y.png" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await h.handleCallback("google", "the-code", state);
    expect(out).not.toBeNull();
    expect(out!.accessToken).toBe("tok-abc");
    expect(out!.refreshToken).toBe("ref-def");
    expect(out!.providerUserId).toBe("g-1");
    expect(out!.email).toBe("a@b.com");
    expect(out!.displayName).toBe("Ada");
    // token exchange must include client_secret in the body for body-auth providers
    const tokenCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/token"));
    const body = (tokenCall![1] as RequestInit).body as URLSearchParams;
    expect(body.get("client_secret")).toBe("secret-xyz");
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("refreshAccessToken swaps a refresh token for a fresh access token (google)", async () => {
    const h = new OAuthHandler({ google: APP }, BASE);
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600, scope: "email" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await h.refreshAccessToken("google", "stored-refresh");
    expect(out!.accessToken).toBe("fresh");
    expect(out!.expiresIn).toBe(3600);
    const body = (fetchMock.mock.calls[0]![1] as RequestInit).body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("stored-refresh");
    expect(body.get("client_secret")).toBe("secret-xyz");
  });

  it("refreshAccessToken uses Basic auth for X and returns null for unconfigured providers", async () => {
    const hX = new OAuthHandler({ x: APP }, BASE);
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ access_token: "x-fresh" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await hX.refreshAccessToken("x", "rt");
    expect(out!.accessToken).toBe("x-fresh");
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^Basic /);

    // No app configured → null (no network call)
    const hNone = new OAuthHandler({}, BASE);
    expect(await hNone.refreshAccessToken("meta", "rt")).toBeNull();
  });

  it("X token exchange uses HTTP Basic auth + code_verifier (PKCE)", async () => {
    const h = new OAuthHandler({ x: APP }, BASE);
    const { state } = h.startFlow("x")!;
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      const s = url.toString();
      if (s.includes("api.twitter.com/2/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "xtok", token_type: "bearer" }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { id: "x-9", username: "ada", name: "Ada" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await h.handleCallback("x", "code", state);
    expect(out!.providerUserId).toBe("x-9");
    expect(out!.displayName).toBe("Ada");
    const tokenCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/oauth2/token"));
    const headers = (tokenCall![1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^Basic /);
    const body = (tokenCall![1] as RequestInit).body as URLSearchParams;
    expect(body.get("code_verifier")).toBeTruthy();
  });
});
