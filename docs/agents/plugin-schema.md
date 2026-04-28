# Plugin Schema Reference — Agent Guide

The Aionima plugin schema (MPx 1.0) defines the contract between plugins and the gateway. This document is the authoritative reference for AI agents extending the system.

## Schema Version

The plugin schema version is tracked in `protocol.json` under `pluginSchema`. The current version is `1.0.0`. Breaking changes increment the major version.

## Key Files

| File | Purpose |
|------|---------|
| `packages/plugins/src/types.ts` | All plugin type definitions |
| `packages/gateway-core/src/stack-types.ts` | Stack type definitions |
| `packages/aion-sdk/src/index.ts` | SDK entry point (builders + type re-exports) |
| `packages/aion-sdk/src/types.ts` | Type re-exports for SDK consumers |
| `packages/aion-sdk/src/testing.ts` | Mock API and test harness |
| `packages/aion-sdk/src/define-stack.ts` | Stack builder |
| `packages/aion-sdk/src/define-runtime.ts` | Runtime builder |
| `packages/aion-sdk/src/define-service.ts` | Service builder |
| `packages/aion-sdk/src/define-action.ts` | Action builder |
| `packages/aion-sdk/src/define-panel.ts` | Panel builder |
| `packages/aion-sdk/src/define-settings.ts` | Settings builder |
| `packages/aion-sdk/src/define-tool.ts` | Agent tool builder |
| `packages/aion-sdk/src/define-skill.ts` | Skill builder |
| `packages/aion-sdk/src/define-theme.ts` | Theme builder |
| `packages/aion-sdk/src/define-knowledge.ts` | Knowledge builder |
| `packages/aion-sdk/src/define-workflow.ts` | Workflow builder |
| `packages/aion-sdk/src/define-sidebar.ts` | Sidebar builder |
| `packages/aion-sdk/src/define-channel.ts` | Channel builder |
| `packages/aion-sdk/src/define-provider.ts` | LLM provider builder |
| `packages/aion-sdk/src/define-scan.ts` | Security scan provider builder |
| `packages/aion-sdk/src/define-worker.ts` | Worker task specialist builder |
| `packages/security/src/types.ts` | Security type definitions (findings, scans, providers) |
| `packages/plugins/src/registry.ts` | Plugin registry (stores registrations) |
| `packages/plugins/src/loader.ts` | Plugin loader (wires `register*` to registry) |

## Registration Surface

The `AionimaPluginAPI` interface (`packages/plugins/src/types.ts:517`) exposes these methods:

| Method | Definition Type | SDK Builder |
|--------|----------------|-------------|
| `registerStack()` | `StackDefinition` | `defineStack()` |
| `registerRuntime()` | `RuntimeDefinition` | `defineRuntime()` |
| `registerService()` | `ServiceDefinition` | `defineService()` |
| `registerRuntimeInstaller()` | `RuntimeInstaller` | — |
| `registerAction()` | `ActionDefinition` | `defineAction()` |
| `registerProjectPanel()` | `ProjectPanelDefinition` | `definePanel()` |
| `registerSettingsSection()` | `SettingsSectionDefinition` | `defineSettings()` |
| `registerSettingsPage()` | `SettingsPageDefinition` | — |
| `registerAgentTool()` | `AgentToolDefinition` | `defineTool()` |
| `registerSkill()` | `SkillRegistration` | `defineSkill()` |
| `registerTheme()` | `ThemeDefinition` | `defineTheme()` |
| `registerKnowledge()` | `KnowledgeNamespace` | `defineKnowledge()` |
| `registerWorkflow()` | `WorkflowDefinition` | `defineWorkflow()` |
| `registerSidebarSection()` | `SidebarSectionDefinition` | `defineSidebar()` |
| `registerScheduledTask()` | `ScheduledTaskDefinition` | — |
| `registerSystemService()` | `SystemServiceDefinition` | — |
| `registerHook()` | `AionimaHookMap[K]` | — |
| `registerHttpRoute()` | `RouteHandler` | — |
| `registerChannel()` | `AionimaChannelPlugin` | `defineChannel()` |
| `registerProvider()` | `LLMProviderDefinition` | `defineProvider()` |
| `registerPmProvider()` | `PmProviderDefinition` | `definePmProvider()` |
| `registerDashboardPage()` | `DashboardInterfacePageDefinition` | — |
| `registerDashboardDomain()` | `DashboardInterfaceDomainDefinition` | — |
| `registerSubdomainRoute()` | `SubdomainRouteDefinition` | — |
| `registerProjectType()` | `ProjectTypeDefinition` | — |
| `registerTool()` | `ProjectTypeTool` | — |
| `registerDashboardTab()` | `DashboardTabDef` | — |
| `registerScanProvider()` | `ScanProviderDefinition` | `defineScan()` |
| `registerWorker()` | `WorkerDefinition` | `defineWorker()` |

## Adding a New Registration Type

1. Define the type in `packages/plugins/src/types.ts`
2. Add the `register*()` method to `AionimaPluginAPI`
3. Add storage + `add*()` / `get*()` methods to `PluginRegistry` in `packages/plugins/src/registry.ts`
4. Wire `register*` in `createPluginAPI()` in `packages/plugins/src/loader.ts`
5. Add mock to `packages/aion-sdk/src/testing.ts` in `MockRegistrations` and `createMockAPI()`
6. Re-export types from `packages/aion-sdk/src/types.ts`
7. Optionally add a `define*()` builder in `packages/aion-sdk/src/`
8. Export the builder from `packages/aion-sdk/src/index.ts`
9. Update `protocol.json` `pluginSchema` if this is a breaking change

## Settings Page Requirement

Every plugin **must** register a settings page via `api.registerSettingsPage()`. This provides:
- A dedicated page under Settings in the dashboard sidebar
- An enable/disable toggle rendered automatically at the top of the page
- A place for plugin-specific configuration sections

For plugins with no configuration, register with an empty `sections` array:

```ts
api.registerSettingsPage({
  id: "my-plugin",
  label: "My Plugin",
  description: "What this plugin does.",
  sections: [],
});
```

The `pluginId` field is injected automatically by the plugin loader — do not include it in the definition.

## Testing Plugins

```ts
import { testActivate } from "@agi/sdk/testing";
import * as plugin from "./index.js";

const regs = await testActivate(plugin);
// regs.runtimes, regs.services, regs.actions, regs.hooks, etc.
```

The mock API in `testing.ts` must be kept in sync with `AionimaPluginAPI`. Every `register*` method needs a corresponding mock.
