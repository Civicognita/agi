import { describe, expect, it } from "vitest";
import {
  IDENTITY_PROVIDERS,
  IDENTITY_PROVIDER_ORDER,
  listIdentityProviders,
  getIdentityProvider,
  isKnownIdentityProvider,
  computeIdentityProviderViews,
} from "./identity-providers.js";

describe("identity-providers — canonical registry (s212 t773)", () => {
  it("defines exactly the 6 canonical providers in stable order", () => {
    expect(IDENTITY_PROVIDER_ORDER).toEqual([
      "github",
      "google",
      "meta",
      "x",
      "tynn",
      "civicognita",
    ]);
    expect(listIdentityProviders().map((p) => p.id)).toEqual(IDENTITY_PROVIDER_ORDER);
    expect(Object.keys(IDENTITY_PROVIDERS).sort()).toEqual([...IDENTITY_PROVIDER_ORDER].sort());
  });

  it("ships GitHub's public client id (hosted, no owner app required)", () => {
    const gh = IDENTITY_PROVIDERS.github;
    expect(gh.hostedClientId).toBeTruthy();
    expect(gh.requiresOwnerApp).toBe(false);
    expect(gh.authMode).toBe("device");
    expect(gh.endpoints?.deviceCodeUrl).toMatch(/device\/code/);
  });

  it("marks google/meta/x/tynn as requiring an owner-supplied OAuth app (redirect)", () => {
    for (const id of ["google", "meta", "x", "tynn"] as const) {
      const p = IDENTITY_PROVIDERS[id];
      expect(p.requiresOwnerApp).toBe(true);
      expect(p.authMode).toBe("redirect");
      expect(p.hostedClientId).toBeUndefined();
      expect(p.endpoints?.authUrl).toMatch(/^https:\/\//);
      expect(p.endpoints?.tokenUrl).toMatch(/^https:\/\//);
      expect(p.endpoints?.userInfoUrl).toMatch(/^https:\/\//);
    }
  });

  it("gates Civicognita (the former Hive-ID) on federation", () => {
    const c = IDENTITY_PROVIDERS.civicognita;
    expect(c.authMode).toBe("federation");
    expect(c.gatedOn).toBe("federation");
    expect(c.displayName).toBe("Civicognita");
    expect(c.requiresOwnerApp).toBe(false);
  });

  it("every provider carries display metadata for the UI grid", () => {
    for (const p of listIdentityProviders()) {
      expect(p.displayName).toBeTruthy();
      expect(p.brandHint).toBeTruthy();
      expect(p.blurb).toBeTruthy();
      expect(Array.isArray(p.scopes)).toBe(true);
    }
  });

  it("lookup + guard helpers behave", () => {
    expect(getIdentityProvider("github")?.displayName).toBe("GitHub");
    expect(getIdentityProvider("nope")).toBeUndefined();
    expect(isKnownIdentityProvider("tynn")).toBe(true);
    // discord is a channel provider, NOT an identity-page provider
    expect(isKnownIdentityProvider("discord")).toBe(false);
  });
});

describe("computeIdentityProviderViews — live status (s212 t774)", () => {
  const base = {
    connectedProviders: new Map<string, string | null>(),
    appConfigured: new Set<string>(),
    federationOnline: false,
  };

  it("returns all 6 providers in stable order", () => {
    const views = computeIdentityProviderViews(base);
    expect(views.map((v) => v.id)).toEqual(IDENTITY_PROVIDER_ORDER);
  });

  it("GitHub (hosted) is 'available' with no connection, 'connected' with one", () => {
    expect(computeIdentityProviderViews(base).find((v) => v.id === "github")?.status).toBe(
      "available",
    );
    const connected = computeIdentityProviderViews({
      ...base,
      connectedProviders: new Map([["github", "octocat"]]),
    });
    const gh = connected.find((v) => v.id === "github");
    expect(gh?.status).toBe("connected");
    expect(gh?.connectedLabel).toBe("octocat");
  });

  it("redirect providers are 'needs-config' until an owner app is configured, then 'available'", () => {
    const noApp = computeIdentityProviderViews(base);
    expect(noApp.find((v) => v.id === "google")?.status).toBe("needs-config");

    const withApp = computeIdentityProviderViews({
      ...base,
      appConfigured: new Set(["google"]),
    });
    expect(withApp.find((v) => v.id === "google")?.status).toBe("available");
    // others without an app stay needs-config
    expect(withApp.find((v) => v.id === "meta")?.status).toBe("needs-config");
  });

  it("Civicognita is 'federation-gated' offline, 'available' when federation is online", () => {
    expect(computeIdentityProviderViews(base).find((v) => v.id === "civicognita")?.status).toBe(
      "federation-gated",
    );
    const online = computeIdentityProviderViews({ ...base, federationOnline: true });
    expect(online.find((v) => v.id === "civicognita")?.status).toBe("available");
  });

  it("a connection always wins over gating (connected civicognita shows connected)", () => {
    const views = computeIdentityProviderViews({
      ...base,
      connectedProviders: new Map([["civicognita", "geid:abc"]]),
    });
    expect(views.find((v) => v.id === "civicognita")?.status).toBe("connected");
  });
});
