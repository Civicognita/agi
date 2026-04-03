# Plugin API Reference

When `activate(api)` is called, the `api` parameter is an `AionimaPluginAPI` instance. This document lists every method available on the API.

---

## Registration Methods

### Core Infrastructure

| Method | Parameter Type | Description |
|--------|---------------|-------------|
| `registerProjectType(def)` | `ProjectTypeDefinition` | Register a project type (shown in dashboard Projects) |
| `registerTool(projectType, tool)` | `string, ProjectTypeTool` | Add a tool to a project type |
| `registerRuntime(def)` | `RuntimeDefinition` | Register a container runtime |
| `registerService(def)` | `ServiceDefinition` | Register an infrastructure service |
| `registerStack(def)` | `StackDefinition` | Register a framework stack |
| `registerRuntimeInstaller(installer)` | `RuntimeInstaller` | Manage runtime version installation |
| `registerHostingExtension(ext)` | `HostingExtension` | Add fields to the hosting panel |

### Channels & Providers

| Method | Parameter Type | Description |
|--------|---------------|-------------|
| `registerChannel(plugin)` | `AionimaChannelPlugin` | Register a messaging channel adapter |
| `registerProvider(def)` | `LLMProviderDefinition` | Register an LLM provider (Anthropic, OpenAI, Ollama, etc.) |

### Dashboard UI

| Method | Parameter Type | Description |
|--------|---------------|-------------|
| `registerAction(def)` | `ActionDefinition` | Add action buttons (run shell commands, call APIs) |
| `registerProjectPanel(def)` | `ProjectPanelDefinition` | Add tabs to project pages with widgets |
| `registerSettingsSection(def)` | `SettingsSectionDefinition` | Add config sections to the Settings page |
| `registerSettingsPage(def)` | `SettingsPageDefinition` | Add a full settings page |
| `registerDashboardPage(def)` | `DashboardInterfacePageDefinition` | Add a custom dashboard page |
| `registerDashboardDomain(def)` | `DashboardInterfaceDomainDefinition` | Add a dashboard domain grouping |
| `registerDashboardTab(projectType, tab)` | `string, DashboardTabDef` | Add a tab to a project type's dashboard |
| `registerSidebarSection(def)` | `SidebarSectionDefinition` | Add navigation sections to the sidebar |
| `registerSubdomainRoute(def)` | `SubdomainRouteDefinition` | Register a subdomain route handler |

### Agent & Intelligence

| Method | Parameter Type | Description |
|--------|---------------|-------------|
| `registerAgentTool(def)` | `AgentToolDefinition` | Add tools the AI agent can invoke |
| `registerSkill(def)` | `SkillRegistration` | Teach the AI agent new knowledge |
| `registerKnowledge(def)` | `KnowledgeNamespace` | Provide documentation under a namespace |

### System

| Method | Parameter Type | Description |
|--------|---------------|-------------|
| `registerSystemService(def)` | `SystemServiceDefinition` | Manage system services (install/start/stop/restart) |
| `registerTheme(def)` | `ThemeDefinition` | Add custom color themes |
| `registerScheduledTask(def)` | `ScheduledTaskDefinition` | Run tasks on schedules (cron/interval) |
| `registerWorkflow(def)` | `WorkflowDefinition` | Define multi-step automations |

### Security

| Method | Parameter Type | Description |
|--------|---------------|-------------|
| `registerScanProvider(def)` | `ScanProviderDefinition` | Register a security scan provider (SAST, SCA, secrets, etc.) |

Use the `defineScan()` builder from `@aionima/sdk` to create `ScanProviderDefinition` objects. See [Builder Reference](../sdk/builders.md#definescanid-name) for details.

### Workers

| Method | Parameter Type | Description |
|--------|---------------|-------------|
| `registerWorker(def)` | `WorkerDefinition` | Register a background task worker for Taskmaster dispatch |

Use the `defineWorker()` builder from `@aionima/sdk` to create `WorkerDefinition` objects. See [Builder Reference](../sdk/builders.md#defineworkerid-name) for details.

### Lifecycle

| Method | Parameter Type | Description |
|--------|---------------|-------------|
| `registerHook(hook, handler)` | `keyof AionimaHookMap, handler` | Hook into gateway lifecycle events |
| `registerHttpRoute(method, path, handler)` | `string, string, RouteHandler` | Add custom API endpoints |

---

## Accessor Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `getConfig()` | `Record<string, unknown>` | The full gateway configuration |
| `getChannelConfig(id)` | `{ enabled: boolean; config: Record<string, unknown> } \| undefined` | Channel-specific configuration |
| `getLogger()` | `ComponentLogger` | A scoped logger instance |
| `getWorkspaceRoot()` | `string` | Workspace root path |
| `getProjectDirs()` | `string[]` | Configured project directories |

---

## Available Lifecycle Hooks

Pass these hook names to `api.registerHook()`:

| Hook | When It Fires |
|------|-------------|
| `gateway:startup` | After all plugins are activated |
| `gateway:shutdown` | Before the gateway shuts down |
| `project:created` | When a new project is registered |
| `project:deleted` | When a project is removed |
| `project:hosting:enabled` | When hosting is enabled for a project |
| `project:hosting:disabled` | When hosting is disabled |
| `agent:beforeInvoke` | Before each LLM API call (can modify context) |
| `agent:afterInvoke` | After each LLM API call |
| `tool:beforeExecute` | Before a tool is executed |
| `tool:afterExecute` | After a tool returns a result |
| `message:beforeSend` | Before a message is sent to a channel |
| `message:afterReceive` | After a message is received from a channel |
| `config:changed` | When a config value changes (hot-reload) |

---

## Type Re-Exports

All types listed in this document are available from `@aionima/sdk`:

```typescript
import type {
  AionimaPlugin,
  AionimaPluginAPI,
  AionimaPluginManifest,
  AionimaPermission,
  ActionDefinition,
  ActionScope,
  ActionHandler,
  PanelWidget,
  ProjectPanelDefinition,
  SettingsSectionDefinition,
  SkillRegistration,
  KnowledgeNamespace,
  SystemServiceDefinition,
  ThemeDefinition,
  AgentToolDefinition,
  SidebarSectionDefinition,
  ScheduledTaskDefinition,
  WorkflowDefinition,
  WorkflowStep,
  RuntimeDefinition,
  ServiceDefinition,
  StackDefinition,
  LLMProviderDefinition,
  AionimaChannelPlugin,
} from "@aionima/sdk";
```

The SDK re-exports types from `@aionima/plugins`, `@aionima/channel-sdk`, and `@aionima/gateway-core` so that plugin authors only need a single import source.
