/**
 * Dashboard API Client — HTTP fetch wrappers for the dashboard backend.
 */

import type {
  WorkerJobSummary,
  BreakdownDimension,
  BreakdownSlice,
  COAExplorerEntry,
  CommsLogEntry,
  DashboardOverview,
  EntityImpactProfile,
  GitAction,
  GitActionResult,
  LeaderboardEntry,
  AionimaConfig,
  Notification,
  OnboardingState,
  Plan,
  ProjectGitInfo,
  ProjectInfo,
  ReportDetail,
  ReportSummary,
  TimeBucket,
  TimelineBucket,
  UpdateCheck,
  ScanProvider,
  ScanRun,
  SecurityFinding,
  SecuritySummary,
} from "./types.js";

// ---------------------------------------------------------------------------
// Base fetch
// ---------------------------------------------------------------------------

const BASE_URL = "/api/dashboard";

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  if (params !== undefined) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

export async function fetchOverview(windowDays = 90): Promise<DashboardOverview> {
  return get<DashboardOverview>("/overview", { windowDays: String(windowDays) });
}

export async function fetchTimeline(
  bucket: TimeBucket = "day",
  entityId?: string,
  since?: string,
  until?: string,
): Promise<{ buckets: TimelineBucket[]; bucket: TimeBucket; since: string; until: string }> {
  return get("/timeline", {
    bucket,
    entityId: entityId ?? "",
    since: since ?? "",
    until: until ?? "",
  });
}

export async function fetchBreakdown(
  by: BreakdownDimension = "domain",
  entityId?: string,
  since?: string,
  until?: string,
): Promise<{ dimension: BreakdownDimension; slices: BreakdownSlice[]; total: number }> {
  return get("/breakdown", {
    by,
    entityId: entityId ?? "",
    since: since ?? "",
    until: until ?? "",
  });
}

export async function fetchLeaderboard(
  windowDays = 90,
  limit = 25,
  offset = 0,
): Promise<{ entries: LeaderboardEntry[]; windowDays: number; total: number; computedAt: string }> {
  return get("/leaderboard", {
    windowDays: String(windowDays),
    limit: String(limit),
    offset: String(offset),
  });
}

export async function fetchEntityProfile(entityId: string, windowDays = 90): Promise<EntityImpactProfile> {
  return get<EntityImpactProfile>(`/entity/${entityId}`, { windowDays: String(windowDays) });
}

export async function fetchCOAEntries(params: {
  entityId?: string;
  fingerprint?: string;
  workType?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}): Promise<{ entries: COAExplorerEntry[]; total: number; hasMore: boolean }> {
  return get("/coa", {
    entityId: params.entityId ?? "",
    fingerprint: params.fingerprint ?? "",
    workType: params.workType ?? "",
    since: params.since ?? "",
    until: params.until ?? "",
    limit: String(params.limit ?? 50),
    offset: String(params.offset ?? 0),
  });
}

// ---------------------------------------------------------------------------
// Projects API — /api/projects
// ---------------------------------------------------------------------------

export async function fetchProjects(): Promise<ProjectInfo[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<ProjectInfo[]>;
}

export async function createProject(params: {
  name: string;
  tynnToken?: string;
  repoRemote?: string;
  category?: string;
  type?: string;
  stacks?: string[];
}): Promise<{ ok: boolean; name: string; slug: string; path: string; cloned: boolean; stacks?: string[] }> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; name: string; slug: string; path: string; cloned: boolean; stacks?: string[] }>;
}

export async function updateProject(params: {
  path: string;
  name?: string;
  tynnToken?: string | null;
  category?: string;
}): Promise<{ ok: boolean }> {
  const res = await fetch("/api/projects", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function deleteProject(params: { path: string; confirm: boolean }): Promise<{ ok: boolean }> {
  const res = await fetch("/api/projects", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function execGitAction<T extends GitActionResult = GitActionResult>(
  path: string,
  action: GitAction,
  params?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("/api/projects/git", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, action, ...params }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchProjectInfo(path: string): Promise<ProjectGitInfo> {
  const url = new URL("/api/projects/info", window.location.origin);
  url.searchParams.set("path", path);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<ProjectGitInfo>;
}

// ---------------------------------------------------------------------------
// Plans API — /api/plans
// ---------------------------------------------------------------------------

export async function fetchPlans(projectPath: string): Promise<Plan[]> {
  const url = new URL("/api/plans", window.location.origin);
  url.searchParams.set("projectPath", projectPath);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<Plan[]>;
}

export async function fetchPlan(planId: string, projectPath: string): Promise<Plan> {
  const url = new URL(`/api/plans/${planId}`, window.location.origin);
  url.searchParams.set("projectPath", projectPath);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<Plan>;
}

export async function approvePlan(planId: string, projectPath: string): Promise<Plan> {
  const res = await fetch(`/api/plans/${planId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath, status: "approved" }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<Plan>;
}

export async function updatePlanStatus(planId: string, projectPath: string, status: string): Promise<Plan> {
  const res = await fetch(`/api/plans/${planId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath, status }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<Plan>;
}

// ---------------------------------------------------------------------------
// System API — /api/system
// ---------------------------------------------------------------------------

export interface SystemStats {
  cpu: { loadAvg: [number, number, number]; cores: number; usage: number };
  memory: { total: number; free: number; used: number; percent: number };
  disk: { total: number; used: number; free: number; percent: number };
  diskIO: { readBytesPerSec: number; writeBytesPerSec: number };
  uptime: number;
  hostname: string;
}

export async function fetchSystemStats(): Promise<SystemStats> {
  const res = await fetch("/api/system/stats");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<SystemStats>;
}

export interface StatsHistoryPoint {
  ts: string;
  cpu: number;
  mem: number;
  disk: number;
  diskRead: number;
  diskWrite: number;
  load1: number;
  load5: number;
  load15: number;
}

export async function fetchStatsHistory(hours = 1): Promise<StatsHistoryPoint[]> {
  const res = await fetch(`/api/system/stats/history?hours=${String(hours)}`);
  if (!res.ok) return [];
  const data = await res.json() as { history: StatsHistoryPoint[] };
  return data.history;
}

export async function checkForUpdates(): Promise<UpdateCheck> {
  const res = await fetch("/api/system/update-check");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<UpdateCheck>;
}

export async function startUpgrade(): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/api/system/upgrade", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; message: string }>;
}

export async function fetchUpgradeLog(): Promise<{ phase: string; message: string; step?: string; status?: string; timestamp: string }[]> {
  const res = await fetch("/api/system/upgrade-log");
  if (!res.ok) return [];
  return res.json() as Promise<{ phase: string; message: string; step?: string; status?: string; timestamp: string }[]>;
}

export interface ChangelogCommit {
  hash: string;
  fullHash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  files: string[];
  summary?: string;
}

export async function fetchChangelog(count = 50, offset = 0): Promise<{ commits: ChangelogCommit[]; total: number }> {
  const res = await fetch(`/api/system/changelog?count=${count}&offset=${offset}`);
  if (!res.ok) return { commits: [], total: 0 };
  return res.json() as Promise<{ commits: ChangelogCommit[]; total: number }>;
}

// ---------------------------------------------------------------------------
// System connections — /api/system/connections
// ---------------------------------------------------------------------------

export async function fetchConnectionStatus(): Promise<import("./types.js").ConnectionStatus> {
  const res = await fetch("/api/system/connections");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<import("./types.js").ConnectionStatus>;
}

// ---------------------------------------------------------------------------
// PRIME API — /api/prime
// ---------------------------------------------------------------------------

export async function fetchPrimeStatus(): Promise<import("./types.js").PrimeStatus> {
  const res = await fetch("/api/prime/status");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<import("./types.js").PrimeStatus>;
}

export async function switchPrimeSource(source: string, branch?: string): Promise<{ ok: boolean; entries: number }> {
  const res = await fetch("/api/prime/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, branch }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; entries: number }>;
}

// ---------------------------------------------------------------------------
// Contributing Mode API — /api/dev
// ---------------------------------------------------------------------------

function getDashboardToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem("aionima-dashboard-token");
}

export async function fetchDevStatus(): Promise<import("./types.js").DevStatus> {
  const token = getDashboardToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch("/api/dev/status", { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<import("./types.js").DevStatus>;
}

export async function switchDevMode(enabled: boolean): Promise<{ ok: boolean; agi: string; prime: string; bots: string }> {
  const token = getDashboardToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch("/api/dev/switch", {
    method: "POST",
    headers,
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; agi: string; prime: string; bots: string }>;
}

// ---------------------------------------------------------------------------
// Config API (outside dashboard prefix — /api/config)
// ---------------------------------------------------------------------------

export async function fetchConfig(): Promise<AionimaConfig> {
  const res = await fetch("/api/config");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<AionimaConfig>;
}

export async function saveConfig(config: AionimaConfig): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; message: string }>;
}

// ---------------------------------------------------------------------------
// Models API — /api/models?provider=...
// ---------------------------------------------------------------------------

export interface ModelEntry {
  id: string;
  name: string;
}

export async function fetchModels(provider: string): Promise<ModelEntry[]> {
  const url = new URL("/api/models", window.location.origin);
  url.searchParams.set("provider", provider);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { provider: string; models: ModelEntry[] };
  return data.models;
}

// ---------------------------------------------------------------------------
// Work Queue API — /api/taskmaster
// ---------------------------------------------------------------------------

export async function fetchTaskmasterJobs(): Promise<WorkerJobSummary[]> {
  const res = await fetch("/api/taskmaster/jobs");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<WorkerJobSummary[]>;
}

export async function approveTaskmasterJob(jobId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/taskmaster/approve/${jobId}`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function rejectTaskmasterJob(jobId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/taskmaster/reject/${jobId}`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Hosting API — /api/hosting
// ---------------------------------------------------------------------------

export interface HostingStatus {
  ready: boolean;
  baseDomain?: string;
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
    containerName?: string;
    image?: string;
    error?: string;
  }[];
}

export async function fetchHostingStatus(): Promise<HostingStatus> {
  const res = await fetch("/api/hosting/status");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<HostingStatus>;
}

export async function runHostingSetup(): Promise<{ ok: boolean; output: string }> {
  const res = await fetch("/api/hosting/setup", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; output: string }>;
}

export async function enableHosting(params: {
  path: string;
  type?: string;
  hostname?: string;
  docRoot?: string;
  startCommand?: string;
  mode?: "production" | "development";
  internalPort?: number;
}): Promise<{ ok: boolean; hosting: unknown }> {
  const res = await fetch("/api/hosting/enable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; hosting: unknown }>;
}

export async function disableHosting(path: string): Promise<{ ok: boolean }> {
  const res = await fetch("/api/hosting/disable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function configureHosting(params: {
  path: string;
  type?: string;
  hostname?: string;
  docRoot?: string;
  startCommand?: string;
  mode?: "production" | "development";
  internalPort?: number;
  runtimeId?: string;
}): Promise<{ ok: boolean; hosting: unknown }> {
  const res = await fetch("/api/hosting/configure", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; hosting: unknown }>;
}

export async function setProjectViewer(path: string, viewer: string | null): Promise<{ ok: boolean }> {
  const res = await fetch("/api/projects/viewer", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, viewer }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function attachMagicApp(path: string, appId: string): Promise<{ ok: boolean; magicApps: string[] }> {
  const res = await fetch("/api/projects/magic-apps", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, appId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; magicApps: string[] }>;
}

export async function detachMagicApp(path: string, appId: string): Promise<{ ok: boolean; magicApps: string[] }> {
  const res = await fetch("/api/projects/magic-apps", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, appId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; magicApps: string[] }>;
}

export async function fetchMAppCatalog(): Promise<{ apps: import("./types.js").MAppCatalogEntry[] }> {
  const res = await fetch("/api/mapp-marketplace/catalog");
  if (!res.ok) return { apps: [] };
  return res.json() as Promise<{ apps: import("./types.js").MAppCatalogEntry[] }>;
}

export async function installMApp(appId: string, sourceId: number): Promise<{ ok: boolean }> {
  const res = await fetch("/api/mapp-marketplace/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, sourceId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function uninstallMApp(appId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/mapp-marketplace/installed/${encodeURIComponent(appId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// MApp Marketplace source management

export async function fetchMAppSources(): Promise<Array<{ id: number; ref: string; name: string; lastSyncedAt: string | null; mappCount: number }>> {
  const res = await fetch("/api/mapp-marketplace/sources");
  if (!res.ok) return [];
  return res.json() as Promise<Array<{ id: number; ref: string; name: string; lastSyncedAt: string | null; mappCount: number }>>;
}

export async function addMAppSource(ref: string, name?: string): Promise<{ id: number; ref: string; name: string }> {
  const res = await fetch("/api/mapp-marketplace/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref, name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ id: number; ref: string; name: string }>;
}

export async function removeMAppSource(id: number): Promise<void> {
  await fetch(`/api/mapp-marketplace/sources/${id}`, { method: "DELETE" });
}

export async function pullMAppMarketplace(): Promise<{ ok: boolean; synced: number; updated: string[]; errors: string[] }> {
  const res = await fetch("/api/mapp-marketplace/pull", { method: "POST" });
  if (!res.ok) return { ok: false, synced: 0, updated: [], errors: ["Pull failed"] };
  return res.json() as Promise<{ ok: boolean; synced: number; updated: string[]; errors: string[] }>;
}

export async function restartHosting(path: string): Promise<{ ok: boolean; hosting: unknown }> {
  const res = await fetch("/api/hosting/restart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; hosting: unknown }>;
}

export async function enableTunnel(path: string): Promise<{ ok: boolean; tunnelUrl?: string }> {
  const res = await fetch("/api/hosting/tunnel/enable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; tunnelUrl?: string }>;
}

export async function disableTunnel(path: string): Promise<{ ok: boolean }> {
  const res = await fetch("/api/hosting/tunnel/disable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Cloudflared management
// ---------------------------------------------------------------------------

export interface CloudflaredStatus {
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
}

export async function fetchCloudflaredStatus(): Promise<CloudflaredStatus> {
  const res = await fetch("/api/hosting/cloudflared/status");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<CloudflaredStatus>;
}

export async function startCloudflaredLogin(): Promise<{ ok: boolean; loginUrl: string }> {
  const res = await fetch("/api/hosting/cloudflared/login", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; loginUrl: string }>;
}

export async function cloudflaredLogout(): Promise<{ success: boolean; error?: string }> {
  const res = await fetch("/api/hosting/cloudflared/logout", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ success: boolean; error?: string }>;
}

export async function fetchContainerLogs(path: string, tail = 100, source?: string): Promise<{ logs: string }> {
  const url = new URL("/api/hosting/logs", window.location.origin);
  url.searchParams.set("path", path);
  url.searchParams.set("tail", String(tail));
  if (source) url.searchParams.set("source", source);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ logs: string }>;
}

export async function fetchLogSources(path: string): Promise<import("./types.js").LogSourceDefinition[]> {
  const url = new URL("/api/hosting/log-sources", window.location.origin);
  url.searchParams.set("path", path);
  const res = await fetch(url.toString());
  if (!res.ok) return [{ id: "container", label: "Container Output", type: "container" }];
  const data = await res.json() as { sources: import("./types.js").LogSourceDefinition[] };
  return data.sources;
}

export async function fetchProjectEnv(path: string): Promise<Record<string, string>> {
  const url = new URL("/api/hosting/env", window.location.origin);
  url.searchParams.set("path", path);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { vars: Record<string, string> };
  return data.vars;
}

export async function saveProjectEnv(path: string, vars: Record<string, string>): Promise<{ ok: boolean }> {
  const res = await fetch("/api/hosting/env", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, vars }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function fetchProjectTypes(): Promise<{ types: import("./types.js").ProjectTypeInfo[] }> {
  const res = await fetch("/api/hosting/project-types");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ types: import("./types.js").ProjectTypeInfo[] }>;
}

export async function executeProjectTool(
  projectPath: string,
  toolId: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const res = await fetch(`/api/hosting/tools/${encodeURIComponent(toolId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: projectPath }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; output?: string; error?: string }>;
}

// ---------------------------------------------------------------------------
// File Editor API
// ---------------------------------------------------------------------------

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
  ext?: string;
}

export async function fetchFile(path: string): Promise<{ content: string; size: number }> {
  const url = new URL("/api/files/read", window.location.origin);
  url.searchParams.set("path", path);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ content: string; size: number }>;
}

export async function saveFile(path: string, content: string): Promise<{ ok: boolean }> {
  const res = await fetch("/api/files/write", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function fetchFileTree(root?: string): Promise<FileNode[]> {
  const url = new URL("/api/files/tree", window.location.origin);
  if (root) url.searchParams.set("root", root);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { tree: FileNode[] };
  return data.tree;
}

export async function fetchDocsTree(): Promise<FileNode[]> {
  return fetchFileTree("docs");
}

// ---------------------------------------------------------------------------
// Project File API — /api/files/project-*
// ---------------------------------------------------------------------------

export async function fetchProjectFileTree(root: string, showHidden = true): Promise<FileNode[]> {
  const url = new URL("/api/files/project-tree", window.location.origin);
  url.searchParams.set("root", root);
  if (!showHidden) url.searchParams.set("hideHidden", "true");
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { tree: FileNode[] };
  return data.tree;
}

export async function fetchProjectFile(path: string): Promise<{ content: string; size: number }> {
  const url = new URL("/api/files/project-read", window.location.origin);
  url.searchParams.set("path", path);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ content: string; size: number }>;
}

export async function saveProjectFile(path: string, content: string): Promise<{ ok: boolean }> {
  const res = await fetch("/api/files/project-write", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Notifications API — /api/notifications
// ---------------------------------------------------------------------------

export async function fetchNotifications(opts?: {
  limit?: number;
  unreadOnly?: boolean;
}): Promise<{ notifications: Notification[]; unreadCount: number }> {
  const url = new URL("/api/notifications", window.location.origin);
  if (opts?.limit !== undefined) url.searchParams.set("limit", String(opts.limit));
  if (opts?.unreadOnly) url.searchParams.set("unreadOnly", "true");
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ notifications: Notification[]; unreadCount: number }>;
}

export async function markNotificationsRead(ids: string[]): Promise<{ ok: boolean }> {
  const res = await fetch("/api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  const res = await fetch("/api/notifications/read-all", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Chat History API — /api/chat
// ---------------------------------------------------------------------------

export interface ChatSessionSummary {
  id: string;
  context: string;
  contextLabel: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastPreview: string;
}

export interface PersistedChatSession {
  id: string;
  context: string;
  contextLabel: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    timestamp: string;
    runId?: string;
    images?: string[];
    toolCards?: Array<Record<string, unknown>>;
    toolCard?: Record<string, unknown>;
  }>;
  lastPreview: string;
}

export async function fetchChatSessions(): Promise<ChatSessionSummary[]> {
  const res = await fetch("/api/chat/sessions");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { sessions: ChatSessionSummary[] };
  return data.sessions;
}

export async function fetchChatSession(id: string): Promise<PersistedChatSession> {
  const res = await fetch(`/api/chat/sessions/${id}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<PersistedChatSession>;
}

export async function deleteChatSession(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Comms Log API — /api/comms
// ---------------------------------------------------------------------------

export async function fetchCommsLog(opts?: {
  channel?: string;
  direction?: string;
  limit?: number;
  offset?: number;
}): Promise<{ entries: CommsLogEntry[]; total: number }> {
  const url = new URL("/api/comms", window.location.origin);
  if (opts?.channel) url.searchParams.set("channel", opts.channel);
  if (opts?.direction) url.searchParams.set("direction", opts.direction);
  if (opts?.limit !== undefined) url.searchParams.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) url.searchParams.set("offset", String(opts.offset));
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ entries: CommsLogEntry[]; total: number }>;
}

// ---------------------------------------------------------------------------
// Channels API — /api/channels
// ---------------------------------------------------------------------------

export async function fetchChannelDetail(id: string): Promise<import("./types.js").ChannelDetail> {
  const res = await fetch(`/api/channels/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<import("./types.js").ChannelDetail>;
}

export async function startChannel(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/channels/${encodeURIComponent(id)}/start`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function stopChannel(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/channels/${encodeURIComponent(id)}/stop`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function restartChannel(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/channels/${encodeURIComponent(id)}/restart`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Plugins API — /api/plugins
// ---------------------------------------------------------------------------

export async function fetchPlugins(): Promise<import("./types.js").PluginInfo[]> {
  const res = await fetch("/api/plugins");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { plugins: import("./types.js").PluginInfo[] };
  return data.plugins;
}

// ---------------------------------------------------------------------------
// Services API — /api/services
// ---------------------------------------------------------------------------

export async function fetchServices(): Promise<import("./types.js").ServiceInfo[]> {
  const res = await fetch("/api/services");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { services: import("./types.js").ServiceInfo[] };
  return data.services;
}

export async function startService(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/services/${encodeURIComponent(id)}/start`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function stopService(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/services/${encodeURIComponent(id)}/stop`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function restartService(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/services/${encodeURIComponent(id)}/restart`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Runtimes API — /api/runtimes
// ---------------------------------------------------------------------------

export async function fetchRuntimes(projectType?: string): Promise<import("./types.js").RuntimeInfo[]> {
  const url = projectType
    ? `/api/runtimes/${encodeURIComponent(projectType)}`
    : "/api/runtimes";
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { runtimes: import("./types.js").RuntimeInfo[] };
  return data.runtimes;
}

export async function fetchInstalledRuntimes(): Promise<Record<string, string[]>> {
  const res = await fetch("/api/runtimes/installed");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { installed: Record<string, string[]> };
  return data.installed;
}

export async function installRuntime(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/runtimes/${encodeURIComponent(id)}/install`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function uninstallRuntime(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/runtimes/${encodeURIComponent(id)}/uninstall`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Hosting Extensions API — /api/hosting-extensions
// ---------------------------------------------------------------------------

export async function fetchHostingExtensions(projectType: string): Promise<import("./types.js").HostingExtensionField[]> {
  const res = await fetch(`/api/hosting-extensions/${encodeURIComponent(projectType)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { fields: import("./types.js").HostingExtensionField[] };
  return data.fields;
}

// ---------------------------------------------------------------------------
// Database connection info — routed through db-portal plugin namespace
// ---------------------------------------------------------------------------

export interface DbConnectionInfo {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  url: string;
}

export async function fetchDbConnectionInfo(engine: string): Promise<DbConnectionInfo> {
  const res = await fetch(`/api/plugins/db-portal/${encodeURIComponent(engine)}/connection-info`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<DbConnectionInfo>;
}

// ---------------------------------------------------------------------------
// Stack API — /api/stacks, /api/hosting/stacks, /api/shared-containers
// ---------------------------------------------------------------------------

export async function fetchStacks(category?: string): Promise<import("./types.js").StackInfo[]> {
  const params = category ? `?category=${encodeURIComponent(category)}` : "";
  const res = await fetch(`/api/stacks${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error("Stack API unavailable");
  }
  const data = await res.json() as { stacks: import("./types.js").StackInfo[] };
  return data.stacks;
}

export async function fetchProjectStacks(path: string): Promise<import("./types.js").ProjectStackInstance[]> {
  const res = await fetch(`/api/hosting/stacks?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { stacks: import("./types.js").ProjectStackInstance[] };
  return data.stacks;
}

export async function addStack(path: string, stackId: string): Promise<import("./types.js").ProjectStackInstance> {
  const res = await fetch("/api/hosting/stacks/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, stackId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { ok: boolean; stack: import("./types.js").ProjectStackInstance };
  return data.stack;
}

export async function runStackAction(
  path: string,
  stackId: string,
  actionId: string,
): Promise<{ actionId: string; ok: boolean; output?: string; error?: string }> {
  const res = await fetch("/api/hosting/stacks/run-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, stackId, actionId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ actionId: string; ok: boolean; output?: string; error?: string }>;
}

export async function fetchProjectDevCommands(path: string): Promise<Record<string, string>> {
  const res = await fetch(`/api/hosting/stacks/dev-commands?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { commands: Record<string, string> };
  return data.commands;
}

export async function removeStack(path: string, stackId: string): Promise<void> {
  const res = await fetch("/api/hosting/stacks/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, stackId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function fetchSharedContainers(): Promise<import("./types.js").SharedContainerInfo[]> {
  const res = await fetch("/api/shared-containers");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { containers: import("./types.js").SharedContainerInfo[] };
  return data.containers;
}

export async function fetchSharedContainerConnection(sharedKey: string, projectPath: string): Promise<import("./types.js").DbConnectionInfo> {
  const res = await fetch(`/api/shared-containers/${encodeURIComponent(sharedKey)}/connection?project=${encodeURIComponent(projectPath)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<import("./types.js").DbConnectionInfo>;
}

// ---------------------------------------------------------------------------
// Dashboard Auth API — /api/auth/*, /api/admin/users
// ---------------------------------------------------------------------------

export async function fetchAuthStatus(): Promise<import("./types.js").AuthStatus> {
  const res = await fetch("/api/auth/status");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<import("./types.js").AuthStatus>;
}

export async function loginDashboard(username: string, password: string): Promise<{
  ok: boolean;
  token: string;
  user: import("./types.js").DashboardUserInfo;
}> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; token: string; user: import("./types.js").DashboardUserInfo }>;
}

export interface IdLoginResult {
  status: "completed" | "pending";
  /** Present when status is "completed" — instant login (LAN auto-approved). */
  token?: string;
  user?: { userId: string; entityId: string; displayName: string; coaAlias: string; geid: string };
  /** Present when status is "pending" — popup flow needed (off-LAN). */
  handoffId?: string;
  authUrl?: string;
}

export async function startIdLogin(): Promise<IdLoginResult> {
  const res = await fetch("/api/auth/login-via-id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<IdLoginResult>;
}

export async function pollIdLogin(handoffId: string): Promise<{
  status: "pending" | "completed" | "expired" | "not_found";
  token?: string;
  user?: { userId: string; entityId: string; displayName: string; coaAlias: string; geid: string };
}> {
  const res = await fetch(`/api/auth/login-via-id/poll?handoffId=${encodeURIComponent(handoffId)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{
    status: "pending" | "completed" | "expired" | "not_found";
    token?: string;
    user?: { userId: string; entityId: string; displayName: string; coaAlias: string; geid: string };
  }>;
}

export async function fetchCurrentUser(token: string): Promise<{
  user: import("./types.js").DashboardUserInfo;
  session: { role: string; expiresAt: number };
}> {
  const res = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ user: import("./types.js").DashboardUserInfo; session: { role: string; expiresAt: number } }>;
}

export async function logoutDashboard(): Promise<void> {
  const token = localStorage.getItem("aionima-dashboard-token");
  if (token) {
    // Best-effort server call — logout works even if this fails
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  localStorage.removeItem("aionima-dashboard-token");
}

export async function fetchDashboardUsers(token: string): Promise<import("./types.js").DashboardUserInfo[]> {
  const res = await fetch("/api/admin/users", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { users: import("./types.js").DashboardUserInfo[] };
  return data.users;
}

export async function createDashboardUser(token: string, params: {
  username: string;
  displayName?: string;
  password: string;
  role?: import("./types.js").DashboardRole;
}): Promise<{ ok: boolean; user: import("./types.js").DashboardUserInfo }> {
  const res = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; user: import("./types.js").DashboardUserInfo }>;
}

export async function updateDashboardUser(token: string, id: string, params: {
  displayName?: string;
  role?: import("./types.js").DashboardRole;
  disabled?: boolean;
}): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function deleteDashboardUser(token: string, id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function resetDashboardUserPassword(token: string, id: string, password: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Machine Admin API — /api/machine/*
// ---------------------------------------------------------------------------

export interface MachineNetworkInfo {
  supported: boolean;
  platform?: string;
  reason?: string;
  connection?: string;
  interface?: string;
  ip?: string;
  subnet?: string;
  gateway?: string;
  method?: "static" | "dhcp";
}

export async function fetchMachineNetwork(): Promise<MachineNetworkInfo> {
  const res = await fetch("/api/machine/network");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<MachineNetworkInfo>;
}

export async function setMachineNetwork(params: {
  method: "static" | "dhcp";
  ip?: string;
  subnet?: string;
  gateway?: string;
}): Promise<{ ok: boolean; error?: string; method?: string; newIp?: string }> {
  const res = await fetch("/api/machine/network", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json() as { ok: boolean; error?: string; method?: string; newIp?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export async function fetchMachineInfo(): Promise<import("./types.js").MachineInfo> {
  const res = await fetch("/api/machine/info");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<import("./types.js").MachineInfo>;
}

export async function setMachineHostname(hostname: string): Promise<{ ok: boolean; hostname: string }> {
  const res = await fetch("/api/machine/hostname", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostname }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; hostname: string }>;
}

export async function fetchLinuxUsers(): Promise<import("./types.js").LinuxUser[]> {
  const res = await fetch("/api/machine/users");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { users: import("./types.js").LinuxUser[] };
  return data.users;
}

export async function createLinuxUser(params: {
  username: string;
  password?: string;
  shell?: string;
  addToSudo?: boolean;
  sshPublicKey?: string;
}): Promise<{ ok: boolean; username: string }> {
  const res = await fetch("/api/machine/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; username: string }>;
}

export async function updateLinuxUser(username: string, params: {
  shell?: string;
  addToSudo?: boolean;
  removeFromSudo?: boolean;
  locked?: boolean;
}): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/machine/users/${encodeURIComponent(username)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function deleteLinuxUser(username: string, removeHome = false): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/machine/users/${encodeURIComponent(username)}?removeHome=${removeHome}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function fetchSSHKeys(username: string): Promise<import("./types.js").SSHKey[]> {
  const res = await fetch(`/api/machine/users/${encodeURIComponent(username)}/ssh-keys`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { keys: import("./types.js").SSHKey[] };
  return data.keys;
}

export async function addSSHKey(username: string, key: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/machine/users/${encodeURIComponent(username)}/ssh-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function removeSSHKey(username: string, index: number): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/machine/users/${encodeURIComponent(username)}/ssh-keys/${index}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Agent API — /api/agents
// ---------------------------------------------------------------------------

export async function fetchAgents(): Promise<import("./types.js").AgentStatus[]> {
  const res = await fetch("/api/agents");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { agents: import("./types.js").AgentStatus[] };
  return data.agents;
}

export async function restartAgent(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/agents/${encodeURIComponent(id)}/restart`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Samba Shares API — /api/samba/*
// ---------------------------------------------------------------------------

export async function fetchSambaShares(): Promise<import("./types.js").SambaShare[]> {
  const res = await fetch("/api/samba/shares");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { shares: import("./types.js").SambaShare[] };
  return data.shares;
}

export async function enableSambaShare(name: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/samba/shares/${encodeURIComponent(name)}/enable`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function disableSambaShare(name: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/samba/shares/${encodeURIComponent(name)}/disable`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Plugin extensibility API — /api/dashboard/plugin-*
// ---------------------------------------------------------------------------

export async function fetchPluginActions(scope?: string, projectType?: string): Promise<import("./types.js").PluginAction[]> {
  const params: Record<string, string> = {};
  if (scope) params.scope = scope;
  if (projectType) params.projectType = projectType;
  return get<import("./types.js").PluginAction[]>("/plugin-actions", params);
}

export async function fetchPluginPanels(projectType?: string): Promise<import("./types.js").PluginPanel[]> {
  const params: Record<string, string> = {};
  if (projectType) params.projectType = projectType;
  return get<import("./types.js").PluginPanel[]>("/plugin-panels", params);
}

export async function executeAction(actionId: string, context?: Record<string, string>): Promise<{ ok: boolean; output?: string; error?: string }> {
  const res = await fetch(`/api/dashboard/action/${encodeURIComponent(actionId)}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(context ?? {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; output?: string; error?: string }>;
}

export async function fetchPluginSettings(): Promise<import("./types.js").PluginSettingsSection[]> {
  return get<import("./types.js").PluginSettingsSection[]>("/plugin-settings");
}

export async function fetchPluginSidebar(): Promise<import("./types.js").PluginSidebarSection[]> {
  return get<import("./types.js").PluginSidebarSection[]>("/plugin-sidebar");
}

export async function fetchPluginThemes(): Promise<import("./types.js").PluginTheme[]> {
  return get<import("./types.js").PluginTheme[]>("/plugin-themes");
}

export async function fetchPluginSystemServices(): Promise<import("./types.js").PluginSystemService[]> {
  return get<import("./types.js").PluginSystemService[]>("/plugin-system-services");
}

export async function controlSystemService(serviceId: string, action: "start" | "stop" | "restart" | "install"): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/dashboard/system-services/${encodeURIComponent(serviceId)}/${action}`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

export async function fetchPluginScheduledTasks(): Promise<import("./types.js").PluginScheduledTask[]> {
  return get<import("./types.js").PluginScheduledTask[]>("/plugin-scheduled-tasks");
}

export async function controlScheduledTask(taskId: string, action: "enable" | "disable" | "run-now"): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/dashboard/scheduled-tasks/${encodeURIComponent(taskId)}/${action}`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

export async function fetchPluginSettingsPages(): Promise<import("./types.js").PluginSettingsPage[]> {
  return get<import("./types.js").PluginSettingsPage[]>("/plugin-settings-pages");
}

export async function fetchPluginDashboardPages(domain?: string): Promise<import("./types.js").PluginDashboardPage[]> {
  return get<import("./types.js").PluginDashboardPage[]>("/plugin-pages", domain ? { domain } : undefined);
}

export async function fetchPluginDashboardDomains(): Promise<import("./types.js").PluginDashboardDomain[]> {
  return get<import("./types.js").PluginDashboardDomain[]>("/plugin-domains");
}

// ---------------------------------------------------------------------------
// Marketplace API
// ---------------------------------------------------------------------------

export async function fetchPluginMarketplaceSources(): Promise<import("./types.js").PluginMarketplaceSource[]> {
  const res = await fetch("/api/marketplace/sources");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<import("./types.js").PluginMarketplaceSource[]>;
}

export async function addPluginMarketplaceSource(ref: string, name?: string): Promise<import("./types.js").PluginMarketplaceSource> {
  const res = await fetch("/api/marketplace/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref, name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<import("./types.js").PluginMarketplaceSource>;
}

export async function removePluginMarketplaceSource(id: number): Promise<void> {
  const res = await fetch(`/api/marketplace/sources/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function syncPluginMarketplaceSource(id: number): Promise<{ ok: boolean; pluginCount?: number; error?: string }> {
  const res = await fetch(`/api/marketplace/sources/${id}/sync`, { method: "POST" });
  return res.json() as Promise<{ ok: boolean; pluginCount?: number; error?: string }>;
}

export async function searchPluginMarketplaceCatalog(params?: { q?: string; type?: string; category?: string; provides?: string }): Promise<import("./types.js").PluginMarketplaceCatalogItem[]> {
  const url = new URL("/api/marketplace/catalog", window.location.origin);
  if (params?.q) url.searchParams.set("q", params.q);
  if (params?.type) url.searchParams.set("type", params.type);
  if (params?.category) url.searchParams.set("category", params.category);
  if (params?.provides) url.searchParams.set("provides", params.provides);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<import("./types.js").PluginMarketplaceCatalogItem[]>;
}

export async function installFromPluginMarketplace(pluginName: string, sourceId: number): Promise<{ ok: boolean; error?: string; autoInstalled?: string[] }> {
  const res = await fetch("/api/marketplace/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pluginName, sourceId }),
  });
  const data = await res.json() as { ok: boolean; error?: string; autoInstalled?: string[] };
  if (!res.ok || !data.ok) throw new Error(data.error ?? `Install failed (${res.status})`);
  return data;
}

export interface CleanupResource {
  id: string;
  type: string;
  label: string;
  removeCommand: string;
  shared?: boolean;
}

export async function fetchUninstallPreview(pluginName: string): Promise<{ resources: CleanupResource[] }> {
  const res = await fetch(`/api/marketplace/uninstall-preview/${encodeURIComponent(pluginName)}`);
  if (!res.ok) return { resources: [] };
  return res.json() as Promise<{ resources: CleanupResource[] }>;
}

export async function uninstallFromPluginMarketplace(
  pluginName: string,
  cleanupIds?: string[],
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/marketplace/installed/${encodeURIComponent(pluginName)}`, {
    method: "DELETE",
    headers: cleanupIds ? { "Content-Type": "application/json" } : undefined,
    body: cleanupIds ? JSON.stringify({ cleanupIds }) : undefined,
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

export async function fetchPluginMarketplaceInstalled(): Promise<import("./types.js").PluginMarketplaceInstalledItem[]> {
  const res = await fetch("/api/marketplace/installed");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<import("./types.js").PluginMarketplaceInstalledItem[]>;
}

export async function fetchPluginMarketplaceUpdates(): Promise<import("./types.js").PluginMarketplaceUpdate[]> {
  const res = await fetch("/api/marketplace/updates");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<import("./types.js").PluginMarketplaceUpdate[]>;
}

export async function updateFromPluginMarketplace(
  pluginName: string,
  sourceId?: number,
): Promise<{ ok: boolean; error?: string; oldVersion?: string; newVersion?: string }> {
  const res = await fetch(`/api/marketplace/update/${encodeURIComponent(pluginName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId }),
  });
  const data = await res.json() as { ok: boolean; error?: string; oldVersion?: string; newVersion?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export async function pullPluginMarketplace(): Promise<{ ok: boolean; catalogSynced: number; updated: string[]; reloaded: string[]; errors: string[] }> {
  const res = await fetch("/api/marketplace/pull", { method: "POST" });
  const data = await res.json() as { ok: boolean; catalogSynced: number; updated: string[]; reloaded: string[]; errors: string[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export async function fetchPluginDetails(id: string): Promise<import("./types.js").PluginDetails> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(id)}/details`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<import("./types.js").PluginDetails>;
}

export async function updatePluginEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; requiresRestart: boolean }> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; requiresRestart: boolean }>;
}

// ---------------------------------------------------------------------------
// RustDesk API — routed through plugin-rustdesk namespace
// ---------------------------------------------------------------------------

export async function fetchRustDeskConnectionInfo(): Promise<import("./types.js").RustDeskConnectionInfo> {
  const res = await fetch("/api/plugins/plugin-rustdesk/connection-info");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<import("./types.js").RustDeskConnectionInfo>;
}

export async function fetchRustDeskLogs(service: string, lines = 100): Promise<{ logs: string }> {
  const res = await fetch(`/api/plugins/plugin-rustdesk/logs/${encodeURIComponent(service)}?lines=${lines}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ logs: string }>;
}

export async function setRustDeskPassword(password: string): Promise<{ ok: boolean }> {
  const res = await fetch("/api/plugins/plugin-rustdesk/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Onboarding API
// ---------------------------------------------------------------------------

export async function fetchOnboardingState(): Promise<OnboardingState> {
  const res = await fetch("/api/onboarding/state");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<OnboardingState>;
}

export async function updateOnboardingState(
  patch: Partial<OnboardingState> & { steps?: Partial<OnboardingState["steps"]> },
): Promise<OnboardingState> {
  const res = await fetch("/api/onboarding/state", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<OnboardingState>;
}

export async function resetOnboarding(): Promise<{ ok: boolean }> {
  const res = await fetch("/api/onboarding/reset", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function testAiKeys(
  keys: { anthropic?: string; openai?: string },
): Promise<{ ok: boolean; validated: { anthropic: boolean; openai: boolean } }> {
  const res = await fetch("/api/onboarding/ai-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(keys),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; validated: { anthropic: boolean; openai: boolean } }>;
}

export async function fetchOAuthUrl(
  target: "owner" | "agent",
  provider: "google" | "github",
): Promise<{ url: string }> {
  const res = await fetch(`/api/onboarding/oauth/${target}/${provider}/url`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ url: string }>;
}

export async function chatZeroMe(
  domain: "MIND" | "SOUL" | "SKILL",
  messages: Array<{ role: string; content: string }>,
): Promise<{ response: string }> {
  const res = await fetch("/api/onboarding/zero-me/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain, messages }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ response: string }>;
}

export async function saveZeroMe(
  domain: string,
  content: string,
): Promise<{ ok: boolean }> {
  const res = await fetch("/api/onboarding/zero-me/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain, content }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function fetchReports(params?: {
  project?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}): Promise<{ reports: ReportSummary[]; total: number }> {
  const qp: Record<string, string> = {};
  if (params?.project) qp.project = params.project;
  if (params?.since) qp.since = params.since;
  if (params?.until) qp.until = params.until;
  if (params?.limit !== undefined) qp.limit = String(params.limit);
  if (params?.offset !== undefined) qp.offset = String(params.offset);
  return get<{ reports: ReportSummary[]; total: number }>("/reports", qp);
}

export async function fetchReport(coaReqId: string): Promise<ReportDetail> {
  return get<ReportDetail>(`/reports/${encodeURIComponent(coaReqId)}`);
}

// ---------------------------------------------------------------------------
// Usage API
// ---------------------------------------------------------------------------

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  invocationCount: number;
}

export interface ProjectCost {
  projectPath: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  invocationCount: number;
}

export interface UsageHistoryPoint {
  period: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  count: number;
}

export async function fetchUsageSummary(days = 30): Promise<UsageSummary> {
  const res = await fetch(`/api/usage/summary?days=${String(days)}`);
  if (!res.ok) return { totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, invocationCount: 0 };
  return res.json() as Promise<UsageSummary>;
}

export async function fetchUsageByProject(days = 30): Promise<ProjectCost[]> {
  const res = await fetch(`/api/usage/by-project?days=${String(days)}`);
  if (!res.ok) return [];
  const data = await res.json() as { projects: ProjectCost[] };
  return data.projects;
}

export async function fetchUsageHistory(days = 30): Promise<UsageHistoryPoint[]> {
  const res = await fetch(`/api/usage/history?days=${String(days)}`);
  if (!res.ok) return [];
  const data = await res.json() as { history: UsageHistoryPoint[] };
  return data.history;
}

// ---------------------------------------------------------------------------
// Compliance API
// ---------------------------------------------------------------------------

export async function fetchIncidents(limit = 50): Promise<unknown[]> {
  const res = await fetch(`/api/compliance/incidents?limit=${String(limit)}`);
  if (!res.ok) return [];
  const data = await res.json() as { incidents: unknown[] };
  return data.incidents;
}

export async function createIncident(params: { severity: string; title: string; description?: string }): Promise<unknown> {
  const res = await fetch("/api/compliance/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json() as { incident: unknown };
  return data.incident;
}

export async function updateIncidentStatus(id: string, status: string): Promise<void> {
  await fetch(`/api/compliance/incidents/${encodeURIComponent(id)}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function updateIncidentBreach(id: string, classification: string): Promise<void> {
  await fetch(`/api/compliance/incidents/${encodeURIComponent(id)}/breach`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ classification }),
  });
}

export async function fetchVendors(): Promise<unknown[]> {
  const res = await fetch("/api/compliance/vendors");
  if (!res.ok) return [];
  const data = await res.json() as { vendors: unknown[] };
  return data.vendors;
}

export async function upsertVendor(params: { name: string; type: string; description?: string }): Promise<unknown> {
  const res = await fetch("/api/compliance/vendors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json() as { vendor: unknown };
  return data.vendor;
}

export async function updateVendorDpa(id: string, signed: boolean): Promise<void> {
  await fetch(`/api/compliance/vendors/${encodeURIComponent(id)}/dpa`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signed }),
  });
}

export async function updateVendorBaa(id: string, signed: boolean): Promise<void> {
  await fetch(`/api/compliance/vendors/${encodeURIComponent(id)}/baa`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signed }),
  });
}

export async function updateVendorCompliance(id: string, status: string): Promise<void> {
  await fetch(`/api/compliance/vendors/${encodeURIComponent(id)}/compliance`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function fetchBackups(): Promise<{ name: string; size: number; created: string }[]> {
  const res = await fetch("/api/compliance/backups");
  if (!res.ok) return [];
  const data = await res.json() as { backups: { name: string; size: number; created: string }[] };
  return data.backups;
}

export async function triggerBackup(): Promise<{ ok: boolean; files: string[] }> {
  const res = await fetch("/api/compliance/backups", { method: "POST" });
  return res.json() as Promise<{ ok: boolean; files: string[] }>;
}

// ---------------------------------------------------------------------------
// Security API
// ---------------------------------------------------------------------------

export async function fetchSecurityProviders(): Promise<ScanProvider[]> {
  const res = await fetch("/api/security/providers");
  if (!res.ok) throw new Error("Failed to fetch security providers");
  return res.json() as Promise<ScanProvider[]>;
}

export async function fetchSecurityScans(projectPath?: string): Promise<ScanRun[]> {
  const params = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : "";
  const res = await fetch(`/api/security/scans${params}`);
  if (!res.ok) throw new Error("Failed to fetch security scans");
  return res.json() as Promise<ScanRun[]>;
}

export async function fetchSecurityScan(scanId: string): Promise<ScanRun> {
  const res = await fetch(`/api/security/scans/${scanId}`);
  if (!res.ok) throw new Error("Failed to fetch scan");
  return res.json() as Promise<ScanRun>;
}

export async function fetchSecurityFindings(opts?: { severity?: string; scanType?: string; status?: string; projectPath?: string }): Promise<SecurityFinding[]> {
  const params = new URLSearchParams();
  if (opts?.severity) params.set("severity", opts.severity);
  if (opts?.scanType) params.set("scanType", opts.scanType);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.projectPath) params.set("projectPath", opts.projectPath);
  const qs = params.toString();
  const res = await fetch(`/api/security/findings${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch findings");
  return res.json() as Promise<SecurityFinding[]>;
}

export async function fetchScanFindings(scanId: string): Promise<SecurityFinding[]> {
  const res = await fetch(`/api/security/scans/${scanId}/findings`);
  if (!res.ok) throw new Error("Failed to fetch scan findings");
  return res.json() as Promise<SecurityFinding[]>;
}

export async function triggerSecurityScan(config: { scanTypes: string[]; targetPath: string; projectId?: string }): Promise<{ scanId: string }> {
  const res = await fetch("/api/security/scans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error("Failed to trigger scan");
  return res.json() as Promise<{ scanId: string }>;
}

export async function updateFindingStatus(findingId: string, status: string): Promise<void> {
  const res = await fetch(`/api/security/findings/${findingId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update finding status");
}

export async function fetchSecuritySummary(projectPath?: string): Promise<SecuritySummary> {
  const params = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : "";
  const res = await fetch(`/api/security/summary${params}`);
  if (!res.ok) throw new Error("Failed to fetch security summary");
  return res.json() as Promise<SecuritySummary>;
}

// ---------------------------------------------------------------------------
// MagicApps API
// ---------------------------------------------------------------------------

export async function fetchMagicApps(): Promise<import("./types.js").MagicAppInfo[]> {
  const res = await fetch("/api/dashboard/magic-apps");
  if (!res.ok) throw new Error("Failed to fetch MagicApps");
  const data = await res.json() as { apps: import("./types.js").MagicAppInfo[] };
  return data.apps;
}

export async function fetchMagicApp(id: string): Promise<import("./types.js").MagicAppInfo> {
  const res = await fetch(`/api/dashboard/magic-apps/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Failed to fetch MagicApp");
  const data = await res.json() as { app: import("./types.js").MagicAppInfo };
  return data.app;
}

export async function fetchMagicAppInstances(): Promise<import("./types.js").MagicAppInstance[]> {
  const res = await fetch("/api/magic-apps/instances");
  if (!res.ok) throw new Error("Failed to fetch instances");
  const data = await res.json() as { instances: import("./types.js").MagicAppInstance[] };
  return data.instances;
}

export async function openMagicAppInstance(appId: string, projectPath: string, mode?: string): Promise<import("./types.js").MagicAppInstance> {
  const res = await fetch("/api/magic-apps/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, projectPath, mode }),
  });
  if (!res.ok) throw new Error("Failed to open instance");
  const data = await res.json() as { instance: import("./types.js").MagicAppInstance };
  return data.instance;
}

export async function saveMagicAppState(instanceId: string, state: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/magic-apps/instances/${encodeURIComponent(instanceId)}/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) throw new Error("Failed to save state");
}

export async function changeMagicAppMode(instanceId: string, mode: string): Promise<void> {
  const res = await fetch(`/api/magic-apps/instances/${encodeURIComponent(instanceId)}/mode`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error("Failed to change mode");
}

export async function closeMagicAppInstance(instanceId: string): Promise<void> {
  const res = await fetch(`/api/magic-apps/instances/${encodeURIComponent(instanceId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to close instance");
}
