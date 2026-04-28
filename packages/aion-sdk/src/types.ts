/**
 * Type re-exports from @agi/plugins and @agi/gateway-core for SDK consumers.
 *
 * This is the canonical type surface for plugin development. Every type a plugin
 * author needs is re-exported here so consumers only depend on `@agi/sdk`.
 *
 * ## Plugin Schema Reference (MPx 1.0)
 *
 * The Aionima plugin schema defines the contract between plugins and the gateway.
 * Each `register*()` method on `AionimaPluginAPI` accepts a typed definition object.
 *
 * ### Core types
 * - `AionimaPlugin` — plugin entry point (`activate`/`deactivate`)
 * - `AionimaPluginAPI` — the API object passed to `activate()`
 * - `AionimaPluginManifest` — `package.json` `"aionima"` field schema
 * - `AionimaPermission` — permission strings (`filesystem.read`, `network`, etc.)
 * - `PluginCategory` — plugin classification
 * - `AionimaHookMap` — hook name → handler signature map
 *
 * ### Registration types (alphabetical)
 * - `ActionDefinition` — dashboard/agent actions
 * - `LLMProviderDefinition` — LLM provider integrations
 * - `AgentToolDefinition` — tools exposed to the agent pipeline
 * - `DashboardInterfacePageDefinition` — pages within existing dashboard domains
 * - `DashboardInterfaceDomainDefinition` — new top-level dashboard domains
 * - `KnowledgeNamespace` — knowledge bases for agent context
 * - `ProjectPanelDefinition` — custom panels in project detail views
 * - `RuntimeDefinition` — container runtime versions
 * - `ScheduledTaskDefinition` — cron/interval background tasks
 * - `ServiceDefinition` — infrastructure service containers
 * - `SettingsPageDefinition` — plugin settings sub-pages
 * - `SettingsSectionDefinition` — sections within settings pages
 * - `SidebarSectionDefinition` — dashboard sidebar navigation sections
 * - `SkillRegistration` — agent skills
 * - `StackDefinition` — composable project stacks (runtime, database, tooling)
 * - `SystemServiceDefinition` — host-level systemd/service management
 * - `ThemeDefinition` — dashboard themes
 * - `WorkflowDefinition` — multi-step automated workflows
 *
 * ### Stack types (MPx 1.0 — composable project infrastructure)
 * - `StackDefinition` — the full stack unit
 * - `StackCategory` — "runtime" | "database" | "tooling" | "framework" | "workflow"
 * - `StackRequirement` — what a stack provides or expects
 * - `StackGuide` — markdown usage guides
 * - `StackContainerConfig` — container lifecycle config
 * - `StackContainerContext` — context passed to dynamic config functions
 * - `StackDatabaseConfig` — per-project DB setup/teardown
 * - `StackScaffoldingConfig` — optional project bootstrap
 * - `ProjectStackInstance` — per-project persisted stack state
 * - `StackInfo` — serialized stack info (API responses)
 */

export type {
  AionimaPlugin,
  AionimaPluginAPI,
  AionimaPluginManifest,
  AionimaPermission,
  PluginCategory,
  AionimaHookMap,
  ActionDefinition,
  ActionScope,
  ActionHandler,
  CleanupResource,
  CleanupManifest,
  PanelWidget,
  ProjectPanelDefinition,
  SettingsSectionDefinition,
  SettingsPageDefinition,
  DashboardInterfacePageDefinition,
  DashboardInterfaceDomainDefinition,
  DashboardDomainPageDefinition,
  UIField,
  SkillRegistration,
  KnowledgeNamespace,
  KnowledgeTopic,
  SystemServiceDefinition,
  ThemeDefinition,
  AgentToolDefinition,
  SidebarSectionDefinition,
  SidebarItem,
  ScheduledTaskDefinition,
  WorkflowDefinition,
  WorkflowStep,
  DashboardTabDef,
  RuntimeDefinition,
  RuntimeDependency,
  RuntimeInstaller,
  ServiceDefinition,
  HostingExtensionField,
  HostingExtension,
  RouteHandler,
  LLMProviderDefinition,
  LLMProviderFactory,
  ProvidesLabel,
} from "@agi/plugins";

export type { AionimaChannelPlugin } from "@agi/channel-sdk";

export type {
  StackDefinition,
  StackCategory,
  StackRequirement,
  StackGuide,
  StackContainerConfig,
  StackContainerContext,
  StackDatabaseConfig,
  StackScaffoldingConfig,
  StackInstallAction,
  StackDevCommands,
  ProjectStackInstance,
  StackInfo,
} from "@agi/gateway-core";
