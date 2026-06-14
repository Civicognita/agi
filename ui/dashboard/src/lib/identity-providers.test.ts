import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_IDENTITY_PROVIDERS,
  resolveIdentityProviders,
} from "./identity-providers.js";
import type { IdentityProviderView } from "@/types.js";

const CANONICAL_ORDER = ["github", "google", "meta", "x", "tynn", "civicognita"];

describe("identity-providers — client-side baked-in seed (story #219)", () => {
  it("ships the canonical 6 in registry order", () => {
    expect(DEFAULT_IDENTITY_PROVIDERS.map((p) => p.id)).toEqual(CANONICAL_ORDER);
  });

  it("seeds GitHub as connectable (device flow) and Civicognita as federation-gated", () => {
    const github = DEFAULT_IDENTITY_PROVIDERS.find((p) => p.id === "github");
    const civi = DEFAULT_IDENTITY_PROVIDERS.find((p) => p.id === "civicognita");
    expect(github?.status).toBe("available");
    expect(github?.authMode).toBe("device");
    expect(github?.requiresOwnerApp).toBe(false);
    expect(civi?.status).toBe("federation-gated");
    expect(civi?.gatedOn).toBe("federation");
  });

  it("the redirect providers seed as needs-config", () => {
    for (const id of ["google", "meta", "x", "tynn"]) {
      const p = DEFAULT_IDENTITY_PROVIDERS.find((x) => x.id === id);
      expect(p?.authMode).toBe("redirect");
      expect(p?.status).toBe("needs-config");
      expect(p?.requiresOwnerApp).toBe(true);
    }
  });

  // The core resilience guarantee: a failed/empty endpoint must NOT blank the grid.
  it("falls back to the baked-in seed when the API result is null", () => {
    expect(resolveIdentityProviders(null)).toBe(DEFAULT_IDENTITY_PROVIDERS);
  });

  it("falls back to the baked-in seed when the API result is empty", () => {
    expect(resolveIdentityProviders([])).toBe(DEFAULT_IDENTITY_PROVIDERS);
  });

  it("always renders GitHub + Civicognita even on a partial API result", () => {
    // API returns only google (e.g. a truncated/garbled response) — the core
    // baked-in providers must still appear.
    const partial: IdentityProviderView[] = [
      {
        id: "google",
        displayName: "Google",
        authMode: "redirect",
        requiresOwnerApp: true,
        brandHint: "google",
        blurb: "x",
        status: "available",
        connectedLabel: null,
      },
    ];
    const resolved = resolveIdentityProviders(partial);
    expect(resolved.map((p) => p.id)).toEqual(CANONICAL_ORDER);
    expect(resolved.find((p) => p.id === "github")?.status).toBe("available");
    expect(resolved.find((p) => p.id === "civicognita")?.status).toBe("federation-gated");
    // The one provider the API DID return gets its live status applied.
    expect(resolved.find((p) => p.id === "google")?.status).toBe("available");
  });

  it("applies live status from a full API result, preserving order", () => {
    const live: IdentityProviderView[] = DEFAULT_IDENTITY_PROVIDERS.map((p) => ({
      ...p,
      status: p.id === "github" ? "connected" : p.status,
      connectedLabel: p.id === "github" ? "octocat" : null,
    }));
    const resolved = resolveIdentityProviders(live);
    expect(resolved.map((p) => p.id)).toEqual(CANONICAL_ORDER);
    const gh = resolved.find((p) => p.id === "github");
    expect(gh?.status).toBe("connected");
    expect(gh?.connectedLabel).toBe("octocat");
  });

  // Drift guard: the client seed must match the gateway-core SSOT id set + order.
  it("stays in sync with the gateway-core SSOT id set", () => {
    const ssotPath = fileURLToPath(
      new URL("../../../../packages/gateway-core/src/identity-providers.ts", import.meta.url),
    );
    const src = readFileSync(ssotPath, "utf-8");
    // IDENTITY_PROVIDER_ORDER drives the backend response order.
    const orderMatch = src.match(/IDENTITY_PROVIDER_ORDER[^=]*=\s*\[([^\]]+)\]/);
    expect(orderMatch, "IDENTITY_PROVIDER_ORDER not found in SSOT").toBeTruthy();
    const ssotOrder = [...orderMatch![1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect(ssotOrder).toEqual(CANONICAL_ORDER);
  });
});
