# @aionima/sdk

Developer SDK for building Aionima plugins. Provides type-safe builders, type re-exports, and testing utilities.

## Install

```bash
pnpm add @aionima/sdk
```

## Quick Start

```ts
import { createPlugin, defineStack, defineRuntime, defineService } from "@aionima/sdk";

export default createPlugin({
  async activate(api) {
    // Register a database stack (shared container)
    api.registerStack(
      defineStack("stack-postgres-17", "PostgreSQL 17")
        .description("PostgreSQL 17 — latest stable")
        .category("database")
        .projectCategories(["app", "web"])
        .requirement({ id: "postgresql", label: "PostgreSQL 17", type: "provided" })
        .guide({ title: "Connection", content: "Use the connection URL from the stack card." })
        .container({
          image: "postgres:17-alpine",
          internalPort: 5432,
          shared: true,
          sharedKey: "postgres-17",
          volumeMounts: () => ["pg17-data:/var/lib/postgresql/data"],
          env: () => ({ POSTGRES_PASSWORD: "aionima-root" }),
          healthCheck: "pg_isready -U postgres",
        })
        .database({
          engine: "postgresql",
          rootUser: "postgres",
          rootPasswordEnvVar: "POSTGRES_PASSWORD",
          setupScript: (ctx) => [
            "psql", "-U", "postgres", "-c",
            `CREATE USER ${ctx.databaseUser} WITH PASSWORD '${ctx.databasePassword}';
             CREATE DATABASE ${ctx.databaseName} OWNER ${ctx.databaseUser};`,
          ],
          teardownScript: (ctx) => [
            "psql", "-U", "postgres", "-c",
            `DROP DATABASE IF EXISTS ${ctx.databaseName}; DROP USER IF EXISTS ${ctx.databaseUser};`,
          ],
          connectionUrlTemplate: "postgresql://{user}:{password}@localhost:{port}/{database}",
        })
        .icon("database")
        .build()
    );
  },
});
```

## Plugin Schema (MPx 1.0)

The plugin schema is versioned alongside the Mycelium Protocol (MPx). Every `register*()` method on `AionimaPluginAPI` accepts a typed definition object.

### Plugin Manifest

Every plugin needs an `"aionima"` field in its `package.json`:

```json
{
  "aionima": {
    "id": "my-plugin",
    "name": "My Plugin",
    "version": "0.1.0",
    "description": "What this plugin does",
    "aionimaVersion": ">=0.3.0",
    "permissions": ["filesystem.read", "network"],
    "entry": "src/index.ts",
    "category": "tool"
  }
}
```

### Permissions

| Permission | Description |
|-----------|-------------|
| `filesystem.read` | Read files from the workspace |
| `filesystem.write` | Write files to the workspace |
| `network` | Make network requests |
| `shell.exec` | Execute shell commands |
| `config.read` | Read configuration |
| `config.write` | Modify configuration |

### Plugin Categories

`runtime` | `service` | `tool` | `editor` | `integration` | `project` | `knowledge` | `theme` | `workflow` | `system` | `stack`

### Registration Methods

Every plugin **must** call `registerSettingsPage()` to provide an enable/disable toggle in the dashboard. Plugins with no configuration use `sections: []`.

| Method | Builder | Description |
|--------|---------|-------------|
| `registerStack()` | `defineStack()` | Composable project stacks |
| `registerRuntime()` | `defineRuntime()` | Container runtime versions |
| `registerService()` | `defineService()` | Infrastructure service containers |
| `registerAction()` | `defineAction()` | Dashboard/agent actions |
| `registerProjectPanel()` | `definePanel()` | Custom panels in project detail |
| `registerSettingsSection()` | `defineSettings()` | Settings page sections |
| `registerSettingsPage()` | - | **Required** — full settings sub-pages with enable/disable toggle |
| `registerAgentTool()` | `defineTool()` | Tools for the agent pipeline |
| `registerSkill()` | `defineSkill()` | Agent skills |
| `registerTheme()` | `defineTheme()` | Dashboard themes |
| `registerKnowledge()` | `defineKnowledge()` | Knowledge bases for agent context |
| `registerWorkflow()` | `defineWorkflow()` | Multi-step automated workflows |
| `registerSidebarSection()` | `defineSidebar()` | Sidebar navigation sections |
| `registerScheduledTask()` | - | Cron/interval background tasks |
| `registerSystemService()` | - | Host-level systemd service management |
| `registerHook()` | - | Lifecycle hook handlers |
| `registerHttpRoute()` | - | Custom HTTP API routes |
| `registerChannel()` | - | Messaging channel adapters |
| `registerDashboardPage()` | - | Pages within existing dashboard domains |
| `registerDashboardDomain()` | - | New top-level dashboard domains |
| `registerSubdomainRoute()` | - | Subdomain routing (e.g. `db.ai.on`) |
| `registerRuntimeInstaller()` | - | Container image install/uninstall |
| ~~`registerHostingExtension()`~~ | - | **Deprecated** — use `registerStack()` |

### Stack System (MPx 1.0)

Stacks are composable, plugin-driven bundles that provide runtime, database, tooling, framework, or workflow capabilities to projects.

**Stack Categories:**

| Category | Purpose | Example |
|----------|---------|---------|
| `runtime` | Programming language version | Node.js 24, PHP 8.5 |
| `database` | Shared database container | PostgreSQL 17, MariaDB 11 |
| `tooling` | Development tools | Redis, Meilisearch |
| `framework` | Framework-specific config | Laravel, Next.js |
| `workflow` | Automated processes | CI/CD pipeline |

**Shared Containers:** Database stacks with `shared: true` share one container across all projects. Each project gets its own database, user, and password within the shared container.

**Requirements:** Stacks declare what they provide (`type: "provided"`) or expect (`type: "expected"`). The UI warns on conflicts.

**Guides:** Markdown usage guides displayed in the stack card.

### Hooks

```ts
api.registerHook("gateway:startup", async () => { /* ... */ });
api.registerHook("project:created", async (project) => { /* ... */ });
```

| Hook | Signature |
|------|-----------|
| `gateway:startup` | `() => Promise<void>` |
| `gateway:shutdown` | `() => Promise<void>` |
| `project:created` | `(project) => Promise<void>` |
| `project:deleted` | `(path) => Promise<void>` |
| `project:hosting:enabled` | `(project) => Promise<void>` |
| `project:hosting:disabled` | `(path) => Promise<void>` |
| `agent:beforeInvoke` | `(ctx) => Promise<ctx>` |
| `agent:afterInvoke` | `(ctx, result) => Promise<void>` |
| `tool:beforeExecute` | `(name, input) => Promise<input>` |
| `tool:afterExecute` | `(name, result) => Promise<result>` |
| `message:beforeSend` | `(msg) => Promise<msg>` |
| `message:afterReceive` | `(msg) => Promise<void>` |
| `config:changed` | `(key, value) => Promise<void>` |

## Testing

```ts
import { testActivate, createMockAPI } from "@aionima/sdk/testing";
import * as myPlugin from "./index.js";

// Quick test — activate and inspect registrations
const regs = await testActivate(myPlugin);
console.log(regs.runtimes);   // RuntimeDefinition[]
console.log(regs.services);   // ServiceDefinition[]
console.log(regs.actions);    // ActionDefinition[]
console.log(regs.hooks);      // { hook, handler }[]

// Advanced — custom config and workspace
const { api, registrations } = createMockAPI({
  config: { plugins: { myPlugin: { port: 9999 } } },
  workspaceRoot: "/tmp/test-workspace",
});
await myPlugin.activate(api);
```

## API Reference

All types are re-exported from `@aionima/sdk` so plugin authors only need one dependency:

```ts
import type {
  AionimaPlugin,
  AionimaPluginAPI,
  StackDefinition,
  RuntimeDefinition,
  ServiceDefinition,
  ActionDefinition,
  // ... all other types
} from "@aionima/sdk";
```

See `src/types.ts` for the complete type surface.
