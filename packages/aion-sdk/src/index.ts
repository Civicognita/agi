/**
 * @agi/sdk — Developer SDK for building Aionima plugins.
 *
 * ## Overview
 *
 * The Aionima SDK provides type-safe builders and type re-exports for plugin
 * development. Plugins extend the Aionima gateway with new capabilities:
 * runtimes, databases, UI panels, agent tools, themes, and more.
 *
 * ## Plugin Schema (MPx 1.0 — Mycelium Protocol)
 *
 * The plugin schema is versioned alongside the Mycelium Protocol. Each
 * `register*()` method on `AionimaPluginAPI` accepts a typed definition.
 * This SDK provides chainable builders for the most common definitions.
 *
 * ### Builders available
 *
 * | Builder           | Registers                         | Definition type                     |
 * |-------------------|-----------------------------------|-------------------------------------|
 * | `defineStack`     | `api.registerStack()`             | `StackDefinition`                   |
 * | `defineRuntime`   | `api.registerRuntime()`           | `RuntimeDefinition`                 |
 * | `defineService`   | `api.registerService()`           | `ServiceDefinition`                 |
 * | `defineAction`    | `api.registerAction()`            | `ActionDefinition`                  |
 * | `definePanel`     | `api.registerProjectPanel()`      | `ProjectPanelDefinition`            |
 * | `defineSettings`  | `api.registerSettingsSection()`   | `SettingsSectionDefinition`         |
 * | `defineTool`      | `api.registerAgentTool()`         | `AgentToolDefinition`               |
 * | `defineSkill`     | `api.registerSkill()`             | `SkillRegistration`                 |
 * | `defineTheme`     | `api.registerTheme()`             | `ThemeDefinition`                   |
 * | `defineKnowledge` | `api.registerKnowledge()`         | `KnowledgeNamespace`                |
 * | `defineWorkflow`  | `api.registerWorkflow()`          | `WorkflowDefinition`                |
 * | `defineSidebar`   | `api.registerSidebarSection()`    | `SidebarSectionDefinition`          |
 * | `defineChannel`   | `api.registerChannel()`           | `AionimaChannelPlugin`              |
 * | `defineProvider`  | `api.registerProvider()`          | `LLMProviderDefinition`             |
 * | `defineSettingsPage` | `api.registerSettingsPage()`   | `SettingsPageDefinition`            |
 * | `defineDashboardPage` | `api.registerDashboardPage()` | `DashboardInterfacePageDefinition`  |
 * | `defineDashboardDomain` | `api.registerDashboardDomain()` | `DashboardInterfaceDomainDefinition` |
 * | `defineScan`            | `api.registerScanProvider()`    | `ScanProviderDefinition`              |
 * | `defineWorker`          | `api.registerWorker()`          | `WorkerDefinition`                    |
 *
 * ### Plugin lifecycle
 *
 * ```ts
 * import { createPlugin, defineStack } from "@agi/sdk";
 *
 * export default createPlugin({
 *   async activate(api) {
 *     const stack = defineStack("my-stack", "My Stack")
 *       .description("...")
 *       .category("tooling")
 *       .projectCategories(["app"])
 *       .build();
 *     api.registerStack(stack);
 *   },
 * });
 * ```
 *
 * ### Testing
 *
 * ```ts
 * import { testActivate } from "@agi/sdk/testing";
 * import * as plugin from "./index.js";
 *
 * const regs = await testActivate(plugin);
 * console.log(regs.runtimes);  // RuntimeDefinition[]
 * console.log(regs.services);  // ServiceDefinition[]
 * ```
 *
 * @see {@link https://github.com/Civicognita/agi/blob/main/docs/agents/stack-management.md | Stack Management Agent Guide}
 * @see {@link https://github.com/Civicognita/agi/blob/main/docs/agents/plugin-development.md | Plugin Development Guide}
 *
 * @packageDocumentation
 */

// Plugin factory
export { createPlugin } from "./create-plugin.js";

// ADF context + facades
export { initADF, resetADF } from "./adf-context.js";
export type { ADFContext, ADFLogger, ADFSecurityContext, ADFProjectConfigContext, ADFSystemConfigContext } from "./adf-context.js";
export { Log, Config, Workspace, Security, ProjectConfig, SystemConfig } from "./facades.js";

// Builder helpers + utilities
export { actionId } from "./helpers.js";
export { defineStack } from "./define-stack.js";
export { defineRuntime } from "./define-runtime.js";
export { defineService } from "./define-service.js";
export { defineAction } from "./define-action.js";
export { definePanel } from "./define-panel.js";
export { defineSettings } from "./define-settings.js";
export { defineTool } from "./define-tool.js";
export { defineSkill } from "./define-skill.js";
export { defineTheme } from "./define-theme.js";
export { defineKnowledge } from "./define-knowledge.js";
export { defineWorkflow } from "./define-workflow.js";
export { defineSidebar } from "./define-sidebar.js";
export { defineChannel } from "./define-channel.js";
// CHN-A (s162) — new ChannelDefinition contract per
// agi/docs/agents/channel-plugin-redesign.md §3. Coexists with the
// legacy AionimaChannelPlugin shape; CHN-M (s174) deletes the legacy.
export { defineChannelV2 } from "./define-channel-v2.js";
export type {
  ChannelDefinition,
  ChannelProtocol,
  ChannelContext,
  ChannelCage,
  ChannelEntityBinding,
  ChannelRoom,
  ChannelUser,
  ChannelMessage,
  ChannelMessageAttachment,
  ChannelEvent,
  ChannelBridgeToolDefinition,
  ChannelReadPolicy,
  ChannelSettingsPageProps,
  ChannelProjectPanelProps,
  ChannelRoomDiscoveryModel,
  ChannelRoomDiscovery,
} from "./channel-v2-types.js";
export { defineProvider } from "./define-provider.js";
export { definePmProvider, definePmKanbanConfig, DEFAULT_TYNN_KANBAN_CONFIG } from "./define-pm-provider.js";
export type { PmProviderDefinition, PmProviderFactory, PmKanbanColumn, PmKanbanConfig } from "./define-pm-provider.js";
export type { ProviderField, ProviderModelInfo } from "./define-provider.js";
export { defineSettingsPage } from "./define-settings-page.js";
export { defineDashboardPage } from "./define-dashboard-page.js";
export { defineDashboardDomain } from "./define-dashboard-domain.js";
export { defineScan } from "./define-scan.js";
export { defineWorker } from "./define-worker.js";
export { defineMagicApp } from "./define-magic-app.js";

// Layer D blockchain anchor — interface only in v0.4.0 (NoopAnchor lives in
// packages/memory). Live Ethereum/L2 implementation arrives in v0.6.0 via
// tynn s113. Callers depend on the interface; the swap is invisible.
export type { AnchorRecord, AnchorResult, BlockchainAnchor } from "./anchor.js";

// MApp Schema (MPx 1.0)
export { MAPP_SCHEMA_VERSION, serializeMApp } from "./mapp-schema.js";
export type {
  MAppDefinition, MAppInfo, MAppCategory, MAppPermission,
  MAppContainerConfig, MAppPanel, MAppWidget, MAppTheme,
  MAppAgentPrompt, MAppWorkflow, MAppWorkflowStep, MAppWorkflowStepType,
  MAppTool, MAppFieldType, MAppField, MAppFormula, MAppConstant,
  MAppCondition, MAppPage, MAppPageType, MAppOutput,
  MAppModelDependency, MAppModelInferenceConfig,
  MAppScreen, MAppScreenElement, MAppScreenInput,
  MAppScreenInputType, MAppScreenInputQualifier, MAppScreenInputSource,
  MAppScreenMiniAgent, MAppScreenMiniAgentToolMode,
} from "./mapp-schema.js";

// ADF UI Component Catalog
export { UI_COMPONENTS, WIDGET_COMPONENT_MAP } from "./ui-components.js";
export type { ContentRendererConfig, MAppWidgetType } from "./ui-components.js";

// Testing utilities (separate entry point: @agi/sdk/testing)
// import { testActivate, createMockAPI } from "@agi/sdk/testing";

// PmProvider interface — canonical PM workflow surface (s118 t432).
// AGI's agentic operating model IS the tynn workflow; this interface is
// what every backing service implements. Storage is pluggable; workflow
// is canonical. See agi/docs/agents/tynn-and-related-concepts.md.
export type {
  PmStatus,
  PmStoryStatus,
  PmProject,
  PmVersion,
  PmStory,
  PmTask,
  PmComment,
  PmCreateTaskInput,
  PmIWishInput,
  PmProvider,
} from "./pm.js";

// Types — full plugin schema surface
export type * from "./types.js";
