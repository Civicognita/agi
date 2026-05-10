/**
 * Gateway Runtime State — assembles the HTTP server, WebSocket server,
 * and shared runtime objects (clients set, broadcast fn).
 *
 * Analogue of OpenClaw's server-runtime-state.ts.
 * Called from server.ts step 4.
 *
 * Uses Fastify v5 instead of raw http.createServer.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, statSync, mkdirSync, readdirSync, rmSync, realpathSync, cpSync, renameSync } from "node:fs";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { execSync, execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { Server as HttpServer, IncomingMessage } from "node:http";

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";

import type { GatewayAuth } from "./auth.js";
import type { GatewayStateMachine } from "./state-machine.js";
import type { AgentSessionManager } from "./agent-session.js";
import type { ChannelRegistry } from "./channel-registry.js";
import type { DashboardApi } from "./dashboard-api.js";
import type { DashboardQueries } from "./dashboard-queries.js";
import { GatewayWebSocketServer } from "./ws-server.js";
import { handlePlanRequest } from "./plan-api.js";
import { readProjectMcpServers, setDotMcpServer, removeDotMcpServer } from "./mcp-config-store.js";
import type { EntityStore, CommsLog, NotificationStore } from "@agi/entity-model";
import { fetchOwnerToken, injectTokenIntoCloneUrl } from "./dev-mode-auth.js";
import { createComponentLogger } from "./logger.js";
import type { Logger } from "./logger.js";
import { probeGpuStats } from "./hardware-probe.js";
import type { GpuLiveStats } from "./hardware-probe.js";
import { CpuPowerSampler, GpuPowerSampler } from "./system-power.js";
import { appRouter, type AppContext } from "@agi/trpc-api";
import type { HostingManager } from "./hosting-manager.js";
import { registerHostingRoutes } from "./hosting-api.js";
import { registerStackRoutes } from "./stack-api.js";
import { registerMAppStorageRoutes } from "./mapp-storage-routes.js";
import { safemodeState } from "./safemode-state.js";
import type { RouteHandler, RuntimeDefinition } from "@agi/plugins";
import { categoryToProvides } from "@agi/plugins";
import type { ServiceManager } from "./service-manager.js";
import { registerCommsRoutes } from "./comms-api.js";
import { registerModelsRoutes } from "./models-api.js";
import type { ChatPersistence } from "./chat-persistence.js";
import { registerChatHistoryRoutes } from "./chat-history-api.js";
import { registerMachineAdminRoutes } from "./machine-admin-api.js";
import { registerOnboardingRoutes } from "./onboarding-api.js";
import type { SecretsManager } from "./secrets.js";
import { DashboardUserStore, hasRole } from "./dashboard-user-store.js";
import { LocalIdAuthProvider } from "./local-id-auth-provider.js";
import type { IdentityProvider } from "./identity-provider.js";
import type { OAuthHandler } from "./oauth-handler.js";
import { registerIdentityRoutes } from "./identity-api.js";
import { registerSubUserRoutes } from "./sub-user-api.js";
import type { VisitorAuthManager } from "./visitor-auth.js";
import type { FederationNode } from "./federation-node.js";
import type { COAChainLogger } from "@agi/coa-chain";
import type { DashboardSession } from "./dashboard-user-store.js";
import type { FederationRouter as FedRouter } from "./federation-router.js";
import { appendUpgradeLog, clearUpgradeLog, getUpgradeLog } from "./upgrade-log.js";
import { projectConfigPath } from "./project-config-path.js";
import {
  buildCandidatePayload,
  clearRawCaptures,
  findPromotionCandidates,
  listIssues as listIssuesStore,
  listRawCaptures,
  logIssue as logIssueStore,
  promoteRawCapture as promoteRawCaptureStore,
  readIssue as readIssueStore,
  recordRawCapture as recordRawCaptureStore,
  searchIssues as searchIssuesStore,
  updateIssueStatus as updateIssueStatusStore,
  type IssueIndexEntry,
  type IssueStatus,
} from "./issues/index.js";
import { dispatchJobsDir } from "./dispatch-paths.js";
import { summarizeQueue, type DispatchJobLike } from "./taskmaster-queue-diagnostic.js";
import type { IterativeWorkScheduler } from "./iterative-work/scheduler.js";
import { cadenceToStaggeredCron } from "./iterative-work/cron.js";
import {
  listProjectEnvKeys,
  readProjectEnv,
  removeProjectEnvVar,
  resolveDollarVars,
  resolveDollarVarsObject,
  setProjectEnvVar,
} from "./project-env-store.js";
import {
  ITERATIVE_WORK_ELIGIBLE_CATEGORIES,
  TESTING_UX_ELIGIBLE_CATEGORIES,
  cadenceOptionsFor,
  type IterativeWorkCadence,
  type ProjectCategory,
} from "./project-types.js";
import type { ProjectConfigManager } from "./project-config-manager.js";
import type { PmProvider } from "@agi/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Sacred-project basenames — the gateway never treats these as user projects.
// Keep in sync with project-config-path.ts and scripts/migrate-projects-s140.sh.
// Includes (a) the workspace-grouping `_aionima/` container per cycle 150,
// (b) the Civicognita core 5, (c) the Particle-Academy 4 (5 with fancy-3d).
const SACRED_PROJECT_NAMES = new Set([
  "_aionima",
  "agi", "prime", "id", "marketplace", "mapp-marketplace",
  "react-fancy", "fancy-code", "fancy-sheets", "fancy-echarts", "fancy-3d",
]);

function isSacredProjectPath(pathStr: string): boolean {
  return SACRED_PROJECT_NAMES.has(basename(pathStr).toLowerCase());
}

/** Lightweight type for widget endpoint resolution (avoids importing full PanelWidget). */
type PanelWidgetAny = Record<string, unknown>;

/**
 * Resolve relative widget endpoints (statusEndpoint, dataEndpoint, valueEndpoint)
 * by prepending the plugin's route prefix. Absolute paths (starting with /api/) are
 * left unchanged for backward compatibility.
 */
function resolveWidgetEndpoints(widgets: PanelWidgetAny[], pluginId: string): PanelWidgetAny[] {
  const prefix = `/api/plugins/${pluginId}`;
  return widgets.map((w) => {
    const resolved = { ...w };
    for (const key of ["statusEndpoint", "dataEndpoint", "valueEndpoint", "logSource"] as const) {
      const val = w[key];
      if (typeof val === "string" && val.startsWith("/") && !val.startsWith("/api/")) {
        resolved[key] = `${prefix}${val}`;
      }
    }
    return resolved;
  });
}


function resolveIdUrl(configPath?: string): string {
  if (!configPath) return "https://id.ai.on";
  try {
    const cfg = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const idSvc = cfg.idService as { local?: { enabled?: boolean; subdomain?: string } } | undefined;
    const hosting = cfg.hosting as { baseDomain?: string } | undefined;
    if (idSvc?.local?.enabled) {
      const sub = idSvc.local.subdomain ?? "id";
      const domain = hosting?.baseDomain ?? "ai.on";
      return `https://${sub}.${domain}`;
    }
  } catch { /* fallback */ }
  return "https://id.ai.on";
}

export interface RuntimeStateDeps {
  auth: GatewayAuth;
  stateMachine: GatewayStateMachine;
  agentSessionManager: AgentSessionManager;
  channelRegistry: ChannelRegistry;
  dashboardApi: DashboardApi;
  /** EntityStore — needed for entity lookups. */
  entityStore?: EntityStore;
  /** COA logger — used for audit logging. */
  coaLogger?: COAChainLogger;
  /** COA resource ID (e.g. $A0). */
  resourceId?: string;
  /** COA node ID (e.g. @A0). */
  nodeId?: string;
  /** Owner entity ID — used for audit logging. */
  ownerEntityId?: string;
  /** Late-bound WS server reference for broadcasting events from HTTP handlers. */
  wsRef?: { server: GatewayWebSocketServer | null };
  /** Callback invoked on POST /api/reload — re-indexes PRIME, re-discovers skills, etc. */
  onReload?: () => ReloadResult;
  /** Path to the gateway.json config file — enables GET/PUT /api/config. */
  configPath?: string;
  /** Directory containing built dashboard static files (e.g. ui/dashboard/dist). */
  staticDir?: string;
  /** Workspace project directories (from config.workspace.projects). */
  workspaceProjects?: string[];
  /** Workspace root path — used for BOTS CLI invocations. */
  workspaceRoot?: string;
  /** Path to the aionima source repo (enables update detection + upgrade). */
  selfRepoPath?: string;
  /** Running AGI version (from root package.json). Surfaced on /health so
   *  the dashboard's version-mismatch detector can force-reload stale tabs
   *  after an upgrade. */
  agiVersion?: string;
  /** Optional logger instance. */
  logger?: Logger;
  /**
   * DashboardQueries instance — passed directly to the tRPC context.
   * If omitted, tRPC dashboard procedures will not be available.
   */
  dashboardQueries?: DashboardQueries;
  /** HostingManager — manages Caddy + Node.js process lifecycle for hosted projects. */
  hostingManager?: HostingManager;
  /** s143 t570 — CircuitBreakerTracker for the /api/services/circuit-breakers
   *  endpoints. Optional: when omitted, the breaker routes return empty
   *  state + 503 on reset attempts. */
  circuitBreaker?: import("./circuit-breaker.js").CircuitBreakerTracker;
  /** IterativeWorkScheduler — exposes status + receives config changes for the
   *  iterative-work API surface. Optional: when omitted, the iterative-work
   *  routes return 503. */
  iterativeWorkScheduler?: IterativeWorkScheduler;
  /** ProjectConfigManager — used by the iterative-work PUT route to validate +
   *  persist iterativeWork config changes through the same atomic-write path
   *  as other project metadata mutations. */
  projectConfigManager?: ProjectConfigManager;
  /** PmProvider — used by the iterative-work progress route (t439) to
   *  surface Race-to-DONE counts. Optional: when missing or when the
   *  provider doesn't expose getActiveFocusProgress, the route returns 503. */
  pmProvider?: PmProvider;
  /** McpClient — used by the per-project MCP tab routes (Wish #7 / s125) to
   *  register/unregister/test MCP servers + surface listServers state. */
  mcpClient?: import("@agi/mcp-client").McpClient;
  /** Path to the MApp marketplace directory (for catalog browsing). */
  mappMarketplaceDir?: string;
  /** CommsLog — persistent message log for comms page. */
  commsLog?: CommsLog;
  /** NotificationStore — persistent notification storage. */
  notificationStore?: NotificationStore;
  /** ChatPersistence — file-based chat history storage. */
  chatPersistence?: ChatPersistence;
  /** ImageBlobStore — file-backed image storage for chat sessions. */
  imageBlobStore?: import("./image-blob-store.js").ImageBlobStore;
  /** PluginRegistry — loaded plugin instances (for GET /api/plugins + HTTP route mounting).
   *  s101 t606 cycle 195 — replaced 29-line inline structural type with the
   *  imported class type from @agi/plugins. Same hidden-drift risk as the
   *  cycle-194 marketplace sweep — typecheck surfaces consumer mismatches. */
  pluginRegistry?: import("@agi/plugins").PluginRegistry;
  /** All discovered plugins (including disabled ones) — for showing full list in GET /api/plugins. */
  discoveredPlugins?: {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string | null;
    permissions: string[];
    category: string;
    basePath: string;
    bakedIn: boolean;
    disableable: boolean;
    provides?: string[];
    depends?: string[];
  }[];
  /** Plugin preferences from config (enabled/priority per plugin ID). */
  pluginPrefs?: Record<string, { enabled?: boolean; priority?: number }>;
  /** StackRegistry — composable stack definitions. */
  stackRegistry?: import("./stack-registry.js").StackRegistry;
  /** SharedContainerManager — shared database containers. */
  sharedContainerManager?: import("./shared-container-manager.js").SharedContainerManager;
  /** ServiceManager — manages infrastructure service containers. */
  serviceManager?: ServiceManager;
  /** SecretsManager — TPM2-sealed credential store. */
  secrets?: SecretsManager;
  /** UsageStore — LLM token usage and cost tracking. */
  usageStore?: { getSummary(days?: number): unknown; getByProject(days?: number): unknown; getByProjectAndSource(days?: number): unknown; getHistory(days?: number, bucket?: string): unknown };

  /** MAppRegistry — standalone MApp registry (NOT plugin-based). */
  mappRegistry?: import("./mapp-registry.js").MAppRegistry;
  /** InferenceGateway — used for model-inference workflow steps. */
  inferenceGateway?: import("@agi/model-runtime").InferenceGateway;
  /** ModelStore — used for model dependency status checks. */
  modelStore?: import("@agi/model-runtime").ModelStore;
  /** s140 t599 cycle 194 — replaced 10-line inline structural type with the
   *  imported class type from @agi/marketplace. Keeps the dep in sync with
   *  the source-of-truth API. Cycle-189 t598 spotted this drift; cycle-194
   *  closes it. */
  mappMarketplaceManager?: import("@agi/marketplace").MAppMarketplaceManager;
  /** MagicAppStateStore — persistent MApp instance state. */
  magicAppStateStore?: import("./magic-app-state-store.js").MagicAppStateStore;

  /** Parsed config object — passed to subsystems that need runtime config access. */
  config?: Record<string, unknown>;
  /** HMAC secret for GitHub webhook signature verification. */
  webhookSecret?: string;
  /** PrimeLoader instance — enables GET /api/prime/status + POST /api/prime/switch. */
  primeLoader?: import("./prime-loader.js").PrimeLoader;
  /** AionMicroManager — enables agentic merge conflict resolution for core forks. */
  aionMicro?: import("./aion-micro-manager.js").AionMicroManager;
  /** Resolved prime directory path. */
  primeDir?: string;
  /** MarketplaceManager — Claude Code-compatible plugin marketplace.
   *  s140 t599 cycle 194 — replaced 17-line inline structural type with
   *  the imported class type from @agi/marketplace. */
  marketplaceManager?: import("@agi/marketplace").MarketplaceManager;
  /** Callback to hot-load a newly installed plugin (discover, activate, bridge). */
  onPluginInstalled?: (installPath: string) => Promise<{ loaded: boolean; pluginId?: string; error?: string }>;
  /** Callback to hot-reload an updated plugin (with ESM cache busting). */
  onPluginUpdated?: (installPath: string) => Promise<{ loaded: boolean; pluginId?: string; error?: string }>;
  /** Callback to deactivate a plugin before update (unbridge, unregister, deactivate). */
  onPluginDeactivating?: (pluginId: string) => Promise<void>;
  /** Federation — identity provider, OAuth, visitor auth, federation node/router. */
  identityProvider?: IdentityProvider;
  oauthHandler?: OAuthHandler | null;
  visitorAuth?: VisitorAuthManager;
  federationNode?: FederationNode;
  federationRouter?: FedRouter;
  /** Callbacks to register additional routes before fastify.listen(). */
  preListenHooks?: ((fastify: import("fastify").FastifyInstance) => void)[];
}

export interface ReloadResult {
  primeEntries: number;
  skillCount: number;
  timestamp: string;
}

export interface RuntimeStateOptions {
  host: string;
  port: number;
}

export interface GatewayRuntimeState {
  httpServer: HttpServer;
  wsServer: GatewayWebSocketServer;
  /** The underlying Fastify instance — use .close() to shut down cleanly. */
  fastify: ReturnType<typeof Fastify>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function isPrivateNetwork(ip: string): boolean {
  if (isLoopback(ip)) return true;
  // Strip IPv4-mapped IPv6 prefix
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length === 4) {
    // 10.x.x.x, 172.16-31.x.x, 192.168.x.x
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  // IPv6 link-local (fe80::)
  if (ip.startsWith("fe80:")) return true;
  return false;
}

function getClientIp(req: IncomingMessage & { ip?: string }): string {
  // Use Fastify's req.ip when available — it handles proxy trust correctly
  // based on the trustProxy configuration. Only fall back to raw socket address.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function extractBearerToken(req: IncomingMessage): string | undefined {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader !== "string") return undefined;
  if (!authHeader.startsWith("Bearer ")) return undefined;
  return authHeader.slice(7);
}

function extractDashboardSession(
  req: IncomingMessage,
  store: DashboardUserStore,
): DashboardSession | null {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  return store.verifySession(token);
}

// ---------------------------------------------------------------------------
// Git dashboard helper (owner-facing, no blocked-command checks)
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile);

const MAX_GIT_STDOUT = 32 * 1024; // 32KB

interface GitExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function execGitDashboard(args: string[], cwd: string): Promise<GitExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return {
      stdout: stdout.length > MAX_GIT_STDOUT ? stdout.slice(0, MAX_GIT_STDOUT) : stdout,
      stderr,
      exitCode: 0,
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: typeof e.stdout === "string" ? e.stdout.slice(0, MAX_GIT_STDOUT) : "",
      stderr: typeof e.stderr === "string" ? e.stderr : (err instanceof Error ? err.message : String(err)),
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Git status parser: git status --porcelain=v1 -b
// ---------------------------------------------------------------------------

interface GitFileEntry {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied";
}

function parseStatusCode(code: string): GitFileEntry["status"] {
  switch (code) {
    case "A": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    default: return "modified";
  }
}

function parseGitStatus(raw: string): {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: string[];
} {
  const lines = raw.split("\n").filter((l) => l.length > 0);
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const staged: GitFileEntry[] = [];
  const unstaged: GitFileEntry[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      // ## branch...upstream [ahead N, behind M]
      const rest = line.slice(3);
      const bracketIdx = rest.indexOf("[");
      const branchPart = bracketIdx >= 0 ? rest.slice(0, bracketIdx).trim() : rest.trim();
      const dotIdx = branchPart.indexOf("...");
      if (dotIdx >= 0) {
        branch = branchPart.slice(0, dotIdx);
        upstream = branchPart.slice(dotIdx + 3);
      } else {
        branch = branchPart === "No commits yet on master" || branchPart.startsWith("No commits yet")
          ? branchPart.replace("No commits yet on ", "")
          : branchPart;
      }
      if (bracketIdx >= 0) {
        const info = rest.slice(bracketIdx);
        const aheadMatch = info.match(/ahead (\d+)/);
        const behindMatch = info.match(/behind (\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1]!, 10);
        if (behindMatch) behind = parseInt(behindMatch[1]!, 10);
      }
      continue;
    }
    if (line.length < 4) continue;
    const x = line[0]!; // staged status
    const y = line[1]!; // worktree status
    const filePath = line.slice(3);
    if (x === "?" && y === "?") {
      untracked.push(filePath);
    } else {
      if (x !== " " && x !== "?") {
        staged.push({ path: filePath, status: parseStatusCode(x) });
      }
      if (y !== " " && y !== "?") {
        unstaged.push({ path: filePath, status: parseStatusCode(y) });
      }
    }
  }
  return { branch, upstream, ahead, behind, staged, unstaged, untracked };
}

// ---------------------------------------------------------------------------
// createGatewayRuntimeState
// ---------------------------------------------------------------------------

/**
 * Creates the Fastify HTTP server with request routing and attaches the
 * WebSocket server to share the same port.
 *
 * HTTP routes mounted in priority order:
 *   1. GET /health — loopback-exempt, others need token
 *   2. GET /api/trpc/* — tRPC router (dashboard, config, system procedures)
 *   3. GET /api/dashboard/* — legacy routes via DashboardApi (backward compat)
 *   4. GET /api/channels — auth-gated channel list
 *   5. /api/plans/*, /api/projects/*, /api/taskmaster/*, /api/reload, /api/config, /api/system/*
 *   6. Static dashboard files (SPA with fallback to index.html)
 *   7. 404 fallback
 */

/** Guard: only one upgrade at a time across the process. */
let upgradeInProgress = false;
let upgradeStartedAt = 0;

/** Fetch cache — avoid hammering the remote on rapid poll calls. */
let lastFetchTime = 0;
const FETCH_CACHE_TTL_MS = 30_000;

export async function createGatewayRuntimeState(
  deps: RuntimeStateDeps,
  opts: RuntimeStateOptions,
): Promise<GatewayRuntimeState> {
  const { auth, stateMachine, agentSessionManager, channelRegistry, dashboardApi } = deps;
  const log = createComponentLogger(deps.logger, "server");

  const fastify = Fastify({ logger: false });

  // -----------------------------------------------------------------------
  // Security headers + CORS — applied to every response
  // -----------------------------------------------------------------------

  fastify.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-XSS-Protection", "0");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    // CORS — only reflect origin if it is in the configured allow-list
    const origin = _req.headers.origin;
    if (origin) {
      let allowedOrigins: string[] = ["http://localhost:3001"];
      if (deps.configPath) {
        try {
          const cfgRaw = readFileSync(deps.configPath, "utf-8");
          const cfgParsed = JSON.parse(cfgRaw) as { cors?: { allowedOrigins?: string[] } };
          allowedOrigins = cfgParsed.cors?.allowedOrigins ?? allowedOrigins;
        } catch { /* use defaults */ }
      }
      if (allowedOrigins.includes(origin)) {
        reply.header("Access-Control-Allow-Origin", origin);
        reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
        reply.header("Access-Control-Allow-Credentials", "true");
      }
    }
  });

  // -----------------------------------------------------------------------
  // Dashboard auth store (if enabled)
  // -----------------------------------------------------------------------

  let dashboardUserStore: DashboardUserStore | undefined;
  if (deps.configPath) {
    try {
      const cfgRaw = readFileSync(deps.configPath, "utf-8");
      const cfg = JSON.parse(cfgRaw) as { dashboardAuth?: { enabled?: boolean; jwtSecret?: string; sessionTtlMs?: number } };
      if (cfg.dashboardAuth?.enabled) {
        const dataDir = join(resolvePath(deps.configPath, ".."), "data");
        const secret = cfg.dashboardAuth.jwtSecret ?? (() => {
          const generated = randomBytes(32).toString("hex");
          log.warn("No dashboardAuth.jwtSecret configured — auto-generated ephemeral secret (sessions will not survive restarts)");
          return generated;
        })();
        const ttl = cfg.dashboardAuth.sessionTtlMs ?? 86400000;
        dashboardUserStore = new DashboardUserStore(dataDir, secret, ttl);
      }
    } catch { /* config unreadable — skip dashboard auth */ }
  }

  // -----------------------------------------------------------------------
  // Local-ID auth provider (if ID service is configured)
  // -----------------------------------------------------------------------

  let localIdAuthProvider: LocalIdAuthProvider | undefined;
  let localIdBaseUrl: string | undefined;
  if (deps.configPath) {
    try {
      const cfgRaw = readFileSync(deps.configPath, "utf-8");
      const cfg = JSON.parse(cfgRaw) as Record<string, unknown>;
      const idService = cfg.idService as Record<string, unknown> | undefined;
      const local = idService?.local as Record<string, unknown> | undefined;

      if (local?.enabled) {
        const hosting = cfg.hosting as Record<string, unknown> | undefined;
        const baseDomain = (hosting?.baseDomain as string) ?? "ai.on";
        const subdomain = (local.subdomain as string) ?? "id";
        localIdBaseUrl = `https://${subdomain}.${baseDomain}`;
        const secret = (cfg.dashboardAuth as Record<string, unknown> | undefined)?.jwtSecret as string
          ?? (() => {
            const generated = randomBytes(32).toString("hex");
            log.warn("No dashboardAuth.jwtSecret configured — auto-generated ephemeral secret (sessions will not survive restarts)");
            return generated;
          })();
        const ttl = (cfg.dashboardAuth as Record<string, unknown> | undefined)?.sessionTtlMs as number
          ?? 86400000;
        localIdAuthProvider = new LocalIdAuthProvider(localIdBaseUrl, secret, ttl, deps.logger);
      }
    } catch { /* config unreadable — skip Local-ID auth */ }
  }

  // Mark DashboardUserStore as deprecated when Local-ID is available
  if (dashboardUserStore && localIdBaseUrl) {
    dashboardUserStore.localIdAvailable = true;
  }

  // -----------------------------------------------------------------------
  // Auth hook — runs on every request
  // -----------------------------------------------------------------------

  fastify.addHook("onRequest", async (request, reply) => {
    const clientIp = getClientIp(request.raw);

    // /health is loopback-exempt
    if (request.url === "/health" || request.url.startsWith("/health?")) {
      if (isLoopback(clientIp) || !auth.hasCredentials) return;
      const token = extractBearerToken(request.raw);
      const result = auth.authenticate(clientIp, token);
      if (!result.authenticated) {
        await reply.code(401).send({ error: "Unauthorized" });
      }
      return;
    }

    // All other routes: allow private network unconditionally; when credentials
    // are configured, require a valid bearer token from external IPs.
    if (isPrivateNetwork(clientIp)) return;
    if (!auth.hasCredentials) return;

    const token = extractBearerToken(request.raw);
    const authResult = auth.authenticate(clientIp, token);
    if (!authResult.authenticated) {
      await reply.code(401).send({ error: "Unauthorized" });
    }
  });

  // -----------------------------------------------------------------------
  // Safemode hook — block mutations when the gateway booted into safemode.
  // Allows GET/HEAD/OPTIONS, /api/admin/*, /health, and the static dashboard.
  // Runs after auth so unauthorized requests are already rejected.
  // -----------------------------------------------------------------------

  fastify.addHook("onRequest", async (request, reply) => {
    if (!safemodeState.isActive()) return;

    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

    const url = request.url;
    if (url.startsWith("/api/admin/")) return;
    if (url === "/health" || url.startsWith("/health?")) return;
    if (url === "/api/health" || url.startsWith("/api/health?")) return;

    await reply.code(503).send({
      error: "safemode_active",
      message: "Gateway is in safemode — the last shutdown was a crash. Review the incident report in Admin and click Recover to exit safemode.",
      snapshot: safemodeState.snapshot(),
    });
  });

  // -----------------------------------------------------------------------
  // GET /health
  // -----------------------------------------------------------------------

  fastify.get("/health", async (_request, reply) => {
    return reply.send({
      ok: true,
      state: stateMachine.getState(),
      uptime: process.uptime(),
      channels: channelRegistry.getRunningChannels().length,
      sessions: agentSessionManager.count,
      // Client-side version-mismatch detector polls `/health` and
      // reloads the page when this drifts from the build-time
      // __AGI_VERSION__. Stops users from hitting TypeError crashes
      // from stale JS after an `agi upgrade` restart.
      version: deps.agiVersion ?? "unknown",
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/gateway/restart — request a graceful restart (private only).
  //
  // Sends SIGTERM to our own process after flushing the response. The signal
  // handler in cli/src/commands/run.ts runs server.close(), which writes the
  // graceful-shutdown marker (see feedback_agi_self_heals.md). systemd
  // restart=always brings the service back up; boot resumes state from the
  // marker. Equivalent to `agi restart` — no sudo required because we only
  // signal ourselves.
  // -----------------------------------------------------------------------

  fastify.post("/api/gateway/restart", async (request, reply) => {
    if (!isPrivateNetwork(getClientIp(request.raw))) {
      return reply.code(403).send({ error: "Gateway restart only allowed from private network" });
    }
    const log = createComponentLogger(deps.logger, "restart-api");
    log.info("gateway restart requested via POST /api/gateway/restart");
    // Flush the response before exiting. setTimeout ensures the Fastify reply
    // leaves the wire before SIGTERM tears down the process.
    setTimeout(() => {
      process.kill(process.pid, "SIGTERM");
    }, 100);
    return reply.send({ ok: true, message: "Gateway restart queued; service will be back up in a few seconds." });
  });

  // -----------------------------------------------------------------------
  // GET /api/gateway/state — current computed operational state.
  //
  // This is a READ-ONLY status, not a setting. States:
  //   INITIAL — boot not yet complete
  //   LIMBO   — local COA<>COI not yet validated with 0PRIME Schema (the
  //             expected steady state until 0PRIME Hive mind is operational)
  //   OFFLINE — local-id or local-prime unavailable
  //   ONLINE  — future; requires 0PRIME (not yet operational)
  // -----------------------------------------------------------------------

  fastify.get("/api/gateway/state", async () => {
    return { state: stateMachine.getState(), capabilities: stateMachine.getCapabilities() };
  });

  // -----------------------------------------------------------------------
  // GET /api/system/runtime-mode — dashboard consults this to gate features
  // that don't make sense in test-VM (nested test-vm spawn, contributing
  // toggle, upgrade buttons, aionima-collection tiles). s118 redesign t122.
  //
  // Mode resolution order:
  //   1. AIONIMA_RUNTIME_MODE env var — explicit override
  //   2. AIONIMA_TEST_VM=1 env var → "test-vm"
  //   3. hostname matches /^agi-test\b/ → "test-vm"
  //   4. NODE_ENV === "development" → "dev"
  //   5. otherwise → "production"
  // -----------------------------------------------------------------------

  fastify.get("/api/system/runtime-mode", async (request, reply) => {
    if (!isPrivateNetwork(getClientIp(request.raw))) {
      return reply.code(403).send({ error: "System API only allowed from private network" });
    }
    const explicit = process.env["AIONIMA_RUNTIME_MODE"];
    let mode: "production" | "test-vm" | "dev";
    if (explicit === "production" || explicit === "test-vm" || explicit === "dev") {
      mode = explicit;
    } else if (process.env["AIONIMA_TEST_VM"] === "1") {
      mode = "test-vm";
    } else {
      let hostname = "";
      try { hostname = execFileSync("hostname", [], { encoding: "utf-8", stdio: "pipe" }).trim(); } catch { /* ignore */ }
      if (/^agi-test\b/i.test(hostname)) {
        mode = "test-vm";
      } else if (process.env["NODE_ENV"] === "development") {
        mode = "dev";
      } else {
        mode = "production";
      }
    }
    return reply.send({ mode });
  });

  // -----------------------------------------------------------------------
  // GET /api/system/connections — AGI / PRIME / workspace status (private)
  // -----------------------------------------------------------------------

  fastify.get("/api/system/connections", async (request, reply) => {
    if (!isPrivateNetwork(getClientIp(request.raw))) {
      return reply.code(403).send({ error: "System API only allowed from private network" });
    }

    const gitInfo = (cwd: string) => {
      try {
        const branch = execSync("git branch --show-current", { cwd, encoding: "utf-8", stdio: "pipe" }).trim() || "main";
        const commit = execSync("git rev-parse --short HEAD", { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
        return { branch, commit };
      } catch {
        return null;
      }
    };

    // AGI — the gateway itself
    const agiRoot = deps.selfRepoPath ?? deps.workspaceRoot ?? process.cwd();
    const agiGit = gitInfo(agiRoot);
    const agi = {
      status: "connected" as const,
      branch: agiGit?.branch ?? "unknown",
      commit: agiGit?.commit ?? "unknown",
      uptime: Math.floor(process.uptime()),
      state: stateMachine.getState(),
    };

    // PRIME — knowledge corpus
    const primeDir = deps.primeDir ?? join(agiRoot, ".aionima");
    let prime: { status: "connected" | "missing" | "error"; dir: string; entries: number; branch?: string };
    if (!existsSync(primeDir)) {
      prime = { status: "missing", dir: primeDir, entries: 0 };
    } else {
      try {
        const entries = deps.primeLoader !== undefined ? deps.primeLoader.index() : 0;
        const primeGit = gitInfo(primeDir);
        prime = { status: "connected", dir: primeDir, entries, branch: primeGit?.branch };
      } catch {
        prime = { status: "error", dir: primeDir, entries: 0 };
      }
    }

    // Workspace — project directories
    const projectDirs = deps.workspaceProjects ?? [];
    const accessibleCount = projectDirs.filter((d) => {
      try { return existsSync(d) && statSync(d).isDirectory(); } catch { return false; }
    }).length;
    const workspace = {
      status: projectDirs.length === 0 ? "empty" as const : accessibleCount > 0 ? "connected" as const : "error" as const,
      configured: projectDirs.length,
      accessible: accessibleCount,
      root: deps.workspaceRoot ?? process.cwd(),
    };

    // ID Service — local or central identity service
    let idService: { status: "connected" | "degraded" | "missing" | "error" | "central"; mode: "local" | "central"; url: string; version?: string };
    const idCfg = deps.configPath ? (() => {
      try {
        const raw = JSON.parse(readFileSync(deps.configPath!, "utf-8")) as Record<string, unknown>;
        return raw.idService as Record<string, unknown> | undefined;
      } catch { return undefined; }
    })() : undefined;

    const idLocal = idCfg?.local as Record<string, unknown> | undefined;
    if (idLocal?.enabled) {
      const hostingCfg = deps.configPath ? (() => {
        try {
          const raw = JSON.parse(readFileSync(deps.configPath!, "utf-8")) as Record<string, unknown>;
          return raw.hosting as Record<string, unknown> | undefined;
        } catch { return undefined; }
      })() : undefined;
      const baseDomain = (hostingCfg?.baseDomain as string) ?? "ai.on";
      const subdomain = (idLocal.subdomain as string) ?? "id";
      const url = `https://${subdomain}.${baseDomain}`;

      // Story #100 — ID no longer binds a host port; reach it through
      // Caddy at its public URL instead of `localhost:${port}`. The
      // gateway already trusts the Caddy root CA (installed by
      // hosting-setup.sh), so the internal cert validates. This path
      // works regardless of whether the gateway is on-host or later
      // moves into a container on aionima.
      try {
        const [healthRes, funcRes] = await Promise.all([
          fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null),
          fetch(`${url}/federation/whoami`, { signal: AbortSignal.timeout(3000) }).catch(() => null),
        ]);

        if (healthRes?.ok && funcRes?.ok) {
          const health = (await healthRes.json()) as { status: string; mode?: string };
          idService = { status: "connected", mode: "local", url, version: health.mode };
        } else if (healthRes?.ok) {
          idService = { status: "degraded", mode: "local", url };
        } else {
          idService = { status: "error", mode: "local", url };
        }
      } catch {
        idService = { status: "error", mode: "local", url };
      }
    } else {
      idService = { status: "central", mode: "central", url: "https://id.aionima.ai" };
    }

    return reply.send({ agi, prime, workspace, idService });
  });

  // -----------------------------------------------------------------------
  // tRPC — /api/trpc/*
  // -----------------------------------------------------------------------

  const upgradeLog = createComponentLogger(deps.logger, "upgrade");

  const broadcastUpgrade = (phase: string, message: string, step?: string, status?: string) => {
    const ts = new Date().toISOString();
    const data: Record<string, string> = { phase, message, timestamp: ts };
    if (step) data.step = step;
    if (status) data.status = status;

    // 1. Structured log via AGI logger — searchable, timestamped, persistent
    if (status === "error" || status === "fail") {
      upgradeLog.error(`[${step ?? phase}] ${message}`);
    } else {
      upgradeLog.info(`[${step ?? phase}] ${message}`);
    }

    // 2. Persist to disk — survives server restart
    appendUpgradeLog({ phase, message, step, status, timestamp: ts });

    // 3. Broadcast via WS — real-time delivery to connected dashboards
    const event = { type: "system:upgrade" as const, data };
    deps.wsRef?.server?.broadcast("dashboard_event", event);
  };

  if (deps.dashboardQueries !== undefined) {
    const dashboardQueries = deps.dashboardQueries;
    await fastify.register(fastifyTRPCPlugin, {
      prefix: "/api/trpc",
      trpcOptions: {
        router: appRouter,
        createContext: (): AppContext => ({
          queries: dashboardQueries,
          workspaceProjects: deps.workspaceProjects ?? [],
          workspaceRoot: deps.workspaceRoot ?? process.cwd(),
          configPath: deps.configPath,
          selfRepoPath: deps.selfRepoPath,
          broadcastUpgrade,
        }),
      },
    });
  }

  // -----------------------------------------------------------------------
  // Legacy dashboard API routes: /api/dashboard/*
  // (kept for backward compat until tRPC client is fully adopted in S44)
  // -----------------------------------------------------------------------

  fastify.get("/api/dashboard/*", async (request, reply) => {
    const handled = await dashboardApi.handle(request.raw, reply.raw);
    if (!handled) {
      await reply.code(404).send({ error: "Not Found" });
    }
  });

  // Non-GET methods on /api/dashboard/* — delegate to dashboardApi for 405
  fastify.route({
    method: ["POST", "PUT", "DELETE", "PATCH"],
    url: "/api/dashboard/*",
    handler: async (request, reply) => {
      await dashboardApi.handle(request.raw, reply.raw);
    },
  });

  // -----------------------------------------------------------------------
  // GET /api/channels
  // -----------------------------------------------------------------------

  fastify.get("/api/channels", async (_request, reply) => {
    const channels = channelRegistry.getChannels().map((entry) => ({
      id: entry.plugin.id,
      status: entry.status,
      registeredAt: entry.registeredAt,
    }));
    return reply.send(channels);
  });

  // -----------------------------------------------------------------------
  // GET /api/channels/:id
  // -----------------------------------------------------------------------

  fastify.get("/api/channels/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = channelRegistry.getChannel(id);
    if (!entry) {
      return reply.code(404).send({ error: `Channel "${id}" not found` });
    }
    return reply.send({
      id: entry.plugin.id,
      status: entry.status,
      registeredAt: entry.registeredAt,
      error: entry.error ?? null,
      capabilities: entry.plugin.capabilities ?? null,
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/channels/:id/start|stop|restart
  // -----------------------------------------------------------------------

  fastify.post("/api/channels/:id/start", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await channelRegistry.startChannel(id);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.post("/api/channels/:id/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await channelRegistry.stopChannel(id);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.post("/api/channels/:id/restart", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await channelRegistry.restartChannel(id);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -----------------------------------------------------------------------
  // Plans API: /api/plans/* (private network only)
  // -----------------------------------------------------------------------

  // Delegate to the existing handlePlanRequest() helper which uses raw req/res.
  const makePlanHandler = () => async (
    request: { raw: IncomingMessage },
    reply: { raw: import("node:http").ServerResponse; code: (n: number) => { send: (d: unknown) => Promise<void> } },
  ) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Plans API only allowed from private network" });
    }
    const url = new URL(request.raw.url ?? "/", `http://${request.raw.headers.host ?? "localhost"}`);
    const handled = handlePlanRequest(request.raw, reply.raw, url.pathname, url);
    if (!handled) {
      await reply.code(404).send({ error: "Not Found" });
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const planHandler = makePlanHandler() as any;
  fastify.get("/api/plans", planHandler);
  fastify.get("/api/plans/*", planHandler);
  fastify.post("/api/plans", planHandler);
  fastify.put("/api/plans/*", planHandler);
  fastify.delete("/api/plans/*", planHandler);

  // -----------------------------------------------------------------------
  // GET /api/projects — list workspace projects (private network only)
  // -----------------------------------------------------------------------

  fastify.get("/api/projects", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }
    const projectDirs = deps.workspaceProjects ?? [];
    // s140 cycle-168 t591 SECURITY — tynnToken is REDACTED in this response.
    // The actual secret never leaves disk. Dashboard consumers should read
    // `tynnTokenSet` (boolean) for "is the token configured" checks; the
    // `tynnToken` field is kept for backward-compat callers but is always
    // null. PUT /api/projects/<path> still accepts a `tynnToken` body field
    // for setting / clearing the secret.
    // s140 cycle-176 t597 — repos[] includes isDefault + port so the
    // Configuration sub-tab can render its primary-repo selector without
    // a second roundtrip. Both fields are optional in the schema; a
    // missing isDefault means "no explicit primary" (dispatch falls
    // back to repos[0]).
    const projects: { name: string; path: string; hasGit: boolean; tynnToken: string | null; tynnTokenSet: boolean; hosting: unknown; detectedHosting?: { projectType: string; suggestedStacks: string[]; docRoot: string; startCommand: string | null }; projectType?: { id: string; label: string; category: string; hostable: boolean; hasCode: boolean; iterativeWorkEligible?: boolean; testingUxEligible?: boolean; tools: { id: string; label: string; description: string; action: string; command?: string; endpoint?: string }[] }; category?: string; iterativeWorkEligible?: boolean; testingUxEligible?: boolean; description?: string; magicApps?: string[]; coreCollection?: string; coreForkSlug?: string; repos?: { name: string; url: string; branch?: string; isDefault?: boolean; port?: number }[]; attachedStacks?: { stackId: string }[]; knowledge?: { pages: number; plans: number; chatSessions: number }; tynnSlice?: { open: number; doing: number } }[] = [];

    // Expand top-level entries into (fullPath, coreCollection, coreForkSlug) triples.
    // A directory that contains a `collection.json` with
    // `type: "aionima-collection"` is treated as a group — we skip the
    // parent and list its children as projects, each flagged with the
    // collection slug so the dashboard can render them as "core".
    const expanded: Array<{ fullPath: string; name: string; coreCollection?: string; coreForkSlug?: string }> = [];
    for (const dir of projectDirs) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith(".")) continue;
          const fullPath = resolvePath(dir, entry.name);

          // s119 t702 (2026-05-09) — _aionima is a single always-present
          // project. The t701 scaffolder ensures `project.json` exists on
          // boot; the t703 fork migration moves the 11 forks into
          // `_aionima/repos/`. From t705 onwards, `_aionima` is enumerated
          // as a single project here — there is no longer a parallel
          // "collection-expansion" branch that walks into the dir.
          if (entry.name === "_aionima") {
            expanded.push({ fullPath, name: "_aionima", coreCollection: "aionima" });
            continue;
          }

          // Skip underscore-prefixed (reserved for collections we haven't
          // identified). Matches hosting-manager's skip rule. _aionima is
          // handled above; other underscore-prefixed dirs stay reserved.
          if (entry.name.startsWith("_")) continue;

          expanded.push({ fullPath, name: entry.name });
        }
      } catch { /* directory may not exist */ }
    }

    for (const { fullPath, name: entryName, coreCollection, coreForkSlug } of expanded) {
      try {
        let tynnToken: string | null = null;
        let metaType: string | null = null;
        let metaCategory: string | null = null;
        let metaDescription: string | undefined;
        let metaMagicApps: string[] | undefined;
        let metaRepos: { name: string; url: string; branch?: string }[] | undefined;
        let metaAttachedStacks: { stackId: string }[] | undefined;
        const metaPath = projectConfigPath(fullPath);
        if (existsSync(metaPath)) {
          try {
            const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as { tynnToken?: string; type?: string; category?: string; description?: string; magicApps?: string[]; repos?: { name: string; url: string; branch?: string }[]; hosting?: { stacks?: { stackId: string }[] } };
            tynnToken = meta.tynnToken ?? null;
            metaType = meta.type ?? null;
            metaCategory = meta.category ?? null;
            metaDescription = meta.description;
            metaMagicApps = meta.magicApps;
            metaRepos = meta.repos;
            metaAttachedStacks = meta.hosting?.stacks;
          } catch { /* ignore malformed metadata */ }
        }
        // s140 layout: repos live at <projectPath>/repos/<repoName>/.git/.
        // Pre-s140 (legacy): repos lived at <projectPath>/.git/. Detect
        // BOTH so existing projects + new s140-shape projects render as
        // "has git" in the dashboard. Without the repos[] check the
        // Repository tab shows the empty-state ("Add Repository / Clone
        // / Init") even when the repos array is populated — owner-
        // reported drift cycle 168.
        const hasGitAtRoot = existsSync(join(fullPath, ".git"));
        const hasGitInRepos = (metaRepos ?? []).some((r) =>
          existsSync(join(fullPath, "repos", r.name, ".git")),
        );
        const hasGit = hasGitAtRoot || hasGitInRepos;
        const hosting = deps.hostingManager
          ? deps.hostingManager.getProjectHostingInfo(fullPath)
          : { enabled: false, type: "static", hostname: entryName.toLowerCase().replace(/[^a-z0-9]+/g, "-"), docRoot: null, startCommand: null, port: null, mode: "production" as const, internalPort: null, status: "unconfigured" as const, url: null };
        const detectedHosting = deps.hostingManager
          ? deps.hostingManager.detectProjectDefaults(fullPath)
          : undefined;
        const projectTypeId = metaType ?? detectedHosting?.projectType ?? "static";
        const registry = deps.hostingManager?.getProjectTypeRegistry();
        const typeDef = registry?.get(projectTypeId);
        const projectType = typeDef ? { id: typeDef.id, label: typeDef.label, category: typeDef.category ?? "", hostable: typeDef.hostable, hasCode: typeDef.hasCode, iterativeWorkEligible: typeDef.iterativeWorkEligible ?? false, testingUxEligible: typeDef.testingUxEligible ?? false, tools: typeDef.tools } : undefined;
        const category = metaCategory ?? projectType?.category ?? null;
        // Effective iterativeWorkEligible — true when the EFFECTIVE category
        // (project.json override or projectType default) is in the eligible
        // set. Mirrors the PUT /api/projects/iterative-work/config gate so
        // the dashboard tab visibility matches what the API will accept.
        const iterativeWorkEligible = category !== null
          ? ITERATIVE_WORK_ELIGIBLE_CATEGORIES.has(category as ProjectCategory)
          : (projectType?.iterativeWorkEligible ?? false);
        // Effective testingUxEligible (s121) — only app/web categories.
        const testingUxEligible = category !== null
          ? TESTING_UX_ELIGIBLE_CATEGORIES.has(category as ProjectCategory)
          : (projectType?.testingUxEligible ?? false);
        // s130 t516 slice 6 — knowledge counts. Walk the per-project
        // k/ subdirs (s130 phase A scaffold) and count files. Cheap +
        // synchronous; the dirs are typically small. Used by the
        // Projects browser list view's Knowledge column to surface
        // each project's knowledge density at a glance.
        let knowledge: { pages: number; plans: number; chatSessions: number } | undefined;
        try {
          // Cycle 135 fix: report knowledge counts whenever the k/
          // scaffold exists (s130-migrated projects), even when the
          // counts are all zero. Previously, only non-zero totals
          // populated the field, which made it impossible to tell
          // "not migrated" from "migrated but empty" in the dashboard.
          // Now: presence of k/ dir → ▣ 0 for empty; absence → "—".
          const kRoot = join(fullPath, "k");
          if (existsSync(kRoot)) {
            const countJson = (subdir: string): number => {
              const dir = join(kRoot, subdir);
              if (!existsSync(dir)) return 0;
              try {
                return readdirSync(dir).filter((f) => f.endsWith(".md") || f.endsWith(".json") || f.endsWith(".mdx")).length;
              } catch { return 0; }
            };
            knowledge = {
              pages: countJson("knowledge"),
              plans: countJson("plans"),
              chatSessions: countJson("chat"),
            };
          }
        } catch { /* k/ scaffold read errored — knowledge stays undefined */ }

        // s139 t541 — tynnSlice column. Read TynnLite's tasks.jsonl
        // (preferred at <projectPath>/k/pm/; fallback to legacy
        // <projectPath>/.tynn-lite/) and compute open + doing counts
        // per the canonical buckets:
        //   open  = backlog
        //   doing = starting + doing + testing
        // Folds snapshots by task id last-wins to get current state.
        // Cheap synchronous read; per-project list is typically small.
        let tynnSlice: { open: number; doing: number } | undefined;
        try {
          const candidates = [
            join(fullPath, "k", "pm", "tasks.jsonl"),
            join(fullPath, ".tynn-lite", "tasks.jsonl"),
          ];
          const tasksPath = candidates.find((p) => existsSync(p));
          if (tasksPath !== undefined) {
            const raw = readFileSync(tasksPath, "utf-8");
            const folded = new Map<string, string>(); // id → latest status
            for (const line of raw.split("\n")) {
              if (line.trim() === "") continue;
              try {
                const r = JSON.parse(line) as { id?: string; status?: string };
                if (typeof r.id === "string" && typeof r.status === "string") {
                  folded.set(r.id, r.status);
                }
              } catch { /* skip malformed line */ }
            }
            let open = 0;
            let doing = 0;
            for (const status of folded.values()) {
              if (status === "backlog") open++;
              else if (status === "starting" || status === "doing" || status === "testing") doing++;
            }
            tynnSlice = { open, doing };
          }
        } catch { /* TynnLite read errored — tynnSlice stays undefined */ }

        projects.push({
          name: entryName,
          path: fullPath,
          hasGit,
          // s140 cycle-168 t591 SECURITY — never ship the raw token to
          // the client. `tynnToken: null` is intentional; the real value
          // stays on disk in project.json. Use `tynnTokenSet` for "is
          // configured" checks.
          tynnToken: null,
          tynnTokenSet: tynnToken !== null,
          hosting,
          detectedHosting,
          projectType,
          category: category ?? undefined,
          iterativeWorkEligible,
          testingUxEligible,
          description: metaDescription,
          magicApps: metaMagicApps,
          coreCollection,
          coreForkSlug,
          repos: metaRepos,
          attachedStacks: metaAttachedStacks,
          knowledge,
          tynnSlice,
        });
      } catch { /* directory may not exist */ }
    }
    return reply.send(projects);
  });

  // -----------------------------------------------------------------------
  // POST /api/projects — create a new project (private network only)
  // -----------------------------------------------------------------------

  fastify.post("/api/projects", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }
    const projectDirs = deps.workspaceProjects ?? [];
    if (projectDirs.length === 0) {
      return reply.code(400).send({ error: "No workspace.projects directories configured" });
    }

    const body = request.body as {
      name?: string;
      tynnToken?: string;
      repoRemote?: string;
      category?: string;
      type?: string;
      stacks?: string[];
    };

    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      return reply.code(400).send({ error: "Project name is required" });
    }
    const slug = body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (slug.length === 0) {
      return reply.code(400).send({ error: "Invalid project name" });
    }
    const targetDir = resolvePath(projectDirs[0]!, slug);
    if (existsSync(targetDir)) {
      return reply.code(409).send({ error: `Project folder already exists: ${slug}` });
    }
    mkdirSync(targetDir, { recursive: true });

    // Clone repo if remote provided
    let cloned = false;
    if (body.repoRemote && typeof body.repoRemote === "string" && body.repoRemote.trim().length > 0) {
      try {
        execSync(`git clone ${JSON.stringify(body.repoRemote.trim())} .`, {
          cwd: targetDir,
          stdio: "pipe",
          timeout: 60000,
        });
        cloned = true;
      } catch (err) {
        return reply.code(500).send({
          error: `Folder created but git clone failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // Write metadata
    const meta: Record<string, unknown> = { name: body.name.trim(), createdAt: new Date().toISOString() };
    if (body.tynnToken && typeof body.tynnToken === "string" && body.tynnToken.trim().length > 0) {
      meta.tynnToken = body.tynnToken.trim();
    }
    if (body.category && typeof body.category === "string") {
      const validCategories = ["literature", "app", "web", "media", "administration", "ops", "monorepo"];
      if (validCategories.includes(body.category)) {
        meta.category = body.category;
      }
    }
    if (body.type && typeof body.type === "string") {
      meta.type = body.type;
    }
    const createMetaPath = projectConfigPath(targetDir);
    mkdirSync(dirname(createMetaPath), { recursive: true });
    writeFileSync(createMetaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");

    // Auto-install selected stacks
    const installedStacks: string[] = [];
    if (Array.isArray(body.stacks) && deps.hostingManager) {
      for (const stackId of body.stacks) {
        if (typeof stackId === "string") {
          try {
            await deps.hostingManager.addStack(targetDir, stackId);
            installedStacks.push(stackId);
          } catch (err) {
            log.warn(`failed to add stack "${stackId}" to ${slug}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }

    log.info(`project created: ${slug} at ${targetDir}${cloned ? " (cloned)" : ""}${installedStacks.length > 0 ? ` (stacks: ${installedStacks.join(", ")})` : ""}`);
    return reply.code(201).send({ ok: true, name: body.name.trim(), slug, path: targetDir, cloned, stacks: installedStacks });
  });

  // -----------------------------------------------------------------------
  // PUT /api/projects — update project metadata (private network only)
  // -----------------------------------------------------------------------

  fastify.put("/api/projects", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }
    const projectDirs = deps.workspaceProjects ?? [];
    const body = request.body as {
      path?: string;
      name?: string;
      tynnToken?: string | null;
      category?: string;
      type?: string;
      /** s150 t636 — free-form Purpose textarea content. Empty string clears. */
      description?: string;
    };

    if (!body.path || typeof body.path !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }
    const targetPath = resolvePath(body.path);
    const isInWorkspace = projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
    if (!isInWorkspace) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    if (!existsSync(targetPath) || !statSync(targetPath).isDirectory()) {
      return reply.code(404).send({ error: "Project directory does not exist" });
    }
    if (isSacredProjectPath(targetPath)) {
      return reply.code(403).send({ error: "Sacred projects cannot be modified" });
    }

    // Read existing metadata or start fresh
    const updateMetaPath = projectConfigPath(targetPath);
    let projectMeta: Record<string, unknown> = {};
    if (existsSync(updateMetaPath)) {
      try {
        projectMeta = JSON.parse(readFileSync(updateMetaPath, "utf-8")) as Record<string, unknown>;
      } catch { /* start fresh if malformed */ }
    }

    // Merge updates
    if (body.name !== undefined && typeof body.name === "string" && body.name.trim().length > 0) {
      projectMeta.name = body.name.trim();
    }
    if (body.tynnToken === null) {
      delete projectMeta.tynnToken;
    } else if (typeof body.tynnToken === "string") {
      projectMeta.tynnToken = body.tynnToken.trim();
    }
    if (body.category !== undefined && typeof body.category === "string") {
      const validCategories = ["literature", "app", "web", "media", "administration", "ops", "monorepo"];
      if (validCategories.includes(body.category)) {
        projectMeta.category = body.category;
      } else {
        return reply.code(400).send({ error: `Invalid category. Must be one of: ${validCategories.join(", ")}` });
      }
    }
    if (body.type !== undefined && typeof body.type === "string" && body.type.trim().length > 0) {
      projectMeta.type = body.type.trim();
      // Also update hosting type if hosting is configured
      const hosting = projectMeta.hosting as Record<string, unknown> | undefined;
      if (hosting) {
        hosting.type = body.type.trim();
      }
    }
    // s150 t636 — free-form description (Purpose textarea). Empty string is
    // the canonical "cleared" value: delete the key so JSON stays clean.
    if (body.description !== undefined && typeof body.description === "string") {
      const trimmed = body.description.trim();
      if (trimmed.length > 0) {
        projectMeta.description = trimmed;
      } else {
        delete projectMeta.description;
      }
    }

    mkdirSync(dirname(updateMetaPath), { recursive: true });
    writeFileSync(updateMetaPath, JSON.stringify(projectMeta, null, 2) + "\n", "utf-8");
    log.info(`project updated: ${targetPath}`);
    return reply.send({ ok: true });
  });

  // -----------------------------------------------------------------------
  // DELETE /api/projects — delete a project directory (private network only)
  // -----------------------------------------------------------------------

  fastify.delete("/api/projects", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }
    const projectDirs = deps.workspaceProjects ?? [];
    const body = request.body as {
      path?: string;
      confirm?: boolean;
    };

    if (!body.path || typeof body.path !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }
    const targetPath = resolvePath(body.path);
    const isInWorkspace = projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
    if (!isInWorkspace) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    if (!existsSync(targetPath) || !statSync(targetPath).isDirectory()) {
      return reply.code(404).send({ error: "Project directory does not exist" });
    }
    if (isSacredProjectPath(targetPath)) {
      return reply.code(403).send({ error: "Sacred projects cannot be deleted" });
    }

    const projectName = basename(targetPath);
    const hasGit = existsSync(join(targetPath, ".git"));

    // Check hosting metadata
    let hostingEnabled = false;
    const hostingMetaPath = join(targetPath, ".agi-hosting.json");
    if (existsSync(hostingMetaPath)) {
      try {
        const hostingMeta = JSON.parse(readFileSync(hostingMetaPath, "utf-8")) as { enabled?: boolean };
        hostingEnabled = hostingMeta.enabled === true;
      } catch { /* ignore malformed metadata */ }
    }

    // Without confirm, return a preview
    if (!body.confirm) {
      return reply.send({
        warning: "This will permanently delete the project directory",
        path: targetPath,
        name: projectName,
        hasGit,
        hosting: hostingEnabled,
      });
    }

    // Disable hosting first (stops containers, releases ports, regenerates Caddyfile)
    if (deps.hostingManager) {
      try {
        await deps.hostingManager.disableProject(targetPath);
      } catch (err) {
        log.warn(`hosting cleanup failed for ${targetPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Remove directory
    rmSync(targetPath, { recursive: true, force: true });
    log.info(`project deleted: ${targetPath}`);
    return reply.send({ ok: true, path: targetPath, name: projectName });
  });

  // -----------------------------------------------------------------------
  // POST /api/hosting/migrate-folders — s130 cycle 129
  // Forces every project in workspace.projects to have the s130 folder
  // layout scaffolded (.agi/, k/{plans,knowledge,pm,memory,chat}/,
  // repos/, .trash/). Idempotent — already-scaffolded dirs preserved.
  // Private network only.
  // -----------------------------------------------------------------------

  fastify.post("/api/hosting/migrate-folders", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Hosting API only allowed from private network" });
    }
    if (!deps.hostingManager) {
      return reply.code(503).send({ error: "Hosting not enabled on this gateway" });
    }
    try {
      const result = deps.hostingManager.migrateAllProjectsToFolderLayout();
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: `migrate-folders failed: ${msg}` });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/hosting/migrate-networks — s130 t515 B3d
  // Restarts every hosted project so existing aionima-network containers
  // migrate to their per-project agi-net-<hostname> networks. Safe to
  // re-run; idempotent. Private network only.
  // -----------------------------------------------------------------------

  fastify.post("/api/hosting/migrate-networks", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Hosting API only allowed from private network" });
    }
    if (!deps.hostingManager) {
      return reply.code(503).send({ error: "Hosting not enabled on this gateway" });
    }
    try {
      const result = deps.hostingManager.migrateAllProjectsToNetworks();
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: `migrate-networks failed: ${msg}` });
    }
  });

  // -----------------------------------------------------------------------
  // s130 t515 B6a — repos[] CRUD for the dashboard editor
  //
  // GET    /api/projects/repos?path=     — list repos for a project
  // POST   /api/projects/repos?path=     — add a new repo (clones via provisionRepos)
  // PUT    /api/projects/repos/:name?path= — update an existing repo
  // DELETE /api/projects/repos/:name?path= — remove + soft-delete to .trash/
  //
  // All four are private-network-only (matches existing /api/projects/* gates).
  // -----------------------------------------------------------------------

  fastify.get("/api/projects/repos", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.projectConfigManager) return reply.code(503).send({ error: "Project config manager not available" });
    const projectDirs = deps.workspaceProjects ?? [];
    const pathParam = (request.query as Record<string, string>)["path"];
    if (!pathParam) return reply.code(400).send({ error: "path query parameter is required" });
    const targetPath = resolvePath(pathParam);
    if (!projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)))) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    const repos = deps.projectConfigManager.getRepos(targetPath);
    return reply.send({ repos });
  });

  fastify.post("/api/projects/repos", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.projectConfigManager) return reply.code(503).send({ error: "Project config manager not available" });
    const projectDirs = deps.workspaceProjects ?? [];
    const pathParam = (request.query as Record<string, string>)["path"];
    if (!pathParam) return reply.code(400).send({ error: "path query parameter is required" });
    const targetPath = resolvePath(pathParam);
    if (!projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)))) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    const body = request.body as Record<string, unknown>;
    if (!body || typeof body !== "object") return reply.code(400).send({ error: "request body must be a repo spec" });

    try {
      const updated = await deps.projectConfigManager.addRepo(targetPath, body as Parameters<typeof deps.projectConfigManager.addRepo>[1]);
      return reply.send({ ok: true, config: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: `addRepo failed: ${msg}` });
    }
  });

  fastify.put<{ Params: { name: string } }>("/api/projects/repos/:name", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.projectConfigManager) return reply.code(503).send({ error: "Project config manager not available" });
    const projectDirs = deps.workspaceProjects ?? [];
    const pathParam = (request.query as Record<string, string>)["path"];
    if (!pathParam) return reply.code(400).send({ error: "path query parameter is required" });
    const targetPath = resolvePath(pathParam);
    if (!projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)))) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    const { name } = request.params;
    const body = request.body as Record<string, unknown>;
    if (!body || typeof body !== "object") return reply.code(400).send({ error: "request body must be a repo patch" });

    try {
      const updated = await deps.projectConfigManager.updateRepo(targetPath, name, body as Parameters<typeof deps.projectConfigManager.updateRepo>[2]);
      return reply.send({ ok: true, config: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.includes("not found") ? 404 : 400;
      return reply.code(code).send({ error: `updateRepo failed: ${msg}` });
    }
  });

  fastify.delete<{ Params: { name: string } }>("/api/projects/repos/:name", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.projectConfigManager) return reply.code(503).send({ error: "Project config manager not available" });
    const projectDirs = deps.workspaceProjects ?? [];
    const pathParam = (request.query as Record<string, string>)["path"];
    if (!pathParam) return reply.code(400).send({ error: "path query parameter is required" });
    const targetPath = resolvePath(pathParam);
    if (!projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)))) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    const { name } = request.params;
    try {
      const updated = await deps.projectConfigManager.removeRepo(targetPath, name);
      return reply.send({ ok: true, config: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.includes("not found") ? 404 : 400;
      return reply.code(code).send({ error: `removeRepo failed: ${msg}` });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/projects/info — git details for a project (private network only)
  // -----------------------------------------------------------------------

  fastify.get("/api/projects/info", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }
    const projectDirs = deps.workspaceProjects ?? [];
    const query = request.query as Record<string, string>;
    const pathParam = query["path"];
    if (!pathParam) {
      return reply.code(400).send({ error: "path query parameter is required" });
    }
    const targetPath = resolvePath(pathParam);
    const isInWorkspace = projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
    if (!isInWorkspace) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    if (!existsSync(targetPath) || !statSync(targetPath).isDirectory()) {
      return reply.code(404).send({ error: "Project directory does not exist" });
    }

    const hasGit = existsSync(join(targetPath, ".git"));
    if (!hasGit) {
      return reply.send({ path: targetPath, branch: null, remote: null, status: null, commits: [] });
    }

    try {
      let branch: string | null = null;
      try {
        branch = execSync(`git -C ${JSON.stringify(targetPath)} rev-parse --abbrev-ref HEAD`, {
          timeout: 5000, stdio: "pipe",
        }).toString().trim();
      } catch { /* no branch */ }

      let remote: string | null = null;
      try {
        remote = execSync(`git -C ${JSON.stringify(targetPath)} remote get-url origin`, {
          timeout: 5000, stdio: "pipe",
        }).toString().trim();
      } catch { /* no remote */ }

      let status: "clean" | "dirty" | null = null;
      try {
        const porcelain = execSync(`git -C ${JSON.stringify(targetPath)} status --porcelain`, {
          timeout: 5000, stdio: "pipe",
        }).toString().trim();
        status = porcelain.length === 0 ? "clean" : "dirty";
      } catch { /* unknown status */ }

      const commits: { hash: string; message: string }[] = [];
      try {
        const logOutput = execSync(`git -C ${JSON.stringify(targetPath)} log --oneline -5`, {
          timeout: 5000, stdio: "pipe",
        }).toString().trim();
        if (logOutput.length > 0) {
          for (const line of logOutput.split("\n")) {
            const spaceIdx = line.indexOf(" ");
            if (spaceIdx > 0) {
              commits.push({ hash: line.slice(0, spaceIdx), message: line.slice(spaceIdx + 1) });
            }
          }
        }
      } catch { /* no commits */ }

      return reply.send({ path: targetPath, branch, remote, status, commits });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/projects/activity-summary — daily activity counts (s130 t516 slice 2 prep)
  // -----------------------------------------------------------------------
  //
  // Returns a per-day count array for the last N days (default 30) of
  // project activity, sourced from git log + chat sessions. Used by the
  // Projects browser list view to render an activity sparkline column
  // (fancy-echarts) per row.
  //
  // Today: just commits + chat session updatedAt counts. Future:
  // iterative-work fires, plan transitions, COA chain events.
  //
  // Security: uses execFileSync with array args (no shell), so the
  // targetPath + days values can't escape into shell injection.

  fastify.get("/api/projects/activity-summary", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }
    const projectDirs = deps.workspaceProjects ?? [];
    const query = request.query as Record<string, string>;
    const pathParam = query["path"];
    const daysParam = Number(query["days"] ?? "30");
    const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 90 ? Math.floor(daysParam) : 30;
    if (!pathParam) {
      return reply.code(400).send({ error: "path query parameter is required" });
    }
    const targetPath = resolvePath(pathParam);
    const isInWorkspace = projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
    if (!isInWorkspace) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    if (!existsSync(targetPath) || !statSync(targetPath).isDirectory()) {
      return reply.code(404).send({ error: "Project directory does not exist" });
    }

    // Build date keys for the last N days (oldest first → today last).
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dayKeys: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      dayKeys.push(d.toISOString().slice(0, 10));
    }

    const counts: Record<string, number> = {};
    for (const k of dayKeys) counts[k] = 0;

    // Git commits — count per day from `git log --since=<N> days
    // --format=%ad --date=short`. execFileSync with array args (no
    // shell) prevents injection — targetPath + days are safe even if
    // the path contains shell metacharacters.
    if (existsSync(join(targetPath, ".git"))) {
      try {
        const out = execFileSync(
          "git",
          [
            "-C", targetPath,
            "log",
            `--since=${String(days)}.days`,
            "--format=%ad",
            "--date=short",
          ],
          { timeout: 5000, stdio: "pipe", encoding: "utf-8" },
        ).trim();
        if (out.length > 0) {
          for (const line of out.split("\n")) {
            const day = line.trim();
            if (day in counts) counts[day] = (counts[day] ?? 0) + 1;
          }
        }
      } catch { /* no git log; commits stay 0 */ }
    }

    // Chat sessions — count files in <projectPath>/k/chat/ whose
    // updatedAt falls within each day. (s130 phase A.6 reader-flip
    // landed cycle 100, so per-project chat dirs are populated for
    // s130-migrated projects.)
    const chatDir = join(targetPath, "k", "chat");
    if (existsSync(chatDir)) {
      try {
        const files = readdirSync(chatDir).filter((f) => f.endsWith(".json"));
        for (const file of files) {
          try {
            const raw = readFileSync(join(chatDir, file), "utf-8");
            const session = JSON.parse(raw) as { updatedAt?: string };
            if (typeof session.updatedAt === "string") {
              const day = session.updatedAt.slice(0, 10);
              if (day in counts) counts[day] = (counts[day] ?? 0) + 1;
            }
          } catch { /* skip corrupt session file */ }
        }
      } catch { /* unreadable chat dir; chat counts stay 0 */ }
    }

    const dailyCounts = dayKeys.map((k) => counts[k] ?? 0);
    const total = dailyCounts.reduce((a, b) => a + b, 0);

    return reply.send({
      path: targetPath,
      days,
      total,
      dailyCounts,
      dayKeys,
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/projects/iterative-work/status — per-project IW snapshot
  // (private network only)
  // -----------------------------------------------------------------------

  fastify.get("/api/projects/iterative-work/status", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }
    if (!deps.iterativeWorkScheduler) {
      return reply.code(503).send({ error: "Iterative-work scheduler not available" });
    }
    const projectDirs = deps.workspaceProjects ?? [];
    const query = request.query as Record<string, string>;
    const pathParam = query["path"];
    if (!pathParam) {
      return reply.code(400).send({ error: "path query parameter is required" });
    }
    const targetPath = resolvePath(pathParam);
    const isInWorkspace = projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
    if (!isInWorkspace) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    const status = deps.iterativeWorkScheduler.getStatus(targetPath);
    if (status === null) {
      return reply.code(404).send({ error: "Project has no project.json — create one first" });
    }
    return reply.send(status);
  });

  // -----------------------------------------------------------------------
  // PUT /api/projects/iterative-work/config — set per-project IW config
  // (private network only). Body: { path: string, iterativeWork: { enabled?,
  //   cadence?, cron? } }.
  //
  // s118 redesign 2026-04-27 (t442 D1): when `cadence` is provided, the cron
  // expression is auto-computed via cadenceToStaggeredCron(cadence, path) so
  // project loops with the same cadence don't all fire at the same minute.
  // Legacy callers still passing `cron` directly continue working.
  //
  // Eligibility: if project.category is set + not in
  // ITERATIVE_WORK_ELIGIBLE_CATEGORIES, return 403. If cadence is set and
  // not in cadenceOptionsFor(category), return 400.
  //
  // Hot-reloads — the scheduler picks up the new config on its next tick.
  // -----------------------------------------------------------------------

  fastify.put("/api/projects/iterative-work/config", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }
    if (!deps.projectConfigManager) {
      return reply.code(503).send({ error: "Project config manager not available" });
    }
    const projectDirs = deps.workspaceProjects ?? [];
    const body = request.body as {
      path?: string;
      iterativeWork?: { enabled?: boolean; cadence?: string; cron?: string };
    } | undefined;
    if (!body?.path) {
      return reply.code(400).send({ error: "body.path is required" });
    }
    if (body.iterativeWork === undefined) {
      return reply.code(400).send({ error: "body.iterativeWork is required" });
    }
    const targetPath = resolvePath(body.path);
    const isInWorkspace = projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
    if (!isInWorkspace) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    if (!existsSync(projectConfigPath(targetPath))) {
      return reply.code(404).send({ error: "Project has no project.json — create one first" });
    }

    // Read current config to access category for eligibility + cadence validation.
    // s150 (2026-05-07): `category` was dropped from the schema. Legacy values
    // survive via .passthrough(); read through an unknown-cast for the migration
    // period until consumers move to deriving from `type` (s150 doc-update task t642).
    let projectCategory: ProjectCategory | undefined;
    try {
      const cur = await deps.projectConfigManager.read(targetPath);
      projectCategory = (cur as unknown as { category?: ProjectCategory })?.category;
    } catch {
      /* fall through — read errors get caught by update() below */
    }

    // Eligibility gate (D4): non-eligible categories return 403.
    if (projectCategory !== undefined && !ITERATIVE_WORK_ELIGIBLE_CATEGORIES.has(projectCategory)) {
      return reply.code(403).send({
        error: `Project category "${projectCategory}" is not eligible for iterative-work. Eligible: web/app/ops/administration.`,
      });
    }

    // Build the persisted iterativeWork object.
    const iw: { enabled?: boolean; cadence?: IterativeWorkCadence; cron?: string } = {};
    if (body.iterativeWork.enabled !== undefined) iw.enabled = body.iterativeWork.enabled;

    if (body.iterativeWork.cadence !== undefined) {
      const cadence = body.iterativeWork.cadence as IterativeWorkCadence;
      // Validate cadence is in the type-aware option set for this category.
      if (projectCategory !== undefined) {
        const opts = cadenceOptionsFor(projectCategory);
        if (!opts.includes(cadence)) {
          return reply.code(400).send({
            error: `Cadence "${cadence}" is not available for category "${projectCategory}". Allowed: ${opts.join(", ")}.`,
          });
        }
      }
      iw.cadence = cadence;
      // Auto-compute the staggered cron (D3).
      iw.cron = cadenceToStaggeredCron(cadence, targetPath);
    } else if (body.iterativeWork.cron !== undefined) {
      // Legacy passthrough — caller manually set a cron expression. Preserve.
      iw.cron = body.iterativeWork.cron;
    }

    try {
      const updated = await deps.projectConfigManager.update(targetPath, { iterativeWork: iw });
      return reply.send({ ok: true, iterativeWork: updated.iterativeWork ?? null });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/projects/iterative-work/stop?path=<projectPath> — operator
  // kill switch (s159 t692). Flips iterativeWork.enabled=false on the
  // project AND force-clears any in-flight tracking so the scheduler
  // treats it as never-fired. Use when a project is in a runaway loop
  // and you don't want to restart the gateway.
  // -----------------------------------------------------------------------

  fastify.post("/api/projects/iterative-work/stop", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }
    if (!deps.projectConfigManager) return reply.code(503).send({ error: "Project config manager not available" });
    const projectDirs = deps.workspaceProjects ?? [];
    const query = request.query as Record<string, string>;
    const pathParam = query["path"];
    if (!pathParam) return reply.code(400).send({ error: "path query parameter is required" });
    const targetPath = resolvePath(pathParam);
    if (!projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)))) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }

    let configFlipped = false;
    try {
      const cur = await deps.projectConfigManager.read(targetPath);
      const iw = ((cur as { iterativeWork?: { enabled?: boolean } }).iterativeWork) ?? {};
      if (iw.enabled !== false) {
        await deps.projectConfigManager.update(targetPath, { iterativeWork: { ...iw, enabled: false } });
        configFlipped = true;
      }
    } catch (err) {
      // Continue — the runtime force-clear is the more important hard-stop.
      deps.logger?.warn?.("iterative-work", `stop: config update for ${targetPath} failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const cleared = deps.iterativeWorkScheduler?.forceClearProject(targetPath) ?? { wasInFlight: false, hadLastFired: false };
    return reply.send({ ok: true, configFlipped, ...cleared });
  });

  // -----------------------------------------------------------------------
  // POST /api/projects/iterative-work/stop-all — nuclear operator kill
  // switch. Force-clears ALL in-flight tracking AND flips enabled=false
  // on every project that has iterativeWork configured. For runaway
  // scenarios where the operator can't pinpoint the looping project.
  // -----------------------------------------------------------------------

  fastify.post("/api/projects/iterative-work/stop-all", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }
    if (!deps.projectConfigManager) return reply.code(503).send({ error: "Project config manager not available" });
    const projectDirs = deps.workspaceProjects ?? [];

    let configFlippedCount = 0;
    let configErrorCount = 0;
    for (const wsDir of projectDirs) {
      let entries: string[];
      try {
        const { readdirSync } = await import("node:fs");
        entries = readdirSync(wsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith("."))
          .map((d) => d.name);
      } catch {
        continue;
      }
      for (const slug of entries) {
        const projectPath = resolvePath(`${wsDir}/${slug}`);
        try {
          const cur = await deps.projectConfigManager.read(projectPath);
          const iw = ((cur as { iterativeWork?: { enabled?: boolean } }).iterativeWork);
          if (iw?.enabled === true) {
            await deps.projectConfigManager.update(projectPath, { iterativeWork: { ...iw, enabled: false } });
            configFlippedCount++;
          }
        } catch {
          configErrorCount++;
        }
      }
    }

    const cleared = deps.iterativeWorkScheduler?.forceClearAll() ?? { inFlightCleared: 0, lastFiredCleared: 0 };
    return reply.send({ ok: true, configFlippedCount, configErrorCount, ...cleared });
  });

  // -----------------------------------------------------------------------
  // Issue registry — Wish #21 Slice 1.
  // Per-project k/issues/ surface. Three routes:
  //   GET   /api/projects/issues?path=<projectPath>           — list summaries
  //   GET   /api/projects/issues/:id?path=<projectPath>       — read full issue
  //   POST  /api/projects/issues?path=<projectPath>           — log (create or append)
  //   PATCH /api/projects/issues/:id?path=<projectPath>       — update status (+resolution)
  //   GET   /api/issues                                        — aggregate across all workspace projects
  // Private-network-only; same workspace-projects scoping as the
  // iterative-work routes above.
  // -----------------------------------------------------------------------

  function validateIssueProjectPath(request: { raw: IncomingMessage; query: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }):
    | { ok: true; targetPath: string }
    | { ok: false; sent: unknown } {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return { ok: false, sent: reply.code(403).send({ error: "Issues API only allowed from private network" }) };
    }
    const projectDirs = deps.workspaceProjects ?? [];
    const query = request.query as Record<string, string>;
    const pathParam = query["path"];
    if (!pathParam) {
      return { ok: false, sent: reply.code(400).send({ error: "path query parameter is required" }) };
    }
    const targetPath = resolvePath(pathParam);
    const isInWorkspace = projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
    if (!isInWorkspace) {
      return { ok: false, sent: reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" }) };
    }
    return { ok: true, targetPath };
  }

  fastify.get("/api/projects/issues", async (request, reply) => {
    const v = validateIssueProjectPath(request, reply);
    if (!v.ok) return v.sent;
    const issues = listIssuesStore(v.targetPath);
    return reply.send({ issues });
  });

  // Wish #21 Slice 2 — free-text search over title + body + tags with
  // tag:/status: structured filters. Linear scan; FTS index deferred
  // until usage proves it's needed.
  fastify.get("/api/projects/issues/search", async (request, reply) => {
    const v = validateIssueProjectPath(request, reply);
    if (!v.ok) return v.sent;
    const query = (request.query as Record<string, string>)["q"] ?? "";
    const hits = searchIssuesStore(v.targetPath, query);
    return reply.send({ hits });
  });

  // Wish #21 Slice 5 — raw-tier auto-capture endpoints.
  // GET    /api/projects/issues/raw                  — list raw captures
  // POST   /api/projects/issues/raw                  — record (body: {source, summary, details?})
  // POST   /api/projects/issues/raw/:id/promote      — promote one to curated
  // DELETE /api/projects/issues/raw                  — clear all
  fastify.get("/api/projects/issues/raw", async (request, reply) => {
    const v = validateIssueProjectPath(request, reply);
    if (!v.ok) return v.sent;
    return reply.send({ captures: listRawCaptures(v.targetPath) });
  });

  fastify.post("/api/projects/issues/raw", async (request, reply) => {
    const v = validateIssueProjectPath(request, reply);
    if (!v.ok) return v.sent;
    const body = (request.body as Record<string, unknown> | null) ?? {};
    const source = typeof body["source"] === "string" ? body["source"] : "";
    const summary = typeof body["summary"] === "string" ? body["summary"] : "";
    if (!source || !summary) return reply.code(400).send({ error: "source and summary are required" });
    const detailsRaw = body["details"];
    const details = detailsRaw && typeof detailsRaw === "object" ? (detailsRaw as Record<string, unknown>) : undefined;
    const entry = recordRawCaptureStore(v.targetPath, { source, summary, details });
    return reply.send({ entry });
  });

  fastify.post<{ Params: { id: string } }>("/api/projects/issues/raw/:id/promote", async (request, reply) => {
    const v = validateIssueProjectPath(request, reply);
    if (!v.ok) return v.sent;
    const body = (request.body as Record<string, unknown> | null) ?? {};
    const title = typeof body["title"] === "string" ? body["title"] : undefined;
    const tagsRaw = body["tags"];
    const tags = Array.isArray(tagsRaw) ? tagsRaw.filter((t): t is string => typeof t === "string") : undefined;
    const result = promoteRawCaptureStore(v.targetPath, request.params.id, { title, tags });
    if (!result) return reply.code(404).send({ error: "Raw capture not found" });
    return reply.send(result);
  });

  fastify.delete("/api/projects/issues/raw", async (request, reply) => {
    const v = validateIssueProjectPath(request, reply);
    if (!v.ok) return v.sent;
    const cleared = clearRawCaptures(v.targetPath);
    return reply.send({ cleared });
  });

  // Wish #21 Slice 6 — promote bash audit-log entries to issues.
  // POST body: { days?: number (default 7), promote?: boolean (default true) }.
  // When promote=false, returns just the candidate list (dry run).
  fastify.post("/api/projects/issues/from-bash-log", async (request, reply) => {
    const v = validateIssueProjectPath(request, reply);
    if (!v.ok) return v.sent;
    const body = (request.body as Record<string, unknown> | null) ?? {};
    const daysRaw = body["days"];
    const days = typeof daysRaw === "number" && Number.isFinite(daysRaw) && daysRaw > 0 ? Math.floor(daysRaw) : 7;
    const promote = body["promote"] !== false; // default true
    const candidates = findPromotionCandidates(days);
    if (!promote) {
      return reply.send({ daysScanned: days, candidates, promoted: 0, appended: 0, dryRun: true });
    }
    let promoted = 0;
    let appended = 0;
    const results: { id: string; outcome: string; occurrences: number }[] = [];
    for (const c of candidates) {
      const payload = buildCandidatePayload(c);
      const result = logIssueStore(v.targetPath, {
        title: payload.title,
        symptom: payload.symptom,
        tool: payload.tool,
        exit_code: payload.exit_code,
        tags: payload.tags,
        body: payload.body,
        agent: "audit-promotion",
      });
      if (result.outcome === "created") promoted++;
      else appended++;
      results.push({ id: result.id, outcome: result.outcome, occurrences: result.occurrences });
    }
    return reply.send({ daysScanned: days, candidates: candidates.length, promoted, appended, results });
  });

  fastify.get<{ Params: { id: string } }>("/api/projects/issues/:id", async (request, reply) => {
    const v = validateIssueProjectPath(request, reply);
    if (!v.ok) return v.sent;
    const issue = readIssueStore(v.targetPath, request.params.id);
    if (!issue) return reply.code(404).send({ error: "Issue not found" });
    return reply.send({ issue });
  });

  fastify.post("/api/projects/issues", async (request, reply) => {
    const v = validateIssueProjectPath(request, reply);
    if (!v.ok) return v.sent;
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return reply.code(400).send({ error: "JSON body required" });
    }
    const title = typeof body["title"] === "string" ? body["title"] : "";
    const symptom = typeof body["symptom"] === "string" ? body["symptom"] : "";
    if (!title || !symptom) {
      return reply.code(400).send({ error: "title and symptom are required" });
    }
    const tool = typeof body["tool"] === "string" ? body["tool"] : undefined;
    const exitRaw = body["exit_code"];
    const exit_code = typeof exitRaw === "number" ? exitRaw : undefined;
    const tagsRaw = body["tags"];
    const tags = Array.isArray(tagsRaw) ? tagsRaw.filter((t): t is string => typeof t === "string") : undefined;
    const agentRaw = body["agent"];
    const agent = typeof agentRaw === "string" ? agentRaw : undefined;
    const result = logIssueStore(v.targetPath, { title, symptom, tool, exit_code, tags, agent });
    return reply.send(result);
  });

  fastify.patch<{ Params: { id: string } }>("/api/projects/issues/:id", async (request, reply) => {
    const v = validateIssueProjectPath(request, reply);
    if (!v.ok) return v.sent;
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return reply.code(400).send({ error: "JSON body required" });
    }
    const status = body["status"];
    const validStatuses: IssueStatus[] = ["open", "known", "fixed", "wont-fix"];
    if (typeof status !== "string" || !validStatuses.includes(status as IssueStatus)) {
      return reply.code(400).send({ error: `status must be one of ${validStatuses.join(", ")}` });
    }
    const resolutionRaw = body["resolution"];
    const resolution = typeof resolutionRaw === "string" ? resolutionRaw : undefined;
    const updated = updateIssueStatusStore(v.targetPath, request.params.id, status as IssueStatus, resolution);
    if (!updated) return reply.code(404).send({ error: "Issue not found" });
    return reply.send({ issue: updated });
  });

  fastify.get("/api/issues", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Issues API only allowed from private network" });
    }
    const projectDirs = deps.workspaceProjects ?? [];
    const aggregated: Array<IssueIndexEntry & { project: string }> = [];
    for (const wsDir of projectDirs) {
      let entries: string[];
      try {
        entries = readdirSync(wsDir);
      } catch {
        continue;
      }
      for (const slug of entries) {
        const projectPath = resolvePath(`${wsDir}/${slug}`);
        try {
          const issues = listIssuesStore(projectPath);
          for (const i of issues) aggregated.push({ ...i, project: slug });
        } catch {
          // skip projects without issues directory
        }
      }
    }
    return reply.send({ issues: aggregated });
  });

  // s159 t689 — Taskmaster queue diagnostic surface (private network
  // only). Reads dispatch job files from `~/.agi/{slug}/dispatch/jobs/`
  // and rolls them up into a status-count summary + duplicate-group
  // detection (same {planRef.planId, planRef.stepId} or same description
  // hash across 2+ non-terminal jobs). Observability before action —
  // operators can see queue-stacking forming BEFORE it's a crisis,
  // ahead of the t695/t696/t697 idempotency/cooldown/breaker gates
  // (which are blocked pending reproducer t694).
  fastify.get("/api/taskmaster/queue", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Taskmaster queue API only allowed from private network" });
    }
    const projectDirs = deps.workspaceProjects ?? [];
    const query = request.query as Record<string, string>;
    const pathParam = query["path"];
    if (!pathParam) {
      return reply.code(400).send({ error: "path query parameter is required" });
    }
    const targetPath = resolvePath(pathParam);
    const isInWorkspace = projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
    if (!isInWorkspace) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    const jobsDir = dispatchJobsDir(targetPath);
    const jobs: DispatchJobLike[] = [];
    try {
      const files = readdirSync(jobsDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const raw = readFileSync(`${jobsDir}/${file}`, "utf-8");
          const parsed = JSON.parse(raw) as DispatchJobLike;
          if (typeof parsed.id === "string") jobs.push(parsed);
        } catch {
          // Skip unreadable job files
        }
      }
    } catch (err) {
      const isNotFound = err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
      if (!isNotFound) {
        return reply.code(500).send({ error: `Failed to read jobs directory: ${err instanceof Error ? err.message : String(err)}` });
      }
      // ENOENT → empty queue
    }
    return reply.send({ projectPath: targetPath, summary: summarizeQueue(jobs), jobCount: jobs.length });
  });

  // -----------------------------------------------------------------------
  // GET /api/projects/iterative-work/log — per-project iteration log
  // (private network only). Query: ?path=<projectPath>&limit=<N>.
  // Returns the in-memory ring buffer (most-recent-first). Buffer is reset
  // on gateway restart — persistence lands when storage choice is owner-blessed.
  // -----------------------------------------------------------------------

  fastify.get("/api/projects/iterative-work/log", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }
    if (!deps.iterativeWorkScheduler) {
      return reply.code(503).send({ error: "Iterative-work scheduler not available" });
    }
    const projectDirs = deps.workspaceProjects ?? [];
    const query = request.query as Record<string, string>;
    const pathParam = query["path"];
    if (!pathParam) {
      return reply.code(400).send({ error: "path query parameter is required" });
    }
    const targetPath = resolvePath(pathParam);
    const isInWorkspace = projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
    if (!isInWorkspace) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    const rawLimit = query["limit"];
    let limit: number | undefined;
    if (rawLimit !== undefined) {
      const parsed = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return reply.code(400).send({ error: "limit must be a positive integer" });
      }
      limit = parsed;
    }
    const entries = deps.iterativeWorkScheduler.getLog(targetPath, limit);
    return reply.send({ entries });
  });

  // -----------------------------------------------------------------------
  // GET /api/projects/iterative-work/progress — Race-to-DONE task counts
  // (private network only). Path arg currently unused — PmProvider's notion
  // of "active focus" is project-agnostic (the provider's bound project).
  // The arg stays in the signature so future per-project PmProviders can
  // route on it without an API contract change. Returns the same shape
  // as PmProvider.getActiveFocusProgress for direct consumption by the
  // dashboard's two-tone bar.
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // GET /api/loop/progress — system-wide progress bar feed (s120 t453).
  //
  // Single source of truth for both terminal statusline (via file mirror)
  // and chat UI (via API). Returns { finished, qa, total, scopeLabel }
  // for the iterative-work loop's TARGET version. When PmProvider doesn't
  // expose getActiveFocusProgress, returns 503 — consumers gracefully hide.
  // -----------------------------------------------------------------------

  fastify.get("/api/loop/progress", async (request, reply) => {
    if (!isPrivateNetwork(getClientIp(request.raw))) {
      return reply.code(403).send({ error: "Loop API only allowed from private network" });
    }
    if (!deps.pmProvider || deps.pmProvider.getActiveFocusProgress === undefined) {
      return reply.code(503).send({ error: "PM provider doesn't expose progress" });
    }
    try {
      const progress = await deps.pmProvider.getActiveFocusProgress();
      return reply.send({
        finished: progress.doneTasks,
        qa: progress.qaTasks,
        total: progress.totalTasks,
        scopeLabel: "v0.4.0",
      });
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get("/api/projects/iterative-work/progress", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }
    if (!deps.pmProvider) {
      return reply.code(503).send({ error: "PM provider not available" });
    }
    if (deps.pmProvider.getActiveFocusProgress === undefined) {
      return reply.code(503).send({ error: `PM provider "${deps.pmProvider.providerId}" doesn't expose progress` });
    }
    const projectDirs = deps.workspaceProjects ?? [];
    const query = request.query as Record<string, string>;
    const pathParam = query["path"];
    if (!pathParam) {
      return reply.code(400).send({ error: "path query parameter is required" });
    }
    const targetPath = resolvePath(pathParam);
    const isInWorkspace = projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
    if (!isInWorkspace) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    try {
      const progress = await deps.pmProvider.getActiveFocusProgress();
      return reply.send(progress);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -----------------------------------------------------------------------
  // Per-project MCP routes (Wish #7 / s125 — MCP tab on project detail).
  //
  // Surfaces project's MCP servers + .env-backed key storage to the dashboard
  // MCP tab. Servers are namespaced as `<projectSlug>:<serverId>` when
  // registered with mcpClient to avoid collision across projects.
  //
  // .env values are NEVER returned through these endpoints — only key NAMES.
  // The project's .env file holds the secrets; dashboard sets values blindly.
  // -----------------------------------------------------------------------

  // Helper: project namespace prefix for MCP server ids.
  const mcpServerNs = (projectPath: string, serverId: string): string => {
    const slug = projectConfigPath(projectPath).split("/").slice(-2, -1)[0] ?? "default";
    return `${slug}:${serverId}`;
  };

  // GET /api/projects/mcp/list?path= — list MCP servers + connection state.
  // s131 t682 — reads via the dual-read API: prefers .mcp.json, falls
  // back to legacy project.json mcp.servers[] for unmigrated installs.
  fastify.get("/api/projects/mcp/list", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.projectConfigManager) return reply.code(503).send({ error: "Project config manager not available" });
    const projectDirs = deps.workspaceProjects ?? [];
    const pathParam = (request.query as Record<string, string>)["path"];
    if (!pathParam) return reply.code(400).send({ error: "path query parameter is required" });
    const targetPath = resolvePath(pathParam);
    if (!projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)))) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    const cfg = await deps.projectConfigManager.read(targetPath);
    const legacy = (cfg as { mcp?: { servers?: Array<{ id: string; name?: string; transport: string; command?: string[]; env?: Record<string, string>; url?: string; autoConnect?: boolean; authToken?: string }> } }).mcp?.servers;
    const dualResult = readProjectMcpServers(targetPath, legacy as Parameters<typeof readProjectMcpServers>[1]);
    const servers = dualResult.servers as typeof legacy & object;
    // Augment with live connection state from mcpClient.
    const liveServers = deps.mcpClient?.listServers() ?? [];
    const liveById = new Map(liveServers.map((s: { id: string; state: string }) => [s.id, s.state]));
    return reply.send({
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name ?? s.id,
        transport: s.transport,
        command: s.command,
        url: s.url,
        envKeys: Object.keys(s.env ?? {}),
        autoConnect: s.autoConnect ?? true,
        hasAuthToken: typeof s.authToken === "string" && s.authToken.length > 0,
        state: liveById.get(mcpServerNs(targetPath, s.id)) ?? "not-registered",
      })),
    });
  });

  // PUT /api/projects/mcp/server?path= — add/update a server (writes to project.json).
  fastify.put("/api/projects/mcp/server", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.projectConfigManager) return reply.code(503).send({ error: "Project config manager not available" });
    const projectDirs = deps.workspaceProjects ?? [];
    const body = request.body as { path?: string; server?: { id: string; name?: string; transport: "stdio" | "http" | "websocket"; command?: string[]; env?: Record<string, string>; url?: string; autoConnect?: boolean; authToken?: string } } | undefined;
    if (!body?.path || !body.server?.id) return reply.code(400).send({ error: "path + server.id are required" });
    const targetPath = resolvePath(body.path);
    if (!projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)))) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    if (!existsSync(projectConfigPath(targetPath))) return reply.code(404).send({ error: "Project has no project.json" });
    try {
      // s131 t682 — write to .mcp.json (Claude Code convention). Legacy
      // project.json mcp.servers writes are removed; the boot migration
      // (t681) brings unmigrated projects forward, and the dual-read in
      // /list keeps them visible until then. Atomic temp+rename inside
      // setDotMcpServer.
      setDotMcpServer(targetPath, body.server as Parameters<typeof setDotMcpServer>[1]);
      // Re-derive the post-write state for the response so callers see
      // the same shape that /list returns.
      const cur = await deps.projectConfigManager.read(targetPath);
      const dualResult = readProjectMcpServers(targetPath, (cur as { mcp?: { servers?: typeof body.server[] } }).mcp?.servers as Parameters<typeof readProjectMcpServers>[1]);
      const servers = dualResult.servers;
      const updated = { mcp: { servers } } as { mcp: { servers: typeof servers } };
      // Re-register with mcpClient under namespaced id (best-effort; surfaces error in response).
      let registerError: string | null = null;
      if (deps.mcpClient && (body.server.autoConnect ?? true)) {
        try {
          const env = body.server.env ? resolveDollarVarsObject(body.server.env, readProjectEnv(targetPath)) : undefined;
          const authToken = body.server.authToken ? resolveDollarVars(body.server.authToken, readProjectEnv(targetPath)) : undefined;
          await deps.mcpClient.registerServer({
            id: mcpServerNs(targetPath, body.server.id),
            name: body.server.name,
            transport: body.server.transport,
            command: body.server.command,
            env,
            url: body.server.url,
            autoConnect: true,
            authToken,
          });
        } catch (err) {
          registerError = err instanceof Error ? err.message : String(err);
        }
      }
      return reply.send({ ok: true, mcp: (updated as { mcp?: unknown }).mcp ?? { servers: [] }, registerError });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // DELETE /api/projects/mcp/server?path=&id= — remove server.
  fastify.delete("/api/projects/mcp/server", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.projectConfigManager) return reply.code(503).send({ error: "Project config manager not available" });
    const projectDirs = deps.workspaceProjects ?? [];
    const query = request.query as Record<string, string>;
    const pathParam = query["path"];
    const idParam = query["id"];
    if (!pathParam || !idParam) return reply.code(400).send({ error: "path + id query params required" });
    const targetPath = resolvePath(pathParam);
    if (!projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)))) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    try {
      // s131 t682 — remove from .mcp.json. No-op when neither .mcp.json
      // nor legacy mcp.servers carries the id.
      removeDotMcpServer(targetPath, idParam);
      // Best-effort unregister.
      try { await deps.mcpClient?.unregisterServer?.(mcpServerNs(targetPath, idParam)); } catch { /* ignore */ }
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/projects/mcp/env?path= — list .env KEY NAMES (never values).
  fastify.get("/api/projects/mcp/env", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    const projectDirs = deps.workspaceProjects ?? [];
    const pathParam = (request.query as Record<string, string>)["path"];
    if (!pathParam) return reply.code(400).send({ error: "path query parameter is required" });
    const targetPath = resolvePath(pathParam);
    if (!projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)))) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    return reply.send({ keys: listProjectEnvKeys(targetPath) });
  });

  // POST /api/projects/mcp/env?path= — body: { key, value }; value is write-only.
  fastify.post("/api/projects/mcp/env", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    const projectDirs = deps.workspaceProjects ?? [];
    const body = request.body as { path?: string; key?: string; value?: string } | undefined;
    if (!body?.path || !body.key) return reply.code(400).send({ error: "path + key required" });
    const targetPath = resolvePath(body.path);
    if (!projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)))) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    try {
      setProjectEnvVar(targetPath, body.key, body.value ?? "");
      return reply.send({ ok: true, keys: listProjectEnvKeys(targetPath) });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // DELETE /api/projects/mcp/env?path=&key= — remove a key from .env.
  fastify.delete("/api/projects/mcp/env", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    const projectDirs = deps.workspaceProjects ?? [];
    const query = request.query as Record<string, string>;
    const pathParam = query["path"];
    const keyParam = query["key"];
    if (!pathParam || !keyParam) return reply.code(400).send({ error: "path + key required" });
    const targetPath = resolvePath(pathParam);
    if (!projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)))) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    try {
      removeProjectEnvVar(targetPath, keyParam);
      return reply.send({ ok: true, keys: listProjectEnvKeys(targetPath) });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/projects/mcp/server/test?path=&id= — try connecting + listTools.
  fastify.post("/api/projects/mcp/server/test", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.mcpClient) return reply.code(503).send({ error: "MCP client not available" });
    const query = request.query as Record<string, string>;
    const pathParam = query["path"];
    const idParam = query["id"];
    if (!pathParam || !idParam) return reply.code(400).send({ error: "path + id required" });
    const targetPath = resolvePath(pathParam);
    const nsId = mcpServerNs(targetPath, idParam);
    try {
      const tools = await deps.mcpClient.listTools(nsId);
      return reply.send({ ok: true, toolCount: tools.length, tools: tools.slice(0, 5).map((t: { name: string }) => t.name) });
    } catch (err) {
      return reply.code(502).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/projects/mcp/server/tools|prompts|resources?path=&id= — browse what
  // a connected server provides. Lets the MCPTab UI render the card's expanded
  // inspector. Errors surface as 502 with the underlying SDK message.
  // s133 t678 (2026-05-09) — `?fresh=1` on any of these GET endpoints
  // bypasses the mcp-client cache (forces a re-fetch). Refresh button in
  // MCPTab passes the param so the user always gets a current snapshot
  // when explicitly refreshing.
  const isFreshRequested = (q: Record<string, string>): boolean => {
    const fresh = q["fresh"];
    return fresh === "1" || fresh === "true";
  };
  fastify.get("/api/projects/mcp/server/tools", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.mcpClient) return reply.code(503).send({ error: "MCP client not available" });
    const query = request.query as Record<string, string>;
    const pathParam = query["path"]; const idParam = query["id"];
    if (!pathParam || !idParam) return reply.code(400).send({ error: "path + id required" });
    const nsId = mcpServerNs(resolvePath(pathParam), idParam);
    try {
      const tools = await deps.mcpClient.listTools(nsId, { bypassCache: isFreshRequested(query) });
      return reply.send({ ok: true, tools });
    } catch (err) {
      return reply.code(502).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get("/api/projects/mcp/server/prompts", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.mcpClient) return reply.code(503).send({ error: "MCP client not available" });
    const query = request.query as Record<string, string>;
    const pathParam = query["path"]; const idParam = query["id"];
    if (!pathParam || !idParam) return reply.code(400).send({ error: "path + id required" });
    const nsId = mcpServerNs(resolvePath(pathParam), idParam);
    try {
      const prompts = await deps.mcpClient.listPrompts(nsId, { bypassCache: isFreshRequested(query) });
      return reply.send({ ok: true, prompts });
    } catch (err) {
      return reply.code(502).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get("/api/projects/mcp/server/resources", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.mcpClient) return reply.code(503).send({ error: "MCP client not available" });
    const query = request.query as Record<string, string>;
    const pathParam = query["path"]; const idParam = query["id"];
    if (!pathParam || !idParam) return reply.code(400).send({ error: "path + id required" });
    const nsId = mcpServerNs(resolvePath(pathParam), idParam);
    try {
      const resources = await deps.mcpClient.listResources(nsId, { bypassCache: isFreshRequested(query) });
      return reply.send({ ok: true, resources });
    } catch (err) {
      return reply.code(502).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // s133 t679 (2026-05-09) — diagnostic surface for the MCP cache.
  // Returns per-server hit/miss/bypass/invalidation counts + last-fetch
  // timestamp; verifies the acceptance criterion "hit ratio > 80% under
  // normal browsing." Read-only; no UI surface in v1.
  fastify.get("/api/projects/mcp/server/cache-status", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.mcpClient) return reply.code(503).send({ error: "MCP client not available" });
    return reply.send({ ok: true, servers: deps.mcpClient.getCacheStatus() });
  });

  // POST /api/projects/mcp/server/call-tool|read-resource — invoke a tool or
  // read a resource. Body: {path, id, toolName/uri, arguments?}. Lets the user
  // test individual surfaces from the UI without round-tripping through chat.
  fastify.post("/api/projects/mcp/server/call-tool", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.mcpClient) return reply.code(503).send({ error: "MCP client not available" });
    const body = request.body as { path?: string; id?: string; toolName?: string; arguments?: Record<string, unknown> } | undefined;
    if (!body?.path || !body.id || !body.toolName) return reply.code(400).send({ error: "path + id + toolName required" });
    const nsId = mcpServerNs(resolvePath(body.path), body.id);
    try {
      const result = await deps.mcpClient.callTool(nsId, body.toolName, body.arguments ?? {});
      return reply.send({ ok: true, result });
    } catch (err) {
      return reply.code(502).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.post("/api/projects/mcp/server/read-resource", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.mcpClient) return reply.code(503).send({ error: "MCP client not available" });
    const body = request.body as { path?: string; id?: string; uri?: string; fresh?: boolean } | undefined;
    if (!body?.path || !body.id || !body.uri) return reply.code(400).send({ error: "path + id + uri required" });
    const nsId = mcpServerNs(resolvePath(body.path), body.id);
    try {
      // s133 t678 — body.fresh=true bypasses the resource-read cache.
      const result = await deps.mcpClient.readResource(nsId, body.uri, { bypassCache: body.fresh === true });
      return reply.send({ ok: true, result });
    } catch (err) {
      return reply.code(502).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/projects/mcp/server/reconnect?path=&id= — re-register the server
  // from current project.json + .env state, then attempt connect. Lets the user
  // recover from an `error` state caused by a transient network blip or a save
  // race without having to remove + re-add the server.
  fastify.post("/api/projects/mcp/server/reconnect", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    if (!deps.mcpClient || !deps.projectConfigManager) return reply.code(503).send({ error: "MCP client or project config manager not available" });
    const query = request.query as Record<string, string>;
    const pathParam = query["path"];
    const idParam = query["id"];
    if (!pathParam || !idParam) return reply.code(400).send({ error: "path + id required" });
    const targetPath = resolvePath(pathParam);
    try {
      const cur = await deps.projectConfigManager.read(targetPath);
      const servers = ((cur as { mcp?: { servers?: Array<{ id: string; name?: string; transport: "stdio" | "http" | "websocket"; command?: string[]; env?: Record<string, string>; url?: string; autoConnect?: boolean; authToken?: string }> } }).mcp?.servers ?? []);
      const target = servers.find((s) => s.id === idParam);
      if (!target) return reply.code(404).send({ error: `Server "${idParam}" not configured for this project` });
      const env = target.env ? resolveDollarVarsObject(target.env, readProjectEnv(targetPath)) : undefined;
      const authToken = target.authToken ? resolveDollarVars(target.authToken, readProjectEnv(targetPath)) : undefined;
      await deps.mcpClient.registerServer({
        id: mcpServerNs(targetPath, target.id),
        name: target.name,
        transport: target.transport,
        command: target.command,
        env,
        url: target.url,
        autoConnect: true,
        authToken,
      });
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(502).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/projects/mcp/available — list MCP server templates (built-in + plugin-registered).
  fastify.get("/api/projects/mcp/available", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "Projects API only allowed from private network" });
    // Built-in templates. Future: plugin-registered MCP service definitions (Wish #8 — Tynn plugin).
    const builtIn: Array<{ id: string; name: string; description: string; transport: "stdio" | "http" | "websocket"; defaultCommand?: string[]; defaultEnv?: Record<string, string>; defaultUrl?: string; authTokenKey?: string; pluginId?: string }> = [
      {
        id: "tynn",
        name: "Tynn",
        description: "Tynn-the-service via MCP. Provides PM tools (list-tasks, set-status, add-comment, getActiveFocusProgress, etc) for the agent. Uses HTTP transport with Bearer auth against tynn.ai.",
        transport: "http",
        defaultUrl: "https://tynn.ai/mcp/tynn",
        authTokenKey: "TYNN_API_KEY",
      },
    ];
    // Plugin-registered templates (s127 t489) — registered via
    // api.registerMcpServerTemplate from a marketplace plugin's activate
    // body. Appended after built-ins so the dashboard's dropdown shows
    // built-ins first, then plugin-provided templates in registration order.
    const pluginTemplates = (deps.pluginRegistry as { getMcpServerTemplates?: () => typeof builtIn } | undefined)?.getMcpServerTemplates?.() ?? [];
    return reply.send({ templates: [...builtIn, ...pluginTemplates] });
  });

  // -----------------------------------------------------------------------
  // POST /api/projects/git — git actions for a workspace project (private network only)
  // -----------------------------------------------------------------------

  fastify.post("/api/projects/git", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Git API only allowed from private network" });
    }
    const projectDirs = deps.workspaceProjects ?? [];
    const body = request.body as {
      path?: string;
      action?: string;
      [key: string]: unknown;
    };

    if (!body.path || typeof body.path !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }
    if (!body.action || typeof body.action !== "string") {
      return reply.code(400).send({ error: "action is required" });
    }

    const targetPath = resolvePath(body.path);
    const isInWorkspace = projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
    if (!isInWorkspace) {
      return reply.code(403).send({ error: "Path is not inside a configured workspace.projects directory" });
    }
    if (!existsSync(targetPath) || !statSync(targetPath).isDirectory()) {
      return reply.code(404).send({ error: "Project directory does not exist" });
    }
    const BRANCH_RE = /^[a-zA-Z0-9_\-./]+$/;

    // --- init / clone: handled before .git check ---
    if (body.action === "init") {
      if (existsSync(join(targetPath, ".git"))) {
        return reply.code(400).send({ error: "Already a git repository" });
      }
      const result = await execGitDashboard(["init"], targetPath);
      return reply.send({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
    }

    if (body.action === "clone") {
      if (existsSync(join(targetPath, ".git"))) {
        return reply.code(400).send({ error: "Already a git repository" });
      }
      const cloneUrl = body.url;
      if (typeof cloneUrl !== "string" || cloneUrl.trim().length === 0) {
        return reply.code(400).send({ error: "url is required for clone" });
      }
      try {
        const { stdout, stderr } = await execFileAsync("git", ["clone", cloneUrl.trim(), "."], {
          cwd: targetPath,
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
        });
        return reply.send({ exitCode: 0, stdout, stderr });
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; code?: number | string };
        return reply.send({
          exitCode: typeof e.code === "number" ? e.code : 1,
          stdout: typeof e.stdout === "string" ? e.stdout : "",
          stderr: typeof e.stderr === "string" ? e.stderr : (err instanceof Error ? err.message : String(err)),
        });
      }
    }

    if (!existsSync(join(targetPath, ".git"))) {
      return reply.code(400).send({ error: "Not a git repository" });
    }

    const validateBranch = (name: unknown): name is string =>
      typeof name === "string" && name.length > 0 && name.length < 256 && BRANCH_RE.test(name);

    const validatePaths = (paths: unknown): paths is string[] => {
      if (!Array.isArray(paths) || paths.length === 0) return false;
      for (const p of paths) {
        if (typeof p !== "string" || p.length === 0) return false;
        // Must not escape project directory
        const resolved = resolvePath(targetPath, p);
        if (!resolved.startsWith(targetPath)) return false;
      }
      return true;
    };

    const { action } = body;

    switch (action) {
      case "status": {
        const result = await execGitDashboard(["status", "--porcelain=v1", "-b"], targetPath);
        if (result.exitCode !== 0) {
          return reply.send({ exitCode: result.exitCode, error: result.stderr });
        }
        const parsed = parseGitStatus(result.stdout);
        return reply.send({ exitCode: 0, ...parsed });
      }

      case "fetch": {
        const result = await execGitDashboard(["fetch", "--all", "--prune"], targetPath);
        return reply.send(result);
      }

      case "pull": {
        const args = ["pull"];
        if (body.rebase === true) args.push("--rebase");
        const result = await execGitDashboard(args, targetPath);
        return reply.send(result);
      }

      case "push": {
        const args = ["push"];
        if (body.setUpstream === true) args.push("-u");
        if (typeof body.remote === "string" && body.remote.length > 0) {
          args.push(body.remote);
          if (typeof body.branch === "string" && body.branch.length > 0) {
            if (!validateBranch(body.branch)) {
              return reply.code(400).send({ error: "Invalid branch name" });
            }
            args.push(body.branch);
          }
        }
        const result = await execGitDashboard(args, targetPath);
        return reply.send(result);
      }

      case "stage": {
        if (!validatePaths(body.paths)) {
          return reply.code(400).send({ error: "paths must be a non-empty array of valid file paths" });
        }
        const result = await execGitDashboard(["add", "--", ...body.paths], targetPath);
        if (result.exitCode !== 0) {
          return reply.send({ exitCode: result.exitCode, error: result.stderr });
        }
        // Return current staged files
        const statusResult = await execGitDashboard(["status", "--porcelain=v1", "-b"], targetPath);
        const parsed = parseGitStatus(statusResult.stdout);
        return reply.send({ exitCode: 0, staged: parsed.staged });
      }

      case "unstage": {
        if (!validatePaths(body.paths)) {
          return reply.code(400).send({ error: "paths must be a non-empty array of valid file paths" });
        }
        const result = await execGitDashboard(["restore", "--staged", "--", ...body.paths], targetPath);
        if (result.exitCode !== 0) {
          return reply.send({ exitCode: result.exitCode, error: result.stderr });
        }
        const statusResult = await execGitDashboard(["status", "--porcelain=v1", "-b"], targetPath);
        const parsed = parseGitStatus(statusResult.stdout);
        return reply.send({ exitCode: 0, unstaged: parsed.unstaged });
      }

      case "commit": {
        if (typeof body.message !== "string" || body.message.trim().length === 0) {
          return reply.code(400).send({ error: "message is required" });
        }
        // Sanitize: strip control chars except newlines/tabs
        // oxlint-disable-next-line no-control-regex
        const sanitized = body.message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
        const result = await execGitDashboard(["commit", "-m", sanitized], targetPath);
        return reply.send(result);
      }

      case "log": {
        let count = 25;
        if (typeof body.count === "number" && body.count > 0) {
          count = Math.min(body.count, 100);
        }
        const result = await execGitDashboard(
          ["log", `--format=%H%x00%s%x00%an%x00%aI`, `-${count}`],
          targetPath,
        );
        if (result.exitCode !== 0) {
          return reply.send({ exitCode: result.exitCode, error: result.stderr, commits: [] });
        }
        const logCommits = result.stdout.trim().split("\n").filter(Boolean).map((line) => {
          const [hash = "", message = "", author = "", date = ""] = line.split("\0");
          return { hash: hash.slice(0, 8), message, author, date };
        });
        return reply.send({ exitCode: 0, commits: logCommits });
      }

      case "diff": {
        const args = ["diff"];
        if (body.staged === true) args.push("--cached");
        if (typeof body.path === "string" && body.path.length > 0) {
          const diffPath = body.path as string;
          // Validate it doesn't escape
          const resolved = resolvePath(targetPath, diffPath);
          if (!resolved.startsWith(targetPath)) {
            return reply.code(400).send({ error: "Invalid file path" });
          }
          args.push("--", diffPath);
        }
        const result = await execGitDashboard(args, targetPath);
        return reply.send({ diff: result.stdout, exitCode: result.exitCode });
      }

      case "stash_list": {
        const result = await execGitDashboard(["stash", "list", "--format=%gd%x00%gs"], targetPath);
        if (result.exitCode !== 0) {
          return reply.send({ exitCode: result.exitCode, error: result.stderr, stashes: [] });
        }
        const stashes = result.stdout.trim().split("\n").filter(Boolean).map((line) => {
          const [ref = "", message = ""] = line.split("\0");
          const indexMatch = ref.match(/\{(\d+)\}/);
          return { index: indexMatch ? parseInt(indexMatch[1]!, 10) : 0, message };
        });
        return reply.send({ exitCode: 0, stashes });
      }

      case "stash_save": {
        const stashArgs = ["stash", "push"];
        if (typeof body.message === "string" && body.message.trim().length > 0) {
          stashArgs.push("-m", body.message.trim());
        }
        const result = await execGitDashboard(stashArgs, targetPath);
        return reply.send(result);
      }

      case "stash_pop": {
        const popArgs = ["stash", "pop"];
        if (typeof body.index === "number") {
          popArgs.push(`stash@{${body.index}}`);
        }
        const result = await execGitDashboard(popArgs, targetPath);
        return reply.send(result);
      }

      case "stash_drop": {
        if (typeof body.index !== "number") {
          return reply.code(400).send({ error: "index is required" });
        }
        const result = await execGitDashboard(["stash", "drop", `stash@{${body.index}}`], targetPath);
        return reply.send(result);
      }

      case "branch_list": {
        const result = await execGitDashboard(
          ["branch", "-a", "--format=%(refname:short)%00%(upstream:short)%00%(HEAD)"],
          targetPath,
        );
        if (result.exitCode !== 0) {
          return reply.send({ exitCode: result.exitCode, error: result.stderr, branches: [] });
        }
        const branches = result.stdout.trim().split("\n").filter(Boolean).map((line) => {
          const [name = "", upstream = "", head = ""] = line.split("\0");
          return { name, upstream: upstream || null, current: head.trim() === "*" };
        });
        return reply.send({ exitCode: 0, branches });
      }

      case "branch_create": {
        if (!validateBranch(body.name)) {
          return reply.code(400).send({ error: "Invalid branch name" });
        }
        const result = await execGitDashboard(["branch", body.name], targetPath);
        return reply.send({ ...result, branch: body.name });
      }

      case "branch_checkout": {
        if (!validateBranch(body.name)) {
          return reply.code(400).send({ error: "Invalid branch name" });
        }
        const result = await execGitDashboard(["checkout", body.name], targetPath);
        return reply.send({ ...result, branch: body.name });
      }

      case "branch_delete": {
        if (!validateBranch(body.name)) {
          return reply.code(400).send({ error: "Invalid branch name" });
        }
        const result = await execGitDashboard(["branch", "-d", body.name], targetPath);
        return reply.send(result);
      }

      case "remote_list": {
        const result = await execGitDashboard(["remote", "-v"], targetPath);
        if (result.exitCode !== 0) {
          return reply.send({ exitCode: result.exitCode, error: result.stderr, remotes: [] });
        }
        const remoteMap = new Map<string, { name: string; fetchUrl: string; pushUrl: string }>();
        for (const line of result.stdout.trim().split("\n").filter(Boolean)) {
          const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
          if (!match) continue;
          const [, name = "", remoteUrl = "", type = ""] = match;
          if (!remoteMap.has(name)) {
            remoteMap.set(name, { name, fetchUrl: "", pushUrl: "" });
          }
          const entry = remoteMap.get(name)!;
          if (type === "fetch") entry.fetchUrl = remoteUrl;
          else entry.pushUrl = remoteUrl;
        }
        return reply.send({ exitCode: 0, remotes: Array.from(remoteMap.values()) });
      }

      case "remote_add": {
        const rName = body.name;
        const rUrl = body.url;
        if (typeof rName !== "string" || !BRANCH_RE.test(rName)) {
          return reply.code(400).send({ error: "Invalid remote name" });
        }
        if (typeof rUrl !== "string" || rUrl.trim().length === 0) {
          return reply.code(400).send({ error: "url is required" });
        }
        const result = await execGitDashboard(["remote", "add", rName, rUrl.trim()], targetPath);
        return reply.send({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
      }

      case "remote_remove": {
        const rName = body.name;
        if (typeof rName !== "string" || !BRANCH_RE.test(rName)) {
          return reply.code(400).send({ error: "Invalid remote name" });
        }
        const result = await execGitDashboard(["remote", "remove", rName], targetPath);
        return reply.send({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
      }

      default:
        return reply.code(400).send({ error: `Unknown action: ${action}` });
    }
  });

  // Worker routes moved to worker-api.ts — registered via preListenHooks in server.ts

  // -----------------------------------------------------------------------
  // POST /api/reload — hot-reload PRIME index, skills, etc. (private network only)
  // -----------------------------------------------------------------------

  if (deps.onReload !== undefined) {
    fastify.post("/api/reload", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Reload only allowed from private network" });
      }
      if (deps.onReload === undefined) {
        return reply.code(404).send({ error: "Not Found" });
      }
      try {
        const result = deps.onReload();
        log.info(`hot-reload: ${String(result.primeEntries)} PRIME entries, ${String(result.skillCount)} skills`);
        return reply.send(result);
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  // -----------------------------------------------------------------------
  // GET /api/prime/status — PRIME corpus source info (private network only)
  // -----------------------------------------------------------------------

  if (deps.primeLoader !== undefined) {
    const primeDir = deps.primeDir ?? "./.aionima";

    fastify.get("/api/prime/status", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Prime API only allowed from private network" });
      }

      let source = "unknown";
      let branch = "main";
      try {
        source = execSync("git remote get-url origin", { cwd: primeDir, encoding: "utf-8" }).trim();
      } catch { /* not a git repo — fall back to config */ }
      try {
        branch = execSync("git branch --show-current", { cwd: primeDir, encoding: "utf-8" }).trim() || "main";
      } catch { /* not a git repo */ }

      // If git didn't work, try reading from config file
      if (source === "unknown" && deps.configPath !== undefined) {
        try {
          const raw = readFileSync(deps.configPath, "utf-8");
          const cfg = JSON.parse(raw) as { prime?: { source?: string; branch?: string } };
          if (cfg.prime?.source) source = cfg.prime.source;
          if (cfg.prime?.branch) branch = cfg.prime.branch;
        } catch { /* ignore */ }
      }

      const entries = deps.primeLoader!.index();
      return reply.send({ source, branch, entries, dir: primeDir });
    });

    // -----------------------------------------------------------------------
    // POST /api/prime/switch — switch PRIME source repo (private network only)
    // -----------------------------------------------------------------------

    fastify.post("/api/prime/switch", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Prime API only allowed from private network" });
      }

      const body = request.body as { source?: string; branch?: string } | null;
      if (body === null || typeof body !== "object" || typeof body.source !== "string" || !body.source) {
        return reply.code(400).send({ error: "Missing required field: source" });
      }

      const newSource = body.source;
      const newBranch = body.branch ?? "main";

      try {
        // Check if primeDir is a git repo
        let isGitRepo = false;
        try {
          execSync("git rev-parse --git-dir", { cwd: primeDir, stdio: "pipe" });
          isGitRepo = true;
        } catch { /* not a git repo */ }

        if (isGitRepo) {
          // Update remote and fetch
          execSync(`git remote set-url origin ${newSource}`, { cwd: primeDir, stdio: "pipe" });
          execSync("git fetch origin", { cwd: primeDir, stdio: "pipe", timeout: 60_000 });
          execSync(`git checkout origin/${newBranch} --force`, { cwd: primeDir, stdio: "pipe" });
        } else {
          // Remove and clone fresh
          const { rmSync } = await import("node:fs");
          rmSync(primeDir, { recursive: true, force: true });
          execSync(
            `git clone --branch ${newBranch} --depth 1 ${newSource} ${primeDir}`,
            { stdio: "pipe", timeout: 120_000 },
          );
        }

        // Re-index
        const entries = deps.primeLoader!.index();

        // Update config file if available
        if (deps.configPath !== undefined) {
          try {
            const raw = readFileSync(deps.configPath, "utf-8");
            const cfg = JSON.parse(raw) as Record<string, unknown>;
            cfg.prime = { ...(cfg.prime as Record<string, unknown>), source: newSource, branch: newBranch };
            writeFileSync(deps.configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
          } catch { /* config write failed — non-fatal */ }
        }

        return reply.send({ ok: true, entries });
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  // -----------------------------------------------------------------------
  // GET /api/dev/status — dev mode repo status (private network only)
  // -----------------------------------------------------------------------

  {
    const workspaceRoot = deps.workspaceRoot ?? process.cwd();
    const primeDir = deps.primeDir ?? join(workspaceRoot, ".aionima");
    const idDir = ((deps.config as Record<string, unknown> | undefined)?.idService as Record<string, string> | undefined)?.dir ?? "/opt/agi-local-id";
    const marketplaceDir = ((deps.config as Record<string, unknown> | undefined)?.marketplace as Record<string, string> | undefined)?.dir ?? "/opt/agi-marketplace";
    const mappMarketplaceDir = ((deps.config as Record<string, unknown> | undefined)?.mappMarketplace as Record<string, string> | undefined)?.dir ?? "/opt/agi-mapp-marketplace";

    const getRemote = (cwd: string): string => {
      try {
        return execSync("git remote get-url origin", { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
      } catch { return "unknown"; }
    };

    const getBranch = (cwd: string): string => {
      try {
        return execSync("git branch --show-current", { cwd, encoding: "utf-8", stdio: "pipe" }).trim() || "main";
      } catch { return "main"; }
    };

    fastify.get("/api/dev/status", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Dev API only allowed from private network" });
      }
      if (dashboardUserStore) {
        const session = extractDashboardSession(request.raw, dashboardUserStore);
        if (!session || !hasRole(session.role, "admin")) {
          return reply.code(403).send({ error: "Admin role required" });
        }
      }

      let enabled = false;
      if (deps.configPath !== undefined) {
        try {
          const raw = readFileSync(deps.configPath, "utf-8");
          const cfg = JSON.parse(raw) as { dev?: { enabled?: boolean }; agent?: { devMode?: boolean } };
          enabled = cfg.dev?.enabled ?? cfg.agent?.devMode ?? false;
        } catch { /* ignore */ }
      }

      const primeEntries = deps.primeLoader !== undefined ? deps.primeLoader.index() : 0;

      // Query Local-ID for the GitHub connection's state so the dashboard
      // can surface account label + token expiry (tynn #254). Local-ID
      // lives at id.ai.on and is the canonical identity store; AGI just
      // reads through it.
      let githubAuthenticated = false;
      let githubAccount: string | null = null;
      let githubTokenExpiresAt: string | null = null;
      let githubTokenScopes: string | null = null;
      try {
        const idUrl = resolveIdUrl(deps.configPath);
        const idRes = await fetch(`${idUrl}/api/auth/device-flow/status`, { signal: AbortSignal.timeout(3000) });
        if (idRes.ok) {
          const conns = (await idRes.json()) as Array<{
            provider: string;
            accountLabel?: string | null;
            tokenExpiresAt?: string | null;
            scopes?: string | null;
          }>;
          const gh = conns.find((c) => c.provider === "github");
          if (gh) {
            githubAuthenticated = true;
            githubAccount = gh.accountLabel ?? null;
            githubTokenExpiresAt = gh.tokenExpiresAt ?? null;
            githubTokenScopes = gh.scopes ?? null;
          }
        }
      } catch { /* ID service unreachable — treat as not authenticated */ }

      // When Dev Mode is ON, the authoritative clones live under the
      // `_aionima/` core collection in the projects workspace — NOT the
      // /opt/* deploy dirs. Prefer the collection paths if they exist,
      // fall back to the legacy dirs. Without this preference, the
      // Repository Status panel rendered stale Civicognita remotes from
      // the /opt/ deploys even after Dev Mode successfully cloned the
      // forks into _aionima/.
      const projectsRoot = (deps.workspaceProjects ?? [])[0];
      const coreCollectionRoot = projectsRoot ? join(projectsRoot, "_aionima") : null;
      const pickDir = (legacy: string, slug: string): string => {
        if (enabled && coreCollectionRoot) {
          const corePath = join(coreCollectionRoot, slug);
          if (existsSync(join(corePath, ".git"))) return corePath;
        }
        return legacy;
      };

      const agiDir = pickDir(workspaceRoot, "agi");
      const effectivePrimeDir = pickDir(primeDir, "prime");
      const effectiveIdDir = pickDir(idDir, "id");
      const effectiveMarketplaceDir = pickDir(marketplaceDir, "marketplace");
      const effectiveMappMarketplaceDir = pickDir(mappMarketplaceDir, "mapp-marketplace");

      // PAx (Particle-Academy) ADF UI primitive forks — s136 t512. No
      // /opt/* deploy paths (these aren't production-deployed); the
      // legacy fallback in pickDir's first arg is the workspace path
      // itself, so when contributing-mode is off we report them as
      // unknown gracefully (getRemote on a non-git dir returns "unknown").
      const paxFallback = projectsRoot ? join(projectsRoot, "_aionima") : workspaceRoot;
      const reactFancyDir   = pickDir(join(paxFallback, "react-fancy"),   "react-fancy");
      const fancyCodeDir    = pickDir(join(paxFallback, "fancy-code"),    "fancy-code");
      const fancySheetsDir  = pickDir(join(paxFallback, "fancy-sheets"),  "fancy-sheets");
      const fancyEchartsDir = pickDir(join(paxFallback, "fancy-echarts"), "fancy-echarts");

      // Phase H.2 — origins alignment check. When Dev Mode is enabled,
      // each /opt/*/.git origin should be pointing at the owner's fork
      // (via v0.4.66's `ensure_origin_remote` in upgrade.sh). If any
      // origin is still Civicognita, the one-time migration hasn't run
      // yet — the dashboard surfaces a yellow callout prompting
      // `agi upgrade`.
      let originsAligned = false;
      const originMisaligned: string[] = [];
      if (enabled) {
        try {
          const cfg = deps.configPath
            ? JSON.parse(readFileSync(deps.configPath, "utf-8")) as {
                dev?: { agiRepo?: string; primeRepo?: string; idRepo?: string };
              }
            : {};
          const probes: Array<[string, string, string | undefined]> = [
            ["agi", "/opt/agi", cfg.dev?.agiRepo],
            ["prime", "/opt/agi-prime", cfg.dev?.primeRepo],
            ["id", "/opt/agi-local-id", cfg.dev?.idRepo],
          ];
          let aligned = true;
          for (const [name, dir, expected] of probes) {
            if (!existsSync(join(dir, ".git"))) {
              // Dir missing — not misalignment, skip.
              continue;
            }
            if (!expected) {
              aligned = false;
              originMisaligned.push(`${name}: no dev.${name}Repo in config`);
              continue;
            }
            const current = getRemote(dir);
            if (current !== expected) {
              aligned = false;
              originMisaligned.push(`${name}: ${current ?? "(unknown)"} (expected ${expected})`);
            }
          }
          originsAligned = aligned;
        } catch {
          // Can't read config — leave originsAligned false but don't
          // populate misalignment list (we don't know the expected).
          originsAligned = false;
        }
      }

      return reply.send({
        enabled,
        githubAuthenticated,
        githubAccount,
        githubTokenExpiresAt,
        githubTokenScopes,
        originsAligned,
        originMisaligned: originMisaligned.length > 0 ? originMisaligned : undefined,
        agi: { remote: getRemote(agiDir), branch: getBranch(agiDir) },
        prime: { remote: getRemote(effectivePrimeDir), branch: getBranch(effectivePrimeDir), entries: primeEntries },
        id: { remote: getRemote(effectiveIdDir), branch: getBranch(effectiveIdDir) },
        marketplace: { remote: getRemote(effectiveMarketplaceDir), branch: getBranch(effectiveMarketplaceDir) },
        mappMarketplace: { remote: getRemote(effectiveMappMarketplaceDir), branch: getBranch(effectiveMappMarketplaceDir) },
        // PAx (Particle-Academy) ADF UI primitive forks — s136 t512.
        reactFancy:   { remote: getRemote(reactFancyDir),   branch: getBranch(reactFancyDir) },
        fancyCode:    { remote: getRemote(fancyCodeDir),    branch: getBranch(fancyCodeDir) },
        fancySheets:  { remote: getRemote(fancySheetsDir),  branch: getBranch(fancySheetsDir) },
        fancyEcharts: { remote: getRemote(fancyEchartsDir), branch: getBranch(fancyEchartsDir) },
      });
    });

    // -----------------------------------------------------------------------
    // GET /api/dev/core-forks/status — ahead/behind per core fork (tynn #276)
    // -----------------------------------------------------------------------
    //
    // Surfaces each of the five `_aionima/<slug>/` clones with its
    // ahead/behind count vs `upstream/<branch>`. Branch defaults to
    // `gateway.updateChannel` — whatever release channel the owner's
    // gateway subscribes to. Fetch is bounded per-repo so one slow
    // network link can't stall the whole listing.

    fastify.get("/api/dev/core-forks/status", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Dev API only allowed from private network" });
      }
      if (dashboardUserStore) {
        const session = extractDashboardSession(request.raw, dashboardUserStore);
        if (!session || !hasRole(session.role, "admin")) {
          return reply.code(403).send({ error: "Admin role required" });
        }
      }

      const projectsRoot = (deps.workspaceProjects ?? [])[0];
      if (!projectsRoot) {
        return reply.send({ forks: [], error: "no workspace projects dir configured" });
      }
      const coreCollectionDir = join(projectsRoot, "_aionima");
      if (!existsSync(coreCollectionDir)) {
        return reply.send({ forks: [], error: "core-fork collection not provisioned — enable Dev Mode" });
      }

      let branch = "main";
      if (deps.configPath !== undefined) {
        try {
          const cfg = JSON.parse(readFileSync(deps.configPath, "utf-8")) as {
            gateway?: { updateChannel?: string };
          };
          if (typeof cfg.gateway?.updateChannel === "string" && cfg.gateway.updateChannel.length > 0) {
            branch = cfg.gateway.updateChannel;
          }
        } catch { /* fall back to main */ }
      }

      const { getAllCoreForkStatuses } = await import("./dev-mode-merge.js");
      const forks = await getAllCoreForkStatuses(coreCollectionDir, branch);
      return reply.send({ forks, branch });
    });

    // -----------------------------------------------------------------------
    // POST /api/dev/core-forks/:slug/merge — merge upstream into owner fork
    // -----------------------------------------------------------------------
    //
    // Body `{ strategy?: "ff-only" | "agentic" }`, default `"ff-only"`.
    // Attempts ff → merge-commit → (if strategy === "agentic") aion-micro
    // assisted resolution. Successful merges get pushed to origin so the
    // next `agi upgrade` picks them up; failures return a structured
    // conflict response that the dashboard can render.

    fastify.post("/api/dev/core-forks/:slug/merge", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Dev API only allowed from private network" });
      }
      if (dashboardUserStore) {
        const session = extractDashboardSession(request.raw, dashboardUserStore);
        if (!session || !hasRole(session.role, "admin")) {
          return reply.code(403).send({ error: "Admin role required" });
        }
      }

      const { slug } = request.params as { slug: string };
      const { CORE_REPOS: CORE_REPO_SPECS } = await import("./dev-mode-forks.js");
      const spec = CORE_REPO_SPECS.find((s) => s.slug === slug);
      if (!spec) {
        return reply.code(404).send({ error: `unknown core fork: ${slug}` });
      }

      const projectsRoot = (deps.workspaceProjects ?? [])[0];
      if (!projectsRoot) {
        return reply.code(500).send({ error: "no workspace projects dir configured" });
      }
      const targetDir = join(projectsRoot, "_aionima", spec.slug);
      if (!existsSync(targetDir)) {
        return reply.code(404).send({ error: `fork not provisioned — toggle Dev Mode to provision ${slug}` });
      }

      let branch = "main";
      if (deps.configPath !== undefined) {
        try {
          const cfg = JSON.parse(readFileSync(deps.configPath, "utf-8")) as {
            gateway?: { updateChannel?: string };
          };
          if (typeof cfg.gateway?.updateChannel === "string" && cfg.gateway.updateChannel.length > 0) {
            branch = cfg.gateway.updateChannel;
          }
        } catch { /* fall back to main */ }
      }

      const body = (request.body as { strategy?: string } | undefined) ?? {};
      const strategy: "ff-only" | "agentic" = body.strategy === "agentic" ? "agentic" : "ff-only";

      const { attemptMerge } = await import("./dev-mode-merge.js");
      const mergeLog = createComponentLogger(deps.logger ?? undefined, "dev-merge");
      const result = await attemptMerge({
        targetDir,
        spec,
        branch,
        strategy,
        aionMicro: strategy === "agentic" ? deps.aionMicro : undefined,
        log: mergeLog,
      });

      // Notify the dashboard to re-poll status after a successful merge.
      if (result.ok) {
        try {
          deps.wsRef?.server?.broadcast("dashboard_event", {
            type: "dev:core-fork-updated" as const,
            data: {
              slug: spec.slug,
              newSha: result.newSha,
              agentic: result.agentic,
            },
          });
        } catch { /* best-effort */ }
      }

      return reply.send(result);
    });

    // -----------------------------------------------------------------------
    // POST /api/dev/switch — toggle dev mode (private network only)
    // -----------------------------------------------------------------------

    fastify.post("/api/dev/switch", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Dev API only allowed from private network" });
      }

      const session = dashboardUserStore
        ? extractDashboardSession(request.raw, dashboardUserStore)
        : null;
      if (dashboardUserStore && (!session || !hasRole(session.role, "admin"))) {
        return reply.code(403).send({ error: "Admin role required" });
      }

      const body = request.body as { enabled?: boolean } | null;
      if (body === null || body === undefined || typeof body.enabled !== "boolean") {
        return reply.code(400).send({ error: "Request body must include { enabled: boolean }" });
      }

      const targetEnabled = body.enabled;

      // Enabling dev mode requires GitHub authentication (checked via Local-ID)
      let ownerGithubLogin: string | null = null;
      if (targetEnabled) {
        let hasGithub = false;
        try {
          const idUrl = resolveIdUrl(deps.configPath);
          const idRes = await fetch(`${idUrl}/api/auth/device-flow/status`, { signal: AbortSignal.timeout(3000) });
          if (idRes.ok) {
            const conns = await idRes.json() as Array<{ provider: string; accountLabel?: string | null }>;
            const gh = conns.find((c) => c.provider === "github");
            if (gh) {
              hasGithub = true;
              ownerGithubLogin = gh.accountLabel?.trim() ?? null;
            }
          }
        } catch { /* ID service unreachable */ }
        if (!hasGithub) {
          return reply.code(403).send({
            error: "GitHub authentication required. Connect your GitHub account via Aionima ID before enabling dev mode.",
            reason: "github_not_authenticated",
          });
        }
      }

      // When flipping ON, resolve (or fork) each of the canonical repos
      // into the owner's GitHub account FIRST, then persist the fork
      // URLs into `dev.*Repo`. Previously the toggle wrote `{enabled:
      // true}` with nothing else and the clone loop silently no-op'd
      // because the URLs were undefined. Owners reasonably expect the
      // toggle to provision everything.
      const forkFailures: Array<{ slug: string; reason: string }> = [];
      let devRepoPatch: Record<string, string> = {};
      let forkNotes: Array<{ slug: string; created: boolean; upstream: string }> = [];
      if (targetEnabled) {
        // Grab the owner's token from Local-ID so we can hit the GitHub API.
        const tokenInfo = await fetchOwnerToken({ provider: "github", role: "owner" });
        if (!tokenInfo) {
          return reply.code(502).send({
            error: "GitHub token unavailable from Local-ID. Reconnect your GitHub account at https://id.ai.on/dashboard.",
            reason: "token_missing",
          });
        }
        if (!ownerGithubLogin) {
          return reply.code(502).send({
            error: "Local-ID didn't return a GitHub login. Reconnect your GitHub account.",
            reason: "github_login_missing",
          });
        }
        const { resolveOrCreateForks } = await import("./dev-mode-forks.js");
        const forks = await resolveOrCreateForks(tokenInfo.accessToken, ownerGithubLogin);
        for (const f of forks) {
          if (f.cloneUrl) {
            // Map slug → dev.*Repo key. Civicognita-owned core five
            // (legacy) + Particle-Academy PAx four (s136 t512). New
            // entries here must match `CoreRepoSpec.configKey` in
            // dev-mode-forks.ts AND the field added to DevConfigSchema
            // in agi/config/src/schema.ts — three places kept in sync
            // by hand (a future refactor could derive this from the
            // CORE_REPOS spec list directly).
            const keyMap: Record<string, string> = {
              "agi": "agiRepo",
              "prime": "primeRepo",
              "id": "idRepo",
              "marketplace": "marketplaceRepo",
              "mapp-marketplace": "mappMarketplaceRepo",
              "react-fancy": "reactFancyRepo",
              "fancy-code": "fancyCodeRepo",
              "fancy-sheets": "fancySheetsRepo",
              "fancy-echarts": "fancyEchartsRepo",
            };
            const cfgKey = keyMap[f.slug];
            if (cfgKey) devRepoPatch[cfgKey] = f.cloneUrl;
            forkNotes.push({ slug: f.slug, created: f.created, upstream: f.upstreamUrl });
          } else {
            forkFailures.push({ slug: f.slug, reason: f.error ?? "fork resolution failed" });
          }
        }
      }

      // Dev mode now switches which directory is used (not git remotes).
      // Update config file to toggle dev.enabled — path resolution happens at next boot.
      try {
        if (deps.configPath !== undefined) {
          const raw = readFileSync(deps.configPath, "utf-8");
          const cfg = JSON.parse(raw) as Record<string, unknown>;
          // Persist fork URLs alongside `enabled` so the clone loop + the
          // auto-sync task resolver (dev-mode-sources.ts) see them.
          cfg.dev = {
            ...(cfg.dev as Record<string, unknown>),
            enabled: targetEnabled,
            ...devRepoPatch,
          };
          // Backward compat — also set agent.devMode
          const agent = (cfg.agent as Record<string, unknown>) ?? {};
          agent.devMode = targetEnabled;
          cfg.agent = agent;
          writeFileSync(deps.configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
        }

        // Provision fork repos into workspace when enabling dev mode.
        // Track failures per-repo so the switch response can surface them
        // to the dashboard (tynn #252) instead of silently dropping the
        // error into the log.
        const provisionedProjects: string[] = [];
        const provisionFailures: Array<{ slug: string; reason: string }> = [];
        if (targetEnabled) {
          const projectDir = (deps.workspaceProjects ?? [])[0];
          if (projectDir && existsSync(projectDir)) {
            // Read dev config from file (cfg may be scoped above)
            let devCfg: Record<string, unknown> = {};
            if (deps.configPath) {
              try {
                const cfgRaw = JSON.parse(readFileSync(deps.configPath, "utf-8")) as Record<string, unknown>;
                devCfg = (cfgRaw.dev as Record<string, unknown>) ?? {};
              } catch { /* use empty defaults */ }
            }
            const { CORE_REPOS: CORE_REPO_SPECS, upstreamRemoteUrl: upstreamRemoteUrlFn } = await import("./dev-mode-forks.js");
            const CORE_REPOS: Array<{ slug: string; name: string; repoKey: string; upstreamUrl: string }> = CORE_REPO_SPECS.map((s) => ({
              slug: s.slug,
              name: s.displayName,
              repoKey: s.configKey,
              upstreamUrl: upstreamRemoteUrlFn(s),
            }));

            // Fetch the owner's GitHub token once for all clones — Dev Mode
            // forks live under wishborn/*, which may be private. HTTPS with
            // x-access-token injects credentials; unauthenticated fallback
            // works for public forks but fails with 404 on private ones.
            const ownerToken = await fetchOwnerToken({ provider: "github", role: "owner" });

            // Core forks live in a special `_aionima/` collection inside
            // the workspace — NOT scattered next to regular projects. The
            // `_`-prefix excludes the parent from hosting discovery (see
            // hosting-manager's readdirSync walker). Each child inherits
            // the `type: "aionima"` restricted UX so users see only the
            // Editor + Repository tabs, not full project-config settings.
            const coreCollectionDir = join(projectDir, "_aionima");
            if (!existsSync(coreCollectionDir)) {
              mkdirSync(coreCollectionDir, { recursive: true });
              // Marker so the dashboard can identify this as "Aionima Core".
              writeFileSync(
                join(coreCollectionDir, "collection.json"),
                JSON.stringify(
                  {
                    type: "aionima-collection",
                    name: "Aionima Core",
                    description: "Forks of the AGI platform repos — submit contributions as PRs.",
                    createdAt: new Date().toISOString(),
                  },
                  null,
                  2,
                ) + "\n",
                "utf-8",
              );
            }

            for (const repo of CORE_REPOS) {
              const repoUrl = devCfg[repo.repoKey] as string | undefined;
              if (!repoUrl) continue;
              const targetDir = join(coreCollectionDir, repo.slug);
              const cloneUrl = ownerToken
                ? injectTokenIntoCloneUrl(repoUrl, ownerToken.accessToken)
                : repoUrl;
              try {
                // Clone if directory doesn't exist. Use execFileSync (no
                // shell) so the authenticated URL isn't logged / eligible
                // for accidental shell interpolation.
                if (!existsSync(targetDir)) {
                  mkdirSync(targetDir, { recursive: true });
                  execFileSync("git", ["clone", cloneUrl, "."], {
                    cwd: targetDir, stdio: "pipe", timeout: 120_000,
                  });
                  // SECURITY: the clone URL embedded the OAuth token as
                  // `https://x-access-token:TOKEN@github.com/...`. git
                  // persists whatever we clone from as `origin`. Leaving
                  // the token in `.git/config` means it shows up in any
                  // `git remote -v` and any API that exposes the remote.
                  // Rewrite origin to the clean fork URL (no credentials).
                  // Future fetch/push will use `GIT_ASKPASS`/credential
                  // helpers, NOT an embedded URL.
                  try {
                    execFileSync("git", ["remote", "set-url", "origin", repoUrl], {
                      cwd: targetDir, stdio: "pipe",
                    });
                  } catch {
                    /* non-fatal — clone succeeded, token stays in origin */
                  }
                  // Configure `upstream` remote so the Repository tab can
                  // compare the fork against the canonical Civicognita repo.
                  // Without this, `git rev-list upstream/<branch>...HEAD`
                  // fails and the dashboard has no way to show ahead/behind
                  // against the release channel.
                  try {
                    execFileSync("git", ["remote", "add", "upstream", repo.upstreamUrl], {
                      cwd: targetDir, stdio: "pipe",
                    });
                  } catch {
                    /* already configured — overwrite below */
                    try {
                      execFileSync("git", ["remote", "set-url", "upstream", repo.upstreamUrl], {
                        cwd: targetDir, stdio: "pipe",
                      });
                    } catch { /* ignore */ }
                  }
                }
                // Migrate legacy clones that still have a token-bearing origin
                // (produced by earlier versions of Dev Mode). Safe no-op if
                // the URL is already clean.
                try {
                  const current = execFileSync("git", ["remote", "get-url", "origin"], {
                    cwd: targetDir, stdio: "pipe",
                  }).toString().trim();
                  if (current.includes("x-access-token:") || /:gh[a-z]_[A-Za-z0-9]+@/.test(current)) {
                    execFileSync("git", ["remote", "set-url", "origin", repoUrl], {
                      cwd: targetDir, stdio: "pipe",
                    });
                    log.info(`dev: scrubbed token from ${repo.slug} origin URL`);
                  }
                } catch { /* ignore */ }
                // Retrofit `upstream` remote on clones made before this
                // commit. Newer clones set it inside the if-not-exists
                // block above; pre-existing clones (the five that landed
                // in earlier v0.4.x iterations) reach this code path
                // instead and get the remote added on the next toggle.
                try {
                  let hasUpstream = false;
                  try {
                    execFileSync("git", ["remote", "get-url", "upstream"], {
                      cwd: targetDir, stdio: "pipe",
                    });
                    hasUpstream = true;
                  } catch { /* missing — add below */ }
                  if (hasUpstream) {
                    execFileSync("git", ["remote", "set-url", "upstream", repo.upstreamUrl], {
                      cwd: targetDir, stdio: "pipe",
                    });
                  } else {
                    execFileSync("git", ["remote", "add", "upstream", repo.upstreamUrl], {
                      cwd: targetDir, stdio: "pipe",
                    });
                    log.info(`dev: added upstream remote for ${repo.slug}`);
                  }
                } catch { /* non-fatal — merge UI will surface the error */ }
                // Write/update project.json with aionima type
                const metaPath = projectConfigPath(targetDir);
                mkdirSync(dirname(metaPath), { recursive: true });
                let existingMeta: Record<string, unknown> = {};
                try { existingMeta = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>; } catch { /* new project */ }
                const meta = {
                  ...existingMeta,
                  name: repo.name,
                  type: "aionima",
                  category: "monorepo",
                  createdAt: existingMeta.createdAt ?? new Date().toISOString(),
                };
                writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
                provisionedProjects.push(repo.slug);
              } catch (cloneErr) {
                const reason = cloneErr instanceof Error ? cloneErr.message : String(cloneErr);
                log.warn(`dev: failed to provision ${repo.slug}: ${reason}`);
                provisionFailures.push({ slug: repo.slug, reason });
              }
            }
          }

          // Provision test.ai.on for Playwright UI testing (best-effort).
          // Precondition checks (tynn #256) — skip cleanly with a clear
          // provisionFailure entry rather than silently crashing if
          // multipass or sudo isn't available.
          const haveMultipass = (() => {
            try {
              execFileSync("which", ["multipass"], { stdio: "pipe", timeout: 3000 });
              return true;
            } catch { return false; }
          })();
          const haveSudo = (() => {
            try {
              execFileSync("sudo", ["-n", "true"], { stdio: "pipe", timeout: 3000 });
              return true;
            } catch { return false; }
          })();

          if (!haveMultipass) {
            provisionFailures.push({
              slug: "test-vm",
              reason: "multipass not installed — run `sudo snap install multipass` to enable test VM provisioning",
            });
          } else if (!haveSudo) {
            provisionFailures.push({
              slug: "test-vm",
              reason: "passwordless sudo required for dnsmasq / Caddy setup — grant NOPASSWD in /etc/sudoers.d/ to enable test VM provisioning",
            });
          } else try {
            const vmIpRaw = execSync("multipass info agi-test --format csv 2>/dev/null", { encoding: "utf-8", stdio: "pipe", timeout: 5000 });
            const vmIpLine = vmIpRaw.trim().split("\n").pop() ?? "";
            const vmIp = vmIpLine.split(",")[2]?.trim();
            if (vmIp && vmIp.length > 0) {
              // Update host dnsmasq
              execSync(`sudo sed -i '/test\\.ai\\.on/d' /etc/dnsmasq.d/ai-on.conf`, { stdio: "pipe" });
              execSync(`echo 'address=/test.ai.on/${vmIp}' | sudo tee -a /etc/dnsmasq.d/ai-on.conf`, { stdio: "pipe" });
              execSync("sudo systemctl restart dnsmasq", { stdio: "pipe", timeout: 10000 });

              // Update VM Caddy — add test.ai.on site
              const caddySnippet = `\\ntest.ai.on {\\n  tls internal\\n  reverse_proxy localhost:3100\\n}`;
              execSync(`multipass exec agi-test -- sudo bash -c "grep -q 'test.ai.on' /etc/caddy/Caddyfile || echo -e '${caddySnippet}' >> /etc/caddy/Caddyfile && sudo systemctl restart caddy"`, { stdio: "pipe", timeout: 15000 });

              // Update VM /etc/hosts
              execSync(`multipass exec agi-test -- sudo bash -c "grep -q 'test.ai.on' /etc/hosts || sudo sed -i 's/ai.on/ai.on test.ai.on/' /etc/hosts"`, { stdio: "pipe", timeout: 5000 });

              log.info("dev: test.ai.on provisioned (VM IP: " + vmIp + ")");
            }
          } catch (testVmErr) {
            const reason = testVmErr instanceof Error ? testVmErr.message : String(testVmErr);
            log.warn(`dev: test.ai.on provisioning failed — ${reason}`);
            provisionFailures.push({ slug: "test-vm", reason });
          }
        }

        if (deps.coaLogger && deps.entityStore) {
          const ownerEntity = deps.ownerEntityId
            ? await deps.entityStore.getEntity(deps.ownerEntityId)
            : null;
          const auditEntity = ownerEntity ?? await deps.entityStore.resolveOrCreate("system", "$DEV_MODE", "Dev Mode");
          const actor = session?.username ?? "unknown";
          const ref = `dev.mode:${targetEnabled ? "enabled" : "disabled"}:${actor}`;
          void deps.coaLogger.log({
            resourceId: deps.resourceId ?? "$A0",
            entityId: auditEntity.id,
            entityAlias: auditEntity.coaAlias,
            nodeId: deps.nodeId ?? "@A0",
            workType: "action",
            action: "update",
            ref,
          });
        }

        // Merge fork-resolution failures with clone-provisioning failures
        // so the UI renders one combined list.
        const allFailures = [...forkFailures, ...provisionFailures];
        const failureNote = allFailures.length > 0
          ? ` ${allFailures.length} item${allFailures.length === 1 ? "" : "s"} failed: ${allFailures.map((f) => f.slug).join(", ")}.`
          : "";
        const createdCount = forkNotes.filter((n) => n.created).length;
        const forkNote = createdCount > 0
          ? ` Created ${createdCount} new fork${createdCount === 1 ? "" : "s"} on GitHub.`
          : "";

        return reply.send({
          ok: true,
          enabled: targetEnabled,
          provisionedProjects,
          // `provisionFailures` is always present in the response (possibly
          // empty) so the dashboard can render a failure list without
          // branching on undefined.
          provisionFailures: allFailures,
          // Per-repo fork outcome — dashboard can render "reused X" vs
          // "created X" to match the user's expectation.
          forks: forkNotes,
          note: targetEnabled && provisionedProjects.length > 0
            ? `Provisioned ${provisionedProjects.length} repos.${forkNote} Restart required for path changes to take effect.${failureNote}`
            : `Restart required for path changes to take effect.${forkNote}${failureNote}`,
        });
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  // -----------------------------------------------------------------------
  // Test VM management (private network only, dev mode)
  // -----------------------------------------------------------------------

  const testVmScript = join(deps.selfRepoPath ?? "/opt/agi", "scripts", "test-vm.sh");
  const ALLOWED_VM_COMMANDS = new Set([
    "create", "destroy", "status", "setup", "provision",
    "services-setup", "services-start", "services-stop", "services-status",
    "test", "test-ui", "remount",
  ]);

  fastify.get("/api/test-vm/status", async (request, reply) => {
    if (!isPrivateNetwork(getClientIp(request.raw))) {
      return reply.code(403).send({ error: "Private network only" });
    }
    try {
      const info = execFileSync("bash", [testVmScript, "status"], {
        stdio: "pipe", timeout: 10_000,
      }).toString();

      const running = info.includes("Running");
      const ipMatch = /IPv4:\s+(\S+)/.exec(info);
      const ip = ipMatch?.[1] ?? null;

      // Test-VM services are reported from inside the VM via
      // `test-vm.sh services-status`. We surface only what the host
      // dashboard actually renders: postgres, caddy, agi. The VM's ID
      // service is VM-internal — it's not probed from the host, and the
      // dashboard's red/green ID light tracks the HOST's Local-ID
      // (reported separately via /api/system/connections). Removing the
      // `id` field here avoids a cross-namespace "red light" when the
      // host ID is up but the VM ID isn't (tynn #259).
      let services = { postgres: "unknown", caddy: "unknown", agi: "unknown" };
      if (running) {
        try {
          const svcOut = execFileSync("bash", [testVmScript, "services-status"], {
            stdio: "pipe", timeout: 15_000,
          }).toString();
          services = {
            postgres: svcOut.includes("PostgreSQL: active") ? "active" : "inactive",
            caddy: svcOut.includes("Caddy: active") || svcOut.includes("Caddy:      active") ? "active" : "inactive",
            agi: svcOut.includes("AGI:        running") || svcOut.includes("AGI: running") ? "running" : "stopped",
          };
        } catch { /* services-status may fail if services not set up */ }
      }

      return reply.send({ exists: true, running, ip, services });
    } catch {
      return reply.send({ exists: false, running: false, ip: null, services: { postgres: "unknown", caddy: "unknown", agi: "unknown" } });
    }
  });

  fastify.post("/api/test-vm/command", async (request, reply) => {
    if (!isPrivateNetwork(getClientIp(request.raw))) {
      return reply.code(403).send({ error: "Private network only" });
    }
    const body = request.body as { command?: string } | undefined;
    const command = body?.command;
    if (!command || !ALLOWED_VM_COMMANDS.has(command)) {
      return reply.code(400).send({ error: `Invalid command. Allowed: ${[...ALLOWED_VM_COMMANDS].join(", ")}` });
    }

    const child = spawn("bash", [testVmScript, command], {
      cwd: deps.selfRepoPath ?? "/opt/agi",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const broadcast = (phase: string, status: string, message: string) => {
      const data = { phase, status, message, timestamp: new Date().toISOString() };
      deps.wsRef?.server?.broadcast("dashboard_event", { type: "system:test-vm", data });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf-8").split("\n").filter(Boolean)) {
        try {
          const parsed = JSON.parse(line) as { phase?: string; status?: string; details?: string };
          if (parsed.phase) {
            broadcast(parsed.phase, parsed.status ?? "info", parsed.details ?? line);
            continue;
          }
        } catch { /* not JSON */ }
        broadcast(command, "info", line);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8").trim();
      if (text) broadcast(command, "warn", text);
    });

    child.on("close", (code) => {
      if (code === 0) {
        broadcast(command, "done", `${command} completed`);
      } else {
        broadcast(command, "error", `${command} failed (exit code ${String(code)})`);
      }
    });

    return reply.send({ ok: true, command });
  });

  fastify.get("/api/test-vm/test-results", async (request, reply) => {
    if (!isPrivateNetwork(getClientIp(request.raw))) {
      return reply.code(403).send({ error: "Private network only" });
    }
    try {
      const reportDir = join(homedir(), ".agi", "playwright", "report");
      const indexPath = join(reportDir, "index.html");
      if (!existsSync(indexPath)) {
        return reply.send({ total: 0, passed: 0, failed: 0, skipped: 0, tests: [] });
      }
      const html = readFileSync(indexPath, "utf-8");
      const passedMatch = /(\d+) passed/.exec(html);
      const failedMatch = /(\d+) failed/.exec(html);
      const skippedMatch = /(\d+) skipped/.exec(html);
      return reply.send({
        total: Number(passedMatch?.[1] ?? 0) + Number(failedMatch?.[1] ?? 0) + Number(skippedMatch?.[1] ?? 0),
        passed: Number(passedMatch?.[1] ?? 0),
        failed: Number(failedMatch?.[1] ?? 0),
        skipped: Number(skippedMatch?.[1] ?? 0),
        tests: [],
      });
    } catch {
      return reply.send({ total: 0, passed: 0, failed: 0, skipped: 0, tests: [] });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/config — read current config (private network only)
  // -----------------------------------------------------------------------

  if (deps.configPath !== undefined) {
    fastify.get("/api/config", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Config API only allowed from private network" });
      }
      if (deps.configPath === undefined) {
        return reply.code(404).send({ error: "Not Found" });
      }
      try {
        const raw = readFileSync(deps.configPath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        // Redact API keys before sending to the browser — never expose secrets.
        const providers = parsed.providers as Record<string, Record<string, unknown>> | undefined;
        if (providers) {
          for (const name of Object.keys(providers)) {
            const prov = providers[name];
            if (prov && typeof prov.apiKey === "string" && prov.apiKey.length > 0) {
              prov.apiKey = "••••••••";
            }
          }
        }
        return reply.send(parsed);
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    // -----------------------------------------------------------------------
    // PUT /api/config — write updated config (private network only)
    // -----------------------------------------------------------------------

    fastify.put("/api/config", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Config API only allowed from private network" });
      }
      if (deps.configPath === undefined) {
        return reply.code(404).send({ error: "Not Found" });
      }
      const parsed = request.body as Record<string, unknown>;
      if (typeof parsed !== "object" || parsed === null) {
        return reply.code(400).send({ error: "Invalid JSON object" });
      }
      try {
        // Preserve existing API keys when the browser sends back the redacted placeholder.
        const existing = JSON.parse(readFileSync(deps.configPath, "utf-8")) as Record<string, unknown>;
        const incomingProviders = parsed.providers as Record<string, Record<string, unknown>> | undefined;
        const existingProviders = existing.providers as Record<string, Record<string, unknown>> | undefined;
        if (incomingProviders && existingProviders) {
          for (const name of Object.keys(incomingProviders)) {
            const inc = incomingProviders[name];
            if (inc && inc.apiKey === "••••••••") {
              inc.apiKey = existingProviders[name]?.apiKey;
            }
          }
        }
        writeFileSync(deps.configPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
        return reply.send({ ok: true, message: "Config saved and applied." });
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    // -----------------------------------------------------------------------
    // PATCH /api/config — merge a key into existing config (private network only)
    //   Body: { "key": "plugins.screensaver.design", "value": "matrix" }
    //   Supports dot-notation paths for nested keys.
    // -----------------------------------------------------------------------

    fastify.patch("/api/config", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Config API only allowed from private network" });
      }
      if (deps.configPath === undefined) {
        return reply.code(404).send({ error: "Not Found" });
      }
      const body = request.body as { key?: string; value?: unknown };
      if (!body || typeof body.key !== "string" || body.key === "") {
        return reply.code(400).send({ error: "Body must include { key: string, value: unknown }" });
      }
      try {
        const raw = readFileSync(deps.configPath, "utf-8");
        const cfg = JSON.parse(raw) as Record<string, unknown>;

        // Walk dot-notation path to set the value
        const parts = body.key.split(".");
        let target: Record<string, unknown> = cfg;
        for (let i = 0; i < parts.length - 1; i++) {
          const p = parts[i]!;
          if (typeof target[p] !== "object" || target[p] === null) {
            target[p] = {};
          }
          target = target[p] as Record<string, unknown>;
        }
        target[parts[parts.length - 1]!] = body.value;

        writeFileSync(deps.configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
        return reply.send({ ok: true, message: "Config updated." });
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  // -----------------------------------------------------------------------
  // Usage API — token counts, costs, project attribution (private network only)
  // -----------------------------------------------------------------------

  if (deps.usageStore) {
    const uStore = deps.usageStore;

    fastify.get("/api/usage/summary", async (request, reply) => {
      if (!isPrivateNetwork(getClientIp(request.raw))) return reply.code(403).send({ error: "Private network only" });
      const days = Number((request.query as { days?: string }).days) || 30;
      return reply.send(await uStore.getSummary(days));
    });

    fastify.get("/api/usage/by-project", async (request, reply) => {
      if (!isPrivateNetwork(getClientIp(request.raw))) return reply.code(403).send({ error: "Private network only" });
      const days = Number((request.query as { days?: string }).days) || 30;
      return reply.send({ projects: await uStore.getByProject(days) });
    });

    fastify.get("/api/usage/by-project-source", async (request, reply) => {
      if (!isPrivateNetwork(getClientIp(request.raw))) return reply.code(403).send({ error: "Private network only" });
      const days = Number((request.query as { days?: string }).days) || 30;
      return reply.send({ projects: await uStore.getByProjectAndSource(days) });
    });

    fastify.get("/api/usage/history", async (request, reply) => {
      if (!isPrivateNetwork(getClientIp(request.raw))) return reply.code(403).send({ error: "Private network only" });
      const query = request.query as { days?: string; bucket?: string };
      const days = Number(query.days) || 30;
      const bucket = query.bucket === "hour" ? "hour" : "day";
      return reply.send({ history: await uStore.getHistory(days, bucket) });
    });
  }

  // -----------------------------------------------------------------------
  // GET /api/system/stats — CPU, RAM, disk, uptime (private network only)
  // -----------------------------------------------------------------------

  // Stats history ring buffer — stores 30-second snapshots for 24 hours (2880 entries)
  const STATS_HISTORY_MAX = 2880;
  const STATS_RECORD_INTERVAL_MS = 30_000;
  const STATS_FLUSH_INTERVAL_MS = 5 * 60 * 1000; // Write to disk every 5 minutes
  type StatsPoint = { ts: string; cpu: number; mem: number; disk: number; diskRead: number; diskWrite: number; load1: number; load5: number; load15: number; cpuWatts?: number; gpuWatts?: number };
  const statsHistory: StatsPoint[] = [];

  // Stats log file — JSONL format, rotated daily
  const configLogDir = ((deps.config as Record<string, unknown> | undefined)?.logging as { logDir?: string } | undefined)?.logDir
    ?? join(homedir(), ".agi", "logs");
  const statsLogDir = configLogDir.replace(/^~/, homedir());
  if (!existsSync(statsLogDir)) { try { mkdirSync(statsLogDir, { recursive: true }); } catch { /* ignore */ } }

  function getStatsLogPath(): string {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return join(statsLogDir, `resource-stats-${date}.jsonl`);
  }

  // Load today's stats log on boot to seed the history buffer
  try {
    const todayLog = getStatsLogPath();
    if (existsSync(todayLog)) {
      const lines = readFileSync(todayLog, "utf-8").trim().split("\n");
      for (const line of lines) {
        if (!line) continue;
        try {
          const point = JSON.parse(line) as StatsPoint;
          if (point.ts && typeof point.cpu === "number") {
            point.diskRead ??= 0;
            point.diskWrite ??= 0;
            statsHistory.push(point);
          }
        } catch { /* skip malformed lines */ }
      }
      if (statsHistory.length > STATS_HISTORY_MAX) {
        statsHistory.splice(0, statsHistory.length - STATS_HISTORY_MAX);
      }
    }
  } catch { /* log file read failed — start fresh */ }

  // Track unflushed points for periodic disk writes
  let lastFlushIndex = statsHistory.length;

  // CPU usage sampling cache (1s TTL)
  let cpuUsageCache: { value: number; ts: number } = { value: 0, ts: 0 };

  async function getCpuUsage(): Promise<number> {
    const now = Date.now();
    if (now - cpuUsageCache.ts < 1000) return cpuUsageCache.value;

    const os = await import("node:os");
    const cpus1 = os.cpus();
    await new Promise((r) => setTimeout(r, 100));
    const cpus2 = os.cpus();

    let idleDelta = 0;
    let totalDelta = 0;
    for (let i = 0; i < cpus1.length; i++) {
      const c1 = cpus1[i]!.times;
      const c2 = cpus2[i]!.times;
      const idle = c2.idle - c1.idle;
      const total = (c2.user - c1.user) + (c2.nice - c1.nice) + (c2.sys - c1.sys) + (c2.irq - c1.irq) + idle;
      idleDelta += idle;
      totalDelta += total;
    }
    const usage = totalDelta > 0 ? Math.round(((totalDelta - idleDelta) / totalDelta) * 100) : 0;
    cpuUsageCache = { value: usage, ts: now };
    return usage;
  }

  // Per-core CPU utilization — same delta-based sampling but reported as
  // one value per logical CPU. Powers the per-core heatmap on the
  // Resources page.
  async function getCpuPerCore(): Promise<number[]> {
    const os = await import("node:os");
    const cpus1 = os.cpus();
    await new Promise((r) => setTimeout(r, 100));
    const cpus2 = os.cpus();
    const result: number[] = [];
    for (let i = 0; i < cpus1.length; i++) {
      const c1 = cpus1[i]!.times;
      const c2 = cpus2[i]!.times;
      const idle = c2.idle - c1.idle;
      const total = (c2.user - c1.user) + (c2.nice - c1.nice) + (c2.sys - c1.sys) + (c2.irq - c1.irq) + idle;
      result.push(total > 0 ? Math.round(((total - idle) / total) * 100) : 0);
    }
    return result;
  }

  // Disk I/O tracking — reads /proc/diskstats for the root volume device
  let rootDiskDevice = "";
  try {
    const dfOut = execSync("df / --output=source", { timeout: 5000 }).toString();
    const dfLines = dfOut.trim().split("\n");
    if (dfLines.length >= 2) {
      const source = dfLines[1]!.trim();
      rootDiskDevice = realpathSync(source).replace(/^\/dev\//, "");
    }
  } catch { /* root device detection failed — disk I/O will report zeros */ }

  let prevDiskSectors: { read: number; written: number; ts: number } | null = null;
  let diskIOCache: { readBytesPerSec: number; writeBytesPerSec: number; ts: number } = { readBytesPerSec: 0, writeBytesPerSec: 0, ts: 0 };

  function getDiskIO(): { readBytesPerSec: number; writeBytesPerSec: number } {
    const now = Date.now();
    if (now - diskIOCache.ts < 5000) return diskIOCache;
    if (!rootDiskDevice) return diskIOCache;
    try {
      const content = readFileSync("/proc/diskstats", "utf-8");
      for (const line of content.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts[2] === rootDiskDevice) {
          const sectorsRead = parseInt(parts[5] ?? "0", 10);
          const sectorsWritten = parseInt(parts[9] ?? "0", 10);
          if (prevDiskSectors) {
            const elapsed = (now - prevDiskSectors.ts) / 1000;
            if (elapsed > 0) {
              diskIOCache = {
                readBytesPerSec: Math.round(((sectorsRead - prevDiskSectors.read) * 512) / elapsed),
                writeBytesPerSec: Math.round(((sectorsWritten - prevDiskSectors.written) * 512) / elapsed),
                ts: now,
              };
            }
          }
          prevDiskSectors = { read: sectorsRead, written: sectorsWritten, ts: now };
          break;
        }
      }
    } catch { /* /proc/diskstats read failed */ }
    return diskIOCache;
  }

  // Seed the initial disk sector reading so the first real sample has a baseline
  getDiskIO();

  // s111 t377 — RAPL CPU power sampler. Returns watts on Linux/Intel hosts
  // where /sys/class/powercap/intel-rapl:0/* is readable; null elsewhere
  // (non-Linux, missing kernel module, permission denied). The sampler
  // needs two consecutive readings to compute a delta, so the first call
  // returns null. Seed it now so the first real /api/system/stats response
  // can produce a watt reading.
  const cpuPowerSampler = new CpuPowerSampler();
  cpuPowerSampler.sample(); // seed; result discarded

  // s111 t417 — NVIDIA GPU power sampler. Returns watts on hosts with an
  // NVIDIA driver + nvidia-smi installed; null elsewhere (Intel iGPU, AMD,
  // ARM, macOS, hardened distros without nvidia-smi). Unlike CpuPowerSampler,
  // the first sample returns a real value — NVIDIA reports instantaneous
  // power, no delta needed. Availability is cached after first probe so
  // non-NVIDIA hosts pay the spawn cost once, not per sample.
  const gpuPowerSampler = new GpuPowerSampler();

  fastify.get("/api/system/stats", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "System API only allowed from private network" });
    }

    const os = await import("node:os");

    // CPU
    const loadAvg = os.loadavg() as [number, number, number];
    const cores = os.cpus().length;
    const cpuUsage = await getCpuUsage();

    // Memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 100);

    // Disk (df -B1 /)
    let diskTotal = 0;
    let diskUsed = 0;
    let diskFree = 0;
    let diskPercent = 0;
    try {
      const dfOut = execSync("df -B1 /", { timeout: 5000 }).toString();
      const lines = dfOut.trim().split("\n");
      if (lines.length >= 2) {
        const parts = lines[1]!.split(/\s+/);
        diskTotal = parseInt(parts[1] ?? "0", 10);
        diskUsed = parseInt(parts[2] ?? "0", 10);
        diskFree = parseInt(parts[3] ?? "0", 10);
        diskPercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;
      }
    } catch {
      // disk stats unavailable
    }

    const diskIO = getDiskIO();

    // s111 t377/t417 — power consumption. cpuWatts is null on non-Linux or
    // when intel-rapl isn't exposed; gpuWatts is null on non-NVIDIA hosts.
    // Future fields: npuWatts (vendor-specific), packageTotalWatts (multi-
    // socket CPU aggregate), multi-GPU aggregation.
    const cpuWatts = cpuPowerSampler.sample();
    const gpuWatts = gpuPowerSampler.sample();
    // Per-GPU live stats (utilization, VRAM, temp, power). NVIDIA only via
    // nvidia-smi today; AMD ROCm enrichment planned. Empty array on hosts
    // without nvidia-smi installed.
    const gpuStats: GpuLiveStats[] = probeGpuStats();
    // Per-core CPU utilization for the per-core heatmap.
    const cpuPerCore = await getCpuPerCore();

    return reply.send({
      cpu: { loadAvg, cores, usage: cpuUsage, perCore: cpuPerCore },
      memory: { total: totalMem, free: freeMem, used: usedMem, percent: memPercent },
      disk: { total: diskTotal, used: diskUsed, free: diskFree, percent: diskPercent },
      diskIO,
      power: { cpuWatts, gpuWatts },
      gpus: gpuStats,
      uptime: os.uptime(),
      hostname: os.hostname(),
    });
  });

  // Record stats history every 30 seconds
  async function recordStatsSnapshot(): Promise<void> {
    try {
      const os = await import("node:os");
      const cpuUsage = await getCpuUsage();
      const loadAvg = os.loadavg();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
      let diskPercent = 0;
      try {
        const dfOut = execSync("df -B1 /", { timeout: 5000 }).toString();
        const parts = dfOut.trim().split("\n")[1]?.split(/\s+/);
        if (parts) {
          const total = parseInt(parts[1] ?? "0", 10);
          const used = parseInt(parts[2] ?? "0", 10);
          diskPercent = total > 0 ? Math.round((used / total) * 100) : 0;
        }
      } catch { /* disk stats unavailable */ }

      const diskIO = getDiskIO();

      // s111 t377/t417 — power samples. Null on hosts without RAPL/NVIDIA;
      // the JSONL parser already tolerates missing fields so older history
      // points without these fields continue to load fine.
      const cpuWatts = cpuPowerSampler.sample();
      const gpuWatts = gpuPowerSampler.sample();

      statsHistory.push({
        ts: new Date().toISOString(),
        cpu: cpuUsage,
        mem: memPercent,
        disk: diskPercent,
        diskRead: diskIO.readBytesPerSec,
        diskWrite: diskIO.writeBytesPerSec,
        cpuWatts: cpuWatts ?? undefined,
        gpuWatts: gpuWatts ?? undefined,
        load1: Math.round(loadAvg[0]! * 100) / 100,
        load5: Math.round(loadAvg[1]! * 100) / 100,
        load15: Math.round(loadAvg[2]! * 100) / 100,
      });
      if (statsHistory.length > STATS_HISTORY_MAX) {
        statsHistory.splice(0, statsHistory.length - STATS_HISTORY_MAX);
      }
    } catch { /* stats recording failed — non-fatal */ }
  }

  // Flush unflushed stats points to disk (append to JSONL file)
  function flushStatsToDisk(): void {
    if (lastFlushIndex >= statsHistory.length) return;
    try {
      const newPoints = statsHistory.slice(lastFlushIndex);
      const lines = newPoints.map((p) => JSON.stringify(p)).join("\n") + "\n";
      appendFileSync(getStatsLogPath(), lines, "utf-8");
      lastFlushIndex = statsHistory.length;
    } catch { /* disk write failed — non-fatal, data stays in memory */ }
  }

  // Clean up old stats log files (keep 7 days)
  function cleanupOldStatsLogs(): void {
    try {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const file of readdirSync(statsLogDir)) {
        if (!file.startsWith("resource-stats-") || !file.endsWith(".jsonl")) continue;
        const filePath = join(statsLogDir, file);
        try {
          if (statSync(filePath).mtimeMs < cutoff) rmSync(filePath);
        } catch { /* skip */ }
      }
    } catch { /* cleanup failed — non-fatal */ }
  }

  // Start recording immediately and every 30 seconds
  void recordStatsSnapshot();
  setInterval(() => void recordStatsSnapshot(), STATS_RECORD_INTERVAL_MS);

  // Flush to disk every 5 minutes
  setInterval(flushStatsToDisk, STATS_FLUSH_INTERVAL_MS);

  // Clean up old log files daily
  cleanupOldStatsLogs();
  setInterval(cleanupOldStatsLogs, 24 * 60 * 60 * 1000);

  // GET /api/system/stats/history — return historical stats (private network only)
  fastify.get("/api/system/stats/history", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "System API only allowed from private network" });
    }
    const query = request.query as { hours?: string };
    const hours = Number(query.hours) || 1;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const filtered = statsHistory.filter((s) => s.ts >= cutoff);
    return reply.send({ history: filtered });
  });

  // -----------------------------------------------------------------------
  // GET /api/system/update-check — check for available updates (private network only)
  // -----------------------------------------------------------------------

  /**
   * Fetch origin with a 30s cache to avoid hammering the remote on rapid polls.
   * Returns true if a fetch was actually performed.
   */
  async function cachedFetchOrigin(repoPath: string): Promise<boolean> {
    const now = Date.now();
    if (now - lastFetchTime < FETCH_CACHE_TTL_MS) return false;
    await execGitDashboard(["fetch", "origin", "--quiet"], repoPath);
    lastFetchTime = Date.now();
    return true;
  }

  /** Read the configured update channel from gateway.json. Returns "main" or "dev". */
  function getUpdateChannel(): "main" | "dev" {
    if (!deps.configPath) return "main";
    try {
      const raw = readFileSync(deps.configPath, "utf-8");
      const cfg = JSON.parse(raw) as { gateway?: { updateChannel?: string } };
      return cfg.gateway?.updateChannel === "dev" ? "dev" : "main";
    } catch {
      return "main";
    }
  }

  /**
   * Check if a service repo has updates available.
   * Returns behind count or 0 if up-to-date/missing.
   */
  async function checkServiceRepo(dir: string): Promise<{ behind: number; name: string }> {
    const name = dir.split("/").pop() ?? dir;
    const channel = getUpdateChannel();
    const ref = `origin/${channel}`;
    try {
      if (!existsSync(join(dir, ".git"))) return { behind: 0, name };
      await execGitDashboard(["fetch", "origin", "--quiet"], dir);
      const local = (await execGitDashboard(["rev-parse", "HEAD"], dir)).stdout.trim();
      const remote = (await execGitDashboard(["rev-parse", ref], dir)).stdout.trim();
      if (local === remote) return { behind: 0, name };
      const count = (await execGitDashboard(["rev-list", `${local}..${ref}`, "--count"], dir)).stdout.trim();
      return { behind: parseInt(count, 10) || 0, name };
    } catch {
      return { behind: 0, name };
    }
  }

  /**
   * Build an UpdateCheck result by comparing deployedCommit vs origin/{channel}.
   * Also checks ID, PRIME, and marketplace repos for pending updates.
   * Shared between the poll endpoint and the webhook handler.
   */
  async function buildUpdateCheck(repoPath: string): Promise<{
    updateAvailable: boolean;
    localCommit: string;
    remoteCommit: string;
    behindCount: number;
    commits: { hash: string; message: string }[];
    channel: "main" | "dev";
    serviceUpdates?: Array<{ name: string; behind: number }>;
    pluginUpdates?: Array<{ pluginName: string; currentVersion: string; availableVersion: string; sourceId: number }>;
  }> {
    const channel = getUpdateChannel();
    const ref = `origin/${channel}`;

    // Read the deployed commit marker (written by upgrade.sh into the deploy dir)
    let deployedCommit = "";
    try {
      deployedCommit = readFileSync(join(process.cwd(), ".deployed-commit"), "utf-8").trim();
    } catch {
      // No marker file — use origin/{channel} as both source and "deployed" reference
      const remote = await execGitDashboard(["rev-parse", ref], repoPath);
      return {
        updateAvailable: false,
        localCommit: remote.stdout.trim(),
        remoteCommit: remote.stdout.trim(),
        behindCount: 0,
        commits: [],
        channel,
      };
    }

    // Get origin/{channel} commit (source of truth from GitHub)
    const remoteResult = await execGitDashboard(["rev-parse", ref], repoPath);
    const remoteCommit = remoteResult.stdout.trim();

    if (deployedCommit === remoteCommit) {
      return {
        updateAvailable: false,
        localCommit: deployedCommit,
        remoteCommit,
        behindCount: 0,
        commits: [],
        channel,
      };
    }

    // Count commits between deployed and origin/{channel}
    const countResult = await execGitDashboard(
      ["rev-list", `${deployedCommit}..${ref}`, "--count"], repoPath,
    );
    const behindCount = parseInt(countResult.stdout.trim(), 10) || 0;

    let commits: { hash: string; message: string }[] = [];
    if (behindCount > 0) {
      const logResult = await execGitDashboard(
        ["log", `${deployedCommit}..${ref}`, "--oneline"], repoPath,
      );
      commits = logResult.stdout.trim().split("\n").filter(Boolean).map((line) => {
        const spaceIdx = line.indexOf(" ");
        return {
          hash: spaceIdx > 0 ? line.slice(0, spaceIdx) : line,
          message: spaceIdx > 0 ? line.slice(spaceIdx + 1) : "",
        };
      });
    }

    // Check service repos (ID, PRIME, marketplace) for pending updates
    const serviceRepoPaths = [
      deps.primeDir,
      deps.config ? (deps.config as Record<string, unknown>).idService ? ((deps.config as Record<string, unknown>).idService as Record<string, string>).dir ?? "/opt/agi-local-id" : "/opt/agi-local-id" : undefined,
      deps.config ? (deps.config as Record<string, unknown>).marketplace ? ((deps.config as Record<string, unknown>).marketplace as Record<string, string>).dir ?? "/opt/agi-marketplace" : "/opt/agi-marketplace" : undefined,
    ].filter(Boolean) as string[];

    const serviceChecks = await Promise.all(serviceRepoPaths.map(checkServiceRepo));
    const serviceUpdates = serviceChecks.filter(s => s.behind > 0);
    const totalServiceBehind = serviceUpdates.reduce((sum, s) => sum + s.behind, 0);

    // Check for marketplace plugin updates when the marketplace repo has changes
    let pluginUpdates: { pluginName: string; currentVersion: string; availableVersion: string; sourceId: number }[] | undefined;
    if (deps.marketplaceManager && totalServiceBehind > 0) {
      const mp = deps.marketplaceManager;
      const marketplaceDir = deps.config
        ? ((deps.config as Record<string, unknown>).marketplace as Record<string, string> | undefined)?.dir ?? "/opt/agi-marketplace"
        : "/opt/agi-marketplace";
      if (existsSync(marketplaceDir)) {
        await mp.syncLocalCatalog(marketplaceDir);
        const { updates } = await mp.checkUpdates();
        if (updates.length > 0) pluginUpdates = updates;
      }
    }

    return {
      updateAvailable: behindCount > 0 || totalServiceBehind > 0,
      localCommit: deployedCommit,
      remoteCommit,
      behindCount,
      commits,
      channel,
      serviceUpdates: serviceUpdates.length > 0 ? serviceUpdates : undefined,
      pluginUpdates,
    };
  }

  fastify.get("/api/system/update-check", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "System API only allowed from private network" });
    }
    if (!deps.selfRepoPath) {
      return reply.send({
        updateAvailable: false,
        localCommit: "",
        remoteCommit: "",
        behindCount: 0,
        commits: [],
      });
    }
    const repoPath = deps.selfRepoPath;
    try {
      await cachedFetchOrigin(repoPath);
      const result = await buildUpdateCheck(repoPath);
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/system/upgrade — trigger upgrade.sh (private network only)
  // -----------------------------------------------------------------------

  fastify.post("/api/system/upgrade", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "System API only allowed from private network" });
    }
    if (!deps.selfRepoPath) {
      return reply.code(400).send({ error: "selfRepo not configured" });
    }
    // Reset stale lock after 5 minutes (child may have died without triggering close/error)
    if (upgradeInProgress && Date.now() - upgradeStartedAt > 5 * 60_000) {
      upgradeInProgress = false;
    }
    if (upgradeInProgress) {
      return reply.code(409).send({ error: "Upgrade already in progress" });
    }

    upgradeInProgress = true;
    upgradeStartedAt = Date.now();
    clearUpgradeLog();
    const repoPath = deps.selfRepoPath;

    // Respond immediately — upgrade runs in the background
    void reply.code(202).send({ ok: true, message: "Upgrade started" });

    const scriptPath = join(repoPath, "scripts/upgrade.sh");
    const channel = getUpdateChannel();
    const child = spawn("bash", [scriptPath], {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AIONIMA_UPDATE_CHANNEL: channel },
    });

    let currentPhase = "pulling";
    let lastStep = "upgrade";

    // Emit immediate "Upgrade started" so the log stream has an entry from the start
    broadcastUpgrade("pulling", "Upgrade started", "upgrade", "start");

    // Phase mapping — coarse UI phase for each upgrade.sh step
    const phaseToUiPhase: Record<string, string> = {
      "pull-agi": "pulling",
      "pull-prime": "pulling",
      "pull-marketplace": "pulling",
      "pull-id": "pulling",
      "preflight": "pulling",
      "submodules": "pulling",
      "protocol-check": "pulling",
      "install": "building",
      "rebuild": "building",
      "build": "building",
      "build-marketplace": "building",
      "required-check": "building",
      "systemd": "restarting",
      "restart": "restarting",
      "complete": "complete",
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const lines = chunk.toString("utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        // Try parsing as structured JSON from upgrade.sh
        try {
          const parsed = JSON.parse(line) as { phase?: string; status?: string; details?: string };
          if (parsed.phase) {
            currentPhase = phaseToUiPhase[parsed.phase] ?? currentPhase;
            lastStep = parsed.phase;
            // Use || instead of ?? so empty string details get a fallback
            const detail = parsed.details || `${parsed.phase}: ${parsed.status}`;
            broadcastUpgrade(currentPhase, detail, parsed.phase, parsed.status);
            continue;
          }
        } catch {
          // Not JSON — fall through to plain text handling
        }
        // Plain text output (from git, pnpm, etc.) — log to disk for
        // debugging but do NOT broadcast to the dashboard. Raw pnpm output
        // creates noise in the upgrade dropdown and shows out-of-order entries.
        upgradeLog.debug(`[${lastStep}] ${line}`);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8").trim();
      if (text) broadcastUpgrade(currentPhase, text);
    });

    child.on("close", (code) => {
      upgradeInProgress = false;
      // code === null means the process was killed by a signal (SIGPIPE) — expected
      // when upgrade.sh calls `systemctl restart aionima` which kills this Node process.
      // The .upgrade-pending sentinel file handles post-restart completion.
      if (code === 0 || (code === null && lastStep === "restart")) {
        // Sync marketplace catalog as the final upgrade step — plugin updates run last
        const mp = deps.marketplaceManager;
        if (mp) {
          broadcastUpgrade("complete", "Syncing marketplace catalog...", "marketplace-sync", "start");
          const sources = mp.getSources();
          Promise.all(sources.map((s) => mp.syncSource(s.id)))
            .then((results) => {
              // s140 cycle 194 — was r.pluginCount under the inline structural
               // type; the real CatalogDiff exposes `total` instead. Fix
               // surfaced when the inline type was replaced with the imported
               // class type.
               const total = results.reduce((n, r) => n + (r.diff?.total ?? 0), 0);
              broadcastUpgrade("complete", `Marketplace synced (${total} plugins)`, "marketplace-sync", "ok");
              broadcastUpgrade("complete", "Deploy complete", "complete", "done");
            })
            .catch(() => {
              broadcastUpgrade("complete", "Marketplace sync failed — plugins may be stale", "marketplace-sync", "fail");
              broadcastUpgrade("complete", "Deploy complete", "complete", "done");
            });
        } else {
          broadcastUpgrade("complete", "Deploy complete", "complete", "done");
        }
      } else {
        broadcastUpgrade("error", `Deploy failed (exit ${code}) at step: ${lastStep}`, lastStep, "fail");
      }
    });

    child.on("error", (err) => {
      upgradeInProgress = false;
      broadcastUpgrade("error", `Deploy error: ${err.message}`, "upgrade", "fail");
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/system/upgrade-log — persisted upgrade log (private network)
  // -----------------------------------------------------------------------

  fastify.get("/api/system/upgrade-log", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "System API only allowed from private network" });
    }
    return reply.send(getUpgradeLog());
  });

  // GET /api/system/changelog — git commit history for the deployed repo
  fastify.get("/api/system/changelog", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "System API only allowed from private network" });
    }
    const repoPath = deps.selfRepoPath ?? process.cwd();
    const query = request.query as Record<string, string>;
    const count = Math.min(parseInt(query.count ?? "50", 10) || 50, 200);
    const offset = parseInt(query.offset ?? "0", 10) || 0;

    try {
      // \x1E at START of format so each block = header + stat for the same commit.
      // \x1F terminates the body field to separate it from --stat output.
      // Fields within header are \x00-separated.
      const logResult = await execGitDashboard([
        "log",
        `--skip=${offset}`,
        `-${count}`,
        "--format=%x1E%H%x00%an%x00%aI%x00%s%x00%b%x1F",
        "--stat",
      ], repoPath);

      const raw = logResult.stdout.trim();
      if (!raw) return reply.send({ commits: [], total: 0 });

      const blocks = raw.split("\x1E").filter((b) => b.trim().length > 0);
      const commits = blocks.map((block) => {
        // Split header (before \x1F) from stat lines (after \x1F)
        const ufIdx = block.indexOf("\x1F");
        const headerPart = ufIdx >= 0 ? block.slice(0, ufIdx) : block;
        const statPart = ufIdx >= 0 ? block.slice(ufIdx + 1) : "";

        // Parse header fields
        const fields = headerPart.trim().split("\x00");
        const hash = fields[0] ?? "";
        const author = fields[1] ?? "";
        const date = fields[2] ?? "";
        const subject = fields[3] ?? "";
        const body = (fields[4] ?? "").trim();

        // Parse stat lines
        const statLines = statPart.split("\n").filter((l) => l.trim().length > 0);
        const summaryLine = statLines.length > 0 ? statLines[statLines.length - 1]?.trim() ?? "" : "";
        const isSummaryLine = /\d+ file/.test(summaryLine);
        const filesChanged = isSummaryLine ? statLines.slice(0, -1) : statLines;

        return {
          hash: hash.slice(0, 10),
          fullHash: hash,
          author,
          date,
          subject,
          body,
          files: filesChanged.map((f) => f.trim()),
          summary: isSummaryLine ? summaryLine : undefined,
        };
      });

      // Get total commit count
      const countResult = await execGitDashboard(["rev-list", "--count", "HEAD"], repoPath);
      const total = parseInt(countResult.stdout.trim(), 10) || commits.length;

      return reply.send({ commits, total });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Failed to read git log" });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/webhooks/push — GitHub webhook for push events
  // -----------------------------------------------------------------------

  fastify.route({
    method: "POST",
    url: "/api/webhooks/push",
    // Capture raw body before Fastify parses JSON — needed for HMAC verification
    preParsing: async (_request, _reply, payload) => {
      const chunks: Buffer[] = [];
      for await (const chunk of payload as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks);
      (_request as any).rawBody = rawBody;
      return Readable.from([rawBody]);
    },
    handler: async (request, reply) => {
      if (!deps.webhookSecret) {
        return reply.code(400).send({ error: "webhookSecret not configured" });
      }
      if (!deps.selfRepoPath) {
        return reply.code(400).send({ error: "selfRepo not configured" });
      }

      // Verify HMAC signature
      const signature = request.headers["x-hub-signature-256"];
      if (typeof signature !== "string") {
        return reply.code(401).send({ error: "Missing X-Hub-Signature-256 header" });
      }
      const rawBody: Buffer = (request as any).rawBody;
      const expected = "sha256=" + createHmac("sha256", deps.webhookSecret).update(rawBody).digest("hex");
      if (
        signature.length !== expected.length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      ) {
        return reply.code(401).send({ error: "Invalid signature" });
      }

      // Only react to pushes to the default branch
      const body = request.body as { ref?: string } | null;
      if (body?.ref !== "refs/heads/main") {
        return reply.send({ ok: true, skipped: true });
      }

      const repoPath = deps.selfRepoPath;
      try {
        // Force a fresh fetch (bypass cache)
        await execGitDashboard(["fetch", "origin", "--quiet"], repoPath);
        lastFetchTime = Date.now();

        const result = await buildUpdateCheck(repoPath);
        if (result.updateAvailable) {
          // Broadcast to all connected dashboard clients
          const event = { type: "system:update_available" as const, data: result };
          deps.wsRef?.server?.broadcast("dashboard_event", event);
        }
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });

  // -----------------------------------------------------------------------
  // Hosting API routes (private network only)
  // -----------------------------------------------------------------------

  if (deps.hostingManager !== undefined) {
    const { registerPortalTool } = registerHostingRoutes(fastify, {
      hostingManager: deps.hostingManager,
      workspaceProjects: deps.workspaceProjects ?? [],
      logger: deps.logger,
      notificationStore: deps.notificationStore,
    });

    // Auto-register database-related services with the DB portal.
    // Scans both container services (registerService) and system services (registerSystemService).
    const DB_KEYWORDS = /\b(db|database|adminer|phpmyadmin|pgadmin|mysql|postgres|postgresql|sqlite|mongo|mongodb|mariadb|redis|memcached|cockroach|clickhouse|influx|neo4j|cassandra|dynamo|supabase)\b/i;
    const seenPortalIds = new Set<string>();
    for (const svc of deps.pluginRegistry?.getServices() ?? []) {
      const haystack = `${svc.id} ${svc.name} ${svc.description}`;
      if (DB_KEYWORDS.test(haystack)) {
        seenPortalIds.add(svc.id);
        // Container services typically have a reverse-proxy route at /{id}/
        registerPortalTool({
          id: svc.id,
          name: svc.name,
          description: svc.description,
          url: `/${svc.id}/`,
          icon: "🗄️",
        });
      }
    }
    for (const s of deps.pluginRegistry?.getSystemServices() ?? []) {
      if (seenPortalIds.has(s.service.id)) continue;
      const haystack = `${s.service.id} ${s.service.name} ${s.service.description ?? ""}`;
      if (DB_KEYWORDS.test(haystack)) {
        registerPortalTool({
          id: s.service.id,
          name: s.service.name,
          description: s.service.description ?? "",
          url: `/services/${s.service.id}`,
          icon: "🗄️",
        });
      }
    }

    // Stack management routes
    if (deps.stackRegistry && deps.sharedContainerManager) {
      registerStackRoutes(fastify, {
        stackRegistry: deps.stackRegistry,
        sharedContainerManager: deps.sharedContainerManager,
        hostingManager: deps.hostingManager,
        log: createComponentLogger(deps.logger, "stack-api"),
        pluginRegistry: deps.pluginRegistry,
      });
    }
  }

  // -----------------------------------------------------------------------
  // MApp storage API (s140 t599 phase 3)
  // -----------------------------------------------------------------------
  // Per-project, per-MApp scoped CRUD under
  //   /api/projects/<slug>/k/mapps/<id>/...        (persistent)
  //   /api/projects/<slug>/sandbox/mapps/<id>/...  (generated/temporary)
  // Required for any MApp that wants to persist user content. Same-origin
  // sandboxed iframes can call directly via fetch; phase 3.5 will add a
  // postMessage IPC mediation layer for cross-origin / restricted MApps.
  registerMAppStorageRoutes(fastify, {
    workspaceProjects: deps.workspaceProjects ?? [],
  });

  // -----------------------------------------------------------------------
  // Plugin extensibility API — declarative plugin data for dashboard
  // -----------------------------------------------------------------------

  fastify.get("/api/dashboard/plugin-actions", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const scope = query.scope ? { type: query.scope, projectType: query.projectType } : undefined;
    const actions = (deps.pluginRegistry?.getActions(scope) ?? []).map((a) => ({
      ...a.action,
      pluginId: a.pluginId,
    }));
    return reply.send(actions);
  });

  fastify.get("/api/dashboard/plugin-panels", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const panels = (deps.pluginRegistry?.getPanels(query.projectType) ?? []).map((p) => ({
      ...p.panel,
      pluginId: p.pluginId,
      widgets: resolveWidgetEndpoints(p.panel.widgets as PanelWidgetAny[], p.pluginId),
    }));
    return reply.send(panels);
  });

  fastify.post("/api/dashboard/action/:id/execute", async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = (request.body ?? {}) as Record<string, string>;
    const registered = (deps.pluginRegistry?.getActions() ?? []).find((a) => a.action.id === id);
    if (!registered) {
      return reply.code(404).send({ ok: false, error: `Action not found: ${id}` });
    }
    const { handler } = registered.action;
    try {
      if (handler.kind === "shell") {
        const { execFile: exec } = await import("node:child_process");
        const cwd = handler.command ? (context.projectPath ?? process.cwd()) : process.cwd();
        const result = await new Promise<{ ok: boolean; output?: string; error?: string }>((resolve) => {
          exec("bash", ["-c", handler.command!], { cwd, timeout: 60_000 }, (err, stdout, stderr) => {
            if (err) resolve({ ok: false, output: stdout, error: stderr || err.message });
            else resolve({ ok: true, output: stdout });
          });
        });
        return reply.send(result);
      }
      if (handler.kind === "api") {
        const method = (handler as { method?: string }).method ?? "GET";
        let endpoint = handler.endpoint!;
        // Resolve relative action endpoints with the plugin's route prefix
        if (endpoint.startsWith("/") && !endpoint.startsWith("/api/")) {
          endpoint = `/api/plugins/${registered.pluginId}${endpoint}`;
        }
        const url = endpoint.startsWith("http") ? endpoint : `http://127.0.0.1:${process.env.PORT ?? 3124}${endpoint}`;
        const res = await fetch(url, { method });
        const text = await res.text();
        return reply.send({ ok: res.ok, output: text });
      }
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get("/api/dashboard/plugin-settings", async (_request, reply) => {
    const sections = (deps.pluginRegistry?.getSettingsSections() ?? []).map((s) => ({
      ...s.section,
      pluginId: s.pluginId,
    }));
    return reply.send(sections);
  });

  fastify.get("/api/dashboard/plugin-sidebar", async (_request, reply) => {
    const sections = (deps.pluginRegistry?.getSidebarSections() ?? []).map((s) => ({
      ...s.section,
      pluginId: s.pluginId,
    }));
    return reply.send(sections);
  });

  fastify.get("/api/dashboard/plugin-themes", async (_request, reply) => {
    const themes = (deps.pluginRegistry?.getThemes() ?? []).map((t) => ({
      ...t.theme,
      pluginId: t.pluginId,
    }));
    return reply.send(themes);
  });

  fastify.get("/api/dashboard/plugin-system-services", async (_request, reply) => {
    const registered = deps.pluginRegistry?.getSystemServices() ?? [];
    const { execFile: exec } = await import("node:child_process");

    const services = await Promise.all(registered.map(async (s) => {
      // Check if installed
      let installed = true;
      const checkCmd = s.service.installedCheck ?? (s.service.unitName ? `systemctl list-unit-files ${s.service.unitName} 2>/dev/null | grep -q ${s.service.unitName}` : `which ${s.service.id}`);
      try {
        await new Promise<void>((resolve, reject) => {
          exec("bash", ["-c", checkCmd], { timeout: 5000 }, (err) => {
            if (err) reject(err); else resolve();
          });
        });
      } catch {
        installed = false;
      }

      // Check status (only if installed)
      let status: "running" | "stopped" | "unknown" = "unknown";
      if (installed && s.service.unitName) {
        try {
          await new Promise<void>((resolve, reject) => {
            exec("systemctl", ["is-active", "--quiet", s.service.unitName!], { timeout: 5000 }, (err) => {
              if (err) reject(err); else resolve();
            });
          });
          status = "running";
        } catch {
          status = "stopped";
        }
      }

      return {
        id: s.service.id,
        pluginId: s.pluginId,
        name: s.service.name,
        description: s.service.description,
        unitName: s.service.unitName,
        agentAware: s.service.agentAware,
        installed,
        installable: !!s.service.installCommand,
        status: installed ? status : "unknown",
      };
    }));

    return reply.send(services);
  });

  fastify.post("/api/dashboard/system-services/:id/:action", async (request, reply) => {
    const { id, action } = request.params as { id: string; action: string };
    if (!["start", "stop", "restart", "install"].includes(action)) {
      return reply.code(400).send({ ok: false, error: `Invalid action: ${action}` });
    }
    const registered = (deps.pluginRegistry?.getSystemServices() ?? []).find((s) => s.service.id === id);
    if (!registered) {
      return reply.code(404).send({ ok: false, error: `Service not found: ${id}` });
    }
    const svc = registered.service;

    // Handle install action
    if (action === "install") {
      if (!svc.installCommand) {
        return reply.code(400).send({ ok: false, error: "No install command configured for this service" });
      }
      const { execFile: exec } = await import("node:child_process");
      return new Promise((resolve) => {
        exec("bash", ["-c", svc.installCommand!], { timeout: 120_000 }, (err, stdout, stderr) => {
          if (err) { reply.code(500).send({ ok: false, error: stderr || err.message }); }
          else { reply.send({ ok: true, output: stdout }); }
          resolve(undefined);
        });
      });
    }

    const cmd = action === "start" ? svc.startCommand
      : action === "stop" ? svc.stopCommand
      : svc.restartCommand;
    if (!cmd && svc.unitName) {
      const { execFile: exec } = await import("node:child_process");
      return new Promise((resolve) => {
        exec("sudo", ["systemctl", action, svc.unitName!], { timeout: 30_000 }, (err, stdout, stderr) => {
          if (err) { reply.code(500).send({ ok: false, error: stderr || err.message }); }
          else { reply.send({ ok: true, output: stdout }); }
          resolve(undefined);
        });
      });
    }
    if (cmd) {
      const { execFile: exec } = await import("node:child_process");
      return new Promise((resolve) => {
        exec("bash", ["-c", cmd], { timeout: 30_000 }, (err, stdout, stderr) => {
          if (err) { reply.code(500).send({ ok: false, error: stderr || err.message }); }
          else { reply.send({ ok: true, output: stdout }); }
          resolve(undefined);
        });
      });
    }
    return reply.code(400).send({ ok: false, error: "No command configured for this action" });
  });

  fastify.get("/api/dashboard/plugin-scheduled-tasks", async (_request, reply) => {
    const tasks = (deps.pluginRegistry?.getScheduledTasks() ?? []).map((t) => ({
      id: t.task.id,
      pluginId: t.pluginId,
      name: t.task.name,
      description: t.task.description,
      cron: t.task.cron,
      intervalMs: t.task.intervalMs,
      enabled: t.task.enabled ?? true,
    }));
    return reply.send(tasks);
  });

  fastify.post("/api/dashboard/scheduled-tasks/:id/:action", async (request, reply) => {
    const { id, action } = request.params as { id: string; action: string };
    if (!["enable", "disable", "run-now"].includes(action)) {
      return reply.code(400).send({ ok: false, error: `Invalid action: ${action}` });
    }
    const registered = (deps.pluginRegistry?.getScheduledTasks() ?? []).find((t) => t.task.id === id);
    if (!registered) {
      return reply.code(404).send({ ok: false, error: `Task not found: ${id}` });
    }
    // run-now: invoke handler directly
    if (action === "run-now") {
      try {
        const task = registered.task as { handler?: () => Promise<void> };
        await task.handler?.();
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    // enable/disable: toggle flag (in-memory only)
    return reply.send({ ok: true });
  });

  fastify.get("/api/dashboard/plugin-workflows", async (_request, reply) => {
    const workflows = (deps.pluginRegistry?.getWorkflows() ?? []).map((w) => ({
      id: w.workflow.id,
      pluginId: w.pluginId,
      name: w.workflow.name,
      description: w.workflow.description,
      trigger: w.workflow.trigger,
      stepCount: (w.workflow.steps as unknown[]).length,
    }));
    return reply.send(workflows);
  });

  // Only show settings/dashboard pages for installed or baked-in plugins
  // (marketplace plugins on disk but not installed should be invisible).
  const getInstalledOrBakedInIds = async (): Promise<Set<string>> => {
    const ids = new Set<string>();
    for (const r of await (deps.marketplaceManager?.getInstalled() ?? Promise.resolve([]))) ids.add(r.name);
    for (const d of deps.discoveredPlugins ?? []) { if (d.bakedIn) ids.add(d.id); }
    return ids;
  };

  fastify.get("/api/dashboard/plugin-settings-pages", async (_request, reply) => {
    const allowed = await getInstalledOrBakedInIds();
    const pages = (deps.pluginRegistry?.getSettingsPages() ?? [])
      .filter((p) => allowed.has(p.pluginId))
      .map((p) => ({ ...p.page, pluginId: p.pluginId }));
    return reply.send(pages);
  });

  // -------------------------------------------------------------------------
  // GET /api/providers — registered LLM providers with their declared fields
  // -------------------------------------------------------------------------

  fastify.get("/api/providers", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Providers API only allowed from private network" });
    }

    const registeredProviders = deps.pluginRegistry?.getProviders() ?? [];
    const configProviders = deps.configPath
      ? (() => {
          try {
            const raw = readFileSync(deps.configPath!, "utf-8");
            return (JSON.parse(raw) as Record<string, unknown>).providers as Record<string, Record<string, unknown>> | undefined;
          } catch {
            return undefined;
          }
        })()
      : undefined;

    const result = registeredProviders.map((r) => {
      const providerConfig = configProviders?.[r.provider.id] ?? {};
      const currentValues = Object.fromEntries(
        Object.entries(providerConfig).map(([k, v]) => {
          if (k === "apiKey" && typeof v === "string" && v.length > 0) return [k, "••••••••"];
          return [k, v];
        })
      );
      return {
        id: r.provider.id,
        name: r.provider.name,
        description: r.provider.description,
        requiresApiKey: r.provider.requiresApiKey ?? false,
        fields: r.provider.fields ?? [],
        currentValues,
      };
    });

    return reply.send(result);
  });

  // -------------------------------------------------------------------------
  // GET /api/providers/balance — live balance check for each registered provider
  // -------------------------------------------------------------------------

  fastify.get("/api/providers/balance", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Providers API only allowed from private network" });
    }

    const registeredProviders = deps.pluginRegistry?.getProviders() ?? [];
    const configProviders = deps.configPath
      ? (() => {
          try {
            const raw = readFileSync(deps.configPath!, "utf-8");
            return (JSON.parse(raw) as Record<string, unknown>).providers as Record<string, Record<string, unknown>> | undefined;
          } catch {
            return undefined;
          }
        })()
      : undefined;

    const balances = await Promise.all(
      registeredProviders.map(async (r) => {
        const providerConfig = configProviders?.[r.provider.id] ?? {};
        let balance: number | null = null;
        if (r.provider.checkBalance) {
          try {
            balance = await r.provider.checkBalance(providerConfig);
          } catch {
            // balance check failed — leave as null
          }
        }
        const threshold = (providerConfig as Record<string, unknown>).balanceAlertThreshold as number | undefined;
        return {
          providerId: r.provider.id,
          providerName: r.provider.name,
          balance,
          threshold: threshold ?? null,
          belowThreshold: balance !== null && threshold !== undefined && balance <= threshold,
        };
      })
    );

    return reply.send(balances);
  });

  fastify.get("/api/dashboard/plugin-pages", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const allowed = await getInstalledOrBakedInIds();
    const pages = (deps.pluginRegistry?.getDashboardPages(query.domain) ?? [])
      .filter((p) => allowed.has(p.pluginId))
      .map((p) => ({
        ...p.page,
        pluginId: p.pluginId,
        widgets: resolveWidgetEndpoints(p.page.widgets as PanelWidgetAny[], p.pluginId),
      }));
    return reply.send(pages);
  });

  fastify.get("/api/dashboard/plugin-domains", async (_request, reply) => {
    const domains = (deps.pluginRegistry?.getDashboardDomains() ?? []).map((d) => ({
      ...d.domain,
      pluginId: d.pluginId,
      pages: d.domain.pages.map((pg) => ({
        ...pg,
        widgets: resolveWidgetEndpoints(pg.widgets as PanelWidgetAny[], d.pluginId),
      })),
    }));
    return reply.send(domains);
  });

  // -----------------------------------------------------------------------
  // Plugin-registered HTTP routes (dynamic dispatch via indirection map)
  //
  // Handlers are stored in a map keyed by "METHOD:path". Fastify routes
  // delegate to the map at call time, so plugin hot-reload can update
  // handlers without re-registering Fastify routes.
  // -----------------------------------------------------------------------

  const pluginRouteHandlers = new Map<string, RouteHandler>();

  for (const route of deps.pluginRegistry?.getRoutes() ?? []) {
    const key = `${route.method.toUpperCase()}:${route.path}`;
    pluginRouteHandlers.set(key, route.handler);
    const method = route.method.toLowerCase() as "get" | "put" | "post" | "delete";
    fastify[method](route.path, async (request, reply) => {
      const handler = pluginRouteHandlers.get(key);
      if (!handler) return reply.code(404).send({ error: "Plugin route no longer available" });
      const clientIp = (request.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? request.ip;
      await handler(
        {
          body: request.body,
          query: request.query as Record<string, string>,
          params: request.params as Record<string, string>,
          headers: request.headers as Record<string, string | string[] | undefined>,
          clientIp,
        },
        { code: (n: number) => ({ send: (d: unknown) => reply.code(n).send(d) }), send: (d: unknown) => reply.send(d) },
      );
    });
  }

  // -----------------------------------------------------------------------
  // Marketplace API
  // -----------------------------------------------------------------------

  if (deps.marketplaceManager) {
    const mp = deps.marketplaceManager;

    fastify.get("/api/marketplace/sources", async (_request, reply) => {
      return reply.send(mp.getSources());
    });

    fastify.post("/api/marketplace/sources", async (request, reply) => {
      const body = request.body as { ref?: string; name?: string };
      if (!body.ref) return reply.code(400).send({ error: "ref is required (e.g. 'owner/repo' or URL)" });
      try {
        const source = mp.addSource(body.ref, body.name);
        return reply.send(source);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    fastify.delete("/api/marketplace/sources/:id", async (request, reply) => {
      const { id } = request.params as { id: string };
      mp.removeSource(Number(id));
      return reply.send({ ok: true });
    });

    fastify.post("/api/marketplace/sources/:id/sync", async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await mp.syncSource(Number(id));
      if (!result.ok) return reply.code(400).send(result);
      return reply.send(result);
    });

    fastify.post("/api/marketplace/dedupe", async (_request, reply) => {
      const fn = (mp as unknown as { dedupeCatalog?: () => Promise<{ removed: number; orphanRefs: string[] }> }).dedupeCatalog;
      if (typeof fn !== "function") {
        return reply.code(501).send({ ok: false, error: "dedupeCatalog not implemented on this manager" });
      }
      const result = await fn.call(mp);
      return reply.send({ ok: true, ...result });
    });

    fastify.get("/api/marketplace/catalog", async (request, reply) => {
      const query = request.query as Record<string, string>;
      const items = await mp.searchCatalog({
        q: query.q,
        type: query.type as string | undefined,
        category: query.category,
        provides: query.provides,
      });

      // Enrich catalog items with installed/active/enabled status + provides.
      // "installed" means the user explicitly installed it (marketplace DB record)
      // or it's a baked-in plugin. Discovery alone does NOT mean installed.
      const discovered = deps.discoveredPlugins ?? [];
      const prefs = deps.pluginPrefs;
      const loadedPlugins = deps.pluginRegistry?.getAll() ?? [];
      const installedRecords = await mp.getInstalled();
      const installedNames = new Set(installedRecords.map((r) => r.name));
      const catalogNames = new Set(items.map((i) => i.name));

      // Resolve provides: active plugins use registry introspection (authoritative),
      // others fall back to manifest provides, then categoryToProvides()
      const resolveProvides = (name: string, catalogProvides?: string[], category?: string): string[] => {
        const active = loadedPlugins.some((l) => l.manifest.id === name);
        if (active && deps.pluginRegistry) {
          const registryProvides = deps.pluginRegistry.getPluginProvides(name);
          if (registryProvides.length > 0) return registryProvides;
        }
        if (catalogProvides && catalogProvides.length > 0) return catalogProvides;
        return categoryToProvides(category);
      };

      const enriched: Record<string, unknown>[] = items.map((item) => {
        const match = discovered.find((d) => d.id === item.name);
        const isInstalled = installedNames.has(item.name) || (match?.bakedIn ?? false);
        const active = match ? loadedPlugins.some((l) => l.manifest.id === match.id) : false;
        const provides = resolveProvides(
          item.name,
          item.provides as string[] | undefined,
          (item.category as string | undefined),
        );
        if (!match && !isInstalled) return { ...item, provides, depends: item.depends };
        return {
          ...item,
          installed: isInstalled,
          active,
          enabled: match ? prefs?.[match.id]?.enabled !== false : true,
          builtIn: match?.bakedIn ?? false,
          provides,
          depends: item.depends,
        };
      });

      // Inject discovered plugins not in the catalog (e.g. channel plugins).
      // Only show them if they're actually installed or baked-in.
      for (const d of discovered) {
        if (catalogNames.has(d.id)) continue;
        const isInstalled = installedNames.has(d.id) || (d.bakedIn ?? false);
        if (!isInstalled) continue;
        // Apply the same filters the DB query uses
        if (query.type && query.type !== "plugin") continue;
        if (query.category && d.category !== query.category) continue;
        const provides = resolveProvides(d.id, d.provides, d.category);
        if (query.provides && !provides.includes(query.provides)) continue;
        if (query.q) {
          const q = query.q.toLowerCase();
          if (!d.name.toLowerCase().includes(q) && !d.description.toLowerCase().includes(q) && !d.id.toLowerCase().includes(q)) continue;
        }
        const active = loadedPlugins.some((l) => l.manifest.id === d.id);
        enriched.push({
          name: d.id,
          sourceId: 0,
          installed: true,
          active,
          enabled: prefs?.[d.id]?.enabled !== false,
          builtIn: d.bakedIn ?? false,
          description: d.description,
          type: "plugin",
          version: d.version,
          author: d.author ? { name: d.author } : undefined,
          category: d.category,
          provides,
          depends: d.depends,
          source: null,
        });
      }

      return reply.send(enriched);
    });

    fastify.post("/api/marketplace/install", async (request, reply) => {
      const body = request.body as { pluginName?: string; sourceId?: number };
      if (!body.pluginName || body.sourceId === undefined) {
        return reply.code(400).send({ error: "pluginName and sourceId are required" });
      }
      const result = await mp.install(body.pluginName, body.sourceId);
      if (!result.ok) return reply.code(400).send(result);

      // Hot-load the newly installed plugin(s) so stacks/tools are immediately available
      const hotLoaded: string[] = [];
      if (deps.onPluginInstalled && result.installPath) {
        const hlResult = await deps.onPluginInstalled(result.installPath);
        if (hlResult.loaded && hlResult.pluginId) hotLoaded.push(hlResult.pluginId);
      }
      // Also hot-load auto-installed dependencies
      if (deps.onPluginInstalled && result.autoInstalled) {
        const installed = await mp.getInstalled();
        for (const depName of result.autoInstalled) {
          const depItem = installed.find(i => i.name === depName);
          if (depItem) {
            const hlResult = await deps.onPluginInstalled(depItem.installPath);
            if (hlResult.loaded && hlResult.pluginId) hotLoaded.push(hlResult.pluginId);
          }
        }
      }

      return reply.send({ ...result, hotLoaded: hotLoaded.length > 0 ? hotLoaded : undefined });
    });

    fastify.get("/api/marketplace/uninstall-preview/:pluginName", async (request, reply) => {
      const { pluginName } = request.params as { pluginName: string };
      // Look up the loaded plugin and call cleanup() if available
      const loaded = deps.pluginRegistry?.get(pluginName);
      if (!loaded?.instance?.cleanup) {
        return reply.send({ resources: [] });
      }
      try {
        const manifest = await loaded.instance.cleanup();
        return reply.send(manifest);
      } catch {
        return reply.send({ resources: [] });
      }
    });

    fastify.delete("/api/marketplace/installed/:pluginName", async (request, reply) => {
      const { pluginName } = request.params as { pluginName: string };
      const query = request.query as Record<string, string>;
      const force = query.force === "true";
      const body = request.body as { cleanupIds?: string[] } | undefined;

      // Execute selected cleanup commands before removing the plugin directory
      if (body?.cleanupIds && body.cleanupIds.length > 0) {
        const loaded = deps.pluginRegistry?.get(pluginName);
        if (loaded?.instance?.cleanup) {
          try {
            const manifest = await loaded.instance.cleanup();
            const selectedIds = new Set(body.cleanupIds);
            for (const resource of manifest.resources) {
              if (selectedIds.has(resource.id)) {
                try {
                  const { execSync } = await import("node:child_process");
                  execSync(resource.removeCommand, { stdio: "pipe", timeout: 60_000 });
                } catch { /* cleanup is best-effort */ }
              }
            }
          } catch { /* cleanup is best-effort */ }
        }
      }

      const result = await mp.uninstall(pluginName, force);
      if (!result.ok) return reply.code(400).send(result);
      return reply.send(result);
    });

    fastify.get("/api/marketplace/installed", async (_request, reply) => {
      return reply.send(await mp.getInstalled());
    });

    fastify.get("/api/marketplace/updates", async (_request, reply) => {
      return reply.send(await mp.checkUpdates());
    });

    // POST /api/marketplace/update/:pluginName — hot-reload an installed plugin
    fastify.post<{ Params: { pluginName: string } }>("/api/marketplace/update/:pluginName", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Marketplace API only allowed from private network" });
      }

      const { pluginName } = request.params;
      const body = request.body as { sourceId?: number } | undefined;

      const installedList = await mp.getInstalled();
      const installed = installedList.find(i => i.name === pluginName);
      if (!installed) return reply.code(404).send({ error: "Plugin not installed" });
      const sourceId = body?.sourceId ?? installed.sourceId;

      // 1. Deactivate old plugin (unbridge skills, unregister stacks/types, deactivate)
      if (deps.onPluginDeactivating) {
        try {
          await deps.onPluginDeactivating(pluginName);
        } catch (deactErr) {
          log.warn(`plugin deactivation warning for "${pluginName}": ${deactErr instanceof Error ? deactErr.message : String(deactErr)}`);
        }
      }

      // 2. Update route dispatch map — remove old handlers for this plugin
      for (const route of deps.pluginRegistry?.getRoutes() ?? []) {
        if (route.pluginId === pluginName) {
          pluginRouteHandlers.delete(`${route.method.toUpperCase()}:${route.path}`);
        }
      }

      // 3. Reinstall from marketplace
      const updateResult = await mp.updatePlugin(pluginName, sourceId);
      if (!updateResult.ok) return reply.code(400).send(updateResult);

      // 4. Hot-load the updated plugin with cache busting
      if (deps.onPluginUpdated && updateResult.installPath) {
        const hlResult = await deps.onPluginUpdated(updateResult.installPath);
        if (!hlResult.loaded) {
          return reply.code(500).send({ error: hlResult.error ?? "Failed to reload plugin" });
        }

        // 5. Update route dispatch map with new handlers
        for (const route of deps.pluginRegistry?.getRoutes() ?? []) {
          if (route.pluginId === pluginName) {
            pluginRouteHandlers.set(`${route.method.toUpperCase()}:${route.path}`, route.handler);
          }
        }
      }

      log.info(`plugin updated: ${pluginName} (${updateResult.oldVersion} → ${updateResult.newVersion})`);
      return reply.send({
        ok: true,
        pluginName,
        oldVersion: updateResult.oldVersion,
        newVersion: updateResult.newVersion,
      });
    });

    // POST /api/marketplace/pull — sync catalog from GitHub, update all installed plugins, hot-reload
    fastify.post("/api/marketplace/pull", async (_request, reply) => {
      const clientIp = getClientIp(_request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Marketplace API only allowed from private network" });
      }

      // 1. Sync catalog from GitHub sources + update all installed plugins
      const result = await mp.syncAndUpdateAll();

      // 2. Hot-reload any updated plugins. onPluginUpdated returns
      //    { loaded, error? } per plugin — we must honour the flag AND log
      //    failures, or the pull endpoint will lie about how many reloaded
      //    (as the earlier implementation did, silently miscounting every
      //    silent-failure as a success).
      const reloaded: string[] = [];
      const reloadErrors: string[] = [];
      if (deps.onPluginUpdated && deps.onPluginDeactivating) {
        const allInstalled = await mp.getInstalled();
        for (const name of result.updated) {
          const installed = allInstalled.find(i => i.name === name);
          if (!installed) {
            reloadErrors.push(`${name}: not found in installed list`);
            continue;
          }
          try {
            await deps.onPluginDeactivating(name);
            const res = await deps.onPluginUpdated(installed.installPath);
            if (res.loaded) {
              reloaded.push(name);
            } else {
              const msg = res.error ?? "unknown error";
              reloadErrors.push(`${name}: ${msg}`);
              log.warn(`hot-reload failed for "${name}": ${msg}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            reloadErrors.push(`${name}: ${msg}`);
            log.warn(`hot-reload threw for "${name}": ${msg}`);
          }
        }
      }

      log.info(
        `plugin-marketplace pull: synced=${String(result.synced)}, updated=${result.updated.length}, reloaded=${reloaded.length}, reloadErrors=${reloadErrors.length}`,
      );
      return reply.send({
        ok: true,
        catalogSynced: result.synced,
        updated: result.updated,
        reloaded,
        reloadErrors,
        errors: result.errors,
      });
    });

    // POST /api/marketplace/rebuild/:name — rebuild a single installed plugin (esbuild only, no re-download)
    fastify.post<{ Params: { name: string } }>("/api/marketplace/rebuild/:name", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Marketplace API only allowed from private network" });
      }

      const { name } = request.params;

      try {
        await mp.rebuildPlugin(name);
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
      }

      // Hot-reload the rebuilt plugin using the same deactivate → reload flow as update
      if (deps.onPluginDeactivating) {
        try { await deps.onPluginDeactivating(name); } catch (deactErr) {
          log.warn(`rebuild deactivation warning for "${name}": ${deactErr instanceof Error ? deactErr.message : String(deactErr)}`);
        }
        // Remove stale route handlers for this plugin
        for (const route of deps.pluginRegistry?.getRoutes() ?? []) {
          if (route.pluginId === name) {
            pluginRouteHandlers.delete(`${route.method.toUpperCase()}:${route.path}`);
          }
        }
      }

      if (deps.onPluginUpdated) {
        const rebuildInstalledList = await mp.getInstalled();
        const installed = rebuildInstalledList.find(i => i.name === name);
        if (installed) {
          const hlResult = await deps.onPluginUpdated(installed.installPath);
          if (!hlResult.loaded) {
            return reply.code(500).send({ error: hlResult.error ?? "Failed to reload plugin after rebuild" });
          }
          // Re-register route handlers for the reloaded plugin
          for (const route of deps.pluginRegistry?.getRoutes() ?? []) {
            if (route.pluginId === name) {
              pluginRouteHandlers.set(`${route.method.toUpperCase()}:${route.path}`, route.handler);
            }
          }
        }
      }

      log.info(`plugin rebuilt and reloaded: ${name}`);
      return reply.send({ ok: true, name });
    });

    // POST /api/marketplace/rebuild-all — rebuild all installed plugins (esbuild only, no re-download)
    fastify.post("/api/marketplace/rebuild-all", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) {
        return reply.code(403).send({ error: "Marketplace API only allowed from private network" });
      }

      const result = await mp.rebuildAll();

      // Hot-reload all successfully rebuilt plugins
      const reloaded: string[] = [];
      const reloadErrors: string[] = [];
      for (const name of result.rebuilt) {
        if (deps.onPluginDeactivating) {
          try { await deps.onPluginDeactivating(name); } catch { /* deactivation is best-effort */ }
          for (const route of deps.pluginRegistry?.getRoutes() ?? []) {
            if (route.pluginId === name) {
              pluginRouteHandlers.delete(`${route.method.toUpperCase()}:${route.path}`);
            }
          }
        }
        if (deps.onPluginUpdated) {
          const rebuildAllInstalledList = await mp.getInstalled();
          const installed = rebuildAllInstalledList.find(i => i.name === name);
          if (installed) {
            try {
              const hlResult = await deps.onPluginUpdated(installed.installPath);
              if (hlResult.loaded) {
                for (const route of deps.pluginRegistry?.getRoutes() ?? []) {
                  if (route.pluginId === name) {
                    pluginRouteHandlers.set(`${route.method.toUpperCase()}:${route.path}`, route.handler);
                  }
                }
                reloaded.push(name);
              } else {
                reloadErrors.push(`${name}: ${hlResult.error ?? "unknown error"}`);
              }
            } catch (err) {
              reloadErrors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }

      log.info(`rebuild-all: rebuilt=${result.rebuilt.length}, failed=${result.failed.length}, reloaded=${reloaded.length}`);
      return reply.send({
        ok: true,
        rebuilt: result.rebuilt,
        failed: result.failed,
        reloaded,
        reloadErrors,
      });
    });
  }

  // -----------------------------------------------------------------------
  // Models API — /api/models?provider=...
  // -----------------------------------------------------------------------

  if (deps.configPath !== undefined) {
    registerModelsRoutes(fastify, { configPath: deps.configPath });
  }

  // -----------------------------------------------------------------------
  // Comms & Notifications API — /api/comms, /api/notifications
  // -----------------------------------------------------------------------

  if (deps.commsLog !== undefined && deps.notificationStore !== undefined) {
    registerCommsRoutes(fastify, {
      commsLog: deps.commsLog,
      notificationStore: deps.notificationStore,
    });
  }

  // -----------------------------------------------------------------------
  // Chat History API routes (private network only)
  // -----------------------------------------------------------------------

  if (deps.chatPersistence !== undefined) {
    // s130 t521 server.ts wire-up (cycle 100 — production reader flip).
    // perProjectChatDirs returns the list of `<projectPath>/k/chat/`
    // dirs for s130-migrated projects in the workspace. Filtered by
    // existsSync(<projectPath>/.agi) — projects without the s130 layout
    // are skipped (today's behavior preserved for them). The list is
    // computed FRESH on each call so newly-added/migrated projects
    // surface without a gateway restart.
    const perProjectChatDirs = (): string[] => {
      const projects = deps.workspaceProjects ?? [];
      const dirs: string[] = [];
      for (const projectPath of projects) {
        if (existsSync(join(projectPath, ".agi"))) {
          const chatDir = join(projectPath, "k", "chat");
          if (existsSync(chatDir)) dirs.push(chatDir);
        }
      }
      return dirs;
    };
    registerChatHistoryRoutes(fastify, {
      chatPersistence: deps.chatPersistence,
      imageBlobStore: deps.imageBlobStore,
      perProjectChatDirs,
    });
  }

  // -----------------------------------------------------------------------
  // Machine Admin API routes (private network only)
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Onboarding API routes (private network only)
  // -----------------------------------------------------------------------

  registerOnboardingRoutes(fastify, {
    logger: deps.logger,
    secrets: deps.secrets,
    config: deps.config as Record<string, unknown>,
    configPath: deps.configPath,
  });

  registerMachineAdminRoutes(fastify, { logger: deps.logger, dashboardUserStore, localIdAuthProvider, idBaseUrl: localIdBaseUrl, configPath: deps.configPath });

  // -----------------------------------------------------------------------
  // GET /api/plugins — list installed plugins (private network only)
  // -----------------------------------------------------------------------

  fastify.get("/api/plugins", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Plugins API only allowed from private network" });
    }
    const loadedPlugins = deps.pluginRegistry?.getAll() ?? [];
    const allDiscovered = deps.discoveredPlugins ?? [];
    const prefs = deps.pluginPrefs;

    // Build full list: loaded (active) + discovered-but-disabled
    const resolveProvides = (id: string, manifestProvides?: string[], category?: string): string[] => {
      const active = loadedPlugins.some(l => l.manifest.id === id);
      if (active && deps.pluginRegistry) {
        const registryProvides = deps.pluginRegistry.getPluginProvides(id);
        if (registryProvides.length > 0) return registryProvides;
      }
      if (manifestProvides && manifestProvides.length > 0) return manifestProvides;
      return categoryToProvides(category);
    };

    const plugins = allDiscovered.length > 0
      ? allDiscovered.map((d) => {
          const active = loadedPlugins.some(l => l.manifest.id === d.id);
          return {
            id: d.id,
            name: d.name,
            version: d.version,
            description: d.description,
            author: d.author,
            permissions: d.permissions,
            category: d.category ?? "tool",
            provides: resolveProvides(d.id, d.provides, d.category),
            active,
            enabled: prefs?.[d.id]?.enabled !== false,
            bakedIn: d.bakedIn ?? false,
            disableable: d.disableable ?? true,
          };
        })
      : loadedPlugins.map((p) => ({
          id: p.manifest.id,
          name: p.manifest.name,
          version: p.manifest.version,
          description: p.manifest.description,
          author: p.manifest.author ?? null,
          permissions: p.manifest.permissions,
          category: p.manifest.category ?? "tool",
          provides: resolveProvides(p.manifest.id, undefined, p.manifest.category),
          active: true,
          enabled: true,
          bakedIn: p.manifest.bakedIn ?? false,
          disableable: p.manifest.disableable ?? true,
        }));

    return reply.send({ plugins });
  });

  // GET /api/plugins/:id/details — full plugin registration breakdown
  fastify.get<{ Params: { id: string } }>("/api/plugins/:id/details", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Plugins API only allowed from private network" });
    }

    const pluginId = request.params.id;
    const reg = deps.pluginRegistry;
    const allDiscovered = deps.discoveredPlugins ?? [];
    const disc = allDiscovered.find((d) => d.id === pluginId);
    const loaded = reg?.getAll().find((l) => l.manifest.id === pluginId);
    const installedRecords = await (deps.marketplaceManager?.getInstalled() ?? Promise.resolve([]));
    const isInstalled = installedRecords.some((r) => r.name === pluginId) || (disc?.bakedIn ?? false);

    if (!disc && !loaded) {
      return reply.code(404).send({ error: "Plugin not found" });
    }

    const manifest = loaded
      ? {
          id: loaded.manifest.id,
          name: loaded.manifest.name,
          version: loaded.manifest.version,
          description: loaded.manifest.description,
          author: loaded.manifest.author ?? null,
          permissions: loaded.manifest.permissions,
          category: loaded.manifest.category ?? "tool",
          provides: reg?.getPluginProvides(pluginId) ?? [],
          depends: disc?.depends,
        }
      : {
          id: disc!.id,
          name: disc!.name,
          version: disc!.version,
          description: disc!.description,
          author: disc!.author,
          permissions: disc!.permissions,
          category: disc!.category,
          provides: disc!.provides ?? [],
          depends: disc!.depends,
        };

    const active = !!loaded;
    const enabled = deps.pluginPrefs?.[pluginId]?.enabled !== false;
    const builtIn = disc?.bakedIn ?? loaded?.manifest.bakedIn ?? false;

    // Only include registrations for loaded (active) plugins
    let registrations: Record<string, unknown> | undefined;
    if (reg && active) {
      const byPlugin = <T extends { pluginId: string }>(arr: T[]) =>
        arr.filter((x) => x.pluginId === pluginId);

      registrations = {
        routes: byPlugin(reg.getRoutes()).map((r) => ({ method: r.method, path: r.path })),
        systemServices: byPlugin(reg.getSystemServices()).map((s) => ({
          id: s.service.id, name: s.service.name, description: s.service.description,
          unitName: s.service.unitName,
        })),
        agentTools: byPlugin(reg.getAgentTools()).map((t) => ({
          name: t.tool.name, description: t.tool.description,
        })),
        settingsPages: byPlugin(reg.getSettingsPages()).map((p) => ({
          id: p.page.id, label: p.page.label,
        })),
        dashboardPages: byPlugin(reg.getDashboardPages()).map((p) => ({
          id: p.page.id, label: p.page.label, domain: p.page.domain,
        })),
        skills: byPlugin(reg.getSkills()).map((s) => ({
          name: s.skill.name, description: s.skill.description, domain: s.skill.domain,
        })),
        knowledge: byPlugin(reg.getKnowledge()).map((k) => ({
          id: k.namespace.id, label: k.namespace.label, topicCount: k.namespace.topics.length,
        })),
        themes: byPlugin(reg.getThemes()).map((t) => ({
          id: t.theme.id, name: t.theme.name,
        })),
        workflows: byPlugin(reg.getWorkflows()).map((w) => ({
          id: w.workflow.id, name: w.workflow.name,
        })),
        scheduledTasks: byPlugin(reg.getScheduledTasks()).map((t) => ({
          id: t.task.id, name: t.task.name, cron: t.task.cron,
        })),
        sidebarSections: byPlugin(reg.getSidebarSections()).map((s) => ({
          id: s.section.id, title: s.section.title, itemCount: s.section.items.length,
        })),
        stacks: byPlugin(reg.getStacks()).map((s) => ({
          id: s.stack.id, label: s.stack.label,
        })),
      };
    }

    return reply.send({ manifest, installed: isInstalled, active, enabled, builtIn, registrations });
  });

  // PUT /api/plugins/:id — toggle plugin enabled state (private network only)

  fastify.put<{ Params: { id: string } }>("/api/plugins/:id", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Plugins API only allowed from private network" });
    }
    if (deps.configPath === undefined) {
      return reply.code(500).send({ error: "Config path not available" });
    }
    const body = request.body as { enabled?: boolean } | null;
    if (body === null || typeof body !== "object" || typeof body.enabled !== "boolean") {
      return reply.code(400).send({ error: "enabled (boolean) is required" });
    }

    const pluginId = request.params.id;

    // Reject disabling non-disableable baked-in plugins
    if (!body.enabled) {
      const discovered = deps.discoveredPlugins ?? [];
      const target = discovered.find(d => d.id === pluginId);
      if (target?.bakedIn && !target.disableable) {
        return reply.code(403).send({ error: "This plugin cannot be disabled" });
      }
    }

    try {
      const raw = JSON.parse(readFileSync(deps.configPath, "utf-8")) as Record<string, unknown>;
      const plugins = (raw.plugins ?? {}) as Record<string, { enabled?: boolean; priority?: number }>;
      if (!plugins[pluginId]) plugins[pluginId] = {};
      plugins[pluginId].enabled = body.enabled;
      raw.plugins = plugins;
      writeFileSync(deps.configPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
      // Update in-memory prefs so subsequent GET calls reflect the change immediately
      if (!deps.pluginPrefs) deps.pluginPrefs = {};
      if (!deps.pluginPrefs[pluginId]) deps.pluginPrefs[pluginId] = {};
      deps.pluginPrefs[pluginId].enabled = body.enabled;
      return reply.send({ ok: true, requiresRestart: true });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/runtimes — list all registered runtimes (private network only)
  // GET /api/runtimes/:projectType — runtimes for a specific project type
  // -----------------------------------------------------------------------

  // Helper: enrich runtimes with actual installation status from RuntimeInstallers
  async function enrichRuntimes(runtimes: RuntimeDefinition[]): Promise<RuntimeDefinition[]> {
    const installers = deps.pluginRegistry?.getRuntimeInstallers() ?? [];
    const installed: Record<string, string[]> = {};
    for (const installer of installers) {
      try { installed[installer.language] = await installer.listInstalled(); }
      catch { installed[installer.language] = []; }
    }
    return runtimes.map(rt => ({
      ...rt,
      installed: installed[rt.language]?.includes(rt.version) ?? false,
    }));
  }

  fastify.get("/api/runtimes", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Runtimes API only allowed from private network" });
    }
    const runtimes = deps.pluginRegistry?.getRuntimes() ?? [];
    return reply.send({ runtimes: await enrichRuntimes(runtimes) });
  });

  fastify.get<{ Params: { projectType: string } }>("/api/runtimes/:projectType", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Runtimes API only allowed from private network" });
    }
    const runtimes = deps.pluginRegistry?.getRuntimesForType(request.params.projectType) ?? [];
    return reply.send({ runtimes: await enrichRuntimes(runtimes) });
  });

  // -----------------------------------------------------------------------
  // GET /api/runtimes/installed — list installed runtime versions
  // POST /api/runtimes/:id/install — install a runtime version
  // POST /api/runtimes/:id/uninstall — uninstall a runtime version
  // -----------------------------------------------------------------------

  fastify.get("/api/runtimes/installed", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Runtimes API only allowed from private network" });
    }

    const installers = deps.pluginRegistry?.getRuntimeInstallers() ?? [];
    const installed: Record<string, string[]> = {};
    for (const installer of installers) {
      try {
        installed[installer.language] = await installer.listInstalled();
      } catch {
        installed[installer.language] = [];
      }
    }
    return reply.send({ installed });
  });

  fastify.post<{ Params: { id: string } }>("/api/runtimes/:id/install", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Runtimes API only allowed from private network" });
    }

    const runtimeId = request.params.id;
    const runtimes = deps.pluginRegistry?.getRuntimes() ?? [];
    const runtime = runtimes.find(r => r.id === runtimeId);
    if (!runtime) {
      return reply.code(404).send({ error: `Runtime "${runtimeId}" not found` });
    }

    const installer = deps.pluginRegistry?.getRuntimeInstaller(runtime.language);
    if (!installer) {
      return reply.code(400).send({ error: `No installer registered for language "${runtime.language}"` });
    }

    try {
      await installer.install(runtime.version);
      log.info(`installed runtime "${runtimeId}" (${runtime.language} ${runtime.version})`);
      return reply.send({ ok: true, runtimeId, version: runtime.version });
    } catch (e: unknown) {
      const stderr = (e as { stderr?: Buffer | string })?.stderr;
      const detail = stderr ? (Buffer.isBuffer(stderr) ? stderr.toString() : stderr).trim() : "";
      const msg = e instanceof Error ? e.message : "Install failed";
      log.error(`failed to install runtime "${runtimeId}": ${msg}${detail ? `\n${detail}` : ""}`);
      return reply.code(500).send({ error: msg, detail: detail || undefined });
    }
  });

  fastify.post<{ Params: { id: string } }>("/api/runtimes/:id/uninstall", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Runtimes API only allowed from private network" });
    }

    const runtimeId = request.params.id;
    const runtimes = deps.pluginRegistry?.getRuntimes() ?? [];
    const runtime = runtimes.find(r => r.id === runtimeId);
    if (!runtime) {
      return reply.code(404).send({ error: `Runtime "${runtimeId}" not found` });
    }

    const installer = deps.pluginRegistry?.getRuntimeInstaller(runtime.language);
    if (!installer) {
      return reply.code(400).send({ error: `No installer registered for language "${runtime.language}"` });
    }

    try {
      await installer.uninstall(runtime.version);
      log.info(`uninstalled runtime "${runtimeId}" (${runtime.language} ${runtime.version})`);
      return reply.send({ ok: true, runtimeId, version: runtime.version });
    } catch (e: unknown) {
      const stderr = (e as { stderr?: Buffer | string })?.stderr;
      const detail = stderr ? (Buffer.isBuffer(stderr) ? stderr.toString() : stderr).trim() : "";
      const msg = e instanceof Error ? e.message : "Uninstall failed";
      log.error(`failed to uninstall runtime "${runtimeId}": ${msg}${detail ? `\n${detail}` : ""}`);
      return reply.code(500).send({ error: msg, detail: detail || undefined });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/hosting-extensions — list all hosting extension fields
  // GET /api/hosting-extensions/:projectType — fields for a specific type
  // -----------------------------------------------------------------------

  fastify.get("/api/hosting-extensions", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Hosting extensions API only allowed from private network" });
    }
    const extensions = deps.pluginRegistry?.getHostingExtensions() ?? [];
    const allFields = extensions.flatMap(ext => ext.fields);
    return reply.send({ fields: allFields });
  });

  fastify.get<{ Params: { projectType: string } }>("/api/hosting-extensions/:projectType", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Hosting extensions API only allowed from private network" });
    }
    const extensions = deps.pluginRegistry?.getHostingExtensions() ?? [];
    const runtimes = deps.pluginRegistry?.getRuntimes() ?? [];
    const fields = extensions.flatMap(ext =>
      ext.fields.filter(f =>
        !f.projectTypes || f.projectTypes.length === 0 || f.projectTypes.includes(request.params.projectType),
      ),
    );
    // Map field IDs to runtime ID prefixes for image-exists filtering
    const versionFieldToPrefix: Record<string, string> = {
      runtimeId: "",
      mariadbVersion: "mariadb-",
      postgresVersion: "postgres-",
    };

    for (const field of fields) {
      const prefix = versionFieldToPrefix[field.id];
      if (prefix !== undefined && field.options) {
        field.options = field.options.filter((opt: { value: string }) => {
          if (!opt.value) return true; // keep "None" option
          const rtId = field.id === "runtimeId" ? opt.value : `${prefix}${opt.value}`;
          const rt = runtimes.find(r => r.id === rtId);
          if (!rt) return false;
          try {
            execFileSync("podman", ["image", "exists", rt.containerImage], {
              stdio: "pipe", timeout: 5000,
            });
            return true;
          } catch {
            return false;
          }
        });
      }
    }
    return reply.send({ fields });
  });

  // -----------------------------------------------------------------------
  // Service API — /api/services
  // -----------------------------------------------------------------------

  fastify.get("/api/services", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Services API only allowed from private network" });
    }
    if (!deps.serviceManager) {
      return reply.send({ services: [] });
    }
    const sm = deps.serviceManager;
    const services = sm.getStatus().map(svc => ({
      ...svc,
      imageAvailable: sm.isImageAvailable(svc.image),
    }));
    return reply.send({ services });
  });

  fastify.post<{ Params: { id: string } }>("/api/services/:id/start", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Services API only allowed from private network" });
    }
    if (!deps.serviceManager) {
      return reply.code(500).send({ error: "Service manager not initialized" });
    }
    try {
      await deps.serviceManager.startService(request.params.id);
      return reply.send({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`service start "${request.params.id}" failed: ${msg}`);
      return reply.code(500).send({ error: msg });
    }
  });

  fastify.post<{ Params: { id: string } }>("/api/services/:id/stop", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Services API only allowed from private network" });
    }
    if (!deps.serviceManager) {
      return reply.code(500).send({ error: "Service manager not initialized" });
    }
    try {
      await deps.serviceManager.stopService(request.params.id);
      return reply.send({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`service stop "${request.params.id}" failed: ${msg}`);
      return reply.code(500).send({ error: msg });
    }
  });

  fastify.post<{ Params: { id: string } }>("/api/services/:id/restart", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Services API only allowed from private network" });
    }
    if (!deps.serviceManager) {
      return reply.code(500).send({ error: "Service manager not initialized" });
    }
    try {
      await deps.serviceManager.restartService(request.params.id);
      return reply.send({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`service restart "${request.params.id}" failed: ${msg}`);
      return reply.code(500).send({ error: msg });
    }
  });

  // -----------------------------------------------------------------------
  // s143 t570 — Circuit-breaker visibility + reset endpoints.
  //
  // The CircuitBreakerTracker (cycle 153) records per-service failures
  // into gateway.json under services.circuitBreaker.states[serviceId].
  // Cycle 155-157 saw four projects trip to status=open and stay there
  // because their build dirs don't exist. The operator's only way to
  // see + reset breakers today is jq + manual file edit, which violates
  // the dashboard-UI-only discipline (cycle 156 owner directive).
  //
  // These routes surface the same data the dashboard's Services page
  // (t572) consumes, plus reset affordances. All gated to private
  // network like the rest of the services API.
  // -----------------------------------------------------------------------

  fastify.get("/api/services/circuit-breakers", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Services API only allowed from private network" });
    }
    if (!deps.circuitBreaker) {
      return reply.send({ states: {}, openCount: 0, halfOpenCount: 0, totalCount: 0 });
    }
    const states = deps.circuitBreaker.listStates();
    const entries = Object.values(states);
    return reply.send({
      states,
      openCount: entries.filter((s) => s.status === "open").length,
      halfOpenCount: entries.filter((s) => s.status === "half-open").length,
      totalCount: entries.length,
    });
  });

  fastify.post<{ Params: { id: string } }>("/api/services/circuit-breakers/:id/reset", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Services API only allowed from private network" });
    }
    if (!deps.circuitBreaker) {
      return reply.code(503).send({ error: "Circuit breaker tracker not wired" });
    }
    // The serviceId from the URL contains slashes (e.g. hosting:/home/...)
    // — fastify's :id captures only one segment. Read the full path from
    // request.url instead so colons + slashes survive routing.
    const url = request.url; // e.g. /api/services/circuit-breakers/hosting:%2Fhome%2F.../reset
    const match = /\/api\/services\/circuit-breakers\/(.+)\/reset$/.exec(url);
    const serviceId = match ? decodeURIComponent(match[1]!) : request.params.id;
    deps.circuitBreaker.reset(serviceId);
    return reply.send({ ok: true, serviceId });
  });

  fastify.post("/api/services/circuit-breakers/reset-all", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Services API only allowed from private network" });
    }
    if (!deps.circuitBreaker) {
      return reply.code(503).send({ error: "Circuit breaker tracker not wired" });
    }
    const count = deps.circuitBreaker.resetAll();
    return reply.send({ ok: true, count });
  });

  // s143 t573 — test-VM-only endpoint that synthesizes an "open" breaker
  // for an arbitrary service id so the e2e can prove force-trip → render
  // → reset → cleared without breaking a real service. Gated on
  // AIONIMA_TEST_VM=1 (the same gate FilesystemSecretsBackend uses) so
  // production cannot reach this surface even from a private network.
  // The expected service-id prefix is `service:e2e-` — but the endpoint
  // doesn't enforce a prefix so other tests (channel/plugin/hosting)
  // can synthesize their own breakers consistently.
  fastify.post("/api/services/circuit-breakers/force-trip", async (request, reply) => {
    if (process.env["AIONIMA_TEST_VM"] !== "1") {
      return reply.code(404).send({ error: "Not Found" });
    }
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Services API only allowed from private network" });
    }
    if (!deps.circuitBreaker) {
      return reply.code(503).send({ error: "Circuit breaker tracker not wired" });
    }
    const body = (request.body ?? {}) as { serviceId?: string; failures?: number };
    if (typeof body.serviceId !== "string" || body.serviceId.length === 0) {
      return reply.code(400).send({ error: "serviceId (string) required" });
    }
    // Default 3 failures = threshold (matches CircuitBreakerTracker default).
    const target = Math.max(1, Math.min(20, body.failures ?? 3));
    for (let i = 0; i < target; i++) {
      deps.circuitBreaker.recordFailure(body.serviceId, new Error(`e2e force-trip failure ${String(i + 1)}/${String(target)}`));
    }
    return reply.send({ ok: true, serviceId: body.serviceId, state: deps.circuitBreaker.getState(body.serviceId) ?? null });
  });

  // -----------------------------------------------------------------------
  // Federation & Identity routes
  // -----------------------------------------------------------------------

  if (deps.identityProvider) {
    registerIdentityRoutes(fastify, {
      identityProvider: deps.identityProvider,
      oauthHandler: deps.oauthHandler ?? null,
      logger: deps.logger,
    });
  }

  if (deps.identityProvider) {
    registerSubUserRoutes(fastify, {
      identityProvider: deps.identityProvider,
      visitorAuth: deps.visitorAuth ?? null,
      dashboardUserStore: null,
      idBaseUrl: localIdBaseUrl,
      logger: deps.logger,
    });
  }

  // /.well-known/mycelium-node.json — federation node manifest
  if (deps.federationNode) {
    const fedNode = deps.federationNode;
    fastify.get("/.well-known/mycelium-node.json", async (_request, reply) => {
      return reply.send(fedNode.getManifest());
    });
  }

  // Federation router — /mycelium/* routes
  if (deps.federationRouter) {
    const fedRouter = deps.federationRouter;
    fastify.all("/mycelium/*", async (request, reply) => {
      const body = request.method === "GET" ? undefined : JSON.stringify(request.body);
      const result = await fedRouter.handleRequest({
        method: request.method as "GET" | "POST" | "PUT" | "DELETE",
        path: request.url,
        headers: request.headers as Record<string, string>,
        body,
      });
      return reply.code(result.status).send(result.body);
    });
  }

  // -----------------------------------------------------------------------
  // Built-in docs file API — serves docs/ directory for the dashboard
  // -----------------------------------------------------------------------
  // These routes provide the file tree and content that the /docs dashboard
  // page needs. They only expose the docs/ subtree (read-only), so they're
  // safe to serve without the full editor plugin.

  const docsRoot = join(deps.selfRepoPath ?? deps.workspaceRoot ?? process.cwd(), "docs");

  type FileNode = { name: string; path: string; type: "file" | "dir"; children?: FileNode[]; ext?: string };

  function buildFileTree(dir: string, prefix: string, hideHidden = false): FileNode[] {
    if (!existsSync(dir)) return [];
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.name !== ".git" && e.name !== "node_modules")
      .filter((e) => !hideHidden || !e.name.startsWith("."))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
    const nodes: FileNode[] = [];
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        nodes.push({ name: entry.name, path: relPath, type: "dir", children: buildFileTree(join(dir, entry.name), relPath, hideHidden) });
      } else {
        const ext = entry.name.includes(".") ? entry.name.slice(entry.name.lastIndexOf(".")) : undefined;
        nodes.push({ name: entry.name, path: relPath, type: "file", ext });
      }
    }
    return nodes;
  }

  fastify.get("/api/files/tree", async (request, reply) => {
    const { root } = request.query as { root?: string };
    // Only allow the docs subtree
    if (root !== "docs") {
      return reply.code(403).send({ error: "Built-in file tree only serves docs/" });
    }
    const tree = buildFileTree(docsRoot, "docs");

    // Append SDK docs as a top-level section
    const sdkDocsDir = join(docsRoot, "..", "packages", "aion-sdk", "docs");
    if (!existsSync(sdkDocsDir)) {
      // Fallback: look for SDK docs in the docs/sdk/ directory (already in tree)
    }

    // Append plugin-provided knowledge namespaces as virtual folders grouped under a
    // single "Plugins" parent folder. Only include documentation files — not raw system
    // dirs or binaries. Note: pluginRegistry.getKnowledge() already only returns
    // namespaces from currently loaded (active) plugins, so no extra filtering is needed.
    const DOC_EXTS = new Set([".md", ".txt", ".html", ".rst", ".adoc"]);
    const knowledgeEntries = deps.pluginRegistry?.getKnowledge() ?? [];
    const pluginDocFolders: FileNode[] = [];
    for (const { namespace } of knowledgeEntries) {
      if (!namespace.contentDir || !existsSync(namespace.contentDir)) continue;
      // If namespace has explicit topics, use those instead of scanning the directory
      if (namespace.topics && namespace.topics.length > 0) {
        const topicNodes: FileNode[] = namespace.topics
          .filter((t) => {
            try { return existsSync(join(namespace.contentDir!, t.path)); } catch { return false; }
          })
          .map((t) => ({
            name: t.title,
            path: `plugin-docs/${namespace.id}/${t.path}`,
            type: "file" as const,
            ext: t.path.includes(".") ? t.path.slice(t.path.lastIndexOf(".")) : undefined,
          }));
        if (topicNodes.length > 0) {
          pluginDocFolders.push({ name: namespace.label, path: `plugin-docs/${namespace.id}`, type: "dir", children: topicNodes });
        }
      } else {
        // No explicit topics — scan directory but only include doc files
        const subtree = buildFileTree(namespace.contentDir, `plugin-docs/${namespace.id}`)
          .filter(function filterDocs(node: FileNode): boolean {
            if (node.type === "dir") {
              node.children = node.children?.filter(filterDocs);
              return (node.children?.length ?? 0) > 0;
            }
            return node.ext ? DOC_EXTS.has(node.ext) : false;
          });
        if (subtree.length > 0) {
          pluginDocFolders.push({ name: namespace.label, path: `plugin-docs/${namespace.id}`, type: "dir", children: subtree });
        }
      }
    }
    // Group all plugin doc namespaces under a single "Plugins" parent folder so they
    // don't appear at the same level as built-in sections (agents, human, sdk, etc.).
    if (pluginDocFolders.length > 0) {
      tree.push({
        name: "Plugins",
        path: "plugin-docs",
        type: "dir",
        children: pluginDocFolders,
      });
    }
    return reply.send({ tree });
  });

  fastify.get("/api/files/read", async (request, reply) => {
    const { path: filePath } = request.query as { path?: string };
    if (!filePath) {
      return reply.code(400).send({ error: "path query parameter is required" });
    }
    const repoRoot = deps.selfRepoPath ?? deps.workspaceRoot ?? process.cwd();

    if (filePath.startsWith("plugin-docs/")) {
      // Extract namespace ID from the second path segment: plugin-docs/<namespaceId>/...
      const parts = filePath.split("/");
      const namespaceId = parts[1];
      if (!namespaceId) {
        return reply.code(400).send({ error: "Invalid plugin-docs path: missing namespace ID" });
      }
      const knowledgeEntries = deps.pluginRegistry?.getKnowledge() ?? [];
      const entry = knowledgeEntries.find((k) => k.namespace.id === namespaceId);
      if (!entry) {
        return reply.code(404).send({ error: `Plugin knowledge namespace not found: ${namespaceId}` });
      }
      const { contentDir } = entry.namespace;
      // Remaining path after plugin-docs/<namespaceId>/
      const relativePart = parts.slice(2).join("/");
      const resolved = resolvePath(contentDir, relativePart);
      const contentDirAbsolute = resolvePath(contentDir);
      // Path traversal protection — must stay within contentDir
      if (!resolved.startsWith(contentDirAbsolute + "/") && resolved !== contentDirAbsolute) {
        return reply.code(403).send({ error: "Path is outside the plugin knowledge namespace directory" });
      }
      if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        return reply.code(404).send({ error: "File not found" });
      }
      const content = readFileSync(resolved, "utf-8");
      const size = statSync(resolved).size;
      return reply.send({ content, size });
    }

    // Resolve and validate the path stays within docs/
    const resolved = resolvePath(repoRoot, filePath);
    const docsAbsolute = resolvePath(docsRoot);
    if (!resolved.startsWith(docsAbsolute + "/") && resolved !== docsAbsolute) {
      return reply.code(403).send({ error: "Built-in file read only serves docs/" });
    }
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      return reply.code(404).send({ error: "File not found" });
    }
    const content = readFileSync(resolved, "utf-8");
    const size = statSync(resolved).size;
    return reply.send({ content, size });
  });

  // -----------------------------------------------------------------------
  // Project file API — serves files from workspace project directories
  // -----------------------------------------------------------------------

  const projectDirsForFiles = deps.workspaceProjects ?? [];

  function isInsideWorkspace(filePath: string): boolean {
    const resolved = resolvePath(filePath);
    return projectDirsForFiles.some((dir) => resolved.startsWith(resolvePath(dir) + "/") || resolved === resolvePath(dir));
  }

  fastify.get("/api/files/project-tree", async (request, reply) => {
    const query = request.query as { root?: string; hideHidden?: string };
    if (!query.root) return reply.code(400).send({ error: "root query parameter is required" });
    if (!isInsideWorkspace(query.root)) return reply.code(403).send({ error: "Path is not inside a configured workspace directory" });

    const resolved = resolvePath(query.root);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      return reply.send({ tree: [] });
    }
    const tree = buildFileTree(resolved, "", query.hideHidden === "true");
    return reply.send({ tree });
  });

  fastify.get("/api/files/project-read", async (request, reply) => {
    const { path: filePath } = request.query as { path?: string };
    if (!filePath) return reply.code(400).send({ error: "path query parameter is required" });
    if (!isInsideWorkspace(filePath)) return reply.code(403).send({ error: "Path is not inside a configured workspace directory" });

    const resolved = resolvePath(filePath);
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      return reply.code(404).send({ error: "File not found" });
    }
    const content = readFileSync(resolved, "utf-8");
    const size = statSync(resolved).size;
    return reply.send({ content, size });
  });

  fastify.put("/api/files/project-write", async (request, reply) => {
    const body = request.body as { path?: string; content?: string };
    if (!body.path || body.content === undefined) return reply.code(400).send({ error: "path and content are required" });
    if (!isInsideWorkspace(body.path)) return reply.code(403).send({ error: "Path is not inside a configured workspace directory" });

    const resolved = resolvePath(body.path);
    try {
      writeFileSync(resolved, body.content, "utf-8");
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/files/project-create — create a file or directory
  fastify.post("/api/files/project-create", async (request, reply) => {
    const body = request.body as { path?: string; type?: "file" | "directory"; content?: string };
    if (!body.path) return reply.code(400).send({ error: "path is required" });
    if (!isInsideWorkspace(body.path)) return reply.code(403).send({ error: "Path is not inside a configured workspace directory" });

    const resolved = resolvePath(body.path);
    try {
      if (body.type === "directory") {
        mkdirSync(resolved, { recursive: true });
      } else {
        mkdirSync(dirname(resolved), { recursive: true });
        writeFileSync(resolved, body.content ?? "", "utf-8");
      }
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // DELETE /api/files/project-delete — delete a file or directory
  fastify.delete("/api/files/project-delete", async (request, reply) => {
    const body = request.body as { path?: string };
    if (!body.path) return reply.code(400).send({ error: "path is required" });
    if (!isInsideWorkspace(body.path)) return reply.code(403).send({ error: "Path is not inside a configured workspace directory" });

    const resolved = resolvePath(body.path);
    try {
      rmSync(resolved, { recursive: true, force: true });
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/files/project-copy — copy a file or directory
  fastify.post("/api/files/project-copy", async (request, reply) => {
    const body = request.body as { sourcePath?: string; destPath?: string };
    if (!body.sourcePath || !body.destPath) return reply.code(400).send({ error: "sourcePath and destPath are required" });
    if (!isInsideWorkspace(body.sourcePath) || !isInsideWorkspace(body.destPath)) {
      return reply.code(403).send({ error: "Paths must be inside a configured workspace directory" });
    }

    const src = resolvePath(body.sourcePath);
    const dest = resolvePath(body.destPath);
    try {
      cpSync(src, dest, { recursive: true });
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/files/project-rename — rename/move a file or directory
  fastify.post("/api/files/project-rename", async (request, reply) => {
    const body = request.body as { oldPath?: string; newPath?: string };
    if (!body.oldPath || !body.newPath) return reply.code(400).send({ error: "oldPath and newPath are required" });
    if (!isInsideWorkspace(body.oldPath) || !isInsideWorkspace(body.newPath)) {
      return reply.code(403).send({ error: "Paths must be inside a configured workspace directory" });
    }

    const src = resolvePath(body.oldPath);
    const dest = resolvePath(body.newPath);
    try {
      renameSync(src, dest);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -----------------------------------------------------------------------
  // Static dashboard files (SPA with fallback to index.html)
  // -----------------------------------------------------------------------

  if (deps.staticDir !== undefined) {
    await fastify.register(fastifyStatic, {
      root: deps.staticDir,
      // Disable prefix so it serves from /
      prefix: "/",
      // Wildcard mode: serves files dynamically at request time rather than
      // pre-scanning at startup. Required because deploy updates asset hashes
      // without restarting the server (frontend-only deploys).
      wildcard: true,
      // Serve index.html as default
      index: "index.html",
      // Hashed assets (e.g. index-BhWVbYcJ.js) can cache forever;
      // index.html + sw.js + manifest must revalidate so the browser picks
      // up new asset hashes and service worker updates after upgrades.
      // Without no-cache on sw.js, the browser serves the stale SW from
      // its HTTP cache and never picks up updated precache entries (icons, etc.).
      setHeaders(res, filePath) {
        const name = filePath.split(/[/\\]/).pop() ?? "";
        if (name === "index.html" || name === "sw.js" || name === "manifest.webmanifest") {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    });

    // SPA fallback — any GET that doesn't match a file or API route serves index.html
    fastify.setNotFoundHandler(async (request, reply) => {
      if (request.method === "GET" || request.method === "HEAD") {
        try {
          void reply.header("Cache-Control", "no-cache");
          return reply.sendFile("index.html");
        } catch {
          // index.html doesn't exist
        }
      }
      return reply.code(404).send({ error: "Not Found" });
    });
  } else {
    // No static dir — simple 404 for everything else
    fastify.setNotFoundHandler(async (_request, reply) => {
      return reply.code(404).send({ error: "Not Found" });
    });
  }

  // -----------------------------------------------------------------------
  // MagicApp API — list registered apps + instance state persistence
  // -----------------------------------------------------------------------

  // GET /api/dashboard/magic-apps — list all registered MApps with full definitions
  fastify.get("/api/dashboard/magic-apps", async (_request, reply) => {
    if (!deps.mappRegistry) return reply.send({ apps: [] });
    // Return full definitions — MApps are JSON-safe (no functions in the schema)
    return reply.send({ apps: deps.mappRegistry.getAll() });
  });

  // GET /api/dashboard/magic-apps/:id — single MApp detail
  fastify.get("/api/dashboard/magic-apps/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!deps.mappRegistry) return reply.code(404).send({ error: "MApp not found" });
    const def = deps.mappRegistry.get(id);
    if (!def) return reply.code(404).send({ error: "MApp not found" });
    const { serializeMApp } = await import("@agi/sdk");
    return reply.send({ app: serializeMApp(def) });
  });

  // MApp security scan + install
  fastify.post("/api/mapps/scan", async (request, reply) => {
    const body = request.body as { definition?: unknown } | undefined;
    if (!body?.definition) return reply.code(400).send({ error: "definition required" });
    const { scanMApp } = await import("./mapp-security-scanner.js");
    return reply.send(scanMApp(body.definition));
  });

  fastify.post("/api/mapps/install", async (request, reply) => {
    const body = request.body as { definition?: unknown; approved?: boolean } | undefined;
    if (!body?.definition) return reply.code(400).send({ error: "definition required" });
    if (!body.approved) return reply.code(400).send({ error: "Must approve permissions before installing" });

    // Scan first
    const { scanMApp } = await import("./mapp-security-scanner.js");
    const scanResult = scanMApp(body.definition);
    if (!scanResult.safe) {
      return reply.code(400).send({ error: "MApp failed security scan", scan: scanResult });
    }

    // Parse and install
    const { MAppDefinitionSchema } = await import("@agi/config");
    const parsed = MAppDefinitionSchema.safeParse(body.definition);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid MApp definition", issues: parsed.error.issues });
    }

    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join: joinPath } = await import("node:path");
    const { homedir: getHome } = await import("node:os");
    const installDir = joinPath(getHome(), ".agi", "mapps", parsed.data.author);
    mkdirSync(installDir, { recursive: true });
    const installPath = joinPath(installDir, `${parsed.data.id}.json`);
    writeFileSync(installPath, JSON.stringify(parsed.data, null, 2) + "\n", "utf-8");

    // Register in live registry
    if (deps.mappRegistry) {
      deps.mappRegistry.register(parsed.data as import("@agi/sdk").MAppDefinition);
    }

    return reply.send({ ok: true, id: parsed.data.id, path: installPath, scan: scanResult });
  });

  // POST /api/mapps/execute — execute a MApp form submission
  fastify.post("/api/mapps/execute", async (request, reply) => {
    const body = request.body as { mappId?: string; instanceId?: string; values?: Record<string, unknown>; projectPath?: string } | undefined;
    if (!body?.mappId || !body?.values) return reply.code(400).send({ error: "mappId and values required" });

    if (!deps.mappRegistry) return reply.code(500).send({ error: "MApp registry not available" });
    const def = deps.mappRegistry.get(body.mappId);
    if (!def) return reply.code(404).send({ error: `MApp "${body.mappId}" not found` });

    const { executeMApp } = await import("./mapp-executor.js");
    const result = await executeMApp(def, {
      mappId: body.mappId,
      instanceId: body.instanceId ?? "",
      projectPath: body.projectPath ?? "",
      values: body.values,
    });
    return reply.send(result);
  });

  // POST /api/mapps/workflow/run — run a named workflow from a MApp
  fastify.post("/api/mapps/workflow/run", async (request, reply) => {
    const body = request.body as {
      mappId?: string;
      workflowId?: string;
      context?: Record<string, unknown>;
    } | undefined;

    if (!body?.mappId || !body?.workflowId) {
      return reply.code(400).send({ error: "mappId and workflowId required" });
    }

    if (!deps.mappRegistry) return reply.code(500).send({ error: "MApp registry not available" });
    const def = deps.mappRegistry.get(body.mappId);
    if (!def) return reply.code(404).send({ error: `MApp "${body.mappId}" not found` });

    const { runWorkflow } = await import("./mapp-executor.js");
    const result = await runWorkflow(
      def,
      body.workflowId,
      body.context ?? {},
      deps.inferenceGateway,
    );
    return reply.send(result);
  });

  // GET /api/mapps/:id/model-status — check model dependency status for a MApp
  fastify.get<{ Params: { id: string } }>("/api/mapps/:id/model-status", async (request, reply) => {
    const { id } = request.params;
    if (!deps.mappRegistry) return reply.code(500).send({ error: "MApp registry not available" });
    const def = deps.mappRegistry.get(id);
    if (!def) return reply.code(404).send({ error: `MApp "${id}" not found` });

    const dependencies = def.modelDependencies ?? [];
    const statuses = await Promise.all(dependencies.map(async (dep) => {
      const model = await deps.modelStore?.getById(dep.modelId);
      return {
        modelId: dep.modelId,
        label: dep.label,
        required: dep.required ?? false,
        pipelineTag: dep.pipelineTag,
        installed: !!model,
        running: model?.status === "running",
        status: model?.status ?? "not-installed",
      };
    }));

    const allRequiredRunning = statuses
      .filter((s) => s.required)
      .every((s) => s.running);

    return reply.send({
      mappId: id,
      modelDependencies: statuses,
      ready: allRequiredRunning,
    });
  });

  // MApp instance state persistence
  if (deps.magicAppStateStore) {
    const store = deps.magicAppStateStore;

    // GET /api/magic-apps/instances — list open instances for current user
    fastify.get("/api/magic-apps/instances", async (_request, reply) => {
      // TODO: derive userEntityId from auth session; for now use owner
      const userId = deps.ownerEntityId ?? "#E0";
      return reply.send({ instances: await store.listInstances(userId) });
    });

    // POST /api/magic-apps/instances — open a new instance (requires projectPath)
    fastify.post("/api/magic-apps/instances", async (request, reply) => {
      const body = request.body as { appId?: string; mode?: string; projectPath?: string } | undefined;
      if (!body?.appId) return reply.code(400).send({ error: "appId required" });
      if (!body?.projectPath) return reply.code(400).send({ error: "projectPath required — MagicApps are project-anchored" });
      const userId = deps.ownerEntityId ?? "#E0";
      const instanceId = `${body.appId}-${Date.now().toString(36)}`;
      const instance = store.createInstance({
        instanceId,
        appId: body.appId,
        userEntityId: userId,
        projectPath: body.projectPath,
        mode: (body.mode as "floating" | "docked" | "minimized") ?? "floating",
      });
      return reply.send({ instance });
    });

    // PUT /api/magic-apps/instances/:id/state — save instance state
    fastify.put("/api/magic-apps/instances/:id/state", async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { state?: Record<string, unknown> } | undefined;
      if (!body?.state) return reply.code(400).send({ error: "state required" });
      store.updateState(id, body.state);
      return reply.send({ ok: true });
    });

    // PUT /api/magic-apps/instances/:id/mode — change mode
    fastify.put("/api/magic-apps/instances/:id/mode", async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { mode?: string } | undefined;
      if (!body?.mode) return reply.code(400).send({ error: "mode required" });
      store.updateMode(id, body.mode as "floating" | "docked" | "minimized");
      return reply.send({ ok: true });
    });

    // DELETE /api/magic-apps/instances/:id — close and destroy
    fastify.delete("/api/magic-apps/instances/:id", async (request, reply) => {
      const { id } = request.params as { id: string };
      store.deleteInstance(id);
      return reply.send({ ok: true });
    });
  }

  // -----------------------------------------------------------------------
  // PUT /api/projects/viewer — set the Content Viewer MApp for a project
  // -----------------------------------------------------------------------

  fastify.put("/api/projects/viewer", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }

    const body = request.body as { path?: string; viewer?: string | null } | undefined;
    if (!body?.path || typeof body.path !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }

    const resolved = resolvePath(body.path);
    const metaPath = projectConfigPath(resolved);
    if (!existsSync(metaPath)) {
      return reply.code(404).send({ error: "Project config not found" });
    }

    try {
      const raw = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
      const hosting = (raw.hosting ?? {}) as Record<string, unknown>;
      if (body.viewer) {
        hosting.viewer = body.viewer;
      } else {
        delete hosting.viewer;
      }
      raw.hosting = hosting;
      writeFileSync(metaPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
      return reply.send({ ok: true, viewer: body.viewer ?? null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: msg });
    }
  });

  // -----------------------------------------------------------------------
  // PUT /api/projects/magic-apps — attach a MApp to a project
  // -----------------------------------------------------------------------

  fastify.put("/api/projects/magic-apps", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }

    const body = request.body as { path?: string; appId?: string } | undefined;
    if (!body?.path || typeof body.path !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }
    if (!body.appId || typeof body.appId !== "string") {
      return reply.code(400).send({ error: "appId is required" });
    }

    const resolved = resolvePath(body.path);
    const metaPath = projectConfigPath(resolved);
    if (!existsSync(metaPath)) {
      return reply.code(404).send({ error: "Project config not found" });
    }

    try {
      const raw = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
      const existing = Array.isArray(raw.magicApps) ? (raw.magicApps as string[]) : [];
      if (!existing.includes(body.appId)) {
        existing.push(body.appId);
      }
      raw.magicApps = existing;
      writeFileSync(metaPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
      return reply.send({ ok: true, magicApps: existing });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: msg });
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /api/projects/magic-apps — detach a MApp from a project
  // -----------------------------------------------------------------------

  fastify.delete("/api/projects/magic-apps", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Projects API only allowed from private network" });
    }

    const body = request.body as { path?: string; appId?: string } | undefined;
    if (!body?.path || typeof body.path !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }
    if (!body.appId || typeof body.appId !== "string") {
      return reply.code(400).send({ error: "appId is required" });
    }

    const resolved = resolvePath(body.path);
    const metaPath = projectConfigPath(resolved);
    if (!existsSync(metaPath)) {
      return reply.code(404).send({ error: "Project config not found" });
    }

    try {
      const raw = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
      const existing = Array.isArray(raw.magicApps) ? (raw.magicApps as string[]) : [];
      const updated = existing.filter((id) => id !== body.appId);
      raw.magicApps = updated;
      writeFileSync(metaPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
      return reply.send({ ok: true, magicApps: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: msg });
    }
  });

  // -----------------------------------------------------------------------
  // MApp Marketplace — browse, install, and manage MApp sources
  // -----------------------------------------------------------------------

  if (deps.mappMarketplaceManager) {
    const mappMp = deps.mappMarketplaceManager;

    // Source management
    fastify.get("/api/mapp-marketplace/sources", async (_request, reply) => {
      return reply.send(mappMp.getSources());
    });

    fastify.post("/api/mapp-marketplace/sources", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "MApp Marketplace API only allowed from private network" });
      const body = request.body as { ref?: string; name?: string };
      if (!body.ref) return reply.code(400).send({ error: "ref is required (e.g. 'owner/repo')" });
      const source = mappMp.addSource(body.ref, body.name);
      return reply.send(source);
    });

    fastify.delete<{ Params: { id: string } }>("/api/mapp-marketplace/sources/:id", async (request, reply) => {
      mappMp.removeSource(Number(request.params.id));
      return reply.send({ ok: true });
    });

    fastify.post<{ Params: { id: string } }>("/api/mapp-marketplace/sources/:id/sync", async (request, reply) => {
      const result = await mappMp.syncSource(Number(request.params.id));
      if (!result.ok) return reply.code(400).send(result);
      return reply.send(result);
    });

    // Catalog
    fastify.get("/api/mapp-marketplace/catalog", async (_request, reply) => {
      const catalog = await mappMp.getCatalogWithInstalled();
      // Wrap in { apps } for backward compatibility with dashboard
      // s145 t598: include `name` from the catalog row when present so
      // dashboard cards show "Admin Editor" rather than the humanize-id
      // fallback. Older catalog rows have name=null; dashboard's
      // humanize-fallback (cycle 176) covers those.
      return reply.send({ apps: catalog.map((entry) => ({
        definition: { id: entry.id, name: entry.name, author: entry.author, description: entry.description, category: entry.category, version: entry.version, source: entry.sourcePath },
        source: entry.sourcePath,
        installed: entry.installed,
        sourceId: entry.sourceId,
      })) });
    });

    // Install
    fastify.post("/api/mapp-marketplace/install", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "MApp Marketplace API only allowed from private network" });
      const body = request.body as { appId?: string; sourceId?: number } | undefined;
      if (!body?.appId || body.sourceId === undefined) {
        return reply.code(400).send({ error: "appId and sourceId are required" });
      }

      const result = await mappMp.install(body.appId, body.sourceId);
      if (!result.ok) return reply.code(400).send(result);

      // Register in live registry
      const { MAppDefinitionSchema } = await import("@agi/config");
      const catalog = await mappMp.getCatalogWithInstalled();
      const entry = catalog.find((e) => e.id === body.appId);
      if (entry && deps.mappRegistry) {
        const mappsDir = join(homedir(), ".agi", "mapps");
        const filePath = join(mappsDir, entry.author, `${body.appId}.json`);
        try {
          const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
          const parsed = MAppDefinitionSchema.safeParse(raw);
          if (parsed.success) {
            deps.mappRegistry.register(parsed.data as import("@agi/sdk").MAppDefinition);
          }
        } catch { /* non-fatal */ }
      }

      return reply.send({ ok: true, id: body.appId });
    });

    // Uninstall
    fastify.delete<{ Params: { id: string } }>("/api/mapp-marketplace/installed/:id", async (request, reply) => {
      const clientIp = getClientIp(request.raw);
      if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "MApp Marketplace API only allowed from private network" });
      const { id } = request.params;
      const def = deps.mappRegistry?.get(id);
      if (!def) return reply.code(404).send({ error: `MApp "${id}" is not installed` });
      mappMp.uninstall(id, def.author);
      deps.mappRegistry?.unregister(id);
      return reply.send({ ok: true });
    });

    // Pull — sync all sources + update installed MApps
    fastify.post("/api/mapp-marketplace/pull", async (_request, reply) => {
      const clientIp = getClientIp(_request.raw);
      if (!isPrivateNetwork(clientIp)) return reply.code(403).send({ error: "MApp Marketplace API only allowed from private network" });
      const result = await mappMp.syncAndUpdateAll();

      // Re-register updated MApps in live registry
      if (deps.mappRegistry && result.updated.length > 0) {
        const { MAppDefinitionSchema } = await import("@agi/config");
        const mappsDir = join(homedir(), ".agi", "mapps");
        for (const appId of result.updated) {
          const catalog = await mappMp.getCatalogWithInstalled();
          const entry = catalog.find((e) => e.id === appId);
          if (!entry) continue;
          try {
            const raw = JSON.parse(readFileSync(join(mappsDir, entry.author, `${appId}.json`), "utf-8")) as Record<string, unknown>;
            const parsed = MAppDefinitionSchema.safeParse(raw);
            if (parsed.success) deps.mappRegistry.register(parsed.data as import("@agi/sdk").MAppDefinition);
          } catch { /* non-fatal */ }
        }
      }

      log.info(`mapp-marketplace pull: synced=${String(result.synced)}, updated=${result.updated.length}`);
      return reply.send({ ok: true, ...result });
    });
  }

  // -----------------------------------------------------------------------
  // Pre-listen hooks — register additional routes before the server starts
  // -----------------------------------------------------------------------

  if (deps.preListenHooks) {
    for (const hook of deps.preListenHooks) {
      hook(fastify);
    }
  }

  // -----------------------------------------------------------------------
  // Start Fastify and attach WebSocket server
  // -----------------------------------------------------------------------

  await fastify.listen({ port: opts.port, host: opts.host });

  const httpServer = fastify.server as HttpServer;

  const wsServer = new GatewayWebSocketServer({ server: httpServer, logger: deps.logger, auth });
  await wsServer.start();

  return { httpServer, wsServer, fastify };
}
