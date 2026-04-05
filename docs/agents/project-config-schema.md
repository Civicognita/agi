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

The root uses `.passthrough()` — plugins can store custom keys at the root level and they will survive read/write cycles.

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
import { ProjectConfigManager } from "@aionima/gateway-core";

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
import { ProjectConfig } from "@aionima/sdk";

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

Types exported from `@aionima/config`:
- `ProjectConfig`, `ProjectHosting`, `ProjectStackInstance`, `ProjectCategory`
