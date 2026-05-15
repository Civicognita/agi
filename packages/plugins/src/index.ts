/**
 * @agi/plugins — Plugin system for Aionima.
 */

// Types
export type {
  AionimaPermission,
  PluginCategory,
  ProvidesLabel,
  AdfElement,
  AionimaPluginManifest,
  AionimaPluginAPI,
  AionimaPlugin,
  AionimaHookMap,
  AgentContext,
  AgentResult,
  ToolResult,
  ChatMessage,
  DashboardTabDef,
  RouteHandler,
  RuntimeDependency,
  RuntimeDefinition,
  RuntimeInstaller,
  ServiceDefinition,
  HostingExtensionField,
  HostingExtension,
  UIField,
  ActionScope,
  ActionHandler,
  ActionDefinition,
  PanelWidget,
  ProjectPanelDefinition,
  SettingsSectionDefinition,
  SkillRegistration,
  KnowledgeTopic,
  KnowledgeNamespace,
  SystemServiceDefinition,
  ThemeDefinition,
  AgentToolHandler,
  AgentToolDefinition,
  SidebarItem,
  SidebarSectionDefinition,
  ScheduledTaskHandler,
  ScheduledTaskDefinition,
  WorkflowStep,
  WorkflowDefinition,
  SettingsPageDefinition,
  DashboardInterfacePageDefinition,
  DashboardInterfaceDomainDefinition,
  DashboardDomainPageDefinition,
  LLMProviderDefinition,
  LLMProviderFactory,
  PmProviderDefinition,
  PmProviderFactory,
  PmKanbanColumn,
  PmKanbanConfig,
  McpServerTemplate,
  ProviderField,
  ProviderModelInfo,
  CleanupResource,
  CleanupManifest,
  WorkerDomain,
  WorkerDefinition,
} from "./types.js";
export { categoryToProvides } from "./types.js";

// Hook bus
export { HookBus } from "./hooks.js";

// Security
export { validatePermissions, validateManifest, validatePluginId, hasPermission } from "./security.js";

// Discovery
export { discoverPlugins, discoverMarketplacePlugins, discoverPrefixedPlugins, discoverChannelPlugins, getDefaultSearchPaths, tryLoadManifest } from "./discovery.js";
export type { DiscoveredPlugin, DiscoveryResult, SearchPathOptions } from "./discovery.js";

// Registry
export { PluginRegistry } from "./registry.js";
export type {
  LoadedPlugin, RegisteredRoute, RegisteredTab,
  RegisteredAction, RegisteredPanel, RegisteredSettingsSection,
  RegisteredSkill, RegisteredKnowledge, RegisteredSystemService,
  RegisteredTheme, RegisteredAgentTool, RegisteredSidebarSection,
  RegisteredScheduledTask, RegisteredWorkflow,
  RegisteredSettingsPage, RegisteredDashboardPage, RegisteredDashboardDomain,
  RegisteredStack, RegisteredRuntime, RegisteredService, RegisteredRuntimeInstaller,
  RegisteredChannel, RegisteredProvider,
} from "./registry.js";

// Loader
export { loadPlugins } from "./loader.js";
export type { PluginLoaderDeps, LoadResult } from "./loader.js";

// Scanner
export { scanPluginSource } from "./scanner.js";
export type { ScanResult, ScanWarning } from "./scanner.js";

// Channel plugin types (migrated from @agi/channel-sdk — s174 CHN-M)
export type {
  ChannelId,
  ChannelMeta,
  ChannelCapabilities,
  AionimaMessage,
  MessageContent,
  ChannelConfigAdapter,
  ChannelGatewayAdapter,
  ChannelOutboundAdapter,
  OutboundContent,
  ChannelMessagingAdapter,
  ChannelSecurityAdapter,
  EntityResolverAdapter,
  ImpactHookAdapter,
  ImpactClassification,
  COAEmitterAdapter,
  AionimaChannelPlugin,
} from "./channel-plugin-types.js";
