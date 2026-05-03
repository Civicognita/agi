/**
 * Route-map for default DevNotes.
 *
 * Owner directive (cycle 150, 2026-04-30): DevNotes lives on every page,
 * every tab, every view as a small embeddable component, with all notes
 * stacking to one global modal navigated by arrow keys.
 *
 * This file is the route-map fallback: every dashboard route gets at
 * least one default `<DevNote>` registration via `<RouteDevNotes>` in
 * root.tsx. Pages can ALSO embed inline `<DevNote>` components for
 * page-specific concerns; both register to the same global modal and
 * both show up under the icon's count.
 *
 * Routes are matched by prefix — the longest-matching prefix wins.
 * `/projects/foo` falls back to `/projects` if `/projects/foo` isn't
 * present in the map.
 *
 * Editing this file: add/update the entry for a route when there's
 * something specific the owner should know when testing that page on
 * production. "What to expect" is the litmus.
 */

import { useLocation } from "react-router";
import type { ReactNode } from "react";
import { DevNote, type DevNoteKind } from "@/components/ui/dev-notes";

interface RouteNote {
  heading: string;
  kind: DevNoteKind;
  body: ReactNode;
}

/**
 * Route → default note map. Longest matching prefix wins so nested
 * routes can override their parents. `null` value means "no default
 * note for this route" (used to suppress a parent default).
 */
const ROUTE_NOTES: Record<string, RouteNote | null> = {
  // ----- Top-level overview -----
  "/": {
    heading: "Dashboard root — overview surface",
    kind: "info",
    body: "Default landing page. Surfaces system pulse + key metrics. Stable surface; no recent agent-side changes this session.",
  },

  // ----- Projects (already has inline DevNotes from cycle 150 wave) -----
  "/projects": {
    heading: "Projects browser — recent ships visible inline",
    kind: "info",
    body: "Click the notebook icon in the header to see the cycle 134-149 work surfaced as inline notes (tray restructure, Health column, Tynn column, PM-Lite reframe).",
  },

  // ----- Aionima collection / PAx (already have inline) -----
  "/aionima": null,
  "/pax": null,

  // ----- Settings family -----
  "/settings": {
    heading: "Settings root",
    kind: "info",
    body: "Sidebar entries: Gateway · Providers · HF · Vault · Security · Scheduled Jobs · plus plugin-defined dynamic settings. Each tab carries its own DevNotes when there's recent work.",
  },
  "/settings/providers": null, // has inline notes from wave 1
  "/settings/gateway": null,   // has inline notes from wave 1
  "/settings/vault": {
    heading: "Vault — TPM2-sealed credential storage",
    kind: "info",
    body: "Backend selected at boot via detectTpm2Available(). Production with TPM2 → SecretsManager. Test VM / dev / CI → FilesystemSecretsBackend. Per-project resolver enforces scope.",
  },
  "/settings/hf": {
    heading: "HuggingFace settings",
    kind: "info",
    body: "Auth token + cache dir + hardware profile. Models surfaced under Settings → Providers → Models tab (cycle 141 consolidation).",
  },
  "/settings/security": {
    heading: "Security settings — UCS compliance controls",
    kind: "info",
    body: "Crypto, MFA, incidents, consent, vendors, sessions, backups. Each control corresponds to a UCS compliance requirement.",
  },
  "/settings/scheduled-jobs": {
    heading: "Scheduled jobs — cron + run-once",
    kind: "info",
    body: "Persisted scheduled work (separate from session-only /loop crons). Each job carries cadence + last-run + next-run.",
  },

  // ----- Knowledge / docs (already has inline) -----
  "/knowledge": null,
  "/docs": {
    heading: "Docs viewer",
    kind: "info",
    body: "Renders docs from agi/docs/{human,agents}/. The s137 universal help system (in progress) will overlay this with chat-aware Support Canvas.",
  },

  // ----- COA / Entity / Reports -----
  "/coa": {
    heading: "COA chain explorer — Chain of Accountability",
    kind: "info",
    body: "Every action signs against an entity chain (#E0.O0.O1). This explorer walks the per-action provenance.",
  },
  "/entity": {
    heading: "Entity detail — #E / #O / $A / $M ids",
    kind: "info",
    body: "PRIME entity model: # = registered (people/orgs/agents); $ = active subjects; ~ prefix = local-only. Edits write to local-id; HIVE-registered entities require Hive-ID.",
  },
  "/reports": {
    heading: "Reports — incident + scan rollup",
    kind: "info",
    body: "Incidents from /api/security/incidents and scans from /api/security/scans. New incidents auto-surface here without a refresh.",
  },
  "/resources": {
    heading: "Resources — what Aion can call out to",
    kind: "info",
    body: "Catalog of MCP servers, plugins, channels, stacks, and external endpoints that contribute to Aion's tool surface.",
  },
  "/services": {
    heading: "Services — agi-* container status",
    kind: "info",
    body: "Per-service health, restart history, log links. agi-* prefix; never aionima-* per memory feedback_agi_prefix_not_aionima.",
  },

  // ----- Logs / prompt inspector / workflows -----
  "/logs": {
    heading: "Gateway logs — tail of agi service",
    kind: "info",
    body: "Live tail of the gateway. Filters: level, component, time-range. For agi-bash audit specifically, see ~/.agi/logs/agi-bash-*.jsonl.",
  },
  "/prompt-inspector": {
    heading: "Prompt inspector — what Aion sees",
    kind: "info",
    body: "Reconstructs the system prompt + tool budget for a given agent invocation. Useful for understanding why a specific provider/model was picked + why tools fired.",
  },
  "/workflows": {
    heading: "Workflows — HF + agent workflows registry",
    kind: "info",
    body: "Plugin-contributed workflow definitions. HF model-fine-tune workflows live here alongside other registered flows.",
  },

  // ----- Plugin/MApp marketplaces -----
  "/marketplace": {
    heading: "Plugin Marketplace",
    kind: "info",
    body: "Always say 'Plugin Marketplace' (not 'Marketplace'). Plugins install to ~/.agi/plugins/cache/ on demand. Source: GitHub, never local.",
  },
  "/hf-marketplace": {
    heading: "HuggingFace Marketplace",
    kind: "info",
    body: "Browse + install local HF models. Discovery + initial download here; lifecycle (start/stop/uninstall) lives in Settings → Providers → Models.",
  },
  "/magic-apps": {
    heading: "MApps — JSON-defined UI + container + agent bundles",
    kind: "info",
    body: "Cycle 124 wired iterative-work updates into Notifications + Toast previews; click a toast to open chat about the related project.",
  },
  "/magic-apps-admin": {
    heading: "MApps admin",
    kind: "info",
    body: "Install / uninstall / publish MApps. Default MApps come from the MApp Marketplace repo, never manually installed.",
  },
  "/mapp-editor": {
    heading: "MApp source editor",
    kind: "info",
    body: "Edit a MApp's JSON definition (UI + container + agent prompts + workflows) before publishing.",
  },

  // ----- Comms (channel adapters) -----
  "/comms": {
    heading: "Comms channels — adapter status",
    kind: "info",
    body: "Telegram, Discord, Signal, Gmail, WhatsApp. Each channel is a plugin-contributed adapter; settings live in their own routes.",
  },
  "/comms/discord": {
    heading: "Discord channel adapter",
    kind: "info",
    body: "Plugin-contributed Discord adapter. Bot token + channel filter live here.",
  },
  "/comms/telegram": {
    heading: "Telegram channel adapter",
    kind: "info",
    body: "Plugin-contributed Telegram adapter. Bot token + chat-id allowlist live here.",
  },
  "/comms/signal": {
    heading: "Signal channel adapter",
    kind: "info",
    body: "Plugin-contributed Signal adapter. Pairing required via the bridge.",
  },
  "/comms/gmail": {
    heading: "Gmail channel adapter",
    kind: "info",
    body: "OAuth flow handled by id.ai.on (per memory feedback_id_owns_identity_not_agi); never re-implement OAuth here.",
  },
  "/comms/whatsapp": {
    heading: "WhatsApp channel adapter",
    kind: "info",
    body: "Plugin-contributed WhatsApp adapter. WhatsApp Business API or pairing flow.",
  },

  // ----- System (admin) -----
  "/admin": {
    heading: "Admin landing — system controls",
    kind: "info",
    body: "Container status, system stats, vendor management, identity service, security incidents.",
  },
  "/system/agents": {
    heading: "System agents — registered $A entities",
    kind: "info",
    body: "Each $A is an agent identity Aion can dispatch to. Includes Aion itself ($A0) plus subagents.",
  },
  "/system/backups": {
    heading: "Database backups — Postgres dumps",
    kind: "info",
    body: "agi_data Postgres backups. Schedule + retention managed here. UCS compliance requirement.",
  },
  "/system/changelog": {
    heading: "System changelog — gateway version history",
    kind: "info",
    body: "Reads from /api/system/changelog. Built from the in-tree CHANGELOG.md per release.",
  },
  "/system/identity": {
    heading: "Identity service — Local-ID per-node OAuth/session broker",
    kind: "info",
    body: "Local-ID lives in aionima-id; Hive-ID is the remote federation hub at id.ai.on. NEVER conflate them.",
  },
  "/system/incidents": {
    heading: "Security incidents",
    kind: "info",
    body: "Auto-detected from gateway anomalies + scan findings. Each incident ties to a UCS compliance category.",
  },
  "/system/security": {
    heading: "System security — gateway hardening status",
    kind: "info",
    body: "TPM2 status, vault backend, sealed credential count, COA verification chain integrity.",
  },
  "/system/vendors": {
    heading: "Vendor management — UCS compliance",
    kind: "info",
    body: "Track third-party vendors + their compliance posture. Required for UCS controls.",
  },

  // ----- Onboarding -----
  "/onboarding": {
    heading: "First-boot onboarding",
    kind: "info",
    body: "Owner profile + AI keys + channels + 0ME interview steps. State at ~/.agi/onboarding-state.json.",
  },
  "/gateway-onboarding": {
    heading: "Gateway onboarding flow",
    kind: "info",
    body: "Pre-config wizard: gateway port, host, base domain, owner identity. Run once; re-runnable from Settings.",
  },
};

/**
 * Resolve the longest-matching prefix in ROUTE_NOTES for a pathname.
 * `/projects/foo/bar` → tries `/projects/foo/bar` first, then `/projects/foo`,
 * then `/projects`, etc. Stops at the first hit (including `null` to suppress).
 */
function resolveRouteNote(pathname: string): RouteNote | null {
  // Exact match first
  if (Object.hasOwn(ROUTE_NOTES, pathname)) {
    return ROUTE_NOTES[pathname] ?? null;
  }
  // Walk parents
  const parts = pathname.split("/").filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = "/" + parts.slice(0, i + 1).join("/");
    if (Object.hasOwn(ROUTE_NOTES, candidate)) {
      return ROUTE_NOTES[candidate] ?? null;
    }
  }
  return ROUTE_NOTES["/"] ?? null;
}

/**
 * Mounted once near the dashboard outlet. Reads location.pathname,
 * resolves the route-note via prefix-match, registers a DevNote.
 *
 * Page-level `<DevNote>` instances embedded inline on individual routes
 * stack onto the same global modal — this just guarantees universal
 * coverage (every route gets at least one default note where applicable).
 */
export function RouteDevNotes() {
  const location = useLocation();
  const note = resolveRouteNote(location.pathname);
  if (!note) return null;
  return (
    <DevNote heading={note.heading} kind={note.kind} scope={location.pathname}>
      {note.body}
    </DevNote>
  );
}
