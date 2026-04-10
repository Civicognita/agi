/**
 * Client-side type re-exports from gateway-core dashboard types.
 * Duplicated here to avoid importing server-side modules in the browser bundle.
 */

export type TimeBucket = "hour" | "day" | "week" | "month";
export type ImpactDomain = "governance" | "community" | "innovation" | "operations" | "knowledge" | "technology";
export type BreakdownDimension = "domain" | "channel" | "workType";

export interface ActivityEntry {
  id: string;
  entityId: string;
  entityName: string;
  channel: string | null;
  workType: string | null;
  impScore: number;
  createdAt: string;
}

export interface DashboardOverview {
  totalImp: number;
  windowImp: number;
  entityCount: number;
  interactionCount: number;
  avgImpPerInteraction: number;
  topChannel: string | null;
  recentActivity: ActivityEntry[];
  computedAt: string;
}

export interface TimelineBucket {
  bucketStart: string;
  totalImp: number;
  positiveImp: number;
  negativeImp: number;
  interactionCount: number;
}

export interface BreakdownSlice {
  key: string;
  totalImp: number;
  count: number;
  percentage: number;
}

export interface LeaderboardEntry {
  entityId: string;
  entityName: string;
  verificationTier: string;
  totalImp: number;
  windowImp: number;
  currentBonus: number;
  rank: number;
}

export interface EntityImpactProfile {
  entityId: string;
  entityName: string;
  entityType: string;
  verificationTier: string;
  coaAlias: string;
  lifetimeImp: number;
  windowImp: number;
  currentBonus: number;
  distinctEventTypes: number;
  domainBreakdown: BreakdownSlice[];
  channelBreakdown: BreakdownSlice[];
  recentActivity: ActivityEntry[];
  skillsAuthored: number;
  recognitionsReceived: number;
  publicFields: string[];
}

export interface COAExplorerEntry {
  fingerprint: string;
  resourceId: string;
  entityId: string;
  entityName: string;
  nodeId: string;
  chainCounter: number;
  workType: string;
  ref: string | null;
  action: string | null;
  payloadHash: string | null;
  createdAt: string;
  impScore: number | null;
}

export interface UpdateCheck {
  updateAvailable: boolean;
  localCommit: string;
  remoteCommit: string;
  behindCount: number;
  commits: { hash: string; message: string }[];
  channel?: "main" | "dev";
  serviceUpdates?: Array<{ name: string; behind: number }>;
}

export interface SystemUpgradeEvent {
  phase: string;
  message: string;
  timestamp: string;
  /** Raw deploy step from upgrade.sh (e.g. "pull-agi", "build", "restart"). */
  step?: string;
  /** Step status from upgrade.sh (e.g. "start", "ok", "skip", "fail"). */
  status?: string;
}

/** Hosting infrastructure status from WebSocket. */
export interface HostingStatusData {
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
    tunnelUrl?: string | null;
    containerName?: string;
    image?: string;
    error?: string;
  }[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  metadata: unknown;
  read: boolean;
  createdAt: string;
}

export interface CommsLogEntry {
  id: string;
  channel: string;
  direction: "inbound" | "outbound";
  senderId: string;
  senderName: string | null;
  subject: string | null;
  preview: string;
  createdAt: string;
}

export interface WorkerJobUpdate {
  jobId: string;
  status: "pending" | "running" | "checkpoint" | "complete" | "failed";
  description: string;
  currentPhase: string | null;
  workers: string[];
}

export interface WorkerReportReady {
  jobId: string;
  coaReqId: string;
  fileCount: number;
  gist: string;
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export interface ReportSummary {
  coaReqId: string;
  gist: string;
  fileCount: number;
  project: { path: string; name: string } | null;
  workers: string[];
  totalTokens: number;
  costEstimate: number;
  durationMs: number;
  createdAt: string;
}

export interface ReportFile {
  filename: string;
  content: string;
}

export interface BurnData {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  durationMs: number;
  workers: BurnWorkerEntry[];
}

export interface BurnWorkerEntry {
  worker: string;
  workerTid: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolLoops: number;
  durationMs: number;
}

export interface ReportDetail {
  coaReqId: string;
  gist: string;
  project: { path: string; name: string } | null;
  workers: string[];
  createdAt: string;
  files: ReportFile[];
  burn: BurnData;
}

/** Project config change event — fired when any field in project.json changes. */
export interface ProjectConfigChangedData {
  projectPath: string;
  changedKeys: string[];
}

/** Container status change event — individual project level. */
export interface ContainerStatusChangedData {
  projectPath: string;
  hostname: string;
  status: "running" | "stopped" | "error" | "unconfigured";
  containerName?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// MagicApps
// ---------------------------------------------------------------------------

export interface MagicAppInfo {
  $schema?: string;
  id: string;
  name: string;
  author?: string;
  description: string;
  version: string;
  icon?: string;
  category: string;
  projectTypes?: string[];
  projectCategories?: string[];
  permissions?: Array<{ id: string; reason: string; required: boolean }>;
  container?: Record<string, unknown>;
  panel?: { label: string; widgets: Array<Record<string, unknown>>; position?: number };
  pages?: Array<Record<string, unknown>>;
  constants?: Array<Record<string, unknown>>;
  output?: Record<string, unknown>;
  prompts?: Array<Record<string, unknown>>;
  workflows?: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  /** Whether this MApp supports docking to the left panel (default: true). */
  dockable?: boolean;
  // Legacy serialized fields (backward compat)
  hasContainer?: boolean;
  panelLabel?: string;
  agentPromptCount?: number;
  workflowCount?: number;
  toolCount?: number;
  pluginId?: string;
}

export interface MAppCatalogEntry {
  definition: MagicAppInfo;
  source: string;
  installed: boolean;
}

export interface MagicAppInstance {
  instanceId: string;
  appId: string;
  userEntityId: string;
  projectPath: string;
  mode: "floating" | "docked" | "minimized" | "maximized";
  state: Record<string, unknown>;
  position: { x: number; y: number; width: number; height: number } | null;
  openedAt: string;
  updatedAt: string;
}

export type DashboardEvent =
  | { type: "impact:recorded"; data: ActivityEntry }
  | { type: "entity:verified"; data: { entityId: string; tier: string } }
  | { type: "coa:created"; data: COAExplorerEntry }
  | { type: "overview:updated"; data: DashboardOverview }
  | { type: "project:activity"; data: ProjectActivity }
  | { type: "system:upgrade"; data: SystemUpgradeEvent }
  | { type: "system:update_available"; data: UpdateCheck }
  | { type: "hosting:status"; data: HostingStatusData }
  | { type: "project:config_changed"; data: ProjectConfigChangedData }
  | { type: "project:container_status"; data: ContainerStatusChangedData }
  | { type: "tm:job_update"; data: WorkerJobUpdate }
  | { type: "tm:report_ready"; data: WorkerReportReady }
  | { type: "notification:new"; data: Notification }
  | { type: "config:changed"; data: { changedKeys: string[]; timestamp: string } };

/** Structured log entry streamed from the gateway. */
export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  component: string;
  message: string;
}

/** Hosting configuration for a project. */
export interface ProjectHostingInfo {
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
  /** MagicApp ID used as the content viewer for this project's *.ai.on URL. */
  viewer?: string;
}

/** Tool definition from project type registry. */
export interface ProjectTypeTool {
  id: string;
  label: string;
  description: string;
  action: "shell" | "api" | "ui";
  command?: string;
  endpoint?: string;
}

export interface LogSourceDefinition {
  id: string;
  label: string;
  type: "container" | "container-file";
  containerPath?: string;
}

/** Project type definition from registry. */
export interface ProjectTypeInfo {
  id: string;
  label: string;
  category: "literature" | "app" | "web" | "media" | "administration" | "ops" | "monorepo";
  hostable: boolean;
  /** Whether this project type contains code (vs. content like literature/media). */
  hasCode: boolean;
  tools: ProjectTypeTool[];
  logSources?: LogSourceDefinition[];
}

/** A workspace project entry returned by GET /api/projects. */
export interface ProjectInfo {
  name: string;
  path: string;
  hasGit: boolean;
  tynnToken: string | null;
  hosting: ProjectHostingInfo;
  detectedHosting?: {
    projectType: string;
    suggestedStacks: string[];
    docRoot: string;
    startCommand: string | null;
  };
  projectType?: ProjectTypeInfo;
  category?: string;
  description?: string;
  magicApps?: string[];
}

/** Git info for a workspace project, returned by GET /api/projects/info. */
export interface ProjectGitInfo {
  path: string;
  branch: string | null;
  remote: string | null;
  status: "clean" | "dirty" | null;
  commits: { hash: string; message: string }[];
}

/** Theme mode for the dashboard. */
export type ThemeMode = "light" | "dark";

// ---------------------------------------------------------------------------
// Git action types — POST /api/projects/git
// ---------------------------------------------------------------------------

export type GitAction =
  | "status" | "fetch" | "pull" | "push"
  | "stage" | "unstage" | "commit"
  | "log" | "diff"
  | "stash_list" | "stash_save" | "stash_pop" | "stash_drop"
  | "branch_list" | "branch_create" | "branch_checkout" | "branch_delete"
  | "remote_list" | "remote_add" | "remote_remove"
  | "init" | "clone";

export interface GitActionRequest {
  path: string;
  action: GitAction;
  [key: string]: unknown;
}

export interface GitActionResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface GitFileEntry {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied";
}

export interface GitStatusResult extends GitActionResult {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: string[];
}

export interface GitCommitEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitBranchEntry {
  name: string;
  upstream: string | null;
  current: boolean;
}

export interface GitStashEntry {
  index: number;
  message: string;
}

export interface GitRemoteEntry {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

// ---------------------------------------------------------------------------
// Config types — mirror of aionima.json structure
// ---------------------------------------------------------------------------

export interface ChannelConfig {
  id: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface OwnerChannels {
  telegram?: string;
  discord?: string;
  signal?: string;
  whatsapp?: string;
  email?: string;
}

export interface OwnerConfig {
  displayName: string;
  channels: OwnerChannels;
  dmPolicy: "pairing" | "open";
}

export interface GatewayConfig {
  host: string;
  port: number;
  state: "ONLINE" | "LIMBO" | "OFFLINE" | "UNKNOWN";
  updateChannel?: "main" | "dev";
}

export interface WorkerModelOverride {
  provider: "anthropic" | "openai" | "ollama";
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ProviderCredential {
  apiKey?: string;
  baseUrl?: string;
}

export interface WorkerConfig {
  workerModels?: Record<string, WorkerModelOverride>;
}

export interface AionimaConfig {
  gateway?: GatewayConfig;
  channels: ChannelConfig[];
  entities?: { path: string };
  owner?: OwnerConfig;
  agent?: {
    resourceId?: string;
    nodeId?: string;
    provider?: string;
    model?: string;
    maxTokens?: number;
    replyMode?: string;
    devMode?: boolean;
  };
  providers?: Record<string, ProviderCredential>;
  workers?: WorkerConfig;
  dev?: { enabled?: boolean; agiRepo?: string; primeRepo?: string };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

export type PlanStatus = "draft" | "reviewing" | "approved" | "executing" | "testing" | "complete" | "failed";
export type PlanStepType = "plan" | "implement" | "test" | "review" | "deploy";
export type PlanStepStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export interface PlanStep {
  id: string;
  title: string;
  type: PlanStepType;
  status: PlanStepStatus;
  dependsOn?: string[];
}

export interface PlanTynnRefs {
  versionId: string | null;
  storyIds: string[];
  taskIds: string[];
}

export interface Plan {
  id: string;
  title: string;
  status: PlanStatus;
  projectPath: string;
  chatSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  tynnRefs: PlanTynnRefs;
  steps: PlanStep[];
  body: string;
}

/** Project activity event from WebSocket. */
export interface ProjectActivity {
  projectPath: string;
  type: "invocation_start" | "invocation_complete" | "tool_used" | "plan_updated" | "tynn_synced";
  summary: string;
  timestamp: string;
}

/** Plugin info from GET /api/plugins. */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string | null;
  permissions: string[];
  category: string;
  provides?: string[];
  active: boolean;
  enabled: boolean;
  bakedIn: boolean;
  disableable: boolean;
}

/** Infrastructure service info from GET /api/services. */
export interface ServiceInfo {
  id: string;
  name: string;
  description: string;
  image: string;
  status: "running" | "stopped" | "error";
  port: number | null;
  enabled: boolean;
}

/** Runtime dependency bundled with a runtime (e.g. npm for Node). */
export interface RuntimeDependencyInfo {
  name: string;
  version: string;
  type: "bundled" | "managed";
}

/** Runtime info from GET /api/runtimes. */
export interface RuntimeInfo {
  id: string;
  label: string;
  language: string;
  version: string;
  containerImage: string;
  projectTypes: string[];
  dependencies?: RuntimeDependencyInfo[];
  installed?: boolean;
  installable?: boolean;
}

// ---------------------------------------------------------------------------
// Stack types
// ---------------------------------------------------------------------------

export interface StackInstallAction {
  id: string;
  label: string;
  description?: string;
  command: string;
  optional?: boolean;
}

export interface StackDevCommands {
  dev?: string;
  build?: string;
  test?: string;
  lint?: string;
  start?: string;
  [key: string]: string | undefined;
}

export interface StackInfo {
  id: string;
  label: string;
  description: string;
  category: "runtime" | "database" | "tooling" | "framework" | "workflow";
  projectCategories: string[];
  requirements: { id: string; label: string; type: "provided" | "expected" }[];
  guides: { title: string; content: string }[];
  hasContainer: boolean;
  hasDatabase: boolean;
  hasScaffolding: boolean;
  installActions?: StackInstallAction[];
  devCommands?: StackDevCommands;
  tools: ProjectTypeTool[];
  icon?: string;
}

export interface ProjectStackInstance {
  stackId: string;
  databaseName?: string;
  databaseUser?: string;
  databasePassword?: string;
  addedAt: string;
}

export interface SharedContainerInfo {
  sharedKey: string;
  containerName: string;
  port: number;
  status: "running" | "stopped" | "error";
  projectCount: number;
}

export interface DbConnectionInfo {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  url: string;
}

/** Hosting extension field from GET /api/hosting-extensions. */
export interface HostingExtensionField {
  id: string;
  label: string;
  type: "select" | "text" | "number";
  options?: { value: string; label: string }[];
  defaultValue?: string;
}

/** Work queue job summary. */
export interface WorkerJobSummary {
  id: string;
  description: string;
  status: "pending" | "running" | "checkpoint" | "complete" | "failed";
  currentPhase: string | null;
  workers: string[];
  gate: "auto" | "checkpoint" | "terminal";
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Machine Admin types
// ---------------------------------------------------------------------------

export interface MachineInfo {
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  distro: string;
  ip: string;
  cpuModel: string;
  totalMemoryGB: number;
}

export interface LinuxUser {
  username: string;
  uid: number;
  gid: number;
  gecos: string;
  home: string;
  shell: string;
  groups: string[];
  sudo: boolean;
  hasSSHKeys: boolean;
  locked: boolean;
}

export interface SSHKey {
  index: number;
  type: string;
  key: string;
  comment: string;
}

export interface AgentStatus {
  id: string;
  name: string;
  type: "gateway" | "worker" | "external";
  status: "running" | "stopped" | "error" | "unknown";
  uptime: number | null;
  pid: number | null;
  memoryMB: number | null;
  channels: string[];
  lastActivity: string | null;
}

// ---------------------------------------------------------------------------
// Dashboard Auth types
// ---------------------------------------------------------------------------

export type DashboardRole = "admin" | "operator" | "viewer";

export interface DashboardUserInfo {
  id: string;
  username: string;
  displayName: string;
  role: DashboardRole;
  createdAt: string;
  lastLoginAt: string | null;
  disabled: boolean;
}

export interface AuthStatus {
  enabled: boolean;
  hasUsers: boolean;
  userCount: number;
  provider?: "local-id" | "internal";
}

/** PRIME corpus source status from GET /api/prime/status. */
export interface PrimeStatus {
  source: string;
  branch: string;
  entries: number;
  dir: string;
}

/** Contributing mode status from GET /api/dev/status. */
export interface DevStatus {
  enabled: boolean;
  githubAuthenticated: boolean;
  agi: { remote: string };
  prime: { remote: string; branch: string; entries: number };
  bots?: { remote: string; branch: string };
  id?: { remote: string; branch: string };
  marketplace?: { remote: string; branch: string };
  mappMarketplace?: { remote: string; branch: string };
  provisionedProjects?: string[];
}

/** System connection status from GET /api/system/connections. */
export interface ConnectionStatus {
  agi: {
    status: "connected";
    branch: string;
    commit: string;
    uptime: number;
    state: string;
  };
  prime: {
    status: "connected" | "missing" | "error";
    dir: string;
    entries: number;
    branch?: string;
  };
  workspace: {
    status: "connected" | "empty" | "error";
    configured: number;
    accessible: number;
    root: string;
  };
  idService?: {
    status: "connected" | "degraded" | "missing" | "error" | "central";
    mode: "local" | "central";
    url: string;
    version?: string;
  };
}

// ---------------------------------------------------------------------------
// Plugin extensibility types (mirrors @aionima/plugins types for dashboard)
// ---------------------------------------------------------------------------

export interface UIField {
  id: string;
  label: string;
  type: "text" | "number" | "select" | "toggle" | "password" | "textarea" | "readonly" | "model-select";
  description?: string;
  defaultValue?: string | number | boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
  configKey?: string;
  /** For model-select fields: the provider to fetch models from (e.g. "anthropic", "openai", "ollama"). */
  provider?: string;
}

export type ActionScope =
  | { type: "global" }
  | { type: "project"; projectTypes?: string[] }
  | { type: "service"; serviceId: string };

export type ActionHandler =
  | { kind: "shell"; command: string; cwd?: string }
  | { kind: "api"; method?: string; endpoint: string; body?: Record<string, unknown> }
  | { kind: "hook"; hookName: string; payload?: Record<string, unknown> };

export interface PluginAction {
  id: string;
  pluginId: string;
  label: string;
  description?: string;
  icon?: string;
  scope: ActionScope;
  handler: ActionHandler;
  confirm?: string;
  group?: string;
  destructive?: boolean;
}

export type PanelWidget =
  | { type: "field-group"; title?: string; fields: UIField[] }
  | { type: "action-bar"; actionIds: string[] }
  | { type: "status-display"; statusEndpoint: string; title?: string }
  | { type: "log-stream"; logSource: string; title?: string; lines?: number }
  | { type: "markdown"; content: string }
  | { type: "table"; dataEndpoint: string; columns: { key: string; label: string; width?: string }[] }
  | { type: "metric"; label: string; valueEndpoint: string; unit?: string; format?: string }
  | { type: "iframe"; src: string; title?: string; height?: string }
  | { type: "code-editor"; language?: string; defaultValue?: string; readOnly?: boolean; height?: string; maxHeight?: string }
  | { type: "tree-nav"; dataEndpoint?: string; title?: string }
  | { type: "layout"; direction: "horizontal" | "vertical" | "grid"; sizes?: string[]; gap?: string; height?: string; children: PanelWidget[] };

export interface PluginPanel {
  id: string;
  pluginId: string;
  label: string;
  projectTypes: string[];
  widgets: PanelWidget[];
  position?: number;
}

export interface PluginSettingsSection {
  id: string;
  pluginId: string;
  label: string;
  description?: string;
  type?: "config" | "runtime-manager" | "service-control" | "custom";
  language?: string;
  configPath: string;
  fields: UIField[];
  position?: number;
  /** For service-control sections: plugin-registered system service IDs to manage. */
  serviceIds?: string[];
}

export interface RustDeskConnectionInfo {
  serverIp: string;
  publicKey: string;
  clientId: string;
  ports: string[];
}

export interface SidebarItem {
  label: string;
  to: string;
  icon?: string;
  exact?: boolean;
}

export interface PluginSidebarSection {
  id: string;
  pluginId: string;
  title: string;
  items: SidebarItem[];
  position?: number;
}

export interface PluginTheme {
  id: string;
  pluginId: string;
  name: string;
  description?: string;
  dark: boolean;
  properties: Record<string, string>;
}

export interface PluginSystemService {
  id: string;
  pluginId: string;
  name: string;
  description?: string;
  status?: "running" | "stopped" | "unknown";
  unitName?: string;
  agentAware?: boolean;
  installed?: boolean;
  installable?: boolean;
}

export interface PluginScheduledTask {
  id: string;
  pluginId: string;
  name: string;
  description?: string;
  cron?: string;
  intervalMs?: number;
  enabled: boolean;
  lastRun?: string;
  lastError?: string;
}

/** Plugin-provided settings page. */
export interface PluginSettingsPage {
  id: string;
  pluginId: string;
  label: string;
  description?: string;
  icon?: string;
  position?: number;
  sections: PluginSettingsSection[];
}

/** Plugin page added to an existing dashboard domain. */
export interface PluginDashboardPage {
  id: string;
  pluginId: string;
  label: string;
  description?: string;
  icon?: string;
  domain: string;
  routePath: string;
  widgets: PanelWidget[];
  position?: number;
}

/** Page within a plugin-provided dashboard domain. */
export interface PluginDomainPage {
  id: string;
  label: string;
  routePath: string;
  icon?: string;
  widgets: PanelWidget[];
  isIndex?: boolean;
  position?: number;
}

/** Plugin-provided top-level dashboard domain. */
export interface PluginDashboardDomain {
  id: string;
  pluginId: string;
  title: string;
  description?: string;
  icon?: string;
  routePrefix: string;
  position?: number;
  pages: PluginDomainPage[];
}

// ---------------------------------------------------------------------------
// Marketplace types
// ---------------------------------------------------------------------------

export type MarketplaceItemType =
  | "plugin" | "skill" | "knowledge" | "theme" | "workflow" | "agent-tool" | "channel";

export interface MarketplaceSource {
  id: number;
  /** Original reference (e.g. "owner/repo" or URL). */
  ref: string;
  sourceType: "github" | "url" | "local";
  name: string;
  description?: string;
  lastSyncedAt: string | null;
  pluginCount: number;
}

export interface MarketplaceCatalogItem {
  name: string;
  description?: string;
  type?: MarketplaceItemType;
  version?: string;
  author?: { name: string; email?: string };
  category?: string;
  provides?: string[];
  depends?: string[];
  tags?: string[];
  keywords?: string[];
  license?: string;
  homepage?: string;
  sourceId: number;
  installed: boolean;
  source: unknown;
  builtIn?: boolean;
  active?: boolean;
  enabled?: boolean;
  trustTier?: "official" | "verified" | "community" | "unknown";
  integrityHash?: string;
}

export interface MarketplaceInstalledItem {
  name: string;
  sourceId: number;
  type: MarketplaceItemType;
  version: string;
  installedAt: string;
  installPath: string;
}

export interface MarketplaceUpdate {
  pluginName: string;
  currentVersion: string;
  availableVersion: string;
  sourceId: number;
}

/** Full plugin detail from GET /api/plugins/:id/details. */
export interface PluginDetails {
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string | null;
    permissions: string[];
    category: string;
    provides: string[];
    depends?: string[];
  };
  installed: boolean;
  active: boolean;
  enabled: boolean;
  builtIn: boolean;
  registrations?: {
    routes: { method: string; path: string }[];
    systemServices: { id: string; name: string; description?: string; unitName?: string }[];
    agentTools: { name: string; description: string }[];
    settingsPages: { id: string; label: string }[];
    dashboardPages: { id: string; label: string; domain: string }[];
    skills: { name: string; description?: string; domain: string }[];
    knowledge: { id: string; label: string; topicCount: number }[];
    themes: { id: string; name: string }[];
    workflows: { id: string; name: string }[];
    scheduledTasks: { id: string; name: string; cron?: string }[];
    sidebarSections: { id: string; title: string; itemCount: number }[];
    stacks: { id: string; label: string }[];
  };
}

/** Samba network share from GET /api/samba/shares. */
export interface SambaShare {
  name: string;
  path: string;
  enabled: boolean;
}

/** Channel detail from GET /api/channels/:id. */
export interface ChannelDetail {
  id: string;
  status: "registered" | "starting" | "running" | "stopping" | "stopped" | "error";
  registeredAt: string;
  error: string | null;
  capabilities: {
    text: boolean;
    media: boolean;
    voice: boolean;
    reactions: boolean;
    threads: boolean;
    ephemeral: boolean;
  } | null;
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export type OnboardingStepStatus = "pending" | "completed" | "skipped";

export interface OnboardingState {
  firstbootCompleted: boolean;
  steps: {
    hosting: OnboardingStepStatus;
    aionimaId: OnboardingStepStatus;
    aiKeys: OnboardingStepStatus;
    ownerProfile: OnboardingStepStatus;
    channels: OnboardingStepStatus;
    federation: OnboardingStepStatus;
    zeroMeMind: OnboardingStepStatus;
    zeroMeSoul: OnboardingStepStatus;
    zeroMeSkill: OnboardingStepStatus;
  };
  idMode?: "central" | "local";
  aionimaIdServices?: Array<{ provider: string; role: string; accountLabel?: string }>;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Security types
// ---------------------------------------------------------------------------

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingConfidence = "high" | "medium" | "low";
export type ScanType = "sast" | "dast" | "sca" | "secrets" | "config" | "container" | "custom";
export type ScanStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type FindingStatus = "open" | "acknowledged" | "mitigated" | "false_positive";

export interface FindingEvidence {
  file?: string;
  line?: number;
  column?: number;
  snippet?: string;
  context?: string;
  dependency?: string;
  installedVersion?: string;
  fixedVersion?: string;
  cveId?: string;
}

export interface FindingRemediation {
  description: string;
  effort: "low" | "medium" | "high";
  slaHours: number;
  references?: string[];
}

export interface SecurityFinding {
  id: string;
  scanId: string;
  title: string;
  description: string;
  checkId: string;
  scanType: ScanType;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  cwe?: string[];
  owasp?: string[];
  evidence: FindingEvidence;
  remediation: FindingRemediation;
  createdAt: string;
  status: FindingStatus;
}

export interface ScanRun {
  id: string;
  status: ScanStatus;
  config: { scanTypes: ScanType[]; targetPath: string; projectId?: string };
  startedAt: string;
  completedAt?: string;
  findingCounts: Record<FindingSeverity, number>;
  totalFindings: number;
}

export interface SecuritySummary {
  totalFindings: number;
  bySeverity: Record<FindingSeverity, number>;
  byStatus: Record<FindingStatus, number>;
  byScanType: Record<ScanType, number>;
  lastScanAt?: string;
  scanCount: number;
}

export interface ScanProvider {
  id: string;
  name: string;
  scanType: string;
  description?: string;
}
