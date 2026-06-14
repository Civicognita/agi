/**
 * Client-side baked-in identity providers (story #219).
 *
 * GitHub (device flow) and Civicognita (federation) are CORE, baked-in identity
 * services — not plugin-provided. The System ▸ Identity page must render them
 * (and the other canonical providers) without depending on a successful
 * `/api/auth/providers` round-trip, exactly the way the onboarding step hardcodes
 * its "Add GitHub" affordance. If the endpoint is empty, 500s, or never responds
 * (e.g. a stale dashboard bundle, or a host that upgraded while an older gateway
 * build is still serving), the grid must still show GitHub so the owner can
 * connect.
 *
 * These defaults mirror the gateway-core SSOT (`identity-providers.ts`) for the
 * static metadata and the fresh-node default statuses. The live endpoint is used
 * only to ENRICH this seed (github → connected, redirect → available once an
 * OAuth app is configured, civicognita → available once federation is online).
 *
 * Keep this list in sync with `IDENTITY_PROVIDERS` in
 * `packages/gateway-core/src/identity-providers.ts`. The order + ids are guarded
 * by the unit test in `identity-providers.test.ts`.
 */

import type { IdentityProviderView } from "@/types.js";

/**
 * The canonical providers as they render on a fresh node with no connections,
 * no owner OAuth apps, and federation off — i.e. the exact shape the backend
 * returns by default. Statuses here are the floor; a successful
 * `/api/auth/providers` call upgrades them.
 */
export const DEFAULT_IDENTITY_PROVIDERS: IdentityProviderView[] = [
  {
    id: "github",
    displayName: "GitHub",
    authMode: "device",
    requiresOwnerApp: false,
    brandHint: "github",
    blurb: "Repos, issues, and PRs — connects instantly via device flow.",
    status: "available",
    connectedLabel: null,
  },
  {
    id: "google",
    displayName: "Google",
    authMode: "redirect",
    requiresOwnerApp: true,
    brandHint: "google",
    blurb: "Gmail, Calendar, and Workspace — add your OAuth app to enable.",
    status: "needs-config",
    connectedLabel: null,
  },
  {
    id: "meta",
    displayName: "Meta",
    authMode: "redirect",
    requiresOwnerApp: true,
    brandHint: "meta",
    blurb: "Facebook & Instagram identity — add your OAuth app to enable.",
    status: "needs-config",
    connectedLabel: null,
  },
  {
    id: "x",
    displayName: "X",
    authMode: "redirect",
    requiresOwnerApp: true,
    brandHint: "x",
    blurb: "X (Twitter) identity — add your OAuth app to enable.",
    status: "needs-config",
    connectedLabel: null,
  },
  {
    id: "tynn",
    displayName: "Tynn.ai",
    authMode: "redirect",
    requiresOwnerApp: true,
    brandHint: "tynn",
    blurb: "Tynn project management — part of the Civicognita ecosystem.",
    status: "needs-config",
    connectedLabel: null,
  },
  {
    id: "civicognita",
    displayName: "Civicognita",
    authMode: "federation",
    requiresOwnerApp: false,
    gatedOn: "federation",
    brandHint: "civicognita",
    blurb: "Aionima's federated identity network — available when federation is online.",
    status: "federation-gated",
    connectedLabel: null,
  },
];

/**
 * Resolve the providers to render from a (possibly failed/empty) API result.
 *
 * The live endpoint is authoritative ONLY when it returns the full canonical
 * set. Otherwise we fall back to the baked-in seed so the core providers never
 * vanish. A partial result (some providers missing) is treated as untrustworthy
 * — we merge each returned provider over its baked-in default by id, and any
 * baked-in provider the API omitted is kept from the seed. This guarantees the
 * canonical 6 always render, with live status applied wherever the API supplied
 * it.
 */
export function resolveIdentityProviders(
  apiResult: IdentityProviderView[] | null | undefined,
): IdentityProviderView[] {
  if (!apiResult || apiResult.length === 0) return DEFAULT_IDENTITY_PROVIDERS;
  const byId = new Map(apiResult.map((p) => [p.id, p]));
  return DEFAULT_IDENTITY_PROVIDERS.map((seed) => byId.get(seed.id) ?? seed);
}
