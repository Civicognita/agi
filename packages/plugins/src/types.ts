/**
 * Plugin system types — adapted from OpenClaw's plugin architecture.
 */

import type { ProjectTypeDefinition, ProjectTypeTool } from "@agi/gateway-core";
export type { LogSourceDefinition } from "@agi/gateway-core";
import type { ComponentLogger } from "@agi/gateway-core";
import type { StackDefinition } from "@agi/gateway-core";
import type { AionimaChannelPlugin } from "@agi/channel-sdk";
import type { ScanProviderDefinition } from "@agi/security";

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type AionimaPermission =
  | "filesystem.read"
  | "filesystem.write"
  | "network"
  | "shell.exec"
  | "config.read"
  | "config.write";

// ---------------------------------------------------------------------------
// Plugin categories
// ---------------------------------------------------------------------------

export type PluginCategory = "runtime" | "service" | "tool" | "editor" | "integration" | "project" | "knowledge" | "theme" | "workflow" | "system" | "stack";

// ---------------------------------------------------------------------------
// Provides labels — capability-based taxonomy
// ---------------------------------------------------------------------------

export type ProvidesLabel =
  | "project-types" | "stacks" | "services" | "runtimes"
  | "system-services" | "ux" | "agent-tools" | "skills"
  | "knowledge" | "themes" | "workflows" | "channels"
  | "providers" | "pm-providers" | "security" | "workers";

/**
 * Map a legacy category string to provides labels for backward compatibility.
 * Plugins without explicit `provides` fall back to this mapping.
 */
export function categoryToProvides(category?: string): ProvidesLabel[] {
  switch (category) {
    case "runtime": return ["runtimes"];
    case "service": return ["services"];
    case "tool": return ["ux"];
    case "editor": return ["ux"];
    case "integration": return ["channels"];
    case "project": return ["project-types"];
    case "knowledge": return ["knowledge"];
    case "theme": return ["themes"];
    case "workflow": return ["workflows"];
    case "system": return ["system-services"];
    case "stack": return ["stacks"];
    default: return ["ux"];
  }
}

// ---------------------------------------------------------------------------
// Plugin Manifest
// ---------------------------------------------------------------------------

export interface AionimaPluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  aionimaVersion: string;
  permissions: AionimaPermission[];
  entry: string;
  projectTypes?: string[];
  category?: PluginCategory;
  /** Capability labels describing what this plugin provides. */
  provides?: ProvidesLabel[];
  /** Plugin IDs this plugin depends on. */
  depends?: string[];
  /** Pre-installed from marketplace during onboarding. Cannot be uninstalled. */
  bakedIn?: boolean;
  /** Whether a baked-in plugin can be disabled. Defaults to true. */
  disableable?: boolean;
}

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

export interface AgentContext {
  sessionId: string;
  entityId: string;
  message: string;
  [key: string]: unknown;
}

export interface AgentResult {
  response: string;
  [key: string]: unknown;
}

export interface ToolResult {
  output: unknown;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  [key: string]: unknown;
}

export interface ProjectInfo {
  name: string;
  path: string;
  type: string;
  [key: string]: unknown;
}

export interface HostedProject {
  path: string;
  hostname: string;
  type: string;
  port: number | null;
  [key: string]: unknown;
}

export interface AionimaHookMap {
  "gateway:startup": () => Promise<void>;
  "gateway:shutdown": () => Promise<void>;
  "project:created": (project: ProjectInfo) => Promise<void>;
  "project:deleted": (projectPath: string) => Promise<void>;
  "project:hosting:enabled": (project: HostedProject) => Promise<void>;
  "project:hosting:disabled": (projectPath: string) => Promise<void>;
  "agent:beforeInvoke": (context: AgentContext) => Promise<AgentContext>;
  "agent:afterInvoke": (context: AgentContext, result: AgentResult) => Promise<void>;
  "tool:beforeExecute": (toolName: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  "tool:afterExecute": (toolName: string, result: ToolResult) => Promise<ToolResult>;
  "message:beforeSend": (message: ChatMessage) => Promise<ChatMessage>;
  "message:afterReceive": (message: ChatMessage) => Promise<void>;
  "config:changed": (key: string, value: unknown) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Dashboard tab definition (for UI plugins)
// ---------------------------------------------------------------------------

export interface DashboardTabDef {
  id: string;
  label: string;
  component: string;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export type RouteHandler = (
  request: {
    body: unknown;
    query: Record<string, string>;
    params: Record<string, string>;
    headers?: Record<string, string | string[] | undefined>;
    clientIp?: string;
  },
  reply: { code: (n: number) => { send: (data: unknown) => void }; send: (data: unknown) => void },
) => Promise<void>;

// ---------------------------------------------------------------------------
// Runtime definitions — plugins can register container runtimes
// ---------------------------------------------------------------------------

export interface RuntimeDependency {
  /** Tool/package name (e.g. "npm", "composer"). */
  name: string;
  /** Version bundled with this runtime (e.g. "10.9.0"). */
  version: string;
  /** How the dependency is managed: "bundled" = included in the container image. */
  type: "bundled" | "managed";
}

export interface RuntimeDefinition {
  id: string;
  label: string;
  language: string;
  version: string;
  containerImage: string;
  internalPort: number;
  /** Project types this runtime applies to. */
  projectTypes: string[];
  /** Dependencies bundled with or managed by this runtime (e.g. npm for Node). */
  dependencies?: RuntimeDependency[];
  /** Whether this runtime version is installed on the machine. */
  installed?: boolean;
  /** Whether this runtime version can be installed/uninstalled. */
  installable?: boolean;
}

// ---------------------------------------------------------------------------
// Runtime installer — plugins can register install/uninstall capabilities
// ---------------------------------------------------------------------------

export interface RuntimeInstaller {
  /** Language this installer manages (e.g. "php", "node"). */
  language: string;
  /** List versions currently installed on the machine. */
  listInstalled(): Promise<string[]>;
  /** Install a specific version. */
  install(version: string): Promise<void>;
  /** Uninstall a specific version. */
  uninstall(version: string): Promise<void>;
  /** All versions this installer knows about. */
  listAvailable(): string[];
}

// ---------------------------------------------------------------------------
// Service definitions — plugins can register infrastructure services
// ---------------------------------------------------------------------------

export interface ServiceDefinition {
  id: string;
  name: string;
  description: string;
  containerImage: string;
  defaultPort: number;
  env?: Record<string, string>;
  volumes?: string[];
  healthCheck?: string;
}

// ---------------------------------------------------------------------------
// Hosting extension fields — plugins can add fields to the HostingPanel
// ---------------------------------------------------------------------------

export interface HostingExtensionField {
  id: string;
  label: string;
  type: "select" | "text" | "number";
  options?: { value: string; label: string }[];
  defaultValue?: string;
  /** Which project types this field appears for. Empty = all hostable. */
  projectTypes?: string[];
}

export interface HostingExtension {
  pluginId: string;
  fields: HostingExtensionField[];
}

// ---------------------------------------------------------------------------
// Declarative UI primitives
// ---------------------------------------------------------------------------

export interface UIField {
  id: string;
  label: string;
  type: "text" | "number" | "select" | "toggle" | "password" | "textarea" | "readonly" | "model-select" | "date" | "color" | "autocomplete" | "slider" | "otp" | "file";
  description?: string;
  defaultValue?: string | number | boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
  /** Dot-path into the config object this field binds to. */
  configKey?: string;
  /** For model-select fields: the provider to fetch models from (e.g. "anthropic", "openai", "ollama"). */
  provider?: string;
  /** For number/slider fields: minimum value. */
  min?: number;
  /** For number/slider fields: maximum value. */
  max?: number;
  /** For slider fields: step increment. */
  step?: number;
  /** For file fields: accepted MIME types or extensions (e.g. "image/*", ".pdf"). */
  accept?: string;
  /** For file fields: whether multiple files can be selected. */
  multiple?: boolean;
  /** For autocomplete fields: API endpoint to fetch suggestions from. */
  autocompleteEndpoint?: string;
}

// ---------------------------------------------------------------------------
// Action definitions
// ---------------------------------------------------------------------------

export type ActionScope =
  | { type: "global" }
  | { type: "project"; projectTypes?: string[] }
  | { type: "service"; serviceId: string };

export type ActionHandler =
  | { kind: "shell"; command: string; cwd?: string }
  | { kind: "api"; method?: string; endpoint: string; body?: Record<string, unknown> }
  | { kind: "hook"; hookName: keyof AionimaHookMap; payload?: Record<string, unknown> };

export interface ActionDefinition {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  scope: ActionScope;
  handler: ActionHandler;
  confirm?: string;
  group?: string;
  destructive?: boolean;
}

// ---------------------------------------------------------------------------
// Project panel definitions
// ---------------------------------------------------------------------------

export type PanelWidget =
  | { type: "field-group"; title?: string; fields: UIField[] }
  | { type: "action-bar"; actionIds: string[] }
  | { type: "status-display"; statusEndpoint: string; title?: string }
  | { type: "log-stream"; logSource: string; title?: string; lines?: number }
  | { type: "markdown"; content: string }
  | { type: "table"; dataEndpoint: string; columns: { key: string; label: string; width?: string }[] }
  | { type: "metric"; label: string; valueEndpoint: string; unit?: string; format?: string }
  | { type: "iframe"; src: string; title?: string; height?: string }
  | { type: "chart"; chartType: "bar" | "line" | "area" | "pie" | "donut" | "sparkline"; dataEndpoint: string; title?: string; height?: number }
  | { type: "timeline"; dataEndpoint: string; title?: string }
  | { type: "kanban"; dataEndpoint: string; title?: string; columns: { id: string; title: string }[] }
  | { type: "editor"; title?: string; defaultValue?: string; outputFormat?: "html" | "markdown" }
  | { type: "diagram"; dataEndpoint: string; title?: string; diagramType?: "erd" | "flowchart" };

export interface ProjectPanelDefinition {
  id: string;
  label: string;
  projectTypes: string[];
  widgets: PanelWidget[];
  position?: number;
}

// ---------------------------------------------------------------------------
// Settings section definitions
// ---------------------------------------------------------------------------

export interface SettingsSectionDefinition {
  id: string;
  label: string;
  description?: string;
  /** Section type: "config" renders form fields, "runtime-manager" renders install/uninstall UI,
   *  "service-control" renders start/stop/restart for system services, "custom" renders plugin-specific UI. */
  type?: "config" | "runtime-manager" | "service-control" | "custom";
  /** For runtime-manager sections: filter runtimes to this language (e.g. "node", "php"). */
  language?: string;
  /** For service-control sections: plugin-registered system service IDs to manage. */
  serviceIds?: string[];
  /** Dot-path prefix for config values (e.g. "plugins.laravel"). */
  configPath: string;
  fields: UIField[];
  position?: number;
}

// ---------------------------------------------------------------------------
// Skill registration
// ---------------------------------------------------------------------------

export interface SkillRegistration {
  name: string;
  description?: string;
  domain: string;
  triggers: string[];
  content: string;
}

// ---------------------------------------------------------------------------
// Knowledge namespace
// ---------------------------------------------------------------------------

export interface KnowledgeTopic {
  title: string;
  path: string;
  description?: string;
}

export interface KnowledgeNamespace {
  id: string;
  label: string;
  description?: string;
  /** Absolute path to directory containing markdown files. */
  contentDir: string;
  topics: KnowledgeTopic[];
}

// ---------------------------------------------------------------------------
// System service definitions
// ---------------------------------------------------------------------------

export interface SystemServiceDefinition {
  id: string;
  name: string;
  description?: string;
  /** Command to check status (exit 0 = running). */
  statusCommand?: string;
  /** Systemd unit name (if managed via systemd). */
  unitName?: string;
  startCommand?: string;
  stopCommand?: string;
  restartCommand?: string;
  /** Shell command to install the service (e.g. apt install). Run when not installed. */
  installCommand?: string;
  /** Command to check if installed (exit 0 = installed). Defaults to `which <id>`. */
  installedCheck?: string;
  /** Whether the agent should be aware of this service. */
  agentAware?: boolean;
  /** Description injected into agent context when agentAware is true. */
  agentDescription?: string;
}

// ---------------------------------------------------------------------------
// Theme definitions
// ---------------------------------------------------------------------------

export interface ThemeDefinition {
  id: string;
  name: string;
  description?: string;
  dark: boolean;
  /** CSS custom property overrides (e.g. { "--color-primary": "#8839ef" }). */
  properties: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Agent tool definitions
// ---------------------------------------------------------------------------

export type AgentToolHandler = (
  input: Record<string, unknown>,
  context: { sessionId: string; entityId: string },
) => Promise<unknown>;

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: AgentToolHandler;
  /** Optional metadata for MagicTools portability across HIVE nodes. */
  meta?: {
    version?: string;
    author?: string;
    tags?: string[];
    /** If true, this tool can be serialized and shared across HIVE nodes. */
    portable?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Sidebar section definitions
// ---------------------------------------------------------------------------

export interface SidebarItem {
  label: string;
  to: string;
  icon?: string;
  exact?: boolean;
}

export interface SidebarSectionDefinition {
  id: string;
  title: string;
  items: SidebarItem[];
  /** Position index for ordering (lower = higher). */
  position?: number;
}

// ---------------------------------------------------------------------------
// Scheduled task definitions
// ---------------------------------------------------------------------------

export type ScheduledTaskHandler = () => Promise<void>;

export interface ScheduledTaskDefinition {
  id: string;
  name: string;
  description?: string;
  /** Cron expression (e.g. "0 * * * *") or null for interval-based. */
  cron?: string;
  /** Interval in milliseconds (used if cron is not set). */
  intervalMs?: number;
  handler: ScheduledTaskHandler;
  /** Whether to skip execution if the previous run is still in progress. */
  skipIfRunning?: boolean;
  /** Whether the task starts enabled. Defaults to true. */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Workflow definitions
// ---------------------------------------------------------------------------

export type WorkflowStep =
  | { type: "shell"; id: string; label: string; command: string; cwd?: string; dependsOn?: string[] }
  | { type: "api"; id: string; label: string; method?: string; endpoint: string; body?: Record<string, unknown>; dependsOn?: string[] }
  | { type: "agent"; id: string; label: string; prompt: string; dependsOn?: string[] }
  | { type: "approval"; id: string; label: string; message: string; dependsOn?: string[] };

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  /** Trigger: manual, event-based, or scheduled. */
  trigger: "manual" | "event" | "scheduled";
  triggerEvent?: string;
  steps: WorkflowStep[];
}

// ---------------------------------------------------------------------------
// LLM Provider definitions
// ---------------------------------------------------------------------------

export type LLMProviderFactory = (config: {
  apiKey?: string;
  defaultModel: string;
  maxTokens: number;
  maxRetries: number;
  retryBaseMs?: number;
  baseUrl?: string;
}) => unknown; // Returns LLMProvider — avoids circular dep on gateway-core

/** A configurable field declared by a provider plugin for the Providers settings UI. */
export interface ProviderField {
  id: string;
  label: string;
  type: "password" | "text" | "number" | "select";
  placeholder?: string;
  description?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
}

export interface LLMProviderDefinition {
  id: string;           // "anthropic", "openai", "ollama", "groq"
  name: string;         // "Anthropic"
  description?: string;
  defaultModel: string; // "claude-sonnet-4-6"
  envKey: string;       // "ANTHROPIC_API_KEY" (empty if no key needed)
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  models?: string[];
  /** Declarative fields shown in the Providers settings UI. */
  fields?: ProviderField[];
  factory: LLMProviderFactory;
  /**
   * Check the provider's remaining credit balance.
   * Receives the provider's saved config (apiKey, adminApiKey, etc.).
   * Returns the USD balance remaining, or null if unavailable/unsupported.
   * Must not throw — wrap in try/catch at the call site.
   */
  checkBalance?: (config: Record<string, unknown>) => Promise<number | null>;
}

// ---------------------------------------------------------------------------
// PM provider plugin contracts (s118 t434)
//
// Plugins can register additional PM providers (Linear, Jira, GitHub Projects,
// etc.) alongside the built-in tynn / tynn-lite. The factory receives the
// provider's saved config and returns an instance whose shape implements
// `PmProvider` from `@agi/sdk`. The factory return type is `unknown` here to
// avoid a circular dep on @agi/sdk — the SDK's `definePmProvider()` builder
// wraps this in a type-safe API.
// ---------------------------------------------------------------------------

export type PmProviderFactory = (config: Record<string, unknown>) => unknown;

export interface PmProviderDefinition {
  /** Unique provider id used by `config.agent.pm.provider` to select this
   *  implementation (e.g. "linear", "jira", "github-projects"). Must not
   *  collide with built-in ids ("tynn", "tynn-lite"). */
  id: string;
  /** Human-readable name shown in any future "PM provider" settings UI. */
  name: string;
  description?: string;
  /** Declarative fields shown in the (future) PM-provider settings UI —
   *  same shape as ProviderField for visual + storage consistency. */
  fields?: ProviderField[];
  factory: PmProviderFactory;
}

// ---------------------------------------------------------------------------
// Settings page definitions (plugin-provided settings sub-pages)
// ---------------------------------------------------------------------------

/** Plugin-provided settings page (own sub-page under /settings). */
export interface SettingsPageDefinition {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  position?: number;
  sections: SettingsSectionDefinition[];
}

// ---------------------------------------------------------------------------
// Dashboard interface page definitions (plugin pages in existing domains)
// ---------------------------------------------------------------------------

/** Plugin page added to an existing dashboard domain. */
export interface DashboardInterfacePageDefinition {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  domain: string;
  routePath: string;
  widgets: PanelWidget[];
  position?: number;
}

// ---------------------------------------------------------------------------
// Dashboard interface domain definitions (plugin-provided top-level domains)
// ---------------------------------------------------------------------------

export interface DashboardDomainPageDefinition {
  id: string;
  label: string;
  routePath: string;
  icon?: string;
  widgets: PanelWidget[];
  isIndex?: boolean;
  position?: number;
}

/** Plugin-provided top-level dashboard domain (sidebar section + pages). */
export interface DashboardInterfaceDomainDefinition {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  routePrefix: string;
  position?: number;
  pages: DashboardDomainPageDefinition[];
}

// ---------------------------------------------------------------------------
// Subdomain route definitions — plugins can claim subdomains of baseDomain
// ---------------------------------------------------------------------------

export interface SubdomainRouteDefinition {
  /** Subdomain prefix (e.g. "db" → "db.ai.on"). */
  subdomain: string;
  /** Description for logs and documentation. */
  description?: string;
  /** Target: "gateway" proxies to the gateway port, or a number for a specific port. */
  target: "gateway" | number;
}

// ---------------------------------------------------------------------------
// Worker definitions — background task dispatch workers
// ---------------------------------------------------------------------------

export type WorkerDomain = "code" | "k" | "ux" | "strat" | "comm" | "ops" | "gov" | "data";

export interface WorkerDefinition {
  id: string;
  name: string;
  domain: WorkerDomain;
  role: string;
  description: string;
  /** Full system prompt for this worker (markdown). */
  prompt: string;
  /** Model preference: "fast" for simple, "balanced" for medium, "capable" for complex tasks. */
  modelTier?: "fast" | "balanced" | "capable";
  /** Tools this worker is allowed to use. */
  allowedTools?: string[];
  /** Minimum entity verification tier required to dispatch this worker. */
  requiredTier?: "verified" | "sealed";
  /** Keywords for auto-routing dispatch requests to this worker. */
  keywords?: string[];
}

// ---------------------------------------------------------------------------
// Plugin API — what plugins receive on activation
// ---------------------------------------------------------------------------

export interface AionimaPluginAPI {
  registerProjectType(def: ProjectTypeDefinition): void;
  registerTool(projectType: string, tool: ProjectTypeTool): void;
  registerHook<K extends keyof AionimaHookMap>(hook: K, handler: AionimaHookMap[K]): void;
  registerHttpRoute(method: string, path: string, handler: RouteHandler, options?: { raw?: boolean }): void;
  registerDashboardTab(projectType: string, tab: DashboardTabDef): void;
  registerRuntime(def: RuntimeDefinition): void;
  registerService(def: ServiceDefinition): void;
  /** @deprecated Use registerStack() instead. */
  registerHostingExtension(extension: HostingExtension): void;
  registerRuntimeInstaller(installer: RuntimeInstaller): void;
  registerStack(def: StackDefinition): void;
  registerChannel(channelPlugin: AionimaChannelPlugin): void;
  registerAction(def: ActionDefinition): void;
  registerProjectPanel(def: ProjectPanelDefinition): void;
  registerSettingsSection(def: SettingsSectionDefinition): void;
  registerSkill(def: SkillRegistration): void;
  registerKnowledge(def: KnowledgeNamespace): void;
  registerSystemService(def: SystemServiceDefinition): void;
  registerTheme(def: ThemeDefinition): void;
  registerAgentTool(def: AgentToolDefinition): void;
  registerSidebarSection(def: SidebarSectionDefinition): void;
  registerScheduledTask(def: ScheduledTaskDefinition): void;
  registerWorkflow(def: WorkflowDefinition): void;
  registerSettingsPage(def: SettingsPageDefinition): void;
  registerDashboardPage(def: DashboardInterfacePageDefinition): void;
  registerDashboardDomain(def: DashboardInterfaceDomainDefinition): void;
  registerSubdomainRoute(def: SubdomainRouteDefinition): void;
  registerProvider(def: LLMProviderDefinition): void;
  registerPmProvider(def: PmProviderDefinition): void;
  registerScanProvider(def: ScanProviderDefinition): void;
  registerWorker(def: WorkerDefinition): void;
  getChannelConfig(channelId: string): { enabled: boolean; config: Record<string, unknown> } | undefined;
  getConfig(): Record<string, unknown>;
  getLogger(): ComponentLogger;
  getWorkspaceRoot(): string;
  getProjectDirs(): string[];
  /** Read a project's config (returns null if not found). */
  getProjectConfig(projectPath: string): Record<string, unknown> | null;
  /** Get installed stacks for a project. */
  getProjectStacks(projectPath: string): Array<{ stackId: string; addedAt: string }>;
}

// ---------------------------------------------------------------------------
// Cleanup types — resources a plugin can declare for removal on uninstall
// ---------------------------------------------------------------------------

export interface CleanupResource {
  id: string;
  type: "container-image" | "apt-package" | "systemd-service" | "data-directory" | "custom";
  label: string;
  removeCommand: string;
  /** If true, other plugins also use this resource. */
  shared?: boolean;
}

export interface CleanupManifest {
  resources: CleanupResource[];
}

// ---------------------------------------------------------------------------
// Plugin entry — what plugins export
// ---------------------------------------------------------------------------

export interface AionimaPlugin {
  activate(api: AionimaPluginAPI): Promise<void>;
  deactivate?(): Promise<void>;
  /** Return cleanup resources for the uninstall preview dialog. */
  cleanup?(): Promise<CleanupManifest>;
}
