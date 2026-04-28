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

#### `registerProvider()` Extended API

Provider definitions support two optional extension methods that enhance the Settings UI:

**`.fields()`** — declares the configuration fields the provider requires (API key, base URL, model selection, etc.). The dashboard renders these fields in the Settings > Providers card:

```typescript
api.registerProvider(
  defineProvider("my-provider", "My Provider")
    .fields([
      { id: "apiKey", label: "API Key", type: "password", placeholder: "sk-..." },
      { id: "baseUrl", label: "Base URL", type: "text", placeholder: "https://api.example.com" },
      { id: "model", label: "Default Model", type: "select",
        options: [{ value: "my-model-v1", label: "My Model v1" }] },
    ])
    .checkBalance(async (config) => {
      // Return balance info or throw on failure
      return { balance: "$5.00", currency: "USD" };
    })
    .build()
);
```

**`.checkBalance(handler)`** — registers an async balance check handler. When the user clicks "Check Balance" in the provider settings card, this handler is invoked with the provider's current config values. Return `{ balance: string; currency?: string }` or throw an error to display in the UI.

Field type reference:

| `type` | Description |
|--------|-------------|
| `password` | Masked text input, never logged |
| `text` | Plain text input |
| `number` | Numeric input with optional `min`, `max`, `step` |
| `select` | Dropdown — provide `options: [{ value, label }]` |

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

Use the `defineScan()` builder from `@agi/sdk` to create `ScanProviderDefinition` objects. See [Builder Reference](../sdk/builders.md#definescanid-name) for details.

### Workers

| Method | Parameter Type | Description |
|--------|---------------|-------------|
| `registerWorker(def)` | `WorkerDefinition` | Register a background task worker for Taskmaster dispatch |

Use the `defineWorker()` builder from `@agi/sdk` to create `WorkerDefinition` objects. See [Builder Reference](../sdk/builders.md#defineworkerid-name) for details.

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

All types listed in this document are available from `@agi/sdk`:

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
} from "@agi/sdk";
```

The SDK re-exports types from `@agi/plugins`, `@agi/channel-sdk`, and `@agi/gateway-core` so that plugin authors only need a single import source.

---

## Plugin Rebuild

The gateway can rebuild installed plugins from source without uninstalling them. This is useful when the AGI SDK version changes or when a plugin's TypeScript source is updated outside of a full reinstall.

**Dashboard:** Go to Marketplace > Installed. Each installed plugin card has a **Rebuild** button. The tab header also shows a **Rebuild All** button that rebuilds every installed plugin in sequence.

**API:**
- `POST /api/marketplace/rebuild/:name` — rebuild a single plugin by name
- `POST /api/marketplace/rebuild-all` — rebuild all installed plugins; returns `{ rebuilt: string[], failed: string[] }`

**Automatic rebuild on upgrade:** When `upgrade.sh` detects that the `@agi/sdk` version has changed, it writes a `.plugins-need-rebuild` sentinel file to the deploy directory. The gateway reads this file on boot and triggers a rebuild pass for all installed plugins before activating them.

---

## Hot-Reload Behavior

All gateway configuration is hot-swappable — read from disk at use time, never cached at boot. This applies to:

- `gateway.json` — all runtime config keys
- Plugin enable/disable state — toggling in the dashboard takes effect immediately without restarting the gateway
- Provider credentials — updated API keys are picked up on the next agent invocation
- Channel config — channel adapter settings are re-read on the next message cycle

Plugins themselves are **not** hot-reloaded automatically. A full plugin reload (deactivate + re-activate) requires a gateway restart or an explicit rebuild via the dashboard. The `config:changed` hook fires on every config write and can be used by plugins to react to setting changes without a restart.

---

## Import Namespace

All SDK imports use the `@agi/*` namespace:

```typescript
import { createPlugin } from "@agi/sdk";
import type { AionimaPlugin, AionimaPluginAPI } from "@agi/sdk";
import { testActivate } from "@agi/sdk/testing";
```

> **Deprecation notice:** The `@aionima/*` import namespace (`@aionima/sdk`, `@aionima/plugins`, `@aionima/channel-sdk`) is deprecated. Existing plugins using these imports are automatically migrated during the next gateway upgrade. New plugins must use `@agi/*`.
