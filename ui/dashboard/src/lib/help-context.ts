/**
 * resolveHelpContext — map a dashboard route to a human-readable context
 * string for the help-mode chat agent (s137 t530).
 *
 * The help button passes this string (prefixed with "help:") into the chat
 * context so Aion knows what page the user is looking at without us having
 * to hard-code per-page help strings. Dynamic segments (e.g. `:slug`,
 * `:id`) are flattened so the help agent gets a stable context.
 *
 * Pure function — no React imports, no DOM access. Unit-testable on host.
 */

const STATIC_ROUTES: Record<string, string> = {
  "/": "dashboard overview",
  "/dashboard": "dashboard overview",
  "/overview": "dashboard overview",
  "/projects": "projects browser",
  "/marketplace": "Plugin Marketplace catalog",
  "/marketplace/plugins": "Plugin Marketplace catalog",
  "/mapp-marketplace": "MApp Marketplace catalog",
  "/marketplace/mapps": "MApp Marketplace catalog",
  "/aionima": "Aionima self-managed project (redirects to /projects/_aionima)",
  "/pax": "PAx primitives — now repos under _aionima (redirects to /projects/_aionima)",
  "/issues": "agent-curated issue registry (system-aggregate view; per-project k/issues/)",
  "/comms": "comms (channels) overview",
  "/workflows": "workflow definitions",
  "/logs": "logs viewer",
  "/onboarding": "gateway onboarding",
  "/notifications": "notifications inbox",
  "/skills": "skills catalog",
  "/knowledge": "knowledge namespaces",
  "/docs": "documentation reader",
  "/coa": "Chain of Accountability ledger",
  "/sandbox": "sandbox (experimentation surface)",
  "/incidents": "incidents log",
  "/system/services": "system services + circuit breakers",
  "/system/agents": "system agents",
  "/system/incidents": "system incidents",
  "/system/identity": "identity + federation",
  "/system/changelog": "changelog",
  "/system/security": "security posture",
  "/system/backups": "backup status",
  "/system/vendors": "vendor registry",
  "/settings": "settings overview",
  "/settings/gateway": "gateway settings",
  "/settings/providers": "providers + models management",
  "/settings/scheduled-jobs": "scheduled jobs",
  "/settings/themes": "theme settings",
  "/settings/user": "user settings",
  "/admin": "admin dashboard",
  "/admin/dashboard": "admin dashboard",
  "/prompt-inspector": "prompt inspector (Aion's prompt assembly)",
};

/**
 * Pattern-based routes — checked in order. First match wins. Dynamic
 * segments are flattened to readable strings via the label function.
 */
const PATTERN_ROUTES: Array<{ regex: RegExp; label: (m: RegExpMatchArray) => string }> = [
  // /projects/<slug or path>
  { regex: /^\/projects\/([^/]+)$/, label: (m) => `workspace for project "${decodeURIComponent(m[1] ?? "")}"` },
  { regex: /^\/projects\/([^/]+)\/(.+)$/, label: (m) => `${decodeURIComponent(m[2] ?? "")} tab in workspace "${decodeURIComponent(m[1] ?? "")}"` },
  { regex: /^\/marketplace\/plugins\/([^/]+)$/, label: (m) => `plugin "${decodeURIComponent(m[1] ?? "")}" detail` },
  { regex: /^\/marketplace\/mapps\/([^/]+)$/, label: (m) => `MApp "${decodeURIComponent(m[1] ?? "")}" detail` },
  { regex: /^\/mapp-editor\/([^/]+)$/, label: (m) => `MApp editor for "${decodeURIComponent(m[1] ?? "")}"` },
  { regex: /^\/entity\/([^/]+)$/, label: (m) => `entity "${decodeURIComponent(m[1] ?? "")}" detail` },
  { regex: /^\/comms\/([^/]+)$/, label: (m) => `comms — ${decodeURIComponent(m[1] ?? "")} channel` },
  { regex: /^\/knowledge\/([^/]+)$/, label: (m) => `knowledge namespace "${decodeURIComponent(m[1] ?? "")}"` },
  { regex: /^\/docs\/(.+)$/, label: (m) => `docs reader: ${decodeURIComponent(m[1] ?? "")}` },
];

/**
 * Map a pathname to a help-context string. Falls back to `unknown route
 * <pathname>` so the help agent always gets something rather than nothing.
 */
export function resolveHelpContext(pathname: string): string {
  if (typeof pathname !== "string" || pathname.length === 0) return "unknown route";
  // Trim trailing slashes for normalization (except for "/").
  const normalized = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  if (normalized in STATIC_ROUTES) return STATIC_ROUTES[normalized] as string;
  for (const entry of PATTERN_ROUTES) {
    const m = normalized.match(entry.regex);
    if (m) return entry.label(m);
  }
  return `unknown route ${normalized}`;
}
