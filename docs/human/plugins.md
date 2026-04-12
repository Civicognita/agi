# Plugin System

Aionima's plugin system allows extending the gateway with new runtimes, services, tools, editors, and channel integrations. Plugins are discovered at startup, loaded dynamically, and activated with access to the plugin API.

---

## Plugin Architecture

### Discovery

The gateway discovers plugins from multiple sources at startup:

1. **Plugin cache** (`~/.agi/plugins/cache/`) — installed marketplace plugins. The marketplace installer downloads, builds, and places plugins here. This is the primary source for all stack, runtime, and service plugins.

2. **Auto-install** — plugins listed in `config/required-plugins.json` are automatically installed from the marketplace catalog on every startup if missing. This ensures core functionality (runtimes, stacks, services) is always available.

3. **Default search paths** (`{workspace}/.plugins/`, `{workspace}/.aionima/plugins/`) — for development or user-installed plugins.

4. **Channel plugins** (`channels/*`) — channel adapters treated as plugins. Discovered via `discoverChannelPlugins()`.

Plugins are never loaded directly from the marketplace repo — they are fetched from GitHub, built, and cached locally.

### Loading

Each discovered plugin's entry file is dynamically imported (`import()`). The entry module must export an object with an `activate` function:

```typescript
export interface AionimaPlugin {
  activate(api: AionimaPluginAPI): Promise<void>;
  deactivate?(): Promise<void>;
}
```

### Activation

`activate(api)` is called with the plugin API. Plugins register their capabilities by calling methods on `api`. After activation, the registered capabilities are live.

### Deactivation

On gateway shutdown, `deactivate()` is called (if defined) for each loaded plugin, in reverse load order. Plugins should clean up connections, timers, and resources.

---

## Plugin Manifest

Each plugin declares its identity and requirements in a manifest. The manifest can be `aionima-plugin.json` or an `"aionima"` block in `package.json`.

### aionima-plugin.json format

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Adds capability X",
  "author": "Your Name",
  "aionimaVersion": "0.3.0",
  "permissions": ["network", "filesystem.read"],
  "entry": "dist/index.js",
  "projectTypes": ["node", "php"],
  "category": "service"
}
```

### Manifest Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique plugin identifier (kebab-case) |
| `name` | Yes | Human-readable name |
| `version` | Yes | SemVer |
| `description` | Yes | Short description |
| `aionimaVersion` | Yes | Compatible Aionima version (SemVer range) |
| `permissions` | Yes | Permissions the plugin requires |
| `entry` | Yes | Path to the plugin entry file |
| `projectTypes` | No | Project types this plugin handles |
| `category` | No | Plugin category |
| `author` | No | Plugin author |
| `bakedIn` | No | Pre-installed during onboarding, cannot be uninstalled |

### Plugin Capabilities (Provides)

Each plugin declares what it **provides** — the capabilities it registers with the system. A single plugin can provide multiple capabilities. For example, a Redis plugin provides services, runtimes, and stacks.

| Capability | Description |
|-----------|-------------|
| `project-types` | New project types (shown in project creation) |
| `stacks` | Framework stack definitions (e.g. TALL, Next.js) |
| `services` | Infrastructure services (MySQL, Redis, PostgreSQL) |
| `runtimes` | Container runtimes for languages (Node.js, PHP) |
| `system-services` | System-level service management (RustDesk, xRDP) |
| `ux` | Dashboard UI extensions (panels, settings, routes, tabs) |
| `agent-tools` | Tools the AI agent can invoke |
| `skills` | Agent skill definitions |
| `knowledge` | Documentation and knowledge providers |
| `themes` | Visual themes — 21 semantic color properties controlling the entire dashboard, react-fancy components, and charts |
| `workflows` | Multi-step automations and pipelines |
| `channels` | Messaging channel integrations |
| `providers` | LLM provider integrations (Anthropic, OpenAI, Ollama) |

The marketplace Browse tab uses a single "Provides" dropdown to filter by capability, and each plugin card displays multiple capability badges showing everything that plugin provides.

### Plugin Dependencies

Plugins can declare dependencies on other plugins using the `depends` field. When installing a plugin, any missing dependencies are automatically installed from the marketplace catalog. If a dependency can't be found in any catalog, the install fails with an error listing the unresolvable dependencies. Uninstalling a plugin that others depend on is blocked unless forced.

```json
{
  "aionima": {
    "provides": ["project-types"],
    "depends": ["aionima-node-runtime"]
  }
}
```

### Legacy Categories

The `category` field is still supported for backward compatibility. Plugins without an explicit `provides` field automatically derive their capabilities from their category:

| Category | Maps to |
|---------|---------|
| `runtime` | `runtimes` |
| `service` | `services` |
| `project` | `project-types` |
| `stack` | `stacks` |
| `system` | `system-services` |
| `knowledge` | `knowledge` |
| `theme` | `themes` |
| `workflow` | `workflows` |
| `integration` | `channels` |
| `tool`, `editor` | `ux` |

### Permissions

| Permission | What It Grants |
|-----------|---------------|
| `filesystem.read` | Read files within the workspace |
| `filesystem.write` | Write files within the workspace |
| `network` | Make outbound network connections |
| `shell.exec` | Execute shell commands |
| `config.read` | Read gateway configuration |
| `config.write` | Modify gateway configuration |

---

## Plugin API

When `activate(api)` is called, the `api` object provides methods to register capabilities. Here are the key groups:

### Core Registration

| Method | What It Does |
|--------|-------------|
| `registerProjectType(def)` | Register a project type (shown in dashboard Projects) |
| `registerTool(projectType, tool)` | Add a tool to a project type |
| `registerHook(hookName, handler)` | Hook into gateway lifecycle events |
| `registerHttpRoute(method, path, handler)` | Add custom API endpoints |
| `registerRuntime(def)` | Register a container runtime |
| `registerService(def)` | Register an infrastructure service |
| `registerHostingExtension(ext)` | Add fields to the hosting panel |
| `registerRuntimeInstaller(installer)` | Manage runtime version installation |
| `registerChannel(plugin)` | Register a channel adapter |
| `registerProvider(def)` | Register an LLM provider (Anthropic, OpenAI, Ollama, etc.) |

### Universal Extensibility

These capabilities let any plugin add UI, automation, and intelligence:

| Method | What It Does |
|--------|-------------|
| `registerAction(def)` | Add action buttons (run shell commands, call APIs) |
| `registerProjectPanel(def)` | Add tabs to project pages with widgets |
| `registerSettingsSection(def)` | Add config sections to Settings page |
| `registerSkill(def)` | Teach the AI agent new knowledge |
| `registerKnowledge(def)` | Provide documentation under a namespace |
| `registerSystemService(def)` | Manage system services (install/start/stop/restart) |
| `registerTheme(def)` | Add custom color themes |
| `registerAgentTool(def)` | Add tools the AI agent can invoke |
| `registerSidebarSection(def)` | Add navigation sections to the sidebar |
| `registerScheduledTask(def)` | Run tasks on schedules (cron/interval) |
| `registerWorkflow(def)` | Define multi-step automations |

### Accessors

| Method | What It Returns |
|--------|---------------|
| `getConfig()` | The full gateway configuration |
| `getChannelConfig(id)` | Channel-specific configuration |
| `getLogger()` | A scoped logger instance |
| `getWorkspaceRoot()` | Workspace root path |
| `getProjectDirs()` | Configured project directories |

### How Plugin UI Works

The dashboard is a static Vite build — plugins cannot inject React components directly. Instead, all plugin UI is **declarative data** rendered by a generic `WidgetRenderer`. Plugins describe *what* to show (fields, buttons, status cards, tables, markdown) and the dashboard renders it.

Widget types available in project panels:

| Widget Type | Description |
|------------|-------------|
| `field-group` | Form inputs from field definitions |
| `action-bar` | Action buttons that execute registered actions |
| `status-display` | Key-value status cards from an API endpoint |
| `log-stream` | Live log output |
| `markdown` | Rendered markdown content |
| `table` | Data table with columns from an API endpoint |
| `metric` | Single stat card with value from an API endpoint |

---

## Available Lifecycle Hooks

Plugins can register hooks to respond to gateway and agent events:

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

## Required Plugins

Required plugins are auto-installed on gateway startup from the marketplace catalog. They cannot be uninstalled. The list is defined in `config/required-plugins.json`. All plugins live in the Plugin Marketplace repo alongside third-party plugins.

### Project Type Plugins

Project type plugins register categories like Web App, API Service, Static Site, Literature, etc. These define what appears in the New Project dialog and determine which stacks are available.

### Runtime Plugins

Runtime plugins register container images for programming languages. All runtimes use custom GHCR images (`ghcr.io/civicognita/*`) with common extensions and tools pre-installed.

| Plugin | Runtimes | Container Image | Pre-installed |
|--------|----------|----------------|---------------|
| `aionima-node-runtime` | Node.js 24, 22, 20 LTS | `ghcr.io/civicognita/node:{version}` | python3, make, g++, git, corepack |
| `aionima-php-runtime` | PHP 8.5, 8.4, 8.3, 8.2 | `ghcr.io/civicognita/php-apache:{version}` | All common extensions (gd, intl, pdo_pgsql, pdo_mysql, redis, imagick, zip, bcmath, opcache, etc.), Composer, mod_rewrite |

### Service Plugins

Service plugins register shared database and cache containers. Each service uses a custom GHCR image with common extensions pre-installed — no runtime compilation needed.

| Plugin | Versions | Container Image | Pre-installed |
|--------|----------|----------------|---------------|
| `aionima-postgres` | PostgreSQL 17, 16, 15 | `ghcr.io/civicognita/postgres:{version}` | pgvector, PostGIS, pg_trgm, uuid-ossp, hstore |
| `aionima-mysql` | MariaDB 11.4, 10.11, 10.6 | `ghcr.io/civicognita/mariadb:{version}` | utf8mb4, dev-friendly defaults |
| `aionima-redis` | Redis 7.4, 7.2, 6.2 | `ghcr.io/civicognita/redis:{version}` | append-only persistence, LRU eviction |

Each service plugin includes a **Settings page** for installing/uninstalling container images and configuring default credentials.

### Stack Plugins

Stack plugins register framework-specific configurations that projects can add. Stacks compose with runtimes and services — for example, a TALL project uses the PHP runtime, the Laravel stack, the TALL stack, and a PostgreSQL service stack.

| Plugin | Stack | Category | Dependencies |
|--------|-------|----------|-------------|
| `stack-laravel` | Laravel | framework | PHP runtime |
| `stack-tall` | TALL Stack | framework | Laravel stack (Livewire, Alpine.js, Tailwind layered on top) |
| `stack-nextjs` | Next.js | framework | Node runtime |
| `stack-nuxt` | Nuxt | framework | Node runtime |
| `stack-node-app` | Node.js App | framework | Node runtime |
| `stack-php-app` | PHP App | framework | PHP runtime |
| `stack-react-vite` | React (Vite) | framework | Node runtime |
| `stack-static-hosting` | Static Hosting | framework | — |
| `stack-hono` | Hono API | framework | Node runtime |

### plugin-editor

The editor plugin provides the file editing API used by the dashboard Settings page and Knowledge editor. It exposes read/write/tree endpoints for config files and project files.

### WhoDB

Modern database explorer accessible at `https://db.ai.on`. Supports PostgreSQL, MariaDB, SQLite, Redis, and MongoDB with spreadsheet editing, schema visualization, AI-powered SQL (via configured Claude/GPT/Ollama), and data export. The Aion agent can query databases directly via the `query_database` tool.

### Channel Plugins

Channel plugins connect messaging platforms to the agent pipeline. Each channel is implemented as a plugin using `defineChannel()` and registered via `api.registerChannel()`. Built-in channels include:

- **Telegram** — grammy-based adapter supporting text, media, and voice
- **Discord** — discord.js adapter supporting text, media, and threads
- **Gmail** — OAuth2-based email adapter for text messaging
- **Signal** — signal-cli REST adapter for encrypted text messaging
- **WhatsApp** — WhatsApp Business API adapter for text and media

### LLM Provider Plugins

Provider plugins connect the agent pipeline to AI model APIs. Each provider is implemented using `defineProvider()` and registered via `api.registerProvider()`. Built-in providers include:

- **Anthropic** — Claude models (claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5)
- **OpenAI** — GPT models (gpt-4o, gpt-4o-mini, o3)
- **Ollama** — Local models running on Ollama (no API key required)

Provider plugins declare their supported models, API key requirements, and a factory function that creates the provider instance.

---

## Configuring Plugin Preferences

Plugin behavior can be tuned in `aionima.json` under the `plugins` key:

```json
{
  "plugins": {
    "plugin-mysql": {
      "enabled": false
    },
    "plugin-redis": {
      "enabled": true,
      "priority": 10
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `enabled` | Whether the plugin is loaded (default: `true`) |
| `priority` | Route priority when multiple plugins register the same route |

---

## Service Configuration Overrides

Service containers can have their defaults overridden in `aionima.json` under `services.overrides`:

```json
{
  "services": {
    "overrides": {
      "postgres": {
        "enabled": true,
        "port": 5433,
        "env": {
          "POSTGRES_PASSWORD": "secretpassword"
        }
      }
    }
  }
}
```

---

## Writing a Plugin

A minimal plugin:

```typescript
// plugins/plugin-example/src/index.ts
import { createPlugin } from "@aionima/sdk";

export default createPlugin({
  async activate(api) {
    const log = api.getLogger();
    log.info("Example plugin activated");

    // Register an HTTP route
    api.registerHttpRoute("GET", "/api/example/hello", async (req, reply) => {
      reply.send({ message: "Hello from example plugin" });
    });

    // Register a lifecycle hook
    api.registerHook("gateway:startup", async () => {
      log.info("Gateway is up, example plugin ready");
    });
  },

  async deactivate() {
    // clean up
  },
});
```

> **Note:** Always import from `@aionima/sdk`, not `@aionima/plugins`. The SDK re-exports all necessary types and provides the `createPlugin()` factory. See the [SDK documentation](../sdk/overview.md) for full details.

To publish: create the plugin in the marketplace repo under `plugins/plugin-example/`, add a `marketplace.json` entry, and push.
