# Aionima SDK Overview

The Aionima SDK (`@aionima/sdk`) is the public API for building marketplace plugins. It provides a `createPlugin()` factory, 14 chainable `define*()` builders, and type-safe access to the full plugin registration surface.

---

## Import Convention

Always import from `@aionima/sdk`:

```typescript
import { createPlugin, defineStack, defineService } from "@aionima/sdk";
```

Never import from `@aionima/plugins` directly — the SDK re-exports all necessary types. Direct imports from internal packages bypass the public API contract and may break across versions.

---

## Creating a Plugin

Every plugin uses the `createPlugin()` factory. It takes an object with `activate` (required) and `deactivate` (optional) methods:

```typescript
import { createPlugin, defineService, defineSettings } from "@aionima/sdk";

export default createPlugin({
  async activate(api) {
    const log = api.getLogger();
    log.info("My plugin activated");

    // Register a service
    const redis = defineService("redis", "Redis")
      .description("In-memory data store")
      .containerImage("redis:7.4-alpine")
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

## ADF Note

The SDK also exports ADF (Application Development Framework) facades — `Log()`, `Config()`, `Workspace()` — but these are for **AGI core code only**, not plugins. Plugins get the same capabilities through the plugin API:

| ADF Facade | Plugin Equivalent |
|------------|------------------|
| `Log()` | `api.getLogger()` |
| `Config()` | `api.getConfig()` |
| `Workspace()` | `api.getWorkspaceRoot()` |

Never use ADF facades in plugin code.

---

## Further Reading

- [Builder Reference](builders.md) — All 14 builders with methods and examples
- [Plugin API Reference](plugin-api.md) — Full `AionimaPluginAPI` interface
- [Testing Plugins](testing.md) — `testActivate()` and mock API usage
