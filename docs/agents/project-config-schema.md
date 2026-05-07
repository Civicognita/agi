# Project Config Schema

Per-project configuration files at `<projectPath>/project.json` (s140 + s150 model).

> **Reconciliation reference:** the rationale for every shape decision below — including why `category` and `hosting.containerKind` were dropped, why every project has `repos/`, and how `type` drives container shape — lives in `_discovery/pm-hosting-reconciliation.md`. That doc is canonical for the s150 PM/Hosting alignment work.

## Overview

Every managed project has a config file at `<projectPath>/project.json` (the s140 root location; pre-s130 `~/.agi/{slug}/project.json` and intermediate `<projectPath>/.agi/project.json` are migrated transparently and the legacy locations are no longer authoritative). `<projectPath>` is `<workspaceRoot>/<slug>/` — typically `~/_projects/<slug>/`.

**All reads and writes go through `ProjectConfigManager`** — never read or write project.json directly. The service validates via Zod, emits change events for live WS updates, and handles per-path locking for concurrent access.

The s150 architecture enforces a **single classifier**: `type` is the source of truth for what a project is. The legacy `category` field has been retired (s150 t630/t632), and `hosting.containerKind` has been retired (s150 t630/t634). The container shape — code-served vs Desktop-served — is derived from `type` via `servesDesktopFor(type, registry)`.

## On-disk layout

Every project — regardless of type — has the same skeleton:

```
<projectPath>/
├── project.json            # canonical config (the ONLY one — no .agi/project.json)
├── repos/                  # UNIVERSAL — every project has a repos/ directory
│   └── <repo_name>/        # one or more sub-repos (clones, project-owned scratch)
├── k/
│   ├── plans/              # per-project plans
│   ├── knowledge/          # markdown notes, design docs, references
│   ├── pm/                 # PM-Lite kanban data
│   ├── memory/             # per-project Aion memory
│   └── chat/               # per-project chat sessions
├── sandbox/                # agent scratch space — keeps chat-tool cage
│                           #   primitive from writing into repos/ or k/
└── .trash/                 # soft-delete buffer
```

The `<workspaceRoot>/.new/` skeleton (s150 t633) is the source of truth for new-project scaffolding. Boot seeds it from agi-shipped templates the first time and prefers the workspace copy thereafter, so owners can customize the skeleton without forking agi.

## Schema Reference

### Root Object (`.passthrough()`)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | — | Display name |
| `createdAt` | `string` | No | — | ISO 8601 creation timestamp |
| `tynnToken` | `string` | No | — | Tynn project token (external integration) |
| `type` | `string` | No | — | **The single classifier.** A registered project type id (e.g., `"web-app"`, `"api-service"`, `"static-site"`, `"ops"`, `"writing"`). |
| `description` | `string` | No | — | Free-form Purpose textarea — what this project is for. Visible to Aion as project context. |
| `hosting` | `object` | No | — | Hosting config (present when project has been configured for hosting) |
| `magicApps` | `string[]` | No | — | Attached MagicApp IDs (Desktop-served projects render these as tiles) |
| `repos` | `array` | No | — | Sub-repo entries served from this project (multi-repo case) |
| `aiModels` | `array` | No | — | AI model dependencies (HuggingFace bindings) |
| `aiDatasets` | `array` | No | — | AI dataset dependencies |
| `iterativeWork` | `object` | No | — | Iterative-work mode toggle |
| `mcp` | `object` | No | — | Per-project MCP servers (s118 / Wish #7) |

The root uses `.passthrough()` — plugins can store custom keys at the root level and they will survive read/write cycles. Boot-time s150 sweep (`migrateAllProjectConfigShapes`) cleans legacy keys (`category`, retired `type` ids) idempotently.

> **Removed (s150):** `category` is no longer surfaced from this schema. `ProjectCategorySchema` export remains for back-compat with `magic-app-schema.ts` until that schema migrates to `projectTypes`. Boot sweep strips on-disk values.

### Hosting Object (`.passthrough()`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Whether hosting is active |
| `type` | `string` | `"static-site"` | Project type ID (mirrors top-level `type`) |
| `hostname` | `string` | — | Subdomain (e.g., `"my-project"` → `my-project.ai.on`) |
| `docRoot` | `string \| null` | `null` | Document root relative to project dir (code-served only) |
| `startCommand` | `string \| null` | `null` | Shell command to start the project (code-served only) |
| `port` | `number \| null` | `null` | Allocated host port for container mapping |
| `mode` | `"production" \| "development"` | `"production"` | Runtime mode |
| `internalPort` | `number \| null` | `null` | Container internal port override |
| `runtimeId` | `string \| null` | — | Runtime definition ID (from plugin registry) |
| `tunnelUrl` | `string \| null` | — | Active Cloudflare tunnel URL |
| `tunnelId` | `string \| null` | — | Named tunnel ID (persists across restarts) |
| `viewer` | `string` | — | MagicApp ID used as the content viewer for the project's `*.ai.on` URL |
| `mapps` | `string[]` | — | List of MApp IDs installed in this project's Desktop tile bundle (Desktop-served only) |
| `stacks` | `array` | `[]` | Installed stack instances (code-served only after s150 t635) |

> **Removed (s150):** `containerKind` is no longer schema-enforced. Dispatch reads `type` via `isDesktopServedType` instead. The dashboard payload still surfaces a computed `containerKind` for back-compat consumers; that surface lands gone in a follow-up SDK rev.

### Stack Instance Object (`.strict()`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stackId` | `string` | Yes | Stack definition ID (e.g., `"stack-node-app"`) |
| `databaseName` | `string` | No | Per-project database name (DB stacks only) |
| `databaseUser` | `string` | No | Per-project database user |
| `databasePassword` | `string` | No | Per-project database password |
| `addedAt` | `string` | Yes | ISO 8601 timestamp |

### Repo Entry Object (`.strict()`)

For multi-repo projects, each entry under `repos[]` describes a clone bind-mounted into `<projectPath>/repos/<name>/`. See `config/src/project-schema.ts` `ProjectRepoSchema` for the full field list (`name`, `url`, `branch`, `port`, `startCommand`, `isDefault`, `externalPath`, `attachedStacks`, etc.).

### Iterative Work Object (`.strict()`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `undefined` | When `true`, the system prompt assembler injects `agi/prompts/iterative-work.md` for project-typed requests on this project. Hot-reloads — no restart needed. |
| `cadence` | `enum` | — | User-picked cadence (`30m`, `1h`, `5h`, `12h`, `1d`, `5d`, `1w`). Auto-staggered to a cron expression at save time. |
| `cron` | `string` | — | Cron expression. When `cadence` is set, this is auto-computed; when only `cron` is set (legacy), it remains the source of truth. |

## Project type → container shape

The `type` field discriminates two container-shape paths:

- **Desktop-served** (`servesDesktopFor(type)` returns `true`): types `ops`, `media`, `literature`, `documentation`, `backup-aggregator`. The container is the Aion Desktop bundle (light Caddy + nginx:alpine + per-project `hosting.mapps[]`). Code in `repos/` is metadata or content; the Desktop renders MApp tiles and serves them.
- **Code-served** (default): types `web-app`, `static-site`, `api-service`, `php-app`, `art`, `writing`. The container image + mounts come from the type registry + installed stacks; the project's `repos/` produces the served output (`npm start`, `nginx`-on-`dist`, `apache`-on-`php`, etc.).

When ambiguous, `servesDesktopFor` consults the type registry's explicit `servesDesktop` flag first, then the `DESKTOP_SERVED_TYPES` / `CODE_SERVED_TYPES` sets, then a category-set fallback for legacy plugins. See `agi/packages/gateway-core/src/project-types.ts`.

> **Retired (s150 t640):** `monorepo` was removed from the type registry. Every project IS a monorepo per the universal-monorepo directive; a sibling "monorepo" type contradicts the model. The boot sweep remaps existing `type: "monorepo"` to `"web-app"` idempotently.

## Migration paths

Two boot-time sweeps converge the workspace on the s150 model on every gateway start:

1. **Folder-layout sweep** (`migrateAllProjectsToFolderLayout`, s130 t523): ensures every project has the canonical skeleton (`k/`, `repos/`, `sandbox/`, `.trash/`).
2. **Shape sweep** (`migrateAllProjectConfigShapes`, s150 t632/t635/t640): drops legacy `category`, drops `hosting.containerKind`, ensures top-level `type` is set, removes `.agi/project.json` debris, strips stacks from Desktop-served projects, remaps retired type ids.

Both are idempotent. Already-migrated projects are silent no-ops; only changes log to the boot output.

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
| `update` | Update name, tynnToken, type, description |
| `hosting_configure` | Update hosting fields |
| `stack_add` / `stack_remove` | Manage stacks (code-served projects only) |

All actions go through `ProjectConfigManager` — no direct file I/O.

## Zod Schemas

Defined in `config/src/project-schema.ts`:

- `ProjectConfigSchema` — root
- `ProjectHostingSchema` — hosting sub-object
- `ProjectStackInstanceSchema` — stack instance
- `ProjectRepoSchema` — sub-repo entry
- `ProjectMcpServerSchema` / `ProjectMcpSchema` — per-project MCP servers
- `ProjectCategorySchema` — legacy enum (kept for back-compat consumers)

Types exported from `@agi/config`:
- `ProjectConfig`, `ProjectHosting`, `ProjectStackInstance`, `ProjectRepo`, `ProjectMcpServer`, `ProjectMcp`

## Dashboard surface

After s150 t636/t637/t638 the project detail page is type-driven, not category-driven:

- **Hosting tab** is universal (every project has a network face). Inside, the panel adapts to `isDesktopServedType(type)`:
  - Desktop-served → MApps list input visible; `docRoot` / `startCommand` hidden.
  - Code-served → `docRoot` / `startCommand` visible; MApps list hidden.
- **MagicApps tab** was retired; the picker now renders inline below the Hosting card when type is Desktop-served.
- **Purpose** is a free-form textarea bound to `description` (was a `category` Select).
- **Tab clutter trim:** primary tabs are Details / Editor / Hosting / Activity; secondary tabs (Repository / Environment / TaskMaster / Iterative Work / MCP / plugin-* / Security) collapse into a "More…" overflow Select.
