# Project Config Schema

Per-project configuration files at `~/.agi/{slug}/project.json`.

## Overview

Every managed project has a config file at `~/.agi/{slug}/project.json` where `{slug}` is derived from the project path (e.g., `/home/user/projects/my-app` becomes `home-user-projects-my_app`).

**All reads and writes go through `ProjectConfigManager`** — never read or write project.json directly. The service validates via Zod, emits change events for live WS updates, and handles per-path locking for concurrent access.

## Schema Reference

### Root Object (`.passthrough()`)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | — | Display name |
| `createdAt` | `string` | No | — | ISO 8601 creation timestamp |
| `tynnToken` | `string` | No | — | Tynn project token (external integration) |
| `type` | `string` | No | — | Project type ID (e.g., `"web-app"`, `"api-service"`, `"static-site"`) |
| `category` | `enum` | No | — | One of: `literature`, `app`, `web`, `media`, `administration`, `ops`, `monorepo` |
| `description` | `string` | No | — | Human-readable description |
| `hosting` | `object` | No | — | Hosting config (present when project has been configured for hosting) |
| `magicApps` | `string[]` | No | — | Attached MagicApp IDs |
| `aiModels` | `array` | No | — | AI model dependencies (HuggingFace bindings) |
| `aiDatasets` | `array` | No | — | AI dataset dependencies |
| `iterativeWork` | `object` | No | — | Iterative-work mode toggle — when `enabled: true`, the prompt assembler injects `agi/prompts/iterative-work.md` so Aion participates in the tynn workflow on this project's behalf |

The root uses `.passthrough()` — plugins can store custom keys at the root level and they will survive read/write cycles.

### Iterative Work Object (`.strict()`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `undefined` (treated as off) | When `true`, the system prompt assembler injects `agi/prompts/iterative-work.md` for project-typed requests on this project. Hot-reloads — no restart needed. |
| `cron` | `string` | — | Cron expression consumed by the cron-nudge scheduler (story s118 / t436). When omitted while `enabled: true`, manual fire only (e.g. via `/next`). |

### Hosting Object (`.strict()`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Whether hosting is active |
| `type` | `string` | `"static-site"` | Project type ID |
| `hostname` | `string` | — | Subdomain (e.g., `"my-project"` → `my-project.ai.on`) |
| `docRoot` | `string \| null` | `null` | Document root relative to project dir |
| `startCommand` | `string \| null` | `null` | Shell command to start the project |
| `port` | `number \| null` | `null` | Allocated host port for container mapping |
| `mode` | `"production" \| "development"` | `"production"` | Runtime mode |
| `internalPort` | `number \| null` | `null` | Container internal port override |
| `runtimeId` | `string \| null` | — | Runtime definition ID (from plugin registry) |
| `tunnelUrl` | `string \| null` | — | Active Cloudflare tunnel URL |
| `stacks` | `array` | `[]` | Installed stack instances |

### Stack Instance Object (`.strict()`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stackId` | `string` | Yes | Stack definition ID (e.g., `"stack-node-app"`) |
| `databaseName` | `string` | No | Per-project database name (DB stacks only) |
| `databaseUser` | `string` | No | Per-project database user |
| `databasePassword` | `string` | No | Per-project database password |
| `addedAt` | `string` | Yes | ISO 8601 timestamp |

## Auto-Detection vs User-Set

| Field | Source |
|-------|--------|
| `type` | Auto-detected from project files by `detectProjectDefaults()`, but user can override via UI dropdown or agent tool |
| `category` | Auto-detected from type, user can override |
| `hostname` | Generated from project directory name, user can change in hosting panel |
| `docRoot`, `startCommand` | Auto-detected, user can override |
| `stacks` | Suggested by detection, added/removed by user |

## Plugin Extension

Plugins can store arbitrary keys at the root of `project.json`:

```json
{
  "name": "my-project",
  "myPluginConfig": { "setting": true }
}
```

The `.passthrough()` on the root schema preserves unknown keys during read/write cycles. The hosting sub-object uses `.strict()` and does NOT allow plugin keys.

## Service API

```ts
import { ProjectConfigManager } from "@agi/gateway-core";

const mgr = new ProjectConfigManager({ logger });

// CRUD
mgr.read(path)             // → ProjectConfig | null
mgr.write(path, config)    // validates + persists
mgr.update(path, patch)    // atomic read-merge-write
mgr.create(path, name, opts)
mgr.exists(path)

// Hosting
mgr.readHosting(path)      // → ProjectHosting | null
mgr.updateHosting(path, patch)

// Stacks
mgr.getStacks(path)        // → ProjectStackInstance[]
mgr.addStack(path, instance)
mgr.removeStack(path, stackId)

// Events
mgr.on("changed", ({ projectPath, config, changedKeys }) => { ... })
```

## ADF Facade

Core code can use the `ProjectConfig()` facade:

```ts
import { ProjectConfig } from "@agi/sdk";

const config = ProjectConfig().read(path);
const stacks = ProjectConfig().getStacks(path);
```

## Plugin API

Plugins access project config through their API:

```ts
export default createPlugin({
  async activate(api) {
    const config = api.getProjectConfig(path);
    const stacks = api.getProjectStacks(path);
  },
});
```

## Agent Tools

The `manage_project` agent tool handles all project operations through the service:

| Action | Description |
|--------|-------------|
| `update` | Update name, tynnToken, type, category |
| `hosting_configure` | Update hosting fields |
| `stack_add` / `stack_remove` | Manage stacks |

All actions go through `ProjectConfigManager` — no direct file I/O.

## Zod Schemas

Defined in `config/src/project-schema.ts`:

- `ProjectConfigSchema` — root
- `ProjectHostingSchema` — hosting sub-object
- `ProjectStackInstanceSchema` — stack instance
- `ProjectCategorySchema` — category enum

Types exported from `@agi/config`:
- `ProjectConfig`, `ProjectHosting`, `ProjectStackInstance`, `ProjectCategory`

## Dashboard Tab Architecture

The dashboard project detail page uses **different tabs for different project categories**:

### Code projects (`hasCode: true`)
Categories: `web`, `app`, `monorepo`, `ops`

Show the **Development** tab with the built-in `HostingPanel` component — full container management, stack selection, environment variables, terminal, restart/configure controls.

### Non-code projects (`hasCode: false`)
Categories: `literature`, `media`, `administration`

Do **NOT** show the Development tab. Instead, the project type's plugin provides its own tab via `registerProjectPanel()`:

- **Literature** → "Reader" tab (provided by `plugin-reader-literature`)
- **Media** → "Gallery" tab (provided by `plugin-reader-media`)

These plugin-provided tabs use the declarative widget system (`WidgetRenderer`) with:
- `status-display` — shows container status from plugin HTTP route
- `iframe` — embeds the reader/gallery SPA at the project's `*.ai.on` URL
- `action-bar` — restart/manage actions

### Widget templates

Widget endpoints support `{projectPath}` template substitution:
```json
{ "type": "status-display", "statusEndpoint": "/status?path={projectPath}" }
{ "type": "iframe", "src": "/reader-frame?path={projectPath}", "height": "600px" }
```

The `{projectPath}` is replaced with the current project's path at render time.

### Adding a reader for a new project type

1. Create a marketplace plugin
2. Register a stack with `containerConfig` (nginx + your reader SPA assets)
3. Register a project panel with `registerProjectPanel()` targeting your project type
4. Register HTTP routes for status and iframe redirect
5. The plugin handles hosting transparently — no user interaction needed
