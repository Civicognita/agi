/**
 * Dev-Mode fork resolution.
 *
 * When Dev Mode is enabled, each of the canonical workspace-resident
 * repos needs an owner-scoped fork at `{ownerLogin}/{repo}`. Owners
 * expect the toggle to "just work" — they shouldn't have to visit
 * github.com and click Fork N times.
 *
 * For each canonical repo:
 *   1. Look up the fork via GitHub's API. If it exists, use it.
 *   2. If it's missing, POST to /repos/{org}/{repo}/forks to create it.
 *      (The `repo` scope — which our owner token has — allows this.)
 *   3. Return the resolved fork URL (or a failure entry if steps 1 + 2
 *      both fail).
 *
 * Newly-created forks appear in the caller's account within a few
 * seconds. We return the expected `clone_url` even if it hasn't
 * propagated yet — the caller should tolerate a transient 404 on the
 * first clone attempt and retry.
 *
 * **Per-spec upstream organization (s136 t512, 2026-04-28):** before this
 * task the registry was hardcoded to a single `CANONICAL_OWNER =
 * "Civicognita"` constant. That worked while every workspace-resident
 * repo lived under the same GitHub org. The PAx packages
 * (react-fancy / fancy-code / fancy-sheets / fancy-echarts) live under
 * `Particle-Academy` — different org, same workspace clone target. Each
 * spec now carries its own `upstreamOrg`; `upstreamRemoteUrl()` builds
 * the URL from the spec, not the constant. The constant remains only as
 * a default for legacy specs that don't set the field.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/** GitHub org that owns the canonical upstream. */
export type UpstreamOrg = "Civicognita" | "Particle-Academy";

export interface CoreRepoSpec {
  /** Stable slug used in config + UI. */
  slug:
    | "agi"
    | "prime"
    | "hive-id"
    | "marketplace"
    | "mapp-marketplace"
    | "react-fancy"
    | "fancy-code"
    | "fancy-sheets"
    | "fancy-echarts"
    | "fancy-3d"
    | "fancy-screens"
    | "fancy-whiteboard"
    | "agent-integrations"
    | "fancy-artboard"
    | "fancy-slides"
    | "fancy-flow";
  /** Repo name on GitHub (NOT the slug — sometimes diverges, e.g. prime
   *  → aionima, id → agi-local-id). */
  upstream: string;
  /** GitHub org that owns the canonical upstream. Defaults to
   *  "Civicognita" when omitted (the legacy core-five behavior). */
  upstreamOrg?: UpstreamOrg;
  /** Human display name. */
  displayName: string;
  /** Config key in `dev.*` that holds the fork URL. */
  configKey:
    | "agiRepo"
    | "primeRepo"
    | "hiveIdRepo"
    | "marketplaceRepo"
    | "mappMarketplaceRepo"
    | "reactFancyRepo"
    | "fancyCodeRepo"
    | "fancySheetsRepo"
    | "fancyEchartsRepo"
    | "fancy3dRepo"
    | "fancyScreensRepo"
    | "fancyWhiteboardRepo"
    | "agentIntegrationsRepo"
    | "fancyArtboardRepo"
    | "fancySlidesRepo"
    | "fancyFlowRepo";
}

export const CORE_REPOS: readonly CoreRepoSpec[] = Object.freeze([
  // Civicognita-owned core five (legacy default — `upstreamOrg` omitted
  // so they continue to use CANONICAL_OWNER = "Civicognita").
  { slug: "agi",              upstream: "agi",                  displayName: "AGI",              configKey: "agiRepo" },
  { slug: "prime",            upstream: "aionima",              displayName: "PRIME",            configKey: "primeRepo" },
  // (Local-ID removed — absorbed into AGI gateway-core via s180)
  // s149 t625 — Hive-ID (cloud federation hub, privately deployed). Added
  // to CORE_REPOS so Contributing Mode provisions + clones the fork locally.
  // Distinct from Local-ID (id.ai.on LAN service) — Hive-ID runs on Railway/Azure.
  { slug: "hive-id",          upstream: "agi-hive-id",          displayName: "Hive-ID",          configKey: "hiveIdRepo" },
  { slug: "marketplace",      upstream: "agi-marketplace",      displayName: "Marketplace",      configKey: "marketplaceRepo" },
  { slug: "mapp-marketplace", upstream: "agi-mapp-marketplace", displayName: "MApp Marketplace", configKey: "mappMarketplaceRepo" },

  // Particle-Academy (PAx) ADF UI primitives — workspace-resident per
  // CLAUDE.md § 1.5. Same provisioning flow as the core five; different
  // upstream org. Forks live at wishborn/<slug>; lookupFork is
  // idempotent so existing forks (created manually in cycle 88) are
  // reused without re-creating.
  { slug: "react-fancy",   upstream: "react-fancy",   upstreamOrg: "Particle-Academy", displayName: "react-fancy",   configKey: "reactFancyRepo" },
  { slug: "fancy-code",    upstream: "fancy-code",    upstreamOrg: "Particle-Academy", displayName: "fancy-code",    configKey: "fancyCodeRepo" },
  { slug: "fancy-sheets",  upstream: "fancy-sheets",  upstreamOrg: "Particle-Academy", displayName: "fancy-sheets",  configKey: "fancySheetsRepo" },
  { slug: "fancy-echarts", upstream: "fancy-echarts", upstreamOrg: "Particle-Academy", displayName: "fancy-echarts", configKey: "fancyEchartsRepo" },
  { slug: "fancy-3d",      upstream: "fancy-3d",      upstreamOrg: "Particle-Academy", displayName: "fancy-3d",      configKey: "fancy3dRepo" },
  // s146 t604 cycle 199 — fancy-screens added to PAx (6th package).
  // Owner-confirmed 2026-05-03: @particle-academy/fancy-screens@0.2.0
  // is the Screen primitive MApps compose against. Containerized
  // application surface with scoped state, typed ports, hibernation,
  // schema-driven rendering, agent-introspectable registry.
  { slug: "fancy-screens", upstream: "fancy-screens", upstreamOrg: "Particle-Academy", displayName: "fancy-screens", configKey: "fancyScreensRepo" },

  // s157 cycle 197 — fancy-whiteboard + agent-integrations added to PAx
  // (8 packages total). Owner-confirmed 2026-05-11: s157 Phase 2 (whiteboard
  // mode for UserNotes) builds on @particle-academy/fancy-whiteboard's
  // canvas primitives + sticky-notes + diagramming + freeform drawing +
  // presence cursors. agent-integrations provides per-session micro-MCP
  // bridges so Aion can participate in shared whiteboard sessions through
  // the same channels other collaborators use (panel + on-canvas cursor).
  { slug: "fancy-whiteboard",   upstream: "fancy-whiteboard",   upstreamOrg: "Particle-Academy", displayName: "fancy-whiteboard",   configKey: "fancyWhiteboardRepo" },
  { slug: "agent-integrations", upstream: "agent-integrations", upstreamOrg: "Particle-Academy", displayName: "agent-integrations", configKey: "agentIntegrationsRepo" },
  // s200 — additional PAx packages registered in the Fancy UI MCP registry.
  { slug: "fancy-artboard",     upstream: "fancy-artboard",     upstreamOrg: "Particle-Academy", displayName: "fancy-artboard",     configKey: "fancyArtboardRepo" },
  { slug: "fancy-slides",       upstream: "fancy-slides",       upstreamOrg: "Particle-Academy", displayName: "fancy-slides",       configKey: "fancySlidesRepo" },
  { slug: "fancy-flow",         upstream: "fancy-flow",         upstreamOrg: "Particle-Academy", displayName: "fancy-flow",         configKey: "fancyFlowRepo" },
] as const);

export interface ForkResolveResult {
  slug: CoreRepoSpec["slug"];
  /** HTTPS clone URL for the owner's fork. Populated on success. */
  cloneUrl?: string;
  /** The upstream the fork was made from, for display. */
  upstreamUrl: string;
  /** Whether we created the fork in this pass (vs reusing an existing one). */
  created: boolean;
  /** Populated on failure. */
  error?: string;
}

/** Default org for specs that don't set `upstreamOrg`. The legacy
 *  core-five rely on this default. New specs should set the field
 *  explicitly. */
export const CANONICAL_OWNER: UpstreamOrg = "Civicognita";

/** Resolve a spec's upstream org (explicit field, falling back to the
 *  legacy CANONICAL_OWNER default). */
export function specUpstreamOrg(spec: CoreRepoSpec): UpstreamOrg {
  return spec.upstreamOrg ?? CANONICAL_OWNER;
}

/** Full `upstream` remote URL for a given core-repo spec. */
export function upstreamRemoteUrl(spec: CoreRepoSpec): string {
  return `https://github.com/${specUpstreamOrg(spec)}/${spec.upstream}.git`;
}

/**
 * Resolve the on-disk directory for a core fork inside its collection dir.
 *
 * **Layout history:** the meta-project restructure (CLAUDE.md § 8, 2026-05-13)
 * moved every fork from a flat `_aionima/<slug>/` into `_aionima/repos/<slug>/`.
 * Helpers that hardcoded `join(collectionDir, slug)` silently reported every
 * fork as "not provisioned" after the move (the Aionima project page's Repos +
 * Contribute panels and the upgrade-wizard fork list all went blank).
 *
 * This resolver is the single source of truth: it prefers the new
 * `repos/<slug>` location and falls back to the legacy flat `<slug>` only if a
 * `.git` exists there — so a pre-restructure install keeps working and a
 * post-restructure install resolves correctly. Returns the `repos/<slug>` path
 * when neither exists yet (the canonical target for new clones).
 */
export function coreForkDir(collectionDir: string, slug: string): string {
  const nested = join(collectionDir, "repos", slug);
  if (existsSync(join(nested, ".git"))) return nested;
  const flat = join(collectionDir, slug);
  if (existsSync(join(flat, ".git"))) return flat;
  return nested;
}

/**
 * Resolve (or create) the owner's fork for every core repo.
 */
export async function resolveOrCreateForks(
  ownerToken: string,
  ownerLogin: string,
): Promise<ForkResolveResult[]> {
  const results: ForkResolveResult[] = [];
  for (const spec of CORE_REPOS) {
    const upstreamUrl = upstreamRemoteUrl(spec);
    try {
      const existing = await lookupFork(ownerToken, ownerLogin, spec.upstream, specUpstreamOrg(spec));
      if (existing) {
        results.push({ slug: spec.slug, cloneUrl: existing, upstreamUrl, created: false });
        continue;
      }

      const created = await createFork(ownerToken, specUpstreamOrg(spec), spec.upstream);
      if (created) {
        results.push({ slug: spec.slug, cloneUrl: created, upstreamUrl, created: true });
      } else {
        results.push({
          slug: spec.slug,
          upstreamUrl,
          created: false,
          error: "GitHub rejected fork creation — confirm your token has the `repo` scope and that the upstream is public",
        });
      }
    } catch (e) {
      results.push({
        slug: spec.slug,
        upstreamUrl,
        created: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

/**
 * HEAD the owner's fork. Returns its `clone_url` if it exists AND is a
 * verified fork of the expected upstream. Returns null if the repo doesn't
 * exist (caller should then create a proper fork). Throws if the repo
 * exists but is not a fork of the expected upstream — that is a name
 * collision that requires manual resolution, not a fork-creation attempt
 * (which would also fail with a 422 from GitHub).
 */
async function lookupFork(
  token: string,
  ownerLogin: string,
  upstream: string,
  expectedUpstreamOrg: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${ownerLogin}/${upstream}`;
  const res = await fetch(url, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET ${url} → ${String(res.status)} ${res.statusText}`);
  }
  const body = (await res.json()) as {
    clone_url?: string;
    html_url?: string;
    fork?: boolean;
    parent?: { full_name?: string };
  };

  // Verify this is a genuine fork of the correct upstream — not just any
  // repo with the same name in the owner's account.
  const expectedFullName = `${expectedUpstreamOrg}/${upstream}`;
  if (!body.fork || body.parent?.full_name !== expectedFullName) {
    throw new Error(
      `${ownerLogin}/${upstream} exists but is not a fork of ${expectedFullName} ` +
      `(fork=${String(!!body.fork)}, parent=${body.parent?.full_name ?? "none"}). ` +
      `Rename or delete the existing repo to let Contributing Mode create a proper fork.`,
    );
  }

  return body.clone_url ?? (body.html_url ? `${body.html_url}.git` : null);
}

/**
 * Create a fork of `{canonicalOwner}/{repo}` into the owner's account
 * (implicit — the token identifies the fork destination). Returns the
 * new fork's clone_url.
 */
async function createFork(
  token: string,
  canonicalOwner: string,
  repo: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${canonicalOwner}/${repo}/forks`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...githubHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}), // no options — default behavior forks into the authenticated user's account
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${url} → ${String(res.status)}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { clone_url?: string; html_url?: string };
  return body.clone_url ?? (body.html_url ? `${body.html_url}.git` : null);
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "aionima-agi",
  };
}
