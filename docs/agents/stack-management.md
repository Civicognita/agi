# Stack Management System — Agent Guide

Stacks are composable, plugin-driven bundles that provide runtime, database, tooling, framework, or workflow capabilities to projects. They replace the flat hosting extension fields with a semantic, structured system.

## Key Concepts

- **StackDefinition**: Registered by plugins via `api.registerStack()`. Contains metadata, container config, database config, guides, tools, and scaffolding.
- **ProjectStackInstance**: Persisted per-project in `~/.agi/{projectSlug}/project.json` under `hosting.stacks[]`. Records stackId, DB credentials, and add timestamp.
- **SharedContainerManager**: Database stacks share containers across projects. One PostgreSQL 17 container serves all projects that add the `stack-postgres-17` stack.
- **StackRegistry**: Central store for all registered stack definitions. Supports filtering by project category and stack category.

## File Paths

| File | Purpose |
|------|---------|
| `packages/gateway-core/src/stack-types.ts` | All type definitions |
| `packages/gateway-core/src/stack-registry.ts` | StackRegistry class |
| `packages/gateway-core/src/shared-container-manager.ts` | Shared DB container lifecycle |
| `packages/gateway-core/src/stack-api.ts` | REST routes for stacks |
| `packages/plugins/src/types.ts` | `registerStack()` on AionimaPluginAPI |
| `packages/plugins/src/registry.ts` | Stack storage in PluginRegistry |
| `packages/plugins/src/loader.ts` | `registerStack` wiring in createPluginAPI |
| `ui/dashboard/src/components/StackManager.tsx` | Stack list + add button |
| `ui/dashboard/src/components/StackCard.tsx` | Single stack display |
| `ui/dashboard/src/components/StackPicker.tsx` | Stack selection modal |
| `ui/dashboard/src/components/ContainerTerminal.tsx` | xterm.js in-container shell |
| `ui/dashboard/src/components/TerminalArea.tsx` | Logs/Terminal tabs |

## Creating a Stack Plugin

1. In your plugin's `activate()` function, call `api.registerStack()`:

```ts
api.registerStack({
  id: "stack-redis-7",
  label: "Redis 7",
  description: "Redis 7 in-memory store.",
  category: "database",
  projectCategories: ["app", "web"],
  requirements: [{ id: "redis", label: "Redis 7", type: "provided" }],
  guides: [{ title: "Usage", content: "Connect via `redis://localhost:{port}`" }],
  containerConfig: {
    image: "ghcr.io/civicognita/redis:7",
    internalPort: 6379,
    shared: true,
    sharedKey: "redis-7",
    volumeMounts: () => ["aionima-redis-7-data:/data"],
    env: () => ({}),
    healthCheck: "redis-cli ping",
  },
  tools: [],
});
```

2. For database stacks, also provide `databaseConfig` with setup/teardown scripts.

3. For runtime stacks (no container), omit `containerConfig`. The stack just provides metadata, guides, and tools.

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/stacks` | List all stacks (optional `?category=web`) |
| `GET` | `/api/stacks/:id` | Single stack detail |
| `POST` | `/api/hosting/stacks/add` | Add stack to project (`{ path, stackId }`) |
| `POST` | `/api/hosting/stacks/remove` | Remove stack from project |
| `GET` | `/api/hosting/stacks` | List project's installed stacks (`?path=...`) |
| `GET` | `/api/shared-containers` | List all shared containers |
| `GET` | `/api/shared-containers/:key/connection` | Per-project DB connection info |

## Container Terminal

WebSocket messages (via `/ws`):

| Message | Direction | Payload |
|---------|-----------|---------|
| `container-terminal:open` | client->server | `{ projectPath, cols?, rows? }` |
| `container-terminal:opened` | server->client | `{ sessionId, containerName }` |
| `container-terminal:data` | server->client | `{ sessionId, data }` |
| `container-terminal:input` | client->server | `{ sessionId, data }` |
| `container-terminal:resize` | client->server | `{ sessionId, cols, rows }` |
| `container-terminal:close` | client->server | `{ sessionId }` |
| `container-terminal:exited` | server->client | `{ sessionId, code }` |

## Migration Notes

- `registerHostingExtension()` is deprecated but still works. Existing extension fields render alongside stacks.
- Old projects without `hosting.stacks[]` simply show no stacks — users add them manually.
- Shared containers persist in `~/.agi/shared-containers.json`.
