# Aionima SDK Overview

The Aionima SDK (`@agi/sdk`) is the public API for building marketplace plugins. It provides a `createPlugin()` factory, 14 chainable `define*()` builders, and type-safe access to the full plugin registration surface.

---

## Import Convention

Always import from `@agi/sdk`:

```typescript
import { createPlugin, defineStack, defineService } from "@agi/sdk";
```

Never import from `@agi/plugins` directly — the SDK re-exports all necessary types. Direct imports from internal packages bypass the public API contract and may break across versions.

---

## Creating a Plugin

Every plugin uses the `createPlugin()` factory. It takes an object with `activate` (required) and `deactivate` (optional) methods:

```typescript
import { createPlugin, defineService, defineSettings } from "@agi/sdk";

export default createPlugin({
  async activate(api) {
    const log = api.getLogger();
    log.info("My plugin activated");

    // Register a service
    const redis = defineService("redis", "Redis")
      .description("In-memory data store")
      .containerImage("ghcr.io/civicognita/redis:7.4")
      .defaultPort(6379)
      .healthCheck("redis-cli ping")
      .build();
    api.registerService(redis);

    // Register a settings page
    const settings = defineSettings("redis-settings", "Redis")
      .description("Manage Redis versions")
      .configPath("services.overrides.redis")
      .field({ key: "port", label: "Port", type: "number", default: 6379 })
      .build();
    api.registerSettingsSection(settings);

    // Register lifecycle hooks
    api.registerHook("gateway:startup", async () => {
      log.info("Redis plugin ready");
    });
  },

  async deactivate() {
    // Clean up connections, timers, etc.
  },
});
```

---

## Builder → Registration Mapping

Each `define*()` builder creates a definition object that you register via the corresponding `api.register*()` method:

| Builder | Registers via | Use case |
|---------|--------------|----------|
| `defineStack()` | `api.registerStack()` | Framework/runtime/database stacks |
| `defineRuntime()` | `api.registerRuntime()` | Runtime version definitions |
| `defineService()` | `api.registerService()` | Container services (MySQL, Redis, etc.) |
| `defineAction()` | `api.registerAction()` | UI/shell/API action buttons |
| `definePanel()` | `api.registerProjectPanel()` | Project dashboard panels with widgets |
| `defineSettings()` | `api.registerSettingsSection()` | Config UI sections on the Settings page |
| `defineTool()` | `api.registerAgentTool()` | Tools the AI agent can invoke |
| `defineSkill()` | `api.registerSkill()` | Agent skill definitions |
| `defineTheme()` | `api.registerTheme()` | Visual color themes |
| `defineKnowledge()` | `api.registerKnowledge()` | Documentation under a namespace |
| `defineWorkflow()` | `api.registerWorkflow()` | Multi-step automations and pipelines |
| `defineSidebar()` | `api.registerSidebarSection()` | Dashboard navigation sections |
| `defineChannel()` | `api.registerChannel()` | Messaging channel adapters |
| `defineProvider()` | `api.registerProvider()` | LLM provider integrations |

All builders follow the same pattern: construct with required identifiers, chain optional methods, call `.build()` to get the definition object, then register it with `api`.

---

## Plugin Lifecycle

### Activation

When the gateway starts, it discovers and loads plugins. Each plugin's `activate(api)` is called with a `AionimaPluginAPI` instance scoped to that plugin. During activation, plugins register all their capabilities by calling `api.register*()` methods.

### Deactivation

On gateway shutdown, `deactivate()` is called (if defined) for each loaded plugin in reverse load order. Plugins should clean up connections, timers, file handles, and other resources.

---

## ADF — Application Development Framework

ADF is a module-scoped singleton for AGI core code. It provides global framework helpers — logging, config access, workspace info, security scanning, and project/system config — without threading dependencies through every call site.

**Plugins must not use ADF.** Plugins receive equivalent capabilities through `AionimaPluginAPI` (see mapping table below).

### Initialization

ADF is initialized once at gateway boot before any plugins activate:

```typescript
import { initADF } from "@agi/sdk";

initADF({
  logger,
  config: rawConfig,
  workspaceRoot: "/home/wishborn/temp_core",
  projectDirs: [...],
  security: securityModule,      // optional — requires @agi/security
  projectConfig: projectConfigMgr, // optional
  systemConfig: systemConfigSvc,   // optional
});
```

To get the raw context object after initialization:

```typescript
import { getADFContext } from "@agi/sdk";

const ctx = getADFContext(); // throws if initADF() was not called
```

### `ADFContext` Interface

```typescript
interface ADFContext {
  logger: ADFLogger;
  config: Record<string, unknown>;
  workspaceRoot: string;
  projectDirs: string[];
  security?: ADFSecurityContext;       // available when @agi/security is loaded
  projectConfig?: ADFProjectConfigContext; // available when ProjectConfigManager is init'd
  systemConfig?: ADFSystemConfigContext;   // available when SystemConfigService is init'd
}
```

### The Six Facades

Import any facade from `@agi/sdk`:

```typescript
import { Log, Config, Workspace, Security, ProjectConfig, SystemConfig } from "@agi/sdk";
```

#### `Log()`

Returns the ADF component logger. Provides `debug`, `info`, `warn`, and `error` methods.

```typescript
Log().info("Gateway started");
Log().error("Unhandled exception in pipeline");
```

#### `Config()`

Returns a dot-path accessor over `gateway.json`. Always reads from the snapshot captured at `initADF()` — for live reads use `SystemConfig()`.

```typescript
const enabled = Config().get<boolean>("hosting.enabled");
const port = Config().getOrThrow<number>("gateway.port");
const hasKey = Config().has("features.experimental");
```

Methods: `.get<T>(path)`, `.getOrThrow<T>(path)`, `.has(path)`.

#### `Workspace()`

Returns workspace root and project directory paths.

```typescript
const { root, projects } = Workspace();
// root    → "/home/wishborn/temp_core"
// projects → ["/home/wishborn/temp_core/my-project", ...]
```

#### `Security()`

Returns the security scanning facade. Throws if `@agi/security` is not loaded.

```typescript
const scan = await Security().runScan({
  scanTypes: ["mapp", "deps"],
  targetPath: "/home/wishborn/.agi/mapps/civicognita/reader.json",
  severityThreshold: "medium",
});
const findings = Security().getFindings(scan.scanId);
const providers = Security().getProviders();
```

#### `ProjectConfig()`

Read-only access to per-project config files. Throws if `ProjectConfigManager` is not initialized.

```typescript
const cfg = ProjectConfig().read("/home/wishborn/temp_core/my-project");
const hosting = ProjectConfig().readHosting("/home/wishborn/temp_core/my-project");
const stacks = ProjectConfig().getStacks("/home/wishborn/temp_core/my-project");
```

#### `SystemConfig()`

Read/write access to `gateway.json`. Reads directly from disk; writes are persisted immediately. Throws if `SystemConfigService` is not initialized.

```typescript
const allConfig = SystemConfig().read();
const channelEnabled = SystemConfig().readKey("channels.telegram.enabled");
SystemConfig().patch("hosting.port", 3000);
```

### ADF Facade → Plugin Equivalent

| ADF Facade | Plugin Equivalent | Notes |
|------------|------------------|-------|
| `Log()` | `api.getLogger()` | Same `ADFLogger` interface |
| `Config()` | `api.getConfig()` | Plugin config is scoped to plugin namespace |
| `Workspace()` | `api.getWorkspaceRoot()` | Returns root path only |
| `Security()` | — | No plugin equivalent; plugins don't run scans |
| `ProjectConfig()` | — | No plugin equivalent |
| `SystemConfig()` | — | No plugin equivalent; use `api.getConfig()` for plugin settings |

Never use ADF facades in plugin code — use `AionimaPluginAPI` instead.

---

## Further Reading

- [ADF Reference](adf.md) — Application Development Framework facades and initialization
- [Builder Reference](builders.md) — All 16 builders with methods and examples
- [Plugin API Reference](plugin-api.md) — Full `AionimaPluginAPI` interface
- [UI Components](ui-components.md) — react-fancy, fancy-code, fancy-sheets, react-echarts
- [Testing Plugins](testing.md) — `testActivate()` and mock API usage
- [MagicApps (MApps)](magic-apps.md) — Declarative JSON apps: schema, builder API, form system, and widget types
