/**
 * HostingManager — manages local network project hosting via Caddy + dnsmasq + Podman.
 *
 * Responsibilities:
 *   - Infrastructure health check (Caddy, dnsmasq, Podman)
 *   - Caddyfile generation from hosted projects -> `sudo caddy reload`
 *   - Podman container lifecycle (rootless containers per project type)
 *   - Port pool allocation (configurable range, default 4000-4099)
 *   - Status polling for container health
 *   - On startup: load all ~/.agi/{slug}/project.json with hosting.enabled, start containers
 *   - On shutdown: stop all containers, clear polling
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, resolve as resolvePath, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync, execFileSync, spawnSync, spawn, type ChildProcess } from "node:child_process";
import { createComponentLogger } from "./logger.js";
import { projectConfigPath, projectSlug } from "./project-config-path.js";
import type { Logger, ComponentLogger } from "./logger.js";
import type { ProjectTypeRegistry } from "./project-types.js";
import type { PluginRegistry } from "@agi/plugins";
import type { StackRegistry } from "./stack-registry.js";
import type { SharedContainerManager } from "./shared-container-manager.js";
import type { ProjectStackInstance, StackContainerContext, StackDefinition, StackContainerConfig } from "./stack-types.js";
import type { ProjectConfigManager } from "./project-config-manager.js";
import type { MagicAppContainerConfig, MagicAppContainerContext } from "./magic-app-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escape codes from command output for clean dashboard display. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07/g;
function stripAnsi(text: string): string { return text.replace(ANSI_RE, ""); }

/**
 * Container start-command source — which tier of the precedence ladder
 * produced the command tokens passed to `podman run`.
 *
 * Order of precedence (highest first):
 *   override      — user's `meta.startCommand` (authoritative when set).
 *   stack         — stack plugin's `command(ctx)` callback.
 *   devCommands   — stack plugin's `devCommands.dev` / `.start`, mode-aware.
 *   image-default — no tokens; the container image's default CMD runs.
 */
export type StartCommandSource = "override" | "stack" | "devCommands" | "image-default";

export interface ResolvedStartCommand {
  tokens: string[] | null;
  source: StartCommandSource;
  sourceLabel: string;
}

/**
 * Resolve the start command for a container from the precedence ladder.
 * Pure function — no I/O, no side effects. Exported for unit tests.
 *
 * The user's `userStartCommand` wins over everything else when set (trimmed,
 * non-empty). This is how the dashboard's "Start Command" field actually
 * takes effect — the stack-based container path previously only read
 * `stackCommand` and `devCommands`, silently ignoring the user's override.
 */
/**
 * Pure Caddyfile content builder. Takes current config + plugin + project state
 * and returns the file body. Preserves the CUSTOM block from an existing
 * Caddyfile if provided; always regenerates the SYSTEM block from scratch so
 * new directives (header strips, port changes) land on existing installs.
 */
export interface BuildCaddyfileOptions {
  baseDomain: string;
  domainAliases?: string[];
  /**
   * Port the AGI gateway listens on. Reached via `host.containers.internal`
   * from within the aionima network (where Caddy now lives), since the
   * gateway itself stays on the host.
   */
  gatewayPort: number;
  /**
   * WhoDB shares the aionima network — Caddy reaches it by container DNS
   * (`agi-whodb:8080`). `whodbPort` is the CONTAINER-INTERNAL port (8080),
   * not a host port. `whodbContainerName` defaults to `agi-whodb`.
   */
  whodbPort?: number;
  whodbContainerName?: string;
  /**
   * Local-ID runs on the aionima network as `agi-local-id`. `port` is the
   * container-internal listen port. `containerName` overrides the default
   * when the unit uses a non-default name.
   */
  idService?: {
    enabled?: boolean;
    subdomain?: string;
    port?: number;
    containerName?: string;
  };
  /**
   * Subdomain routes declared by plugins. `target` is a container-internal
   * port when `containerName` is provided (aionima DNS route); falls back
   * to `host.containers.internal:<target>` when only a port is given, or
   * the gateway for `target === "gateway"`.
   */
  pluginSubdomainRoutes: Array<{
    subdomain: string;
    target: number | "gateway";
    containerName?: string;
  }>;
  /**
   * Per-project hosting. `containerName` + `internalPort` are what Caddy
   * uses now that it lives on aionima. `port` is retained as a nullable
   * legacy field; when non-null and `containerName` is absent, Caddy falls
   * back to `host.containers.internal:${port}` so half-migrated installs
   * still serve.
   */
  projects: Array<{
    hostname: string;
    port?: number | null;
    containerName?: string | null;
    internalPort?: number | null;
    name?: string;
  }>;
  existingCaddyfile: string;
}

/**
 * Analyze a Caddyfile custom block for stale `localhost:` upstreams. After
 * story #100, Caddy runs inside a rootless container on the aionima network;
 * `localhost` inside that container resolves to the container itself, so any
 * user-written `reverse_proxy localhost:<port>` line in the CUSTOM block
 * silently breaks after the migration. This function flags those lines so
 * HostingManager can surface a warning to the log / dashboard.
 *
 * Returns an array of warnings; each entry is the stale directive line
 * (trimmed) so the operator can find it in their CUSTOM block.
 */
export function findStaleCustomUpstreams(customBlock: string): string[] {
  if (!customBlock) return [];
  const warnings: string[] = [];
  for (const rawLine of customBlock.split("\n")) {
    const line = rawLine.trim();
    // Match `reverse_proxy localhost:<num>` or `reverse_proxy 127.0.0.1:<num>`
    // — either form now means "the Caddy container itself" (wrong), not "the
    // host" (what the user probably intended).
    if (/^reverse_proxy\s+(localhost|127\.0\.0\.1):\d+\b/.test(line)) {
      warnings.push(line);
    }
  }
  return warnings;
}

export function buildCaddyfileContent(opts: BuildCaddyfileOptions): string {
  const SYSTEM_BEGIN = "# === SYSTEM DOMAINS ===";
  const SYSTEM_END = "# === END SYSTEM DOMAINS ===";
  const PROJECTS_BEGIN = "# === PROJECT DOMAINS ===";
  const PROJECTS_END = "# === END PROJECT DOMAINS ===";
  const CUSTOM_BEGIN = "# --- BEGIN CUSTOM ---";
  const CUSTOM_END = "# --- END CUSTOM ---";

  // Caddy's `tls internal` defaults to ~12h cert lifetime. Owner directive
  // 2026-04-29 cycle 124: bump local-CA cert lifetime to 7 days for less
  // renewal churn during long-running development sessions. Caddy auto-renews
  // when ~1/3 lifetime remains (~5 days post-issue) and on every reload —
  // natural cadence accepted; no daily-reload timer needed.
  const TLS_INTERNAL = `tls internal { lifetime 168h }`;

  // Extract the user-editable CUSTOM block from the existing Caddyfile.
  let customBlock = "";
  if (opts.existingCaddyfile) {
    const customBeginIdx = opts.existingCaddyfile.indexOf(CUSTOM_BEGIN);
    const customEndIdx = opts.existingCaddyfile.indexOf(CUSTOM_END);
    if (customBeginIdx !== -1 && customEndIdx !== -1) {
      customBlock = opts.existingCaddyfile.slice(customBeginIdx, customEndIdx + CUSTOM_END.length);
    }
  }

  const blocks: string[] = [];
  blocks.push("# aionima hosting — auto-generated by HostingManager");
  blocks.push("# Do not edit manually (except between CUSTOM markers).");
  blocks.push("");
  // Global options. Story #100 follow-up: after Caddy moved into a
  // rootless container on aionima, HTTP/2 WebSocket upgrades over the
  // container→host proxy hop stopped translating cleanly to the
  // upstream's HTTP/1.1 WS handshake. Browsers that negotiate h2 via
  // ALPN then hang on wss://ai.on/ws, which cascades into a broken
  // dashboard (status stream fails → ID badge red, chat can't start,
  // polling fallback gets slow). Restrict the Caddy container to
  // HTTP/1.1 — browsers ALPN-negotiate h1 and every websocket
  // upgrade goes through cleanly. Trade-off is mild loss of h2 request
  // multiplexing, negligible for a single-user dashboard.
  blocks.push("{");
  blocks.push("    servers {");
  blocks.push("        protocols h1");
  blocks.push("    }");
  blocks.push("}");
  blocks.push("");

  // ---- System domains section ----
  blocks.push(SYSTEM_BEGIN);
  blocks.push("");

  // Caddy now lives in a rootless container on the aionima podman network
  // (story #100). Every upstream is either a container DNS name on that
  // network OR `host.containers.internal` when we need to reach the host.
  // Gateway stays on the host; all other services are reached by podman DNS.
  const gw = `host.containers.internal:${String(opts.gatewayPort)}`;

  // Gateway (dashboard) — reached by Caddy-on-aionima via the host bridge.
  const gatewayDomains = [opts.baseDomain, ...(opts.domainAliases ?? [])].join(", ");
  blocks.push(`${gatewayDomains} {`);
  blocks.push(`    ${TLS_INTERNAL}`);
  blocks.push(`    reverse_proxy ${gw}`);
  blocks.push(`}\n`);

  // WhoDB database explorer — always-on infrastructure at db.{baseDomain}.
  // Resolved via aionima DNS (`agi-whodb:8080`), not a host port. WhoDB sets
  // `X-Frame-Options: deny` and may set `Content-Security-Policy` with a
  // restrictive `frame-ancestors` directive; both block the dashboard's
  // WhoDB iframe. Strip them at the proxy so the dashboard can embed WhoDB
  // while keeping it accessible standalone at https://db.{baseDomain}.
  const whodbContainer = opts.whodbContainerName ?? "agi-whodb";
  const whodbInternalPort = opts.whodbPort ?? 8080;
  const whodbFrameOrigins = [opts.baseDomain, ...(opts.domainAliases ?? [])]
    .map((d) => `https://${d} https://*.${d}`)
    .join(" ");
  blocks.push(`db.${opts.baseDomain} {`);
  blocks.push(`    ${TLS_INTERNAL}`);
  blocks.push(`    header -X-Frame-Options`);
  blocks.push(`    header -Content-Security-Policy`);
  blocks.push(`    header Content-Security-Policy "frame-ancestors 'self' ${whodbFrameOrigins}"`);
  blocks.push(`    reverse_proxy ${whodbContainer}:${String(whodbInternalPort)}`);
  blocks.push(`}\n`);

  // Local ID service — when enabled, reverse-proxy id.{baseDomain} to the
  // ID container on aionima. No host port binding; only AGI binds host ports.
  if (opts.idService?.enabled) {
    const idSubdomain = opts.idService.subdomain ?? "id";
    const idContainer = opts.idService.containerName ?? "agi-local-id";
    const idInternalPort = opts.idService.port ?? 3200;
    blocks.push(`${idSubdomain}.${opts.baseDomain} {`);
    blocks.push(`    ${TLS_INTERNAL}`);
    blocks.push(`    reverse_proxy ${idContainer}:${String(idInternalPort)}`);
    blocks.push(`}\n`);
  }

  // Plugin-registered subdomain routes. When the route declares a
  // containerName, Caddy resolves it on aionima; otherwise (legacy route
  // with only a port) we fall back to host.containers.internal so pre-
  // migration plugins still serve through Caddy while they migrate.
  for (const route of opts.pluginSubdomainRoutes) {
    const fqdn = `${route.subdomain}.${opts.baseDomain}`;
    let target: string;
    if (route.target === "gateway") {
      target = gw;
    } else if (route.containerName) {
      target = `${route.containerName}:${String(route.target)}`;
    } else {
      target = `host.containers.internal:${String(route.target)}`;
    }
    blocks.push(`${fqdn} {`);
    blocks.push(`    ${TLS_INTERNAL}`);
    blocks.push(`    reverse_proxy ${target}`);
    blocks.push(`}\n`);
  }

  // Custom block (e.g. papa.ai.on) — preserved from existing Caddyfile, or
  // emitted as empty markers if no prior file existed.
  if (customBlock) {
    blocks.push(customBlock);
  } else {
    blocks.push(CUSTOM_BEGIN);
    blocks.push(CUSTOM_END);
  }

  blocks.push("");
  blocks.push(SYSTEM_END);

  blocks.push("");

  // ---- Project domains section ----
  blocks.push(PROJECTS_BEGIN);
  blocks.push("");

  for (const project of opts.projects) {
    const fqdn = `${project.hostname}.${opts.baseDomain}`;
    // Project name for display in the offline page — use provided name, or
    // derive a human-readable label from the hostname slug (e.g. "my-app" → "my-app").
    const displayName = (project.name ?? project.hostname).replace(/[^\w\s-]/g, "");
    const dashboardUrl = `https://${opts.baseDomain}/projects`;
    // Compact single-line HTML body — no quotes or braces in the string to avoid
    // Caddyfile parsing conflicts. We use single-backtick heredoc-style with
    // Caddy's `respond` directive which accepts a body as the first argument.
    const offlineHtml = [
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">`,
      `<meta name="viewport" content="width=device-width,initial-scale=1">`,
      `<title>${displayName} - Container Offline</title>`,
      `<style>*{box-sizing:border-box;margin:0;padding:0}`,
      `body{background:#0f1117;color:#e4e4e7;font-family:system-ui,sans-serif;`,
      `display:flex;align-items:center;justify-content:center;min-height:100vh}`,
      `.card{background:#1a1b23;border:1px solid #27272a;border-radius:12px;`,
      `padding:48px;max-width:480px;width:100%;text-align:center;margin:24px}`,
      `.dot{display:inline-block;width:8px;height:8px;border-radius:50%;`,
      `background:#f59e0b;margin-right:8px;vertical-align:middle}`,
      `h1{font-size:20px;font-weight:600;margin-bottom:12px}`,
      `.sub{color:#a1a1aa;font-size:14px;line-height:1.6;margin-bottom:24px}`,
      `.name{color:#e4e4e7;font-weight:500}`,
      `.btn{display:inline-block;background:#3f3f46;color:#e4e4e7;`,
      `text-decoration:none;padding:8px 20px;border-radius:6px;font-size:13px}`,
      `.hint{color:#71717a;font-size:12px;margin-top:16px}</style></head>`,
      `<body><div class="card"><h1><span class="dot"></span>Container not running</h1>`,
      `<p class="sub">The project <span class="name">${displayName}</span>`,
      ` is currently offline. Its container may have stopped or failed to start.</p>`,
      `<a class="btn" href="${dashboardUrl}">View in dashboard</a>`,
      `<p class="hint">Start the container from Projects to restore access.</p>`,
      `</div></body></html>`,
    ].join("");

    // Caddy-on-aionima reaches the project container by podman DNS name
    // (`agi-<hostname>:<internalPort>`). Fall back to `host.containers.internal`
    // when a project hasn't been re-launched yet after migration — that path
    // still reaches the container's old host-port binding if present.
    let projectUpstream: string;
    if (project.containerName && project.internalPort) {
      projectUpstream = `${project.containerName}:${String(project.internalPort)}`;
    } else if (project.port) {
      projectUpstream = `host.containers.internal:${String(project.port)}`;
    } else {
      // No route available (project has no container yet). Emit a placeholder
      // host.containers.internal line so the 5xx handler shows the offline
      // page; this matches legacy behavior.
      projectUpstream = `host.containers.internal:${String(project.port ?? 0)}`;
    }
    blocks.push(`${fqdn} {`);
    blocks.push(`    ${TLS_INTERNAL}`);
    blocks.push(`    reverse_proxy ${projectUpstream}`);
    // `handle_errors <status_codes...>` (filter form) needs Caddy 2.8+.
    // Plenty of deployments are still on 2.6.x which rejects that syntax
    // with "Wrong argument count or unexpected line ending after '502'"
    // and fails the whole reload. Use the expression-matcher form that
    // works on 2.6 through 2.8 uniformly — still limits the offline
    // page to 5xx responses so legitimate 4xx from the backend (403,
    // 404, etc.) aren't hidden behind a "container not running" page.
    blocks.push(`    handle_errors {`);
    blocks.push(`        @5xx expression \`{http.error.status_code} >= 500\``);
    blocks.push(`        handle @5xx {`);
    // `respond` defaults to text/plain, which renders the offline HTML
    // as raw source in browsers (cycle-122 owner-reported bug). Set
    // Content-Type explicitly so the styled card renders.
    blocks.push(`            header Content-Type "text/html; charset=utf-8"`);
    blocks.push(`            respond \`${offlineHtml}\` 503`);
    blocks.push(`        }`);
    blocks.push(`    }`);
    blocks.push(`}\n`);
  }

  blocks.push(PROJECTS_END);
  blocks.push("");

  return blocks.join("\n");
}

export function resolveContainerStartCommand(params: {
  userStartCommand?: string | null | undefined;
  stackCommand?: string[] | null;
  stackId?: string | undefined;
  devCommands?: { dev?: string; start?: string } | undefined;
  mode: "development" | "production";
}): ResolvedStartCommand {
  // 1. User override — wins over anything.
  if (typeof params.userStartCommand === "string") {
    const trimmed = params.userStartCommand.trim();
    if (trimmed.length > 0) {
      return {
        tokens: ["sh", "-c", trimmed],
        source: "override",
        sourceLabel: "override (user meta.startCommand)",
      };
    }
  }
  // 2. Stack's command() callback.
  if (params.stackCommand && params.stackCommand.length > 0) {
    return {
      tokens: params.stackCommand,
      source: "stack",
      sourceLabel: `stack (${params.stackId ?? "unknown"}.command)`,
    };
  }
  // 3. Stack's devCommands, mode-aware.
  if (params.devCommands) {
    const key = params.mode === "development" ? "dev" : "start";
    const cmd = params.devCommands[key];
    if (cmd) {
      return {
        tokens: ["sh", "-c", cmd],
        source: "devCommands",
        sourceLabel: `devCommands.${key} (${params.stackId ?? "unknown"})`,
      };
    }
  }
  // 4. Fall through — image's default CMD runs.
  return { tokens: null, source: "image-default", sourceLabel: "image default CMD" };
}

/**
 * Phase 1 container resilience wrapper.
 *
 * Wraps a command token array so the container's PID 1 outlives the user's
 * start command. Returns `null` when `cmdTokens` is null/undefined so the
 * caller can fall back to the image's default CMD (e.g. nginx for static
 * sites, apache for PHP) — those are typically benign and don't need a
 * shell supervisor.
 *
 * Exported for unit tests.
 */
export function wrapResilientCmd(cmdTokens: string[] | null | undefined): string[] | null {
  if (!cmdTokens || cmdTokens.length === 0) return null;
  const aliveMsg = "[aionima] start command exited; container remains alive for development";
  // Normalize `sh -c <cmd>` shape; otherwise shell-escape each token.
  let cmdStr: string;
  if (cmdTokens.length === 3 && cmdTokens[0] === "sh" && cmdTokens[1] === "-c") {
    cmdStr = cmdTokens[2]!;
  } else {
    cmdStr = cmdTokens.map((t) => `'${t.replace(/'/g, "'\\''")}'`).join(" ");
  }
  // `(cmd) || true` swallows non-zero exits so the shell continues.
  // `exec sleep infinity` replaces PID 1 so the container survives forever.
  return ["sh", "-c", `(${cmdStr}) || true; echo '${aliveMsg}'; exec sleep infinity`];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallActionResult {
  actionId: string;
  ok: boolean;
  output?: string;
  error?: string;
}

export interface DetectedProjectConfig {
  projectType: string;
  suggestedStacks: string[];
  docRoot: string;
  startCommand: string | null;
}

export interface HostingConfig {
  enabled: boolean;
  lanIp: string;
  baseDomain: string;
  /** Extra domain names that should also reverse-proxy to the gateway. */
  domainAliases?: string[];
  gatewayPort: number;
  portRangeStart: number;
  containerRuntime: "podman";
  statusPollIntervalMs: number;
  /** Default tunnel mode: "quick" (ephemeral URL) or "named" (persistent URL). */
  tunnelMode?: "quick" | "named";
  /** Cloudflare-managed domain for named tunnels. Named tunnels create DNS as <project>.<tunnelDomain>. */
  tunnelDomain?: string;
  /** Local ID service config — when enabled, generates a Caddy entry for id.{baseDomain}. */
  idService?: {
    enabled: boolean;
    port: number;
    subdomain: string;
  };
  /** WhoDB database explorer port (default: 5050). Always-on infrastructure. */
  whodbPort?: number;
}

export interface ProjectHostingMeta {
  enabled: boolean;
  type: string;
  hostname: string;
  docRoot: string | null;
  startCommand: string | null;
  port: number | null;
  mode: "production" | "development";
  internalPort: number | null;
  runtimeId?: string | null;
  tunnelUrl?: string | null;
  /** Named tunnel ID (persisted, survives restarts with same URL). */
  tunnelId?: string | null;
  /** MagicApp ID used as the content viewer for this project's *.ai.on URL. */
  viewer?: string | null;
}

export interface HostedProject {
  path: string;
  meta: ProjectHostingMeta;
  containerId: string | null;
  containerName: string | null;
  status: "running" | "stopped" | "error" | "unconfigured";
  error?: string;
  tunnelPid: number | null;
  tunnelUrl: string | null;
}

export interface InfraStatus {
  ready: boolean;
  caddy: { installed: boolean; running: boolean };
  dnsmasq: { installed: boolean; running: boolean; configured: boolean };
  podman: { installed: boolean; rootless: boolean };
}

export interface HostingManagerDeps {
  config: HostingConfig;
  workspaceProjects: string[];
  projectTypeRegistry?: ProjectTypeRegistry;
  pluginRegistry?: PluginRegistry;
  stackRegistry?: StackRegistry;
  sharedContainerManager?: SharedContainerManager;
  projectConfigManager?: ProjectConfigManager;
  mappRegistry?: import("./mapp-registry.js").MAppRegistry;
  logger?: Logger;
}

/**
 * Optional late-bound references to HuggingFace model runtime deps.
 * Set via setModelDeps() after model runtime is initialized (Step 5i),
 * since the HostingManager is created before Step 5i runs.
 */
export interface HostingManagerModelDeps {
  modelStore: { getById(id: string): Promise<{ status: string; containerPort?: number } | undefined> };
  modelContainerManager: { getStatus(modelId: string): { port: number; status: string } | undefined };
}

// ---------------------------------------------------------------------------
// Container image and port constants
// @deprecated — Legacy fallback for un-migrated projects. Container config
// now lives in StackDefinition.containerConfig (registered by stack plugins).
// Will be removed once all existing projects have migrated to stack-based hosting.
// ---------------------------------------------------------------------------

const CONTAINER_IMAGES: Record<string, string> = {
  static: "nginx:alpine",
  php: "ghcr.io/civicognita/php-apache:8.4",
  node: "ghcr.io/civicognita/node:22",
  laravel: "ghcr.io/civicognita/php-apache:8.4",
  nextjs: "ghcr.io/civicognita/node:22",
  "web-app": "ghcr.io/civicognita/node:22",
  "api-service": "ghcr.io/civicognita/node:22",
  nuxt: "ghcr.io/civicognita/node:22",
  "react-vite": "nginx:alpine",
  // Python / Go / Rust
  python: "ghcr.io/civicognita/python:3.12",
  django: "ghcr.io/civicognita/python:3.12",
  fastapi: "ghcr.io/civicognita/python:3.12",
  flask: "ghcr.io/civicognita/python:3.12",
  go: "ghcr.io/civicognita/go:1.24",
  rust: "ghcr.io/civicognita/rust:1.87",
  // Non-dev project types — serve static files via nginx when no MApp viewer is configured
  writing: "nginx:alpine",
  art: "nginx:alpine",
  "static-site": "nginx:alpine",
};

const CONTAINER_INTERNAL_PORTS: Record<string, number> = {
  static: 80,
  php: 80,
  node: 3000,
  laravel: 80,
  nextjs: 3000,
  nuxt: 3000,
  "react-vite": 80,
  python: 8000,
  django: 8000,
  fastapi: 8000,
  flask: 8000,
  go: 8080,
  rust: 8080,
  writing: 80,
  art: 80,
  "static-site": 80,
};

const PORT_POOL_SIZE = 100;

/**
 * Migration map: old framework-based project types → broad project types + corresponding stacks.
 * Used during initialize() to auto-migrate existing projects to the new model.
 */
const MIGRATION_MAP: Record<string, { newType: string; autoStack: string }> = {
  laravel:      { newType: "web-app",      autoStack: "stack-laravel" },
  nextjs:       { newType: "web-app",      autoStack: "stack-nextjs" },
  nuxt:         { newType: "web-app",      autoStack: "stack-nuxt" },
  node:         { newType: "api-service",  autoStack: "stack-node-app" },
  php:          { newType: "web-app",      autoStack: "stack-php-app" },
  "react-vite": { newType: "web-app",      autoStack: "stack-react-vite" },
  static:       { newType: "static-site",  autoStack: "stack-static-hosting" },
};

// ---------------------------------------------------------------------------
// HostingManager
// ---------------------------------------------------------------------------

export class HostingManager {
  private readonly config: HostingConfig;
  private readonly workspaceProjects: string[];
  private readonly log: ComponentLogger;
  private readonly projects = new Map<string, HostedProject>();
  private readonly allocatedPorts = new Set<number>();
  /** Running containers discovered on startup — used to reconnect instead of recreating. */
  private _runningContainers = new Map<string, { name: string; image: string; state: string }>();
  private readonly registry: ProjectTypeRegistry | null;
  private readonly pluginReg: PluginRegistry | null;
  private readonly stackReg: StackRegistry | null;
  private readonly sharedContainers: SharedContainerManager | null;
  private readonly configMgr: ProjectConfigManager | null;
  private readonly mappReg: import("./mapp-registry.js").MAppRegistry | null;
  private readonly tunnelProcesses = new Map<string, ChildProcess>();
  private readonly tunnelMode: "quick" | "named";
  private readonly tunnelDomain: string | undefined;
  private loginProcess: ChildProcess | null = null;
  private onStatusChange: (() => void) | null = null;
  private statusPollTimer: ReturnType<typeof setInterval> | null = null;
  private eventsProcess: ChildProcess | null = null;
  /** HuggingFace model runtime deps — set via setModelDeps() after Step 5i. */
  private modelDeps: HostingManagerModelDeps | null = null;

  constructor(deps: HostingManagerDeps) {
    this.config = deps.config;
    this.tunnelMode = deps.config.tunnelMode ?? "named";
    this.tunnelDomain = deps.config.tunnelDomain;
    this.workspaceProjects = deps.workspaceProjects;
    this.registry = deps.projectTypeRegistry ?? null;
    this.pluginReg = deps.pluginRegistry ?? null;
    this.stackReg = deps.stackRegistry ?? null;
    this.sharedContainers = deps.sharedContainerManager ?? null;
    this.configMgr = deps.projectConfigManager ?? null;
    this.mappReg = deps.mappRegistry ?? null;
    this.log = createComponentLogger(deps.logger, "hosting");
  }

  /**
   * Wire up HuggingFace model runtime deps.
   * Called from server.ts after Step 5i creates ModelStore + ModelContainerManager.
   * Uses optional chaining throughout so projects without aiModels are unaffected.
   */
  setModelDeps(deps: HostingManagerModelDeps): void {
    this.modelDeps = deps;
  }

  /** Expose the project type registry. */
  getProjectTypeRegistry(): ProjectTypeRegistry | null {
    return this.registry;
  }

  /** Expose the stack registry for tool lookups. */
  getStackRegistry(): StackRegistry | null {
    return this.stackReg;
  }

  /** Expose hosting config for API routes. */
  getConfig(): HostingConfig {
    return this.config;
  }

  /** Register a callback for status changes (used by dashboard broadcaster). */
  setOnStatusChange(cb: () => void): void {
    this.onStatusChange = cb;
  }

  // -------------------------------------------------------------------------
  // Early boot — write system domains to Caddyfile + reload
  // Called before full initialization so the dashboard reverse proxy is
  // available immediately after restart (project domains come later).
  // -------------------------------------------------------------------------

  regenerateSystemDomains(): void {
    if (!this.config.enabled) return;
    if (!this.isCaddyInstalled() || !this.isCaddyRunning()) {
      this.log.warn("caddy not available — skipping early system domain setup");
      return;
    }
    // Delegate to the full regenerate — it already handles the system/project
    // split via section markers. At this point no projects are loaded, so the
    // PROJECT DOMAINS section will be empty, which is fine.
    this.regenerateCaddyfile();
    this.log.info("system domains configured (early boot)");

    // Ensure the Caddy root CA is in the system trust store.
    // `caddy trust` is idempotent — it's a no-op if already installed.
    // This covers first boot after hosting-setup.sh and CA regeneration.
    this.ensureCaddyCATrusted();
  }

  /**
   * Install the Caddy internal root CA into the system trust store.
   * Required for `tls internal` certs to be trusted by browsers and curl.
   * Idempotent — Caddy skips the install if the CA is already trusted.
   */
  private ensureCaddyCATrusted(): void {
    try {
      execSync("sudo caddy trust 2>&1", { stdio: "pipe", timeout: 15_000 });
      this.log.info("Caddy root CA verified in system trust store");
    } catch (err) {
      this.log.warn(`failed to install Caddy CA: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Infrastructure checks
  // -------------------------------------------------------------------------

  checkInfrastructure(): InfraStatus {
    const caddy = {
      installed: this.isCaddyInstalled(),
      running: this.isCaddyRunning(),
    };
    const dnsmasq = {
      installed: this.isDnsmasqInstalled(),
      running: this.isDnsmasqRunning(),
      configured: existsSync("/etc/dnsmasq.d/ai-on.conf"),
    };
    const podman = {
      installed: this.isPodmanInstalled(),
      rootless: this.isPodmanRootless(),
    };
    return {
      ready: caddy.installed && caddy.running && dnsmasq.installed && dnsmasq.running && dnsmasq.configured && podman.installed,
      caddy,
      dnsmasq,
      podman,
    };
  }

  private isCaddyInstalled(): boolean {
    // Post Story #100, Caddy runs as the rootless `agi-caddy` podman container
    // (user-scope systemd unit). The legacy `which caddy` check only finds an
    // apt-installed binary on the host, which is typically absent after the
    // containerization. Treat a known agi-caddy container as "installed" too.
    try {
      const containerCheck = execSync("podman container exists agi-caddy", { stdio: "pipe", timeout: 5000 });
      // `container exists` exits 0 if present, non-zero otherwise (caught below)
      if (containerCheck !== undefined) return true;
    } catch {
      // Fall through to the apt-binary check
    }
    try {
      execSync("which caddy", { stdio: "pipe", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private isCaddyRunning(): boolean {
    // Prefer the containerized agi-caddy status; fall back to the system-scope
    // systemd caddy.service for pre-#100 installs. The user-scope agi-caddy
    // unit isn't reachable from `systemctl is-active` (that hits system scope)
    // so we check podman directly.
    try {
      const status = execSync(
        "podman ps --filter name=^agi-caddy$ --format '{{.Status}}'",
        { stdio: "pipe", timeout: 5000 },
      ).toString().trim();
      if (status.startsWith("Up")) return true;
    } catch {
      // Fall through to the legacy systemd check
    }
    try {
      const result = execSync("systemctl is-active caddy", { stdio: "pipe", timeout: 5000 }).toString().trim();
      return result === "active";
    } catch {
      return false;
    }
  }

  private isDnsmasqInstalled(): boolean {
    try {
      // Check for the dnsmasq package (not just dnsmasq-base which lacks the systemd service)
      const result = execSync("dpkg -l dnsmasq 2>/dev/null | grep -c '^ii'", { stdio: "pipe", timeout: 5000 }).toString().trim();
      return result === "1";
    } catch {
      return false;
    }
  }

  private isDnsmasqRunning(): boolean {
    try {
      const result = execSync("systemctl is-active dnsmasq", { stdio: "pipe", timeout: 5000 }).toString().trim();
      return result === "active";
    } catch {
      return false;
    }
  }

  private isPodmanInstalled(): boolean {
    try {
      execSync("which podman", { stdio: "pipe", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private isPodmanRootless(): boolean {
    try {
      const result = execFileSync("podman", ["info", "--format", "{{.Host.Security.Rootless}}"], {
        stdio: "pipe",
        timeout: 10_000,
      }).toString().trim();
      return result === "true";
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Initialization (called during gateway startup)
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      this.log.info("hosting disabled in config");
      return;
    }

    const infra = this.checkInfrastructure();
    if (!infra.ready) {
      this.log.warn("hosting infrastructure not ready — skipping auto-start");
      return;
    }

    // Ensure WhoDB is running (always-on infrastructure)
    this.ensureWhoDB();

    // Self-heal stale Caddyfiles on boot. If an install predates the WhoDB
    // migration, the on-disk Caddyfile may still have db.{baseDomain} proxying
    // the gateway instead of the WhoDB container — that causes the redirect
    // loop seen in the dashboard iframe. Regenerating on startup ensures the
    // db block always points at port 5050 on fresh boots.
    try {
      this.regenerateCaddyfile();
    } catch (err) {
      this.log.warn(`boot-time Caddyfile regenerate failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Discover running containers from prior gateway run — reconnect instead of recreating.
    // Containers persist across gateway restarts; only replaced when their image changes.
    const runningContainers = new Map<string, { name: string; image: string; state: string }>();
    try {
      const out = execFileSync("podman", [
        "ps", "-a", "--filter", "label=agi.managed=true",
        "--format", "{{.Names}}|{{.Image}}|{{.State}}|{{.Labels}}",
      ], { stdio: "pipe", timeout: 15_000 }).toString().trim();
      if (out.length > 0) {
        for (const line of out.split("\n")) {
          const [name, image, state, labels] = line.split("|");
          if (!name || !image) continue;
          // Extract project path from labels. Podman formats {{.Labels}} as
          // map[key1:value1 key2:value2 ...] — colon between key/value,
          // space-separated, wrapped in map[]. The old regex used `=` and `,`
          // which never matched, causing "discovered 0" on every boot and
          // silently recreating all containers from scratch on every restart.
          // Match both agi.project (current) and aionima.project (legacy — containers
          // created before this rename still carry the old labels; backward compat).
          const projectMatch = labels?.match(/(?:agi|aionima)\.project:([^ \]]+)/);
          const projectPath = projectMatch?.[1];
          if (projectPath) {
            runningContainers.set(resolvePath(projectPath), { name, image, state: state ?? "" });
          }
        }
        this.log.info(`discovered ${String(runningContainers.size)} existing container(s)`);
      }
    } catch { /* podman not available */ }
    // Store for use in enableProject
    this._runningContainers = runningContainers;

    // Scan all workspace project dirs — auto-enable ALL projects on *.ai.on.
    // Every project directory gets a virtual host, regardless of type or prior state.
    for (const dir of this.workspaceProjects) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          // Skip hidden dirs (`.git`, `.agi`) AND the underscore-prefixed
          // `_aionima/` collection that holds Dev Mode's core-repo forks.
          // Those are NOT deployable projects — they're source trees the
          // owner contributes to and submits PRs from; hosting them as
          // virtual hosts would produce bogus *.ai.on entries.
          if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
          const fullPath = resolvePath(dir, entry.name);

          // Auto-migrate old framework types → broad type + stack
          this.migrateProjectType(fullPath);

          let meta = this.readHostingMeta(fullPath);

          if (meta !== null) {
            // Existing config — force-enable if disabled
            if (!meta.enabled) {
              meta.enabled = true;
            }
          } else {
            // No hosting config on disk — detect and create one
            const detected = this.detectProjectDefaults(fullPath);
            const slug = this.slugFromPath(fullPath);
            meta = {
              enabled: true,
              type: detected.projectType,
              hostname: slug,
              docRoot: detected.docRoot,
              startCommand: detected.startCommand,
              port: null,
              mode: "production" as const,
              internalPort: null,
            };
          }

          // Auto-assign stacks BEFORE enabling (container launch needs the stack config)
          const typeDef = this.registry?.get(meta.type);
          const isCodeType = typeDef?.hasCode ?? true; // default to code if unknown

          if (isCodeType) {
            // Code projects: auto-assign suggested stack if none
            const stacks = this.getProjectStacks(fullPath);
            if (stacks.length === 0) {
              const detected = this.detectProjectDefaults(fullPath);
              if (detected.suggestedStacks.length > 0 && this.stackReg?.has(detected.suggestedStacks[0]!)) {
                this.writeStackInstance(fullPath, {
                  stackId: detected.suggestedStacks[0]!,
                  addedAt: new Date().toISOString(),
                });
                this.log.info(`[${this.slugFromPath(fullPath)}] auto-assigned stack "${detected.suggestedStacks[0]}"`);
              }
            }
          }

          await this.enableProject(fullPath, meta);

          if (!isCodeType) {
            // Non-code projects: auto-set viewer to first matching MagicApp
            const hosting = this.readHostingMeta(fullPath);
            if (hosting && !hosting.viewer) {
              const apps = this.mappReg?.getForType(meta.type);
              if (apps && apps.length > 0) {
                const viewerId = apps[0]!.id;
                if (this.configMgr) {
                  void this.configMgr.updateHosting(fullPath, { viewer: viewerId } as Record<string, unknown>);
                }
                this.log.info(`[${this.slugFromPath(fullPath)}] auto-set viewer "${viewerId}"`);
              }
            }
          }
        }
      } catch {
        // Directory may not exist
      }
    }

    // Clean up orphan containers (discovered but not matched to any project)
    for (const [, orphan] of this._runningContainers) {
      this.log.info(`removing orphan container: ${orphan.name}`);
      try { execFileSync("podman", ["rm", "-f", orphan.name], { stdio: "pipe", timeout: 15_000 }); } catch { /* ignore */ }
    }
    this._runningContainers.clear();

    // Generate Caddyfile and reload (always — even with zero projects,
    // so the ai.on dashboard reverse proxy is configured)
    this.regenerateCaddyfile();

    // Start status polling
    this.startStatusPolling();

    const count = Array.from(this.projects.values()).filter((p) => p.status === "running").length;
    this.log.info(`hosting initialized: ${String(count)} project(s) running`);

    // Restore tunnels for projects that had them active before shutdown/upgrade.
    // Quick tunnels get a new URL each time but the tunnel itself stays active.
    // The new URL is persisted and the dashboard shows it automatically.
    void this.restoreTunnels();
  }

  // -------------------------------------------------------------------------
  // Project metadata I/O
  // -------------------------------------------------------------------------

  readHostingMeta(projectPath: string): ProjectHostingMeta | null {
    // Delegate to ProjectConfigManager when available
    if (this.configMgr) {
      const hosting = this.configMgr.readHosting(projectPath);
      if (!hosting) return null;
      return {
        enabled: hosting.enabled,
        type: hosting.type ?? "static",
        hostname: hosting.hostname ?? this.slugFromPath(projectPath),
        docRoot: hosting.docRoot ?? null,
        startCommand: hosting.startCommand ?? null,
        port: hosting.port ?? null,
        mode: hosting.mode ?? "production",
        internalPort: hosting.internalPort ?? null,
        runtimeId: hosting.runtimeId ?? null,
        tunnelUrl: hosting.tunnelUrl ?? null,
        tunnelId: hosting.tunnelId ?? null,
        viewer: hosting.viewer ?? null,
      };
    }

    // Legacy fallback (no config manager) — reads from ~/.agi/{slug}/project.json only
    const metaPath = projectConfigPath(projectPath);
    if (!existsSync(metaPath)) return null;

    try {
      const raw = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
      const hosting = raw.hosting as Record<string, unknown> | undefined;
      if (!hosting) return null;

      return {
        enabled: hosting.enabled === true,
        type: (hosting.type as string) ?? "static",
        hostname: (hosting.hostname as string) ?? this.slugFromPath(projectPath),
        docRoot: (hosting.docRoot as string) ?? null,
        startCommand: (hosting.startCommand as string) ?? null,
        port: (hosting.port as number) ?? null,
        mode: (hosting.mode as "production" | "development") ?? "production",
        internalPort: (hosting.internalPort as number) ?? null,
        runtimeId: (hosting.runtimeId as string) ?? null,
        tunnelUrl: (hosting.tunnelUrl as string) ?? null,
        tunnelId: (hosting.tunnelId as string) ?? null,
      };
    } catch {
      return null;
    }
  }

  private writeHostingMeta(projectPath: string, meta: ProjectHostingMeta): void {
    // Delegate to ProjectConfigManager when available
    if (this.configMgr) {
      void this.configMgr.updateHosting(projectPath, {
        enabled: meta.enabled,
        type: meta.type,
        hostname: meta.hostname,
        docRoot: meta.docRoot,
        startCommand: meta.startCommand,
        port: meta.port,
        mode: meta.mode,
        internalPort: meta.internalPort,
        ...(meta.runtimeId != null ? { runtimeId: meta.runtimeId } : {}),
        ...(meta.tunnelUrl != null ? { tunnelUrl: meta.tunnelUrl } : {}),
        ...(meta.tunnelId != null ? { tunnelId: meta.tunnelId } : {}),
      });
      return;
    }

    // Legacy fallback (no config manager)
    const metaPath = projectConfigPath(projectPath);
    let existing: Record<string, unknown> = {};
    if (existsSync(metaPath)) {
      try {
        existing = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
      } catch { /* start fresh */ }
    }

    // Preserve existing hosting fields (e.g. stacks) that aren't part of meta
    const existingHosting = (existing.hosting ?? {}) as Record<string, unknown>;
    existing.hosting = {
      ...existingHosting,
      enabled: meta.enabled,
      type: meta.type,
      hostname: meta.hostname,
      docRoot: meta.docRoot,
      startCommand: meta.startCommand,
      port: meta.port,
      mode: meta.mode,
      internalPort: meta.internalPort,
      ...(meta.runtimeId ? { runtimeId: meta.runtimeId } : {}),
      ...(meta.tunnelUrl ? { tunnelUrl: meta.tunnelUrl } : {}),
      ...(meta.tunnelId ? { tunnelId: meta.tunnelId } : {}),
    };

    mkdirSync(dirname(metaPath), { recursive: true });
    writeFileSync(metaPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  }

  private slugFromPath(projectPath: string): string {
    const parts = projectPath.split("/");
    return (parts[parts.length - 1] ?? "project").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  /** List filenames (not dirs) in a directory, non-recursive. */
  private listShallowFiles(dirPath: string): string[] {
    try {
      return readdirSync(dirPath, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith("."))
        .map((e) => e.name);
    } catch {
      return [];
    }
  }

  /** Get lowercase file extension including the dot. */
  private extOf(filename: string): string {
    const dot = filename.lastIndexOf(".");
    return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  }

  /**
   * Migrate old framework-based project types (e.g. "laravel", "nextjs") to
   * broad project types ("web-app", "api-service") and auto-install the
   * corresponding stack if not already present.
   */
  private migrateProjectType(projectPath: string): void {
    // When using config manager, read via the validated service
    if (this.configMgr) {
      const config = this.configMgr.read(projectPath);
      if (!config?.hosting) return;

      const currentType = config.hosting.type;
      if (!currentType) return;

      const migration = MIGRATION_MAP[currentType];
      if (!migration) return;

      const stacks = config.hosting.stacks ?? [];
      const newStacks = stacks.some((s) => s.stackId === migration.autoStack)
        ? stacks
        : [...stacks, { stackId: migration.autoStack, addedAt: new Date().toISOString() }];

      void this.configMgr.updateHosting(projectPath, {
        type: migration.newType,
        stacks: newStacks,
      });

      this.log.info(`[${this.slugFromPath(projectPath)}] migrated type "${currentType}" → "${migration.newType}" + stack "${migration.autoStack}"`);
      return;
    }

    // Legacy fallback
    const metaPath = projectConfigPath(projectPath);
    if (!existsSync(metaPath)) return;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
    } catch {
      return;
    }

    const hosting = raw.hosting as Record<string, unknown> | undefined;
    if (!hosting) return;

    const currentType = hosting.type as string | undefined;
    if (!currentType) return;

    const migration = MIGRATION_MAP[currentType];
    if (!migration) return; // Already a broad type or unknown — nothing to do

    // Update type to broad category
    hosting.type = migration.newType;

    // Auto-add the corresponding stack if not already present
    const stacks = (hosting.stacks ?? []) as ProjectStackInstance[];
    if (!stacks.some((s) => s.stackId === migration.autoStack)) {
      stacks.push({
        stackId: migration.autoStack,
        addedAt: new Date().toISOString(),
      });
      hosting.stacks = stacks;
    }

    raw.hosting = hosting;
    mkdirSync(dirname(metaPath), { recursive: true });
    writeFileSync(metaPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
    this.log.info(`[${this.slugFromPath(projectPath)}] migrated type "${currentType}" → "${migration.newType}" + stack "${migration.autoStack}"`);
  }

  // -------------------------------------------------------------------------
  // Enable / Disable hosting
  // -------------------------------------------------------------------------

  async enableProject(
    projectPath: string,
    meta: ProjectHostingMeta,
  ): Promise<HostedProject> {
    const resolved = resolvePath(projectPath);

    // All types get a port for container port mapping
    if (meta.port !== null) {
      if (this.allocatedPorts.has(meta.port) || !this.isPortAvailable(meta.port)) {
        this.log.warn(`[${meta.hostname}] persisted port ${String(meta.port)} is in use — reallocating`);
        meta.port = this.allocatePort();
      } else {
        this.allocatedPorts.add(meta.port);
      }
    } else {
      meta.port = this.allocatePort();
    }

    // Check for hostname collision
    for (const existing of this.projects.values()) {
      if (existing.meta.hostname === meta.hostname && existing.path !== resolved) {
        throw new Error(`Hostname "${meta.hostname}" is already in use by ${existing.path}`);
      }
    }

    const containerName = `agi-${meta.hostname}`;

    const hosted: HostedProject = {
      path: resolved,
      meta,
      containerId: null,
      containerName,
      status: "stopped",
      tunnelPid: null,
      tunnelUrl: null,
    };

    this.projects.set(resolved, hosted);

    // Check if a container is already running from a prior gateway session.
    //
    // IMPORTANT: podman's `{{.State}}` format token returns the container
    // state as one of: running | exited | paused | stopping | stopped |
    // created | dead | removing — NEVER the string "up". The previous
    // `state.toLowerCase().includes("up")` check therefore NEVER matched,
    // and every boot silently fell into the "not running" branch below —
    // which does `podman rm -f` + fresh `startContainer()`. That meant
    // every `agi upgrade` tore down and recreated every project container
    // even though nothing about the container had changed.
    //
    // The `== "running"` check aligns with the correct podman vocabulary
    // (same one used at line ~2286 in ensureWhoDB). Non-running containers
    // (exited, etc.) still fall through to the start-fresh branch.
    const existing = this._runningContainers.get(resolved);
    if (existing && existing.state.toLowerCase() === "running") {
      // Container is running — reconnect without restarting
      hosted.containerName = existing.name;
      hosted.status = "running";
      this._runningContainers.delete(resolved);
      this.log.info(`[${meta.hostname}] reconnected to running container ${existing.name}`);
    } else {
      // No running container — clean up stale one if exists, start fresh
      if (existing) {
        try { execFileSync("podman", ["rm", "-f", existing.name], { stdio: "pipe", timeout: 15_000 }); } catch { /* ignore */ }
        this._runningContainers.delete(resolved);
      }
      void this.startContainer(hosted);
    }

    // Persist metadata
    this.writeHostingMeta(resolved, meta);

    this.log.info(`enabled hosting: ${meta.hostname}.${this.config.baseDomain} (${meta.type})`);
    this.notifyStatusChange();
    return hosted;
  }

  async disableProject(projectPath: string): Promise<void> {
    const resolved = resolvePath(projectPath);
    const hosted = this.projects.get(resolved);
    if (!hosted) return;

    // Kill tunnel if active
    this.disableTunnel(resolved);

    // Stop container
    this.stopContainer(hosted);

    // Release port
    if (hosted.meta.port !== null) {
      this.allocatedPorts.delete(hosted.meta.port);
    }

    // Update metadata
    hosted.meta.enabled = false;
    this.writeHostingMeta(resolved, hosted.meta);

    this.projects.delete(resolved);

    // Regenerate Caddyfile
    this.regenerateCaddyfile();

    this.log.info(`disabled hosting: ${hosted.meta.hostname}.${this.config.baseDomain}`);
    this.notifyStatusChange();
  }

  async configureProject(
    projectPath: string,
    updates: Partial<Omit<ProjectHostingMeta, "enabled">>,
  ): Promise<HostedProject | null> {
    const resolved = resolvePath(projectPath);
    let hosted = this.projects.get(resolved);

    // Auto-enable if not in active map but has meta on disk
    if (!hosted) {
      const meta = this.readHostingMeta(resolved);
      if (meta) {
        Object.assign(meta, updates, { enabled: true });
        hosted = await this.enableProject(resolved, meta);
        this.regenerateCaddyfile();
        this.notifyStatusChange();
        return hosted;
      }
      return null;
    }

    const hadContainer = hosted.containerId !== null;

    // Apply updates
    if (updates.type !== undefined) hosted.meta.type = updates.type;
    if (updates.hostname !== undefined) {
      hosted.meta.hostname = updates.hostname;
      hosted.containerName = `agi-${updates.hostname}`;
    }
    if (updates.docRoot !== undefined) hosted.meta.docRoot = updates.docRoot;
    if (updates.startCommand !== undefined) hosted.meta.startCommand = updates.startCommand;
    if (updates.mode !== undefined) hosted.meta.mode = updates.mode;
    if (updates.internalPort !== undefined) hosted.meta.internalPort = updates.internalPort;
    if (updates.runtimeId !== undefined) hosted.meta.runtimeId = updates.runtimeId;

    // Restart container with new config
    if (hadContainer) {
      this.stopContainer(hosted);
    }
    void this.startContainer(hosted);

    this.writeHostingMeta(resolved, hosted.meta);
    this.regenerateCaddyfile();
    this.notifyStatusChange();

    return hosted;
  }

  // -------------------------------------------------------------------------
  // Container lifecycle
  // -------------------------------------------------------------------------

  /**
   * Resolve container config from the project's installed stacks.
   * Returns the first per-project (shared === false) stack container config,
   * or null if no stack provides one.
   */
  /**
   * Resolve container config from a registered MagicApp for this project type.
   * MagicApps serve non-dev project types (literature, media, etc.).
   */
  /**
   * Resolve MagicApp container config. Priority:
   * 1. Project-specific viewer (hosting.viewer) — exact MagicApp ID
   * 2. Type-based fallback — first MagicApp registered for this project type
   */
  /**
   * Resolve MApp container config from standalone MAppRegistry.
   * Priority: viewer field → type-based fallback.
   */
  private resolveMagicAppContainerConfig(hosted: HostedProject): MagicAppContainerConfig | null {
    if (!this.mappReg) return null;

    // 1. Check viewer field (project-specific MApp selection)
    const viewerId = hosted.meta.viewer;
    if (viewerId) {
      const viewerApp = this.mappReg.get(viewerId);
      if (viewerApp?.container) {
        // Convert MApp container template strings to functions
        return this.mappContainerToConfig(viewerApp.container);
      }
    }

    // 2. Fallback: first MApp registered for this project type
    const apps = this.mappReg.getForType(hosted.meta.type);
    if (apps.length === 0) return null;
    const first = apps[0]!;
    if (!first.container) return null;
    return this.mappContainerToConfig(first.container);
  }

  /**
   * Convert MApp container config (template strings) to the function-based
   * MagicAppContainerConfig used by startContainer().
   */
  private mappContainerToConfig(container: import("@agi/sdk").MAppContainerConfig): MagicAppContainerConfig {
    return {
      image: container.image,
      internalPort: container.internalPort,
      volumeMounts: (ctx) => container.volumeMounts.map((v) =>
        v.replace(/\{projectPath\}/g, ctx.projectPath)
          .replace(/\{projectHostname\}/g, ctx.projectHostname),
      ),
      env: (ctx) => {
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(container.env ?? {})) {
          env[k] = v.replace(/\{projectPath\}/g, ctx.projectPath)
            .replace(/\{projectHostname\}/g, ctx.projectHostname);
        }
        return env;
      },
      command: container.command ? () => container.command! : undefined,
      healthCheck: container.healthCheck,
    };
  }

  private resolveStackContainerConfig(hosted: HostedProject): StackContainerConfig | null {
    if (!this.stackReg) return null;

    const stacks = this.getProjectStacks(hosted.path);
    if (stacks.length === 0) return null;

    for (const instance of stacks) {
      const def = this.stackReg.get(instance.stackId);
      if (def?.containerConfig && !def.containerConfig.shared) {
        return def.containerConfig;
      }
    }

    return null;
  }

  /** Resolve the full StackDefinition (not just containerConfig) for devCommands fallback. */
  private resolveStackDefinition(hosted: HostedProject): StackDefinition | null {
    if (!this.stackReg) return null;

    const stacks = this.getProjectStacks(hosted.path);
    for (const instance of stacks) {
      const def = this.stackReg.get(instance.stackId);
      if (def?.containerConfig && !def.containerConfig.shared) {
        return def;
      }
    }

    return null;
  }

  /**
   * Build extra podman run args for AI model env vars and dataset volume mounts.
   *
   * For each aiModels binding:
   *   - Always injects: AIONIMA_MODEL_{ALIAS}_ID={modelId}
   *   - If the model container is running: AIONIMA_MODEL_{ALIAS}_URL=http://host.containers.internal:{port}
   *   - If required but not running: logs a warning (does not block start)
   *
   * For each aiDatasets binding:
   *   - Mounts ~/.agi/datasets/hub/datasets--{safeId}/snapshots/main:{mountPath}:ro
   *
   * Returns separate arrays so each code path can splice them at the right point.
   */
  private async buildAiBindingArgs(projectPath: string): Promise<{ envArgs: string[]; volumeArgs: string[] }> {
    const envArgs: string[] = [];
    const volumeArgs: string[] = [];

    // Config manager is required to read aiModels/aiDatasets from project.json.
    if (!this.configMgr) return { envArgs, volumeArgs };

    const projectConfig = this.configMgr.read(projectPath);
    if (!projectConfig) return { envArgs, volumeArgs };

    // --- AI model bindings ---
    for (const binding of projectConfig.aiModels ?? []) {
      const aliasUpper = binding.alias.toUpperCase().replace(/[^A-Z0-9]/g, "_");

      // Always inject the model ID env var
      envArgs.push("-e", `AIONIMA_MODEL_${aliasUpper}_ID=${binding.modelId}`);

      // Resolve running container port
      let port: number | undefined;
      if (this.modelDeps) {
        const containerState = this.modelDeps.modelContainerManager.getStatus(binding.modelId);
        if (containerState?.status === "running") {
          port = containerState.port;
        } else {
          // Fall back to port stored in ModelStore (container may have been started externally)
          const stored = await this.modelDeps.modelStore.getById(binding.modelId);
          if (stored?.status === "running" && stored.containerPort !== undefined) {
            port = stored.containerPort;
          }
        }
      }

      if (port !== undefined) {
        envArgs.push("-e", `AIONIMA_MODEL_${aliasUpper}_URL=http://host.containers.internal:${String(port)}`);
      } else if (binding.required) {
        this.log.warn(
          `[${this.slugFromPath(projectPath)}] required model "${binding.modelId}" (alias: ${binding.alias}) is not running — project will start without AIONIMA_MODEL_${aliasUpper}_URL`,
        );
      }
    }

    // --- AI dataset bindings ---
    const datasetsBase = join(homedir(), ".agi", "datasets", "hub");
    for (const binding of projectConfig.aiDatasets ?? []) {
      const safeId = binding.datasetId.replace(/\//g, "--");
      const hostPath = join(datasetsBase, `datasets--${safeId}`, "snapshots", "main");
      const mountPath = binding.mountPath ?? `/data/${binding.alias}`;
      volumeArgs.push("-v", `${hostPath}:${mountPath}:ro`);
    }

    return { envArgs, volumeArgs };
  }

  private async startContainer(hosted: HostedProject): Promise<void> {
    // Refresh meta from disk before starting. Without this, any user hand-edit
    // to `<project>/project.json` (startCommand, internalPort, mode, type,
    // stackId, viewer) is invisible to the container until a gateway restart
    // — the cached `hosted.meta` snapshot was captured at enableProject() time
    // and never re-synced. The agent flagged this one via its reasoning log
    // after looping on a startCommand change that appeared to apply in the
    // file but never in the running container.
    //
    // Merge semantics: disk values (user's source of truth) win; fields not
    // present on disk fall back to the cached in-memory meta (e.g. `enabled`
    // + `port` are gateway-managed fields that live in ~/.agi/{slug}/project.json
    // via ProjectConfigManager, not the project's own project.json).
    try {
      const diskMeta = this.readHostingMeta(hosted.path);
      if (diskMeta) {
        hosted.meta = { ...hosted.meta, ...diskMeta };
        this.projects.set(hosted.path, hosted);
      }
    } catch (err) {
      this.log.warn(
        `[${hosted.meta.hostname}] meta refresh from disk failed, using cached values: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (hosted.meta.port === null) {
      hosted.status = "error";
      hosted.error = "No port allocated";
      return;
    }

    const containerName = hosted.containerName ?? `agi-${hosted.meta.hostname}`;

    // Clean up any stale container with the same name
    try {
      execFileSync("podman", ["rm", "-f", containerName], { stdio: "pipe", timeout: 15_000 });
    } catch {
      // Container may not exist — that's fine
    }

    // Resolve AI model env vars and dataset volume mounts for this project.
    // These are injected into every code path (magic-app, stack, legacy) before the image token.
    const aiBindingArgs = await this.buildAiBindingArgs(hosted.path);

    // -----------------------------------------------------------------------
    // MagicApp path: resolve container config from registered MagicApps
    // (non-dev project types like literature/media use MagicApps, not stacks)
    // -----------------------------------------------------------------------

    const magicAppConfig = this.resolveMagicAppContainerConfig(hosted);
    if (magicAppConfig) {
      const ctx: MagicAppContainerContext = {
        projectPath: hosted.path,
        projectHostname: hosted.meta.hostname,
        allocatedPort: hosted.meta.port,
        mode: hosted.meta.mode,
      };

      // Ensure meta.internalPort reflects the effective port so the
      // regenerated Caddyfile routes to the right container port.
      // Takes effect on next project write via updateProject.
      hosted.meta.internalPort = hosted.meta.internalPort ?? magicAppConfig.internalPort;

      const args: string[] = [
        "run", "-d",
        "--name", containerName,
        "--restart=always",
        "--label", "agi.managed=true",
        "--label", `agi.hostname=${hosted.meta.hostname}`,
        "--label", `agi.project=${hosted.path}`,
        // Story #100 — only AGI binds host ports. Project containers live on
        // the aionima network and are reached by Caddy-on-aionima via
        // podman DNS (`${containerName}:${internalPort}`). No `-p` mapping.
        "--network=aionima",
      ];

      for (const vol of magicAppConfig.volumeMounts(ctx)) {
        args.push("-v", vol);
      }
      for (const [key, value] of Object.entries(magicAppConfig.env(ctx))) {
        args.push("-e", `${key}=${value}`);
      }

      const magicTunnelOrigin = this.computeTunnelOrigin(hosted);
      if (magicTunnelOrigin) {
        args.push("-e", `HOSTNAME_ALLOWED_ORIGIN=${magicTunnelOrigin}`);
      }

      // Inject AI model env vars and dataset volume mounts
      args.push(...aiBindingArgs.volumeArgs);
      args.push(...aiBindingArgs.envArgs);

      args.push(magicAppConfig.image);

      // Resolve via the same precedence ladder as stack projects; magic apps have no
      // devCommands, so devCommands step is skipped and the ladder collapses to
      // override > magic-app-config.command > image default.
      const magicResolved = resolveContainerStartCommand({
        userStartCommand: hosted.meta.startCommand,
        stackCommand: magicAppConfig.command?.(ctx) ?? null,
        stackId: `magic-app:${hosted.meta.viewer ?? hosted.meta.type}`,
        mode: hosted.meta.mode,
      });
      this.log.info(`[${hosted.meta.hostname}] start command source: ${magicResolved.sourceLabel}`);
      const cmdTokens = magicResolved.tokens;
      const wrapped = this.wrapResilient(cmdTokens);
      if (wrapped) args.push(...wrapped);

      this.execContainerStart(hosted, containerName, args, "magic-app");
      return;
    }

    // -----------------------------------------------------------------------
    // Stack path: resolve container config from installed stacks
    // -----------------------------------------------------------------------

    const stackConfig = this.resolveStackContainerConfig(hosted);
    if (stackConfig) {
      const ctx: StackContainerContext = {
        projectPath: hosted.path,
        projectHostname: hosted.meta.hostname,
        allocatedPort: hosted.meta.port,
        mode: hosted.meta.mode,
      };

      hosted.meta.internalPort = hosted.meta.internalPort ?? stackConfig.internalPort;

      const args: string[] = [
        "run", "-d",
        "--name", containerName,
        "--restart=always",
        "--label", "agi.managed=true",
        "--label", `agi.hostname=${hosted.meta.hostname}`,
        "--label", `agi.project=${hosted.path}`,
        // Story #100 — aionima network, no host port binding.
        "--network=aionima",
      ];

      for (const vol of stackConfig.volumeMounts(ctx)) {
        args.push("-v", vol);
      }
      for (const [key, value] of Object.entries(stackConfig.env(ctx))) {
        args.push("-e", `${key}=${value}`);
      }

      // Inject tunnel hostname as allowed dev origin so frameworks like Next.js
      // accept HMR WebSocket connections through the tunnel domain.
      // HOSTNAME_ALLOWED_ORIGIN is read by our dev-origin shim (injected below).
      const tunnelOrigin = this.computeTunnelOrigin(hosted);
      if (tunnelOrigin) {
        args.push("-e", `HOSTNAME_ALLOWED_ORIGIN=${tunnelOrigin}`);
      }

      // Set working directory to the container-side mount path from the stack's first volume.
      // Different stacks mount to different paths (e.g. /app for Node, /var/www/html for PHP).
      const firstMount = stackConfig.volumeMounts(ctx)[0];
      if (firstMount) {
        const containerPath = firstMount.split(":")[1];
        if (containerPath) args.push("-w", containerPath);
      }

      // Inject AI model env vars and dataset volume mounts
      args.push(...aiBindingArgs.volumeArgs);
      args.push(...aiBindingArgs.envArgs);

      // Use runtime-selected image if available, otherwise stack's default
      const runtimeDef = hosted.meta.runtimeId
        ? this.pluginReg?.getRuntimes().find(r => r.id === hosted.meta.runtimeId)
        : undefined;
      args.push(runtimeDef?.containerImage ?? stackConfig.image);

      // Resolve the command via the precedence ladder: user override > stack.command >
      // stack.devCommands (mode-aware) > image default. The user's Start Command field
      // now actually takes effect here — previously it was silently ignored for stack
      // projects.
      const stackDef = this.resolveStackDefinition(hosted);
      const resolved = resolveContainerStartCommand({
        userStartCommand: hosted.meta.startCommand,
        stackCommand: stackConfig.command?.(ctx) ?? null,
        stackId: stackDef?.id,
        devCommands: stackDef?.devCommands,
        mode: hosted.meta.mode,
      });
      this.log.info(`[${hosted.meta.hostname}] start command source: ${resolved.sourceLabel}`);
      let cmdTokens = resolved.tokens;

      // Wrap dev commands with an origin-injection shim for Next.js.
      // Next.js blocks HMR WebSocket connections from unknown origins in dev mode.
      // If HOSTNAME_ALLOWED_ORIGIN is set, inject allowedDevOrigins into next.config.
      if (cmdTokens && hosted.meta.mode === "development" && tunnelOrigin) {
        const origCmd = cmdTokens.length === 3 && cmdTokens[0] === "sh" && cmdTokens[1] === "-c"
          ? cmdTokens[2]!
          : cmdTokens.join(" ");
        const shimScript = [
          // Inject allowedDevOrigins into next.config if it exists (Next.js 15+)
          `if [ -n "$HOSTNAME_ALLOWED_ORIGIN" ] && [ -f next.config.ts ] || [ -f next.config.mjs ] || [ -f next.config.js ]; then`,
          `  CFG=$(ls next.config.ts next.config.mjs next.config.js 2>/dev/null | head -1);`,
          `  if ! grep -q allowedDevOrigins "$CFG" 2>/dev/null; then`,
          `    sed -i "s|/\\* config options here \\*/|allowedDevOrigins: [\\"$HOSTNAME_ALLOWED_ORIGIN\\"],|" "$CFG" 2>/dev/null || true;`,
          `    sed -i "s|};|  allowedDevOrigins: [\\"$HOSTNAME_ALLOWED_ORIGIN\\"],\\n};|" "$CFG" 2>/dev/null || true;`,
          `  fi;`,
          `fi;`,
          origCmd,
        ].join(" ");
        cmdTokens = ["sh", "-c", shimScript];
      }

      // Resilience-wrap so broken user code can't kill the container (Phase 1).
      // If the stack doesn't specify a command, the image's default CMD runs.
      const stackWrapped = this.wrapResilient(cmdTokens);
      if (stackWrapped) args.push(...stackWrapped);

      this.execContainerStart(hosted, containerName, args, "stack");
      return;
    }

    // -----------------------------------------------------------------------
    // Legacy fallback (deprecated): ProjectType registry + hardcoded constants
    // @deprecated — Remove after existing projects migrate to stack-based hosting
    // -----------------------------------------------------------------------

    const typeDef = this.registry?.get(hosted.meta.type);
    const runtimeDef = hosted.meta.runtimeId
      ? this.pluginReg?.getRuntimes().find(r => r.id === hosted.meta.runtimeId)
      : undefined;

    const knownType = hosted.meta.type;
    const internalPort = hosted.meta.internalPort
      ?? runtimeDef?.internalPort
      ?? typeDef?.containerConfig?.internalPort
      ?? CONTAINER_INTERNAL_PORTS[knownType]
      ?? 3000;
    const image = runtimeDef?.containerImage
      ?? typeDef?.containerConfig?.image
      ?? CONTAINER_IMAGES[knownType]
      ?? "ghcr.io/civicognita/node:22";

    const args: string[] = [
      "run", "-d",
      "--name", containerName,
      "--restart=always",
      "--label", "agi.managed=true",
      "--label", `agi.hostname=${hosted.meta.hostname}`,
      "--label", `agi.project=${hosted.path}`,
      // Story #100 — legacy-path project container joins aionima.
      "--network=aionima",
    ];

    // Collected across branches: the user-level command tokens (post-image).
    // Resilience-wrapped once at the end so every legacy path survives failure.
    let legacyCmdTokens: string[] | null = null;

    if (typeDef?.containerConfig) {
      const cfg = typeDef.containerConfig;
      const volumes = cfg.volumeMounts(hosted.path, hosted.meta);
      for (const vol of volumes) {
        args.push("-v", vol);
      }
      const envVars = cfg.env(hosted.meta);
      for (const [key, value] of Object.entries(envVars)) {
        args.push("-e", `${key}=${value}`);
      }
      if (hosted.meta.type === "node") {
        args.push("-w", "/app");
      }
      // Inject AI model env vars and dataset volume mounts
      args.push(...aiBindingArgs.volumeArgs);
      args.push(...aiBindingArgs.envArgs);
      args.push(image);
      const cmdTokens = cfg.command?.(hosted.meta);
      if (cmdTokens) {
        legacyCmdTokens = cmdTokens;
      } else if (hosted.meta.type === "node" && !hosted.meta.startCommand) {
        hosted.status = "error";
        hosted.error = "Missing startCommand for Node.js project";
        return;
      }
    } else {
      switch (hosted.meta.type) {
        case "static": {
          const docRoot = hosted.meta.docRoot ?? "dist";
          const hostPath = join(hosted.path, docRoot);
          // Pre-flight: nginx mounts hostPath read-only; if the directory
          // doesn't exist on the host, podman aborts with `statfs ENOENT`
          // and the project lands in an "exited" state with a cryptic
          // error. Catch it here with an actionable message instead
          // (story #110 task #358).
          if (!existsSync(hostPath)) {
            hosted.status = "error";
            hosted.error = `Static-site document root missing: ${hostPath}. ` +
              `Build the project (e.g., \`npm run build\`) so that ${docRoot}/ exists, ` +
              `or set docRoot in the project config to point at the actual built output.`;
            return;
          }
          args.push("-v", `${hostPath}:/usr/share/nginx/html:ro,Z`);
          // Inject AI model env vars and dataset volume mounts
          args.push(...aiBindingArgs.volumeArgs);
          args.push(...aiBindingArgs.envArgs);
          args.push(image);
          break;
        }
        case "php": {
          const docRoot = hosted.meta.docRoot ?? "public";
          args.push("-v", `${hosted.path}:/var/www/html:Z`);
          // Inject AI model env vars and dataset volume mounts
          args.push(...aiBindingArgs.volumeArgs);
          args.push(...aiBindingArgs.envArgs);
          args.push(image);
          if (docRoot !== ".") {
            legacyCmdTokens = ["bash", "-c",
              `sed -i 's|/var/www/html|/var/www/html/${docRoot}|g' /etc/apache2/sites-available/000-default.conf /etc/apache2/apache2.conf && a2enmod rewrite && docker-php-entrypoint apache2-foreground`];
          }
          break;
        }
        case "node": {
          if (!hosted.meta.startCommand) {
            hosted.status = "error";
            hosted.error = "Missing startCommand for Node.js project";
            return;
          }
          args.push("-v", `${hosted.path}:/app:Z`);
          args.push("-w", "/app");
          args.push("-e", `PORT=${String(internalPort)}`);
          args.push("-e", `NODE_ENV=${hosted.meta.mode}`);
          const nodeTunnelOrigin = this.computeTunnelOrigin(hosted);
          if (nodeTunnelOrigin) args.push("-e", `HOSTNAME_ALLOWED_ORIGIN=${nodeTunnelOrigin}`);
          // Inject AI model env vars and dataset volume mounts
          args.push(...aiBindingArgs.volumeArgs);
          args.push(...aiBindingArgs.envArgs);
          args.push(image);
          legacyCmdTokens = hosted.meta.startCommand.split(/\s+/);
          break;
        }
        default: {
          // Generic fallback: mount project, run startCommand if provided
          if (!hosted.meta.startCommand) {
            hosted.status = "error";
            hosted.error = `No container configuration for project type "${hosted.meta.type}". Add a stack or set a start command.`;
            return;
          }
          args.push("-v", `${hosted.path}:/app:Z`);
          args.push("-w", "/app");
          args.push("-e", `PORT=${String(internalPort)}`);
          args.push("-e", `NODE_ENV=${hosted.meta.mode}`);
          const defaultTunnelOrigin = this.computeTunnelOrigin(hosted);
          if (defaultTunnelOrigin) args.push("-e", `HOSTNAME_ALLOWED_ORIGIN=${defaultTunnelOrigin}`);
          // Inject AI model env vars and dataset volume mounts
          args.push(...aiBindingArgs.volumeArgs);
          args.push(...aiBindingArgs.envArgs);
          args.push(image);
          legacyCmdTokens = hosted.meta.startCommand.split(/\s+/);
          break;
        }
      }
    }

    // Resilience-wrap so the container outlives the user's start command (Phase 1).
    // If the branch doesn't set legacyCmdTokens (e.g. static nginx), the image default runs.
    const legacyWrapped = this.wrapResilient(legacyCmdTokens);
    if (legacyWrapped) args.push(...legacyWrapped);

    this.execContainerStart(hosted, containerName, args, "legacy");
  }

  /** Execute podman run and update hosted project state. */
  private execContainerStart(
    hosted: HostedProject,
    containerName: string,
    args: string[],
    source: "stack" | "legacy" | "magic-app",
  ): void {
    try {
      const result = execFileSync("podman", args, {
        stdio: "pipe",
        timeout: 60_000,
      }).toString().trim();

      hosted.containerId = result;
      hosted.containerName = containerName;
      hosted.status = "running";
      hosted.error = undefined;

      this.log.info(`[${hosted.meta.hostname}] container started: ${containerName} (port ${String(hosted.meta.port)}) [${source}]`);
    } catch (err) {
      hosted.status = "error";
      hosted.error = err instanceof Error ? err.message : String(err);
      this.log.error(`[${hosted.meta.hostname}] failed to start container: ${hosted.error}`);
    }
  }

  // -------------------------------------------------------------------------
  // Container resilience (Phase 1): sleep-infinity supervisor
  //
  // The container's PID 1 is a resilience wrapper — the user's start command
  // runs first, but whatever exit code it produces (or signal it crashes with)
  // is swallowed and PID 1 exec's into `sleep infinity`. The container
  // therefore survives broken user code, missing dependencies, bad configs,
  // etc. — which makes it suitable as a persistent dev environment where
  // dev commands are run on-demand via `podman exec`.
  //
  // This pattern mirrors VS Code devcontainers and GitHub Codespaces.
  //
  // If no user command is configured, PID 1 is just `sleep infinity` directly.
  // With this in place, `--restart=always` is safe: PID 1 never exits
  // voluntarily, so "always" never loops on a broken command.
  // -------------------------------------------------------------------------

  /** Instance method that delegates to the exported pure helper. */
  private wrapResilient(cmdTokens: string[] | null | undefined): string[] | null {
    return wrapResilientCmd(cmdTokens);
  }

  private stopContainer(hosted: HostedProject): void {
    if (!hosted.containerName) return;

    try {
      execFileSync("podman", ["stop", "-t", "10", hosted.containerName], {
        stdio: "pipe",
        timeout: 30_000,
      });
    } catch {
      // Container may already be stopped
    }

    try {
      execFileSync("podman", ["rm", "-f", hosted.containerName], {
        stdio: "pipe",
        timeout: 15_000,
      });
    } catch {
      // Container may already be removed
    }

    hosted.containerId = null;
    hosted.status = "stopped";
    this.log.info(`[${hosted.meta.hostname}] container stopped: ${hosted.containerName}`);
  }

  restartProject(projectPath: string): boolean {
    const resolved = resolvePath(projectPath);
    const hosted = this.projects.get(resolved);
    if (!hosted) return false;

    this.stopContainer(hosted);
    void this.startContainer(hosted);
    this.notifyStatusChange();
    return true;
  }

  // -------------------------------------------------------------------------
  // Tunnel origin computation
  // -------------------------------------------------------------------------

  /**
   * Compute the tunnel origin hostname for a hosted project.
   * Returns the tunnel domain (e.g. "blackorchid-web.doers.market") if a tunnel
   * is configured, so frameworks like Next.js can allow HMR through it.
   */
  private computeTunnelOrigin(hosted: HostedProject): string | null {
    // If a tunnel URL is already known, extract the hostname
    if (hosted.meta.tunnelUrl) {
      try {
        return new URL(hosted.meta.tunnelUrl).hostname;
      } catch { /* fall through */ }
    }
    // For named tunnels, compute from hostname + configured tunnel domain
    const { domain } = this.readTunnelConfig();
    if (domain && hosted.meta.hostname) {
      return `${hosted.meta.hostname}.${domain}`;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Container logs
  // -------------------------------------------------------------------------

  getContainerLogs(
    projectPath: string,
    tail = 100,
    sourceType?: "container" | "container-file",
    containerFilePath?: string,
  ): string | null {
    const resolved = resolvePath(projectPath);
    const hosted = this.projects.get(resolved);
    if (!hosted?.containerName) return null;

    try {
      if (sourceType === "container-file" && containerFilePath) {
        return execFileSync("podman", [
          "exec", hosted.containerName,
          "tail", "-n", String(tail), containerFilePath,
        ], { stdio: "pipe", timeout: 10_000 }).toString();
      }
      // podman logs sends container stdout to its stdout and container stderr
      // to its stderr — we need both (Node.js apps typically log to stderr)
      const result = spawnSync("podman", ["logs", "--tail", String(tail), hosted.containerName], {
        stdio: "pipe",
        timeout: 10_000,
      });
      const stdout = result.stdout?.toString() ?? "";
      const stderr = result.stderr?.toString() ?? "";
      return (stdout + stderr).trim();
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Status monitoring — event-driven with fallback polling
  //
  // Uses `podman events` to stream container state changes via a single
  // persistent process instead of spawning `podman inspect` per container
  // every N seconds. A low-frequency fallback poll (120s) catches anything
  // the event stream misses.
  // -------------------------------------------------------------------------

  private startStatusPolling(): void {
    // Start event-driven monitoring
    this.startEventsStream();

    // Low-frequency fallback poll (120s) in case events stream misses something
    if (this.statusPollTimer !== null) return;
    this.statusPollTimer = setInterval(
      () => this.pollContainerStatuses(),
      120_000,
    );
  }

  /**
   * Start a persistent `podman events` process that streams container state changes.
   * Replaces the old per-container `podman inspect` polling that caused kernel lockups
   * by spawning ~36 processes/minute (6 containers * every 10 seconds).
   */
  private startEventsStream(): void {
    if (this.eventsProcess !== null) return;

    try {
      const child = spawn("podman", [
        "events",
        "--format", "json",
        "--filter", "type=container",
        "--filter", "event=start",
        "--filter", "event=stop",
        "--filter", "event=die",
        "--filter", "event=exited",
      ], { stdio: ["ignore", "pipe", "ignore"] });

      this.eventsProcess = child;

      let buffer = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        // Process complete JSON lines
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line) as { Actor?: { Attributes?: { name?: string } }; Action?: string; Status?: string };
            const containerName = event.Actor?.Attributes?.name;
            const action = event.Action ?? event.Status ?? "";
            if (containerName) this.handleContainerEvent(containerName, action);
          } catch {
            // Malformed JSON — skip
          }
        }
      });

      child.on("close", () => {
        this.eventsProcess = null;
        // Restart after a delay if the process dies unexpectedly
        setTimeout(() => {
          if (this.statusPollTimer !== null) this.startEventsStream();
        }, 5_000);
      });

      child.on("error", () => {
        this.eventsProcess = null;
      });

      this.log.info("container status monitoring started (podman events)");
    } catch {
      this.log.warn("failed to start podman events stream — relying on fallback polling");
    }
  }

  /** Handle a container state change event from the podman events stream. */
  private handleContainerEvent(containerName: string, action: string): void {
    // Find the hosted project for this container
    for (const hosted of this.projects.values()) {
      if (hosted.containerName !== containerName) continue;

      let newStatus: "running" | "stopped" | "error";
      if (action === "start") {
        newStatus = "running";
      } else if (action === "stop" || action === "die" || action === "exited") {
        newStatus = "stopped";
      } else {
        return; // Unknown action — ignore
      }

      if (hosted.status !== newStatus) {
        hosted.status = newStatus;
        this.notifyStatusChange();
      }
      return;
    }
  }

  /** Low-frequency fallback poll — runs every 120s to catch missed events. */
  private pollContainerStatuses(): void {
    let changed = false;

    for (const hosted of this.projects.values()) {
      if (!hosted.containerName) continue;

      let newStatus: "running" | "stopped" | "error";
      try {
        const raw = execFileSync(
          "podman",
          ["inspect", "--format", "{{.State.Status}}", hosted.containerName],
          { stdio: "pipe", timeout: 10_000 },
        ).toString().trim();

        if (raw === "running") {
          newStatus = "running";
        } else if (raw === "exited" || raw === "stopped") {
          newStatus = "stopped";
        } else {
          newStatus = "error";
        }
      } catch {
        newStatus = "stopped";
        hosted.containerId = null;
      }

      if (hosted.status !== newStatus) {
        hosted.status = newStatus;
        changed = true;
      }
    }

    if (changed) {
      this.notifyStatusChange();
    }
  }

  // -------------------------------------------------------------------------
  // Port allocation
  // -------------------------------------------------------------------------

  /** Check whether a TCP port is free using `ss`. */
  private isPortAvailable(port: number): boolean {
    try {
      const out = execFileSync("ss", ["-tlnH", `sport = :${String(port)}`], { stdio: "pipe", timeout: 5_000 }).toString();
      return out.trim().length === 0;
    } catch {
      return true; // ss failed — assume free
    }
  }

  private allocatePort(): number {
    const start = this.config.portRangeStart;
    for (let i = 0; i < PORT_POOL_SIZE; i++) {
      const port = start + i;
      if (!this.allocatedPorts.has(port) && this.isPortAvailable(port)) {
        this.allocatedPorts.add(port);
        return port;
      }
    }
    throw new Error(`Port pool exhausted (${String(start)}-${String(start + PORT_POOL_SIZE - 1)})`);
  }

  // -------------------------------------------------------------------------
  // Caddyfile generation
  // -------------------------------------------------------------------------

  regenerateCaddyfile(): void {
    // Defense-in-depth: when hosting is disabled the static script-managed
    // Caddyfile is the source of truth (see scripts/test-vm.sh). Any caller
    // that reaches this function with hosting.enabled=false would otherwise
    // overwrite the static ai.on/test.ai.on stanzas with auto-generated
    // content keyed on baseDomain — manifests as test.ai.on routing failure
    // owner reported 2026-04-27. The early-return mirrors the
    // regenerateSystemDomains() guard at the same level.
    if (!this.config.enabled) {
      this.log.debug("regenerateCaddyfile: hosting disabled — skipping (static Caddyfile is source of truth)");
      return;
    }

    let existing = "";
    try {
      existing = readFileSync("/etc/caddy/Caddyfile", "utf8");
    } catch {
      // No existing Caddyfile — skip
    }

    const caddyfile = buildCaddyfileContent({
      baseDomain: this.config.baseDomain,
      domainAliases: this.config.domainAliases,
      gatewayPort: this.config.gatewayPort,
      whodbPort: this.config.whodbPort,
      idService: this.config.idService,
      pluginSubdomainRoutes: this.pluginReg?.getSubdomainRoutes().map(({ route }) => route) ?? [],
      projects: Array.from(this.projects.values())
        .filter((p) => p.meta.enabled)
        .map((p) => ({
          hostname: p.meta.hostname,
          port: p.meta.port,
          containerName: p.containerName ?? (p.meta.hostname ? `agi-${p.meta.hostname}` : null),
          internalPort: p.meta.internalPort,
        })),
      existingCaddyfile: existing,
    });

    try {
      execSync(`sudo tee /etc/caddy/Caddyfile > /dev/null`, {
        input: caddyfile,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      });
      this.log.info("Caddyfile regenerated");
    } catch (err) {
      this.log.error(`failed to write Caddyfile: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Reload Caddy
    try {
      execSync("sudo caddy reload --config /etc/caddy/Caddyfile", {
        stdio: "pipe",
        timeout: 10_000,
      });
      this.log.info("Caddy reloaded");
    } catch (err) {
      this.log.error(`failed to reload Caddy: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  getStatus(): {
    ready: boolean;
    baseDomain: string;
    caddy: { installed: boolean; running: boolean };
    dnsmasq: { installed: boolean; running: boolean; configured: boolean };
    podman: { installed: boolean; rootless: boolean };
    projects: {
      path: string;
      hostname: string;
      type: string;
      status: "running" | "stopped" | "error" | "unconfigured";
      port: number | null;
      url: string | null;
      mode: "production" | "development";
      internalPort: number | null;
      tunnelUrl?: string | null;
      containerName?: string;
      image?: string;
      error?: string;
    }[];
  } {
    const infra = this.checkInfrastructure();
    const projects = Array.from(this.projects.values()).map((hosted) => {
      const knownType = hosted.meta.type;
      return {
        path: hosted.path,
        hostname: hosted.meta.hostname,
        type: hosted.meta.type,
        status: hosted.status,
        port: hosted.meta.port,
        mode: hosted.meta.mode,
        internalPort: hosted.meta.internalPort,
        url: hosted.status === "running"
          ? `https://${hosted.meta.hostname}.${this.config.baseDomain}`
          : null,
        ...(hosted.tunnelUrl ? { tunnelUrl: hosted.tunnelUrl } : {}),
        ...(hosted.containerName ? { containerName: hosted.containerName } : {}),
        ...(CONTAINER_IMAGES[knownType] ? { image: CONTAINER_IMAGES[knownType] } : {}),
        ...(hosted.error !== undefined ? { error: hosted.error } : {}),
      };
    });

    return {
      ...infra,
      baseDomain: this.config.baseDomain,
      projects,
    };
  }

  /** Get the running container name for a project (or null if not running). */
  getContainerName(projectPath: string): string | null {
    const resolved = resolvePath(projectPath);
    const hosted = this.projects.get(resolved);
    if (!hosted || hosted.status !== "running" || !hosted.containerName) return null;
    return hosted.containerName;
  }

  /** Get hosting info for a specific project (merged into GET /api/projects response). */
  getProjectHostingInfo(projectPath: string): {
    enabled: boolean;
    type: string;
    hostname: string;
    docRoot: string | null;
    startCommand: string | null;
    port: number | null;
    mode: "production" | "development";
    internalPort: number | null;
    runtimeId?: string | null;
    status: "running" | "stopped" | "error" | "unconfigured";
    tunnelUrl?: string | null;
    containerName?: string;
    image?: string;
    error?: string;
    url: string | null;
    viewer?: string;
  } {
    const resolved = resolvePath(projectPath);
    const hosted = this.projects.get(resolved);

    if (hosted) {
      const knownType = hosted.meta.type;
      // Resolve image from runtime definition, then stack config, then hardcoded fallback
      const runtimeDef = hosted.meta.runtimeId
        ? this.pluginReg?.getRuntimes().find(r => r.id === hosted.meta.runtimeId)
        : undefined;
      const stackConfig = this.resolveStackContainerConfig(hosted);
      const resolvedImage = runtimeDef?.containerImage
        ?? stackConfig?.image
        ?? CONTAINER_IMAGES[knownType];
      return {
        enabled: hosted.meta.enabled,
        type: hosted.meta.type,
        hostname: hosted.meta.hostname,
        docRoot: hosted.meta.docRoot,
        startCommand: hosted.meta.startCommand,
        port: hosted.meta.port,
        mode: hosted.meta.mode,
        internalPort: hosted.meta.internalPort,
        runtimeId: hosted.meta.runtimeId ?? null,
        status: hosted.status,
        ...(hosted.tunnelUrl ? { tunnelUrl: hosted.tunnelUrl } : {}),
        ...(hosted.containerName ? { containerName: hosted.containerName } : {}),
        ...(resolvedImage ? { image: resolvedImage } : {}),
        ...(hosted.error !== undefined ? { error: hosted.error } : {}),
        ...(hosted.meta.viewer ? { viewer: hosted.meta.viewer } : {}),
        url: hosted.status === "running"
          ? `https://${hosted.meta.hostname}.${this.config.baseDomain}`
          : null,
      };
    }

    // Check if project has hosting meta but is not active
    const meta = this.readHostingMeta(resolved);
    if (meta) {
      return {
        enabled: meta.enabled,
        type: meta.type,
        hostname: meta.hostname,
        docRoot: meta.docRoot,
        startCommand: meta.startCommand,
        port: meta.port,
        mode: meta.mode,
        internalPort: meta.internalPort,
        runtimeId: meta.runtimeId ?? null,
        ...(meta.viewer ? { viewer: meta.viewer } : {}),
        status: "unconfigured",
        url: null,
      };
    }

    // No hosting config at all
    return {
      enabled: false,
      type: "static",
      hostname: this.slugFromPath(projectPath),
      docRoot: null,
      startCommand: null,
      port: null,
      mode: "production",
      internalPort: null,
      status: "unconfigured",
      url: null,
    };
  }

  // -------------------------------------------------------------------------
  // Project type detection
  // -------------------------------------------------------------------------

  detectProjectDefaults(projectPath: string): DetectedProjectConfig {
    const has = (name: string) => existsSync(join(projectPath, name));
    const anyMatch = (pattern: RegExp) => {
      try {
        return readdirSync(projectPath).some((f) => pattern.test(f));
      } catch {
        return false;
      }
    };

    // Parse package.json and composer.json once upfront
    let pkgDeps: Record<string, string> = {};
    let pkgScripts: Record<string, string> = {};
    let composerRequire: Record<string, string> = {};
    const hasPackageJson = has("package.json");
    const hasComposerJson = has("composer.json");

    if (hasPackageJson) {
      try {
        const pkg = JSON.parse(readFileSync(join(projectPath, "package.json"), "utf-8")) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          scripts?: Record<string, string>;
        };
        pkgDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        pkgScripts = pkg.scripts ?? {};
      } catch { /* malformed — fall through */ }
    }

    if (hasComposerJson) {
      try {
        const composer = JSON.parse(readFileSync(join(projectPath, "composer.json"), "utf-8")) as {
          require?: Record<string, string>;
          "require-dev"?: Record<string, string>;
        };
        composerRequire = { ...composer.require, ...composer["require-dev"] };
      } catch { /* malformed — fall through */ }
    }

    // 1. Laravel (composer.json with laravel/framework)
    if (hasComposerJson && "laravel/framework" in composerRequire) {
      const suggestedStacks = ["stack-laravel"];
      // Monorepo: suggest React stack if React is also present
      if (hasPackageJson && "react" in pkgDeps) {
        suggestedStacks.push("stack-react");
      }
      return { projectType: "web-app", suggestedStacks, docRoot: "public", startCommand: null };
    }

    // 2. WordPress (composer.json with roots/wordpress or johnpbloch/wordpress-core)
    if (hasComposerJson && ("roots/wordpress" in composerRequire || "johnpbloch/wordpress-core" in composerRequire)) {
      return { projectType: "web-app", suggestedStacks: ["stack-php-app"], docRoot: "web/wp", startCommand: null };
    }

    // 3. Next.js (config file or package.json dep)
    if (has("next.config.ts") || has("next.config.js") || has("next.config.mjs") || "next" in pkgDeps) {
      return { projectType: "web-app", suggestedStacks: ["stack-nextjs"], docRoot: ".", startCommand: "npm start" };
    }

    // 4. Nuxt (config file or package.json dep)
    if (has("nuxt.config.ts") || has("nuxt.config.js") || "nuxt" in pkgDeps) {
      return { projectType: "web-app", suggestedStacks: ["stack-nuxt"], docRoot: ".", startCommand: "npm start" };
    }

    // 5. React + Vite
    if (hasPackageJson && "react" in pkgDeps && "vite" in pkgDeps) {
      return { projectType: "web-app", suggestedStacks: ["stack-react-vite"], docRoot: "dist", startCommand: null };
    }

    // 6. Generic Node.js with start script
    if (hasPackageJson && pkgScripts.start) {
      return { projectType: "api-service", suggestedStacks: ["stack-node-app"], docRoot: ".", startCommand: "npm start" };
    }

    // 7. Vite only (no React)
    if (hasPackageJson && "vite" in pkgDeps) {
      return { projectType: "static-site", suggestedStacks: ["stack-static-hosting"], docRoot: "dist", startCommand: null };
    }

    // 8. Generic PHP (composer.json)
    if (hasComposerJson) {
      return { projectType: "web-app", suggestedStacks: ["stack-php-app"], docRoot: "public", startCommand: null };
    }

    // 9. Loose .php files
    if (anyMatch(/\.php$/)) {
      return { projectType: "web-app", suggestedStacks: ["stack-php-app"], docRoot: ".", startCommand: null };
    }

    // 10. Python — Django (manage.py)
    if (has("manage.py") && (has("requirements.txt") || has("pyproject.toml"))) {
      return { projectType: "web-app", suggestedStacks: ["stack-django"], docRoot: ".", startCommand: "python manage.py runserver" };
    }

    // 10b. Python — FastAPI/Flask (requirements.txt with framework deps)
    if (has("requirements.txt")) {
      try {
        const reqContent = readFileSync(join(projectPath, "requirements.txt"), "utf-8").toLowerCase();
        if (reqContent.includes("fastapi")) {
          return { projectType: "api-service", suggestedStacks: ["stack-fastapi"], docRoot: ".", startCommand: null };
        }
        if (reqContent.includes("flask")) {
          return { projectType: "web-app", suggestedStacks: ["stack-flask"], docRoot: ".", startCommand: null };
        }
      } catch { /* unreadable */ }
    }

    // 10c. Go (go.mod)
    if (has("go.mod")) {
      return { projectType: "api-service", suggestedStacks: ["stack-go-app"], docRoot: ".", startCommand: null };
    }

    // 10d. Rust (Cargo.toml)
    if (has("Cargo.toml")) {
      return { projectType: "api-service", suggestedStacks: ["stack-rust-app"], docRoot: ".", startCommand: null };
    }

    // 11. Static (index.html in root)
    if (has("index.html")) {
      return { projectType: "static-site", suggestedStacks: ["stack-static-hosting"], docRoot: ".", startCommand: null };
    }

    // 12. Literature (mostly markdown/text files)
    {
      const LITERATURE_EXTS = new Set([".md", ".txt", ".rst", ".tex", ".adoc", ".org"]);
      const files = this.listShallowFiles(projectPath);
      const litCount = files.filter((f) => LITERATURE_EXTS.has(this.extOf(f))).length;
      if (files.length > 0 && litCount / files.length > 0.5) {
        return { projectType: "writing", suggestedStacks: ["stack-literature-reader"], docRoot: ".", startCommand: null };
      }
    }

    // 13. Media (mostly image/video files)
    {
      const MEDIA_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".mp4", ".webm", ".mov", ".avi", ".psd", ".ai", ".bmp", ".tiff"]);
      const files = this.listShallowFiles(projectPath);
      const mediaCount = files.filter((f) => MEDIA_EXTS.has(this.extOf(f))).length;
      if (files.length > 0 && mediaCount / files.length > 0.5) {
        return { projectType: "art", suggestedStacks: ["stack-media-gallery"], docRoot: ".", startCommand: null };
      }
    }

    // 14. Fallback
    return { projectType: "static-site", suggestedStacks: ["stack-static-hosting"], docRoot: "dist", startCommand: null };
  }

  // -------------------------------------------------------------------------
  // WhoDB — always-on database explorer
  // -------------------------------------------------------------------------

  private ensureWhoDB(): void {
    const containerName = "agi-whodb";
    const port = this.config.whodbPort ?? 5050;

    try {
      // Check if container exists and is running
      const state = execFileSync("podman", ["inspect", containerName, "--format", "{{.State.Status}}"], {
        stdio: "pipe", timeout: 10_000,
      }).toString().trim();

      if (state === "running") {
        this.log.info(`WhoDB already running on port ${String(port)}`);
        return;
      }

      // Container exists but stopped — start it
      if (state === "exited" || state === "stopped" || state === "created") {
        execFileSync("podman", ["start", containerName], { stdio: "pipe", timeout: 30_000 });
        this.log.info(`WhoDB started (was ${state})`);
        return;
      }
    } catch {
      // Container doesn't exist — create it
    }

    // Build env vars — pass AI provider keys if available
    const envArgs: string[] = [];
    if (process.env["ANTHROPIC_API_KEY"]) {
      envArgs.push("-e", `WHODB_ANTHROPIC_API_KEY=${process.env["ANTHROPIC_API_KEY"]}`);
    }
    if (process.env["OPENAI_API_KEY"]) {
      envArgs.push("-e", `WHODB_OPENAI_API_KEY=${process.env["OPENAI_API_KEY"]}`);
    }
    envArgs.push("-e", "WHODB_OLLAMA_HOST=host.containers.internal");
    envArgs.push("-e", "WHODB_OLLAMA_PORT=11434");

    try {
      // Pull image if not present (first run after install)
      try {
        execFileSync("podman", ["image", "exists", "docker.io/clidey/whodb:latest"], { stdio: "pipe", timeout: 10_000 });
      } catch {
        this.log.info("Pulling WhoDB image (first run)...");
        execFileSync("podman", ["pull", "docker.io/clidey/whodb:latest"], { stdio: "pipe", timeout: 300_000 });
      }

      execFileSync("podman", [
        "run", "-d",
        "--name", containerName,
        "--restart=always",
        "--label", "agi.infra=true",
        // Story #100 — aionima network, Caddy reaches by `agi-whodb:8080`.
        "--network=aionima",
        "-v", "whodb-data:/data",
        ...envArgs,
        "docker.io/clidey/whodb:latest",
      ], { stdio: "pipe", timeout: 60_000 });
      this.log.info(`WhoDB started on aionima network as ${containerName}`);
    } catch (err) {
      this.log.warn(`failed to start WhoDB: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Snapshot — used by boot-recovery to record what was running at shutdown
  // -------------------------------------------------------------------------

  /**
   * Return a minimal snapshot of currently-running project containers. Used by
   * the shutdown-marker writer in server.close() so the next boot can restart
   * exactly these containers if podman-restart missed them (e.g. after a hard
   * system crash).
   */
  snapshotRunning(): Array<{ slug: string; containerName: string }> {
    const out: Array<{ slug: string; containerName: string }> = [];
    for (const hosted of this.projects.values()) {
      if (hosted.status === "running" && hosted.containerName !== null) {
        out.push({
          slug: hosted.meta.hostname,
          containerName: hosted.containerName,
        });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    this.log.info("shutting down hosted projects...");

    // Stop polling and events stream
    if (this.statusPollTimer !== null) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }
    if (this.eventsProcess !== null) {
      try { this.eventsProcess.kill(); } catch { /* already dead */ }
      this.eventsProcess = null;
    }

    // Kill all tunnel processes (gateway-managed, not container processes)
    for (const [, proc] of this.tunnelProcesses) {
      try { proc.kill(); } catch { /* already dead */ }
    }
    this.tunnelProcesses.clear();

    // Do NOT stop containers — they persist as independent Podman processes.
    // The gateway will reconnect to them on next startup. Containers are only
    // replaced when their image changes (detected during initialize()).
    this.projects.clear();
    this.allocatedPorts.clear();
    this.log.info("hosting manager shut down");
  }

  // -------------------------------------------------------------------------
  // Cloudflare Named Tunnels (persistent URL across restarts)
  // -------------------------------------------------------------------------
  //
  // Named tunnels keep the same URL forever because Cloudflare assigns a
  // deterministic subdomain based on the tunnel ID:
  //   https://<tunnel-id>.cfargotunnel.com
  //
  // Credentials are stored per-project in ~/.agi/{slug}/tunnel.json.
  // Requires one-time `cloudflared tunnel login` (browser auth).

  /** Re-enable tunnels for projects that had them active before a restart/upgrade. */
  private async restoreTunnels(): Promise<void> {
    const projectsWithTunnels: string[] = [];

    for (const [path, hosted] of this.projects) {
      if (hosted.meta.tunnelId && hosted.status === "running") {
        projectsWithTunnels.push(path);
      }
    }

    if (projectsWithTunnels.length === 0) return;

    this.log.info(`restoring ${String(projectsWithTunnels.length)} tunnel(s)...`);

    for (const path of projectsWithTunnels) {
      try {
        const result = await this.enableTunnel(path);
        this.log.info(`tunnel restored for ${path}: ${result.url}`);
      } catch (err) {
        this.log.warn(`failed to restore tunnel for ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.notifyStatusChange();
  }

  /** Locate the cloudflared binary. Throws if not installed. */
  private ensureCloudflared(): string {
    try {
      return execSync("which cloudflared", { stdio: "pipe", timeout: 5000 }).toString().trim();
    } catch {
      throw new Error(
        "cloudflared not installed. Run: curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb && sudo dpkg -i /tmp/cloudflared.deb",
      );
    }
  }

  /** Read tunnel config fresh from gateway.json — picks up changes made since boot. */
  private readTunnelConfig(): { mode: "quick" | "named"; domain: string | undefined } {
    try {
      const cfgPath = join(homedir(), ".agi", "gateway.json");
      const raw = readFileSync(cfgPath, "utf-8");
      const cfg = JSON.parse(raw) as { hosting?: { tunnelMode?: string; tunnelDomain?: string } };
      return {
        mode: cfg.hosting?.tunnelMode === "quick" ? "quick" : "named",
        domain: cfg.hosting?.tunnelDomain || undefined,
      };
    } catch {
      return { mode: this.tunnelMode, domain: this.tunnelDomain };
    }
  }

  /** Check if cloudflared is authenticated (has origin cert from `cloudflared tunnel login`). */
  isCloudflaredAuthenticated(): boolean {
    const certPath = join(homedir(), ".cloudflared", "cert.pem");
    return existsSync(certPath);
  }

  /** Return composite status of cloudflared binary, auth, and active tunnels. */
  getCloudflaredStatus(): {
    binaryInstalled: boolean;
    binaryPath: string | null;
    authenticated: boolean;
    certPath: string;
    tunnelMode: "quick" | "named";
    tunnelDomain: string | null;
    activeTunnels: {
      projectPath: string;
      hostname: string;
      tunnelUrl: string;
      tunnelType: "quick" | "named";
      tunnelId: string | null;
    }[];
  } {
    let binaryInstalled = false;
    let binaryPath: string | null = null;
    try {
      binaryPath = execSync("which cloudflared", { stdio: "pipe", timeout: 5000 }).toString().trim();
      binaryInstalled = true;
    } catch { /* not installed */ }

    const certPath = join(homedir(), ".cloudflared", "cert.pem");
    const authenticated = existsSync(certPath);

    const activeTunnels: {
      projectPath: string;
      hostname: string;
      tunnelUrl: string;
      tunnelType: "quick" | "named";
      tunnelId: string | null;
    }[] = [];

    for (const [path, hosted] of this.projects) {
      if (hosted.tunnelUrl) {
        activeTunnels.push({
          projectPath: path,
          hostname: hosted.meta.hostname,
          tunnelUrl: hosted.tunnelUrl,
          tunnelType: hosted.meta.tunnelId ? "named" : "quick",
          tunnelId: hosted.meta.tunnelId ?? null,
        });
      }
    }

    const liveCfg = this.readTunnelConfig();
    return { binaryInstalled, binaryPath, authenticated, certPath, tunnelMode: liveCfg.mode, tunnelDomain: liveCfg.domain ?? null, activeTunnels };
  }

  /**
   * Start the interactive cloudflared login flow.
   * Spawns `cloudflared tunnel login`, captures the OAuth URL from stderr,
   * and returns it so the UI can display it to the user.
   */
  startCloudflaredLogin(): Promise<{ loginUrl: string; waitForCompletion: Promise<{ success: boolean; error?: string }> }> {
    // Prevent concurrent login attempts
    if (this.loginProcess) {
      try { this.loginProcess.kill(); } catch { /* ignore */ }
      this.loginProcess = null;
    }

    const bin = this.ensureCloudflared();

    return new Promise((resolve, reject) => {
      const child = spawn(bin, ["tunnel", "login"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.loginProcess = child;

      let stderrBuf = "";
      let urlResolved = false;
      const urlRegex = /https:\/\/dash\.cloudflare\.com\/[^\s]+/;

      const timeout = setTimeout(() => {
        if (!urlResolved) {
          try { child.kill(); } catch { /* ignore */ }
          this.loginProcess = null;
          reject(new Error("Timed out waiting for cloudflared login URL (30s)"));
        }
      }, 30_000);

      child.stderr.on("data", (data: Buffer) => {
        stderrBuf += data.toString();
        if (!urlResolved) {
          const match = urlRegex.exec(stderrBuf);
          if (match) {
            urlResolved = true;
            clearTimeout(timeout);
            const loginUrl = match[0];

            const waitForCompletion = new Promise<{ success: boolean; error?: string }>((completeResolve) => {
              child.on("close", (code) => {
                this.loginProcess = null;
                const success = code === 0 && this.isCloudflaredAuthenticated();
                completeResolve({ success, error: success ? undefined : `cloudflared login exited with code ${String(code)}` });
              });
              child.on("error", (err) => {
                this.loginProcess = null;
                completeResolve({ success: false, error: err.message });
              });
            });

            resolve({ loginUrl, waitForCompletion });
          }
        }
      });

      child.stdout.on("data", (data: Buffer) => {
        // cloudflared may also print the URL to stdout in some versions
        stderrBuf += data.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        this.loginProcess = null;
        if (!urlResolved) {
          reject(new Error(`cloudflared login exited (code ${String(code)}) before producing a URL`));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        this.loginProcess = null;
        if (!urlResolved) {
          reject(new Error(`cloudflared spawn error: ${err.message}`));
        }
      });
    });
  }

  /** Remove cloudflared authentication (deletes cert.pem). */
  revokeCloudflaredAuth(): { success: boolean; error?: string } {
    const certPath = join(homedir(), ".cloudflared", "cert.pem");
    if (!existsSync(certPath)) return { success: true };
    try {
      const { unlinkSync } = require("node:fs") as typeof import("node:fs");
      unlinkSync(certPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Get the credentials file path for a project's named tunnel. */
  private tunnelCredPath(projectPath: string): string {
    return join(homedir(), ".agi", projectSlug(projectPath), "tunnel.json");
  }

  /**
   * Enable a persistent named tunnel for a hosted project.
   * Creates the tunnel on first call, reuses it on subsequent calls.
   * The URL (https://<tunnel-id>.cfargotunnel.com) never changes.
   */
  async enableTunnel(projectPath: string): Promise<{ url: string }> {
    const resolved = resolvePath(projectPath);
    const hosted = this.projects.get(resolved);
    if (!hosted) throw new Error("Project is not hosted");
    if (hosted.status !== "running") throw new Error("Project container is not running");

    // Already running?
    const existing = this.tunnelProcesses.get(resolved);
    if (existing && hosted.tunnelUrl) {
      return { url: hosted.tunnelUrl };
    }

    const bin = this.ensureCloudflared();

    // Read tunnel config fresh from disk — user may have changed settings since boot
    const { mode, domain } = this.readTunnelConfig();

    // Use named tunnel if mode is "named", Cloudflare is authenticated, AND a tunnel domain is configured
    let result: { url: string };
    if (mode === "named" && this.isCloudflaredAuthenticated() && domain) {
      result = await this.enableNamedTunnel(resolved, hosted, bin, domain);
    } else {
      result = await this.enableQuickTunnel(resolved, hosted, bin);
    }

    // Restart the container so it picks up HOSTNAME_ALLOWED_ORIGIN with the tunnel hostname.
    // This ensures frameworks like Next.js accept HMR connections through the tunnel.
    if (hosted.meta.mode === "development" && hosted.containerName) {
      this.log.info(`[${hosted.meta.hostname}] restarting container to inject tunnel origin`);
      this.stopContainer(hosted);
      void this.startContainer(hosted);
      this.notifyStatusChange();
    }

    return result;
  }

  /** Quick tunnel — ephemeral random URL, no auth needed. Falls back here when Cloudflare is not authenticated. */
  private enableQuickTunnel(resolved: string, hosted: HostedProject, bin: string): Promise<{ url: string }> {
    return new Promise<{ url: string }>((resolve, reject) => {
      const child = spawn(bin, ["tunnel", "--url", `http://localhost:${String(hosted.meta.port)}`], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderrBuf = "";
      const urlRegex = /https:\/\/[-a-z0-9]+\.trycloudflare\.com/;
      let resolved_url = false;

      const timeout = setTimeout(() => {
        if (!resolved_url) {
          try { child.kill(); } catch { /* ignore */ }
          this.tunnelProcesses.delete(resolved);
          reject(new Error("Timed out waiting for cloudflared tunnel URL (15s)"));
        }
      }, 15_000);

      child.stderr.on("data", (data: Buffer) => {
        stderrBuf += data.toString();
        const match = urlRegex.exec(stderrBuf);
        if (match && !resolved_url) {
          resolved_url = true;
          clearTimeout(timeout);
          const url = match[0];

          hosted.tunnelUrl = url;
          hosted.tunnelPid = child.pid ?? null;
          hosted.meta.tunnelUrl = url;
          this.tunnelProcesses.set(resolved, child);
          this.writeHostingMeta(resolved, hosted.meta);
          this.notifyStatusChange();

          this.log.info(`[${hosted.meta.hostname}] quick tunnel active: ${url}`);
          resolve({ url });
        }
      });

      child.on("close", () => {
        clearTimeout(timeout);
        if (this.tunnelProcesses.get(resolved) === child) {
          this.tunnelProcesses.delete(resolved);
          hosted.tunnelUrl = null;
          hosted.tunnelPid = null;
          hosted.meta.tunnelUrl = null;
          this.writeHostingMeta(resolved, hosted.meta);
          this.notifyStatusChange();
          this.log.info(`[${hosted.meta.hostname}] quick tunnel closed`);
        }
        if (!resolved_url) {
          reject(new Error(`cloudflared exited before providing a URL. stderr: ${stderrBuf.slice(0, 500)}`));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        this.tunnelProcesses.delete(resolved);
        if (!resolved_url) {
          reject(new Error(`cloudflared spawn error: ${err.message}`));
        }
      });
    });
  }

  /** Named tunnel — persistent URL via Cloudflare DNS. Credentials stored in ~/.agi/{slug}/tunnel.json. */
  private async enableNamedTunnel(resolved: string, hosted: HostedProject, bin: string, domain: string): Promise<{ url: string }> {
    const credPath = this.tunnelCredPath(resolved);
    const tunnelName = `aionima-${hosted.meta.hostname}`;
    const dnsHostname = `${hosted.meta.hostname}.${domain}`;

    // Create tunnel if no credentials exist yet
    if (!existsSync(credPath)) {
      mkdirSync(dirname(credPath), { recursive: true });
      try {
        execSync(
          `${bin} tunnel create --credentials-file ${credPath} ${tunnelName}`,
          { stdio: "pipe", timeout: 30_000 },
        );
      } catch (err: unknown) {
        const stderr = (err as { stderr?: Buffer })?.stderr?.toString() ?? "";
        if (!stderr.includes("already exists")) {
          throw new Error(`Failed to create tunnel: ${stderr || (err instanceof Error ? err.message : String(err))}`);
        }
      }
    }

    let tunnelId: string;
    try {
      const creds = JSON.parse(readFileSync(credPath, "utf-8")) as { AccountTag: string; TunnelID: string; TunnelSecret: string };
      tunnelId = creds.TunnelID;
    } catch {
      throw new Error(`Cannot read tunnel credentials at ${credPath}`);
    }

    // Create DNS CNAME record: <hostname>.<tunnelDomain> → <tunnelId>.cfargotunnel.com
    try {
      execSync(
        `${bin} tunnel route dns ${tunnelName} ${dnsHostname}`,
        { stdio: "pipe", timeout: 30_000 },
      );
      this.log.info(`[${hosted.meta.hostname}] DNS route created: ${dnsHostname}`);
    } catch (err: unknown) {
      const stderr = (err as { stderr?: Buffer })?.stderr?.toString() ?? "";
      // "already exists" is fine — the CNAME was created on a previous run
      if (!stderr.includes("already exists")) {
        this.log.warn(`[${hosted.meta.hostname}] DNS route warning: ${stderr || (err instanceof Error ? err.message : String(err))}`);
      }
    }

    const url = `https://${dnsHostname}`;
    const configPath = join(dirname(credPath), "tunnel-config.yml");
    const configContent = [
      `tunnel: ${tunnelId}`,
      `credentials-file: ${credPath}`,
      `ingress:`,
      `  - hostname: ${dnsHostname}`,
      `    service: http://localhost:${String(hosted.meta.port)}`,
      `  - service: http_status:404`,
    ].join("\n");
    writeFileSync(configPath, configContent);

    return new Promise<{ url: string }>((resolve, reject) => {
      const child = spawn(bin, ["tunnel", "--config", configPath, "run"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderrBuf = "";
      let started = false;

      const timeout = setTimeout(() => {
        if (!started) {
          started = true;
          hosted.tunnelUrl = url;
          hosted.tunnelPid = child.pid ?? null;
          hosted.meta.tunnelUrl = url;
          hosted.meta.tunnelId = tunnelId;
          this.tunnelProcesses.set(resolved, child);
          this.writeHostingMeta(resolved, hosted.meta);
          this.notifyStatusChange();
          this.log.info(`[${hosted.meta.hostname}] named tunnel starting: ${url}`);
          resolve({ url });
        }
      }, 5_000);

      child.stderr.on("data", (data: Buffer) => {
        stderrBuf += data.toString();
        if (!started && (stderrBuf.includes("Registered tunnel connection") || stderrBuf.includes("Connection registered"))) {
          started = true;
          clearTimeout(timeout);
          hosted.tunnelUrl = url;
          hosted.tunnelPid = child.pid ?? null;
          hosted.meta.tunnelUrl = url;
          hosted.meta.tunnelId = tunnelId;
          this.tunnelProcesses.set(resolved, child);
          this.writeHostingMeta(resolved, hosted.meta);
          this.notifyStatusChange();
          this.log.info(`[${hosted.meta.hostname}] named tunnel active: ${url}`);
          resolve({ url });
        }
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (this.tunnelProcesses.get(resolved) === child) {
          this.tunnelProcesses.delete(resolved);
          hosted.tunnelPid = null;
          this.notifyStatusChange();
          this.log.info(`[${hosted.meta.hostname}] named tunnel process exited (code ${String(code)})`);
        }
        if (!started) {
          reject(new Error(`cloudflared exited before connecting. stderr: ${stderrBuf.slice(0, 500)}`));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        this.tunnelProcesses.delete(resolved);
        if (!started) {
          reject(new Error(`cloudflared spawn error: ${err.message}`));
        }
      });
    });
  }

  /** Kill a running tunnel for a hosted project. Keeps credentials so it can be re-enabled with the same URL. */
  disableTunnel(projectPath: string): void {
    const resolved = resolvePath(projectPath);
    const proc = this.tunnelProcesses.get(resolved);
    if (!proc) return;

    try { proc.kill(); } catch { /* already dead */ }
    this.tunnelProcesses.delete(resolved);

    const hosted = this.projects.get(resolved);
    if (hosted) {
      hosted.tunnelUrl = null;
      hosted.tunnelPid = null;
      hosted.meta.tunnelUrl = null;
      // Keep tunnelId — credentials persist in ~/.agi/{slug}/tunnel.json
      // Re-enabling will use the same URL
      this.writeHostingMeta(resolved, hosted.meta);
      this.log.info(`[${hosted.meta.hostname}] tunnel disabled (credentials preserved)`);
    }
    this.notifyStatusChange();
  }

  // -------------------------------------------------------------------------
  // Stack management
  // -------------------------------------------------------------------------

  /**
   * Add a stack to a project. For DB stacks with shared containers,
   * delegates to SharedContainerManager.
   */
  async addStack(projectPath: string, stackId: string): Promise<ProjectStackInstance> {
    const resolved = resolvePath(projectPath);
    if (!this.stackReg) throw new Error("Stack registry not available");

    const def = this.stackReg.get(stackId);
    if (!def) throw new Error(`Stack "${stackId}" not found in registry`);

    let databaseName: string | undefined;
    let databaseUser: string | undefined;
    let databasePassword: string | undefined;

    // Handle shared DB containers
    if (def.containerConfig?.shared && this.sharedContainers) {
      const hosted = this.projects.get(resolved);
      const hostname = hosted?.meta.hostname ?? this.slugFromPath(resolved);

      const result = await this.sharedContainers.addProject(
        def.containerConfig.sharedKey!,
        resolved,
        hostname,
        def.containerConfig,
        def.databaseConfig,
      );

      databaseName = result.databaseName;
      databaseUser = result.databaseUser;
      databasePassword = result.databasePassword;
    }

    const instance: ProjectStackInstance = {
      stackId,
      databaseName,
      databaseUser,
      databasePassword,
      addedAt: new Date().toISOString(),
    };

    // Persist to ~/.agi/{slug}/project.json
    this.writeStackInstance(resolved, instance);

    // Auto-run install actions sequentially
    const actionResults = await this.runInstallActions(resolved, def);

    this.notifyStatusChange();

    return { ...instance, actionResults } as ProjectStackInstance & { actionResults?: InstallActionResult[] };
  }

  /** Run install actions for a stack definition in the given project directory. */
  private async runInstallActions(projectPath: string, def: StackDefinition): Promise<InstallActionResult[]> {
    if (!def.installActions || def.installActions.length === 0) return [];
    const results: InstallActionResult[] = [];

    for (const action of def.installActions) {
      try {
        this.log.info(`[${def.id}] running action: ${action.label} (${action.id})`);
        execSync(action.command, {
          cwd: projectPath,
          timeout: 120_000,
          stdio: "pipe",
          env: { ...process.env },
        });
        results.push({ actionId: action.id, ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`[${def.id}] action "${action.id}" failed: ${msg}`);
        results.push({ actionId: action.id, ok: false, error: msg });
        if (!action.optional) break;
      }
    }

    return results;
  }

  /** Run a single install action by ID for a stack on a project. */
  async runStackAction(projectPath: string, stackId: string, actionId: string): Promise<InstallActionResult> {
    const resolved = resolvePath(projectPath);
    if (!this.stackReg) throw new Error("Stack registry not available");

    const def = this.stackReg.get(stackId);
    if (!def) throw new Error(`Stack "${stackId}" not found in registry`);

    const action = def.installActions?.find((a) => a.id === actionId);
    if (!action) throw new Error(`Action "${actionId}" not found in stack "${stackId}"`);

    try {
      this.log.info(`[${stackId}] re-running action: ${action.label} (${action.id})`);
      const output = execSync(action.command, {
        cwd: resolved,
        timeout: 120_000,
        stdio: "pipe",
        env: { ...process.env, TERM: "xterm-256color" },
      });
      return { actionId: action.id, ok: true, output: stripAnsi(output.toString()).slice(0, 4096) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { actionId: action.id, ok: false, error: stripAnsi(msg) };
    }
  }

  /**
   * Get aggregated dev commands from all installed stacks for a project.
   *
   * First-win deduplication: the first stack that declares a given command
   * key (e.g. "build") provides that command; later stacks declaring the
   * same key are logged as a collision and ignored. The UI shows a single
   * button per key.
   */
  getProjectDevCommands(projectPath: string): Record<string, string> {
    const resolved = resolvePath(projectPath);
    if (!this.stackReg) return {};

    const stacks = this.getProjectStacks(resolved);
    const merged: Record<string, string> = {};
    const providerFor: Record<string, string> = {};

    for (const instance of stacks) {
      const def = this.stackReg.get(instance.stackId);
      if (!def?.devCommands) continue;
      for (const [key, cmd] of Object.entries(def.devCommands)) {
        if (!cmd) continue;
        if (merged[key]) {
          // Collision: earlier stack already provided this key. Log once per collision
          // so stack authors / install-level conflicts are observable without spam.
          this.log.warn(
            `[stacks] dev-command collision on "${key}": already provided by ${providerFor[key]} (cmd="${merged[key]}"); ignoring duplicate from ${def.id} (cmd="${cmd}")`,
          );
          continue;
        }
        merged[key] = cmd;
        providerFor[key] = def.id;
      }
    }

    return merged;
  }

  /**
   * Resolve the effective container start command for a project, as it would
   * be computed at container boot. Exposes the same precedence ladder the
   * startContainer() path uses (override > stack.command > devCommands >
   * image-default) so the UI can show the user which source wins and what
   * the stack default would be.
   */
  getEffectiveStartCommand(projectPath: string): {
    effective: string | null;
    source: StartCommandSource;
    sourceLabel: string;
    override: string | null;
    stackDefault: string | null;
  } {
    const resolved = resolvePath(projectPath);
    const hosted = this.projects.get(resolved);
    if (!hosted) {
      return { effective: null, source: "image-default", sourceLabel: "image default CMD", override: null, stackDefault: null };
    }
    const stackDef = this.resolveStackDefinition(hosted);
    const stackConfig = this.resolveStackContainerConfig(hosted);
    let stackCommand: string[] | null = null;
    if (stackConfig) {
      const ctx: StackContainerContext = {
        projectPath: hosted.path,
        projectHostname: hosted.meta.hostname,
        allocatedPort: hosted.meta.port ?? 0,
        mode: hosted.meta.mode,
      };
      stackCommand = stackConfig.command?.(ctx) ?? null;
    }
    const result = resolveContainerStartCommand({
      userStartCommand: hosted.meta.startCommand,
      stackCommand,
      stackId: stackDef?.id,
      devCommands: stackDef?.devCommands,
      mode: hosted.meta.mode,
    });
    // Collapse tokens to a human-readable shell string for UI display.
    const asShellString = (tokens: string[] | null): string | null => {
      if (!tokens || tokens.length === 0) return null;
      if (tokens.length === 3 && tokens[0] === "sh" && tokens[1] === "-c") return tokens[2] ?? null;
      return tokens.join(" ");
    };
    // Compute what the stack-default would be (ignoring override) for UI display.
    const stackDefaultTokens = resolveContainerStartCommand({
      userStartCommand: undefined,
      stackCommand,
      stackId: stackDef?.id,
      devCommands: stackDef?.devCommands,
      mode: hosted.meta.mode,
    }).tokens;
    return {
      effective: asShellString(result.tokens),
      source: result.source,
      sourceLabel: result.sourceLabel,
      override: hosted.meta.startCommand && hosted.meta.startCommand.trim().length > 0
        ? hosted.meta.startCommand.trim()
        : null,
      stackDefault: asShellString(stackDefaultTokens),
    };
  }

  /**
   * Remove a stack from a project. Tears down DB if applicable,
   * removes from shared container.
   */
  async removeStack(projectPath: string, stackId: string): Promise<void> {
    const resolved = resolvePath(projectPath);
    if (!this.stackReg) throw new Error("Stack registry not available");

    const def = this.stackReg.get(stackId);
    const stacks = this.getProjectStacks(resolved);
    const instance = stacks.find((s) => s.stackId === stackId);
    if (!instance) return;

    // Handle shared DB container teardown
    if (def?.containerConfig?.shared && this.sharedContainers && def.databaseConfig) {
      const hosted = this.projects.get(resolved);
      const hostname = hosted?.meta.hostname ?? this.slugFromPath(resolved);
      const port = this.sharedContainers.has(def.containerConfig.sharedKey!)
        ? 0 : 0; // Port is managed internally by SharedContainerManager

      const ctx: StackContainerContext = {
        projectPath: resolved,
        projectHostname: hostname,
        allocatedPort: port,
        databaseName: instance.databaseName,
        databaseUser: instance.databaseUser,
        databasePassword: instance.databasePassword,
        mode: "development",
      };

      await this.sharedContainers.removeProject(
        def.containerConfig.sharedKey!,
        resolved,
        def.databaseConfig,
        ctx,
      );
    }

    // Remove from ~/.agi/{slug}/project.json
    this.removeStackInstance(resolved, stackId);
    this.notifyStatusChange();
  }

  /** Get all stack instances for a project. */
  getProjectStacks(projectPath: string): ProjectStackInstance[] {
    // Delegate to ProjectConfigManager when available
    if (this.configMgr) {
      return this.configMgr.getStacks(projectPath);
    }

    // Legacy fallback
    const resolved = resolvePath(projectPath);
    const metaPath = projectConfigPath(resolved);
    if (!existsSync(metaPath)) return [];
    try {
      const raw = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
      const hosting = raw.hosting as Record<string, unknown> | undefined;
      const stacks = hosting?.stacks as ProjectStackInstance[] | undefined;
      return stacks ?? [];
    } catch {
      return [];
    }
  }

  private writeStackInstance(projectPath: string, instance: ProjectStackInstance): void {
    // Delegate to ProjectConfigManager when available
    if (this.configMgr) {
      void this.configMgr.addStack(projectPath, instance);
      return;
    }

    // Legacy fallback
    const metaPath = projectConfigPath(projectPath);
    let existing: Record<string, unknown> = {};
    if (existsSync(metaPath)) {
      try {
        existing = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
      } catch { /* start fresh */ }
    }

    const hosting = (existing.hosting ?? {}) as Record<string, unknown>;
    const stacks = (hosting.stacks ?? []) as ProjectStackInstance[];
    stacks.push(instance);
    hosting.stacks = stacks;
    existing.hosting = hosting;
    mkdirSync(dirname(metaPath), { recursive: true });
    writeFileSync(metaPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  }

  private removeStackInstance(projectPath: string, stackId: string): void {
    // Delegate to ProjectConfigManager when available
    if (this.configMgr) {
      void this.configMgr.removeStack(projectPath, stackId);
      return;
    }

    // Legacy fallback
    const metaPath = projectConfigPath(projectPath);
    if (!existsSync(metaPath)) return;
    try {
      const existing = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
      const hosting = (existing.hosting ?? {}) as Record<string, unknown>;
      const stacks = (hosting.stacks ?? []) as ProjectStackInstance[];
      hosting.stacks = stacks.filter((s) => s.stackId !== stackId);
      existing.hosting = hosting;
      mkdirSync(dirname(metaPath), { recursive: true });
      writeFileSync(metaPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
    } catch { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private notifyStatusChange(): void {
    if (this.onStatusChange) {
      this.onStatusChange();
    }
  }
}
