/**
 * @aionima/sdk — Developer SDK for building Aionima plugins.
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
 * import { createPlugin, defineStack } from "@aionima/sdk";
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
 * import { testActivate } from "@aionima/sdk/testing";
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
export { defineProvider } from "./define-provider.js";
export { defineSettingsPage } from "./define-settings-page.js";
export { defineDashboardPage } from "./define-dashboard-page.js";
export { defineDashboardDomain } from "./define-dashboard-domain.js";
export { defineScan } from "./define-scan.js";
export { defineWorker } from "./define-worker.js";
export { defineMagicApp } from "./define-magic-app.js";

// Testing utilities (separate entry point: @aionima/sdk/testing)
// import { testActivate, createMockAPI } from "@aionima/sdk/testing";

// Types — full plugin schema surface
export type * from "./types.js";
