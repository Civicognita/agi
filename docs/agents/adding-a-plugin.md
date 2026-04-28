# Adding a New Plugin

This guide covers creating a plugin for the Aionima marketplace. All plugins live in the marketplace repo (`Civicognita/agi-marketplace`), not in the AGI repo. Use any existing plugin in `plugins/plugin-*/` in the marketplace repo as reference.

## UI is a contract — use ADF primitives, file bugs upstream

Any dashboard surface a plugin renders MUST consume the ADF UI primitive layer (`@particle-academy/react-fancy` + the project-side wrappers under `agi/ui/dashboard/src/components/ui/*`). Hand-rolling `<div>` + Tailwind chrome breaks the contract that owners (and other plugins, MApps, locally-hosted apps) depend on for consistent UX, theming, accessibility, and security.

**See** [`docs/human/adf.md` § 5 UI components](../human/adf.md#5-ui-components) **for the full primitive cheatsheet** (Card / Tabs / Field / Action / ContentRenderer / Editor / Chart / Sidebar / TreeNav / etc.) and the bug-routing rules for `react-fancy` / `fancy-sheets` / `fancy-code` / `react-echarts` (→ `fancy-echarts`) — we own all four upstream repos. **Do not work around primitive bugs locally without filing the upstream issue first.**

Reference implementation for "what right looks like": `agi/ui/dashboard/src/components/MCPTab.tsx` (Card + Tabs + ContentRenderer + content-block-aware result rendering). Copy the pattern, adapt the surface.

## What Plugins Can Do

Plugins receive an `AionimaPluginAPI` instance during `activate()` and can:

**Core registrations:**
- Register HTTP routes (`api.registerHttpRoute`)
- Register project types and tools (`api.registerProjectType`, `api.registerTool`)
- Register hooks into the agent pipeline (`api.registerHook`)
- Register infrastructure services (`api.registerService`)
- Register runtime definitions and installers (`api.registerRuntime`, `api.registerRuntimeInstaller`)
- Register dashboard tabs (`api.registerDashboardTab`)
- Register hosting field extensions (`api.registerHostingExtension`)
- Register channel plugins (`api.registerChannel`)
- Register LLM providers (`api.registerProvider`)
- Register PM providers (`api.registerPmProvider`) — back the canonical tynn workflow with alternative storage (Linear, Jira, GitHub Projects, etc.)

**Universal extensibility:**
- Register actions with scopes and handlers (`api.registerAction`) — buttons that run shell/api/hook commands
- Register project panels (`api.registerProjectPanel`) — tabs with declarative widget arrays
- Register settings sections (`api.registerSettingsSection`) — config cards with form fields
- Register skills (`api.registerSkill`) — programmatic skill definitions for the agent
- Register knowledge namespaces (`api.registerKnowledge`) — markdown docs under a namespace. **Auto-registered:** if your plugin ships a `docs/` folder and does not call `api.registerKnowledge()` itself, the loader automatically registers the folder with `id = plugin id`, `label = plugin name`, and `contentDir = <basePath>/docs`. Call `api.registerKnowledge()` explicitly only when you need a custom id/label/topics list.
- Register system services (`api.registerSystemService`) — systemd/process services with controls
- Register themes (`api.registerTheme`) — 21 semantic CSS custom properties. Must set `dark: true/false` for react-fancy compatibility. See `docs/sdk/theming.md`
- Register agent tools (`api.registerAgentTool`) — tools the agent can invoke
- Register sidebar sections (`api.registerSidebarSection`) — dashboard nav sections
- Register scheduled tasks (`api.registerScheduledTask`) — cron/interval tasks
- Register workflows (`api.registerWorkflow`) — multi-step automations

**Accessors:**
- Read config (`api.getConfig`)
- Get workspace info (`api.getWorkspaceRoot`, `api.getProjectDirs`)
- Get a structured logger (`api.getLogger`)

## Step 1: Create the Plugin in the Marketplace Repo

```bash
cd /path/to/agi-marketplace
mkdir -p plugins/plugin-<name>/src
```

The directory must be inside `plugins/` and start with `plugin-` for `discoverMarketplacePlugins()` to find it.

## Step 2: Write package.json

The plugin manifest lives in the `"aionima"` field of `package.json`.

```json
{
  "name": "@agi/plugin-<name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "aionima": {
    "id": "plugin-<name>",
    "name": "<Name> Plugin",
    "description": "What this plugin does",
    "aionimaVersion": ">=0.1.0",
    "category": "service",
    "provides": ["services", "ux"],
    "depends": [],
    "permissions": ["network"],
    "entry": "./src/index.ts"
  },
  "dependencies": {
    "@agi/sdk": "workspace:*"
  }
}
```

### Manifest Fields

| Field | Required | Values / Notes |
|-------|----------|---------------|
| `id` | Yes | Unique across all plugins. Convention: `plugin-<name>` |
| `name` | Yes | Display name shown in the dashboard Plugins page |
| `version` | Yes | SemVer string |
| `description` | Yes | One-line description |
| `aionimaVersion` | Yes | SemVer range. Use `">=0.1.0"` for new plugins |
| `category` | No | Legacy. `"runtime"`, `"service"`, `"tool"`, `"editor"`, `"integration"`, `"project"`, `"system"`, `"stack"` |
| `provides` | No | Array of capability labels (see below). Used for marketplace filtering and badge display |
| `depends` | No | Array of plugin IDs this plugin requires to be installed |
| `permissions` | Yes | Array of `AionimaPermission` values (can be empty `[]`) |
| `entry` | Yes | Relative path to the TypeScript entry file |
| `projectTypes` | No | Project type slugs this plugin applies to |
| `bakedIn` | No | If `true`, pre-installed during onboarding and cannot be uninstalled |

### Provides Labels (Capabilities)

| Label | Description |
|-------|-------------|
| `project-types` | Registers new project types |
| `stacks` | Provides framework stack definitions |
| `services` | Registers infrastructure services |
| `runtimes` | Registers container runtimes |
| `system-services` | Manages system-level services |
| `ux` | Extends the dashboard UI (routes, panels, settings, tabs, sidebar) |
| `agent-tools` | Provides tools the AI agent can invoke |
| `skills` | Registers agent skill definitions |
| `knowledge` | Provides documentation namespaces |
| `themes` | Registers visual themes |
| `workflows` | Defines multi-step automations |
| `channels` | Registers messaging channel adapters |
| `providers` | Registers LLM provider integrations |
| `pm-providers` | Registers PM provider integrations (Linear, Jira, etc. — back the canonical tynn workflow) |

Plugins without `provides` fall back to deriving capabilities from the legacy `category` field. Active plugins also get their provides enriched from registry introspection (what they actually registered).

### Available Permissions

```ts
type AionimaPermission =
  | "filesystem.read"
  | "filesystem.write"
  | "network"
  | "shell.exec"
  | "config.read"
  | "config.write";
```

Declare only the permissions your plugin actually uses. The manifest validator (`validateManifest` in `packages/plugins/src/security.ts`) will reject unknown permission strings.

## Step 3: Write the Plugin Entry File

```ts
// plugins/plugin-<name>/src/index.ts
import { createPlugin } from "@agi/sdk";

export default createPlugin({
  async activate(api) {
    const log = api.getLogger();
    const config = api.getConfig();

    log.info("plugin-<name> activating");

    // Register HTTP routes, services, hooks, etc.
    api.registerHttpRoute("GET", "/api/<name>/status", async (_req, reply) => {
      reply.send({ ok: true });
    });

    log.info("plugin-<name> active");
  },

  async deactivate() {
    // Clean up connections, timers, etc.
  },
});
```

`deactivate()` is optional. Implement it if your plugin opens connections or starts timers.

> **Note:** Always import from `@agi/sdk`, not `@agi/plugins`. The SDK wraps the low-level plugin types with `createPlugin()` factory and `define*()` builders for type-safe registration. See `docs/agents/plugin-schema.md` for the full registration surface.

## Step 4: Add to marketplace.json

Add an entry to `marketplace.json` in the marketplace repo root:

```json
{
  "name": "plugin-<name>",
  "description": "What this plugin does",
  "type": "plugin",
  "version": "0.1.0",
  "category": "<category>",
  "provides": ["services", "ux"],
  "depends": [],
  "author": { "name": "Your Name" },
  "tags": ["relevant", "tags"]
}
```

## Step 5: How Discovery Works

`discoverMarketplacePlugins(marketplaceDir)` in `packages/plugins/src/discovery.ts`:

1. Scans `marketplaceDir/plugins/` for subdirectories starting with `plugin-`
2. For each, attempts to load a manifest from `package.json`'s `"aionima"` field (falls back to `aionima-plugin.json`)
3. Validates the manifest with `validateManifest()`
4. Checks that the `entry` file exists
5. Returns a `DiscoveryResult` with `plugins[]` and `errors[]`

If your plugin's `entry` file does not exist or the manifest is invalid, it appears in `errors[]` and is silently skipped — the gateway continues starting other plugins.

The discovery chain at startup is: `discoverPlugins()` (user-installed) → `discoverMarketplacePlugins()` (marketplace) → `discoverChannelPlugins()` (channels) — deduplicated by manifest ID.

## Step 6: Deploy

The marketplace repo is deployed to `/opt/agi-marketplace/`. When `upgrade.sh` runs, it pulls the marketplace repo alongside AGI and PRIME. New plugins added to the marketplace repo are automatically available after the next deploy.

## Files to Modify

| File | Change |
|------|--------|
| `plugins/plugin-<name>/package.json` | Create — manifest with `"aionima"` field |
| `plugins/plugin-<name>/src/index.ts` | Create — plugin entry implementing `AionimaPlugin` |
| `marketplace.json` | Add catalog entry |
| `gateway.json` | Add plugin-specific config section if needed |

## How to Add a PM Provider

PM providers back the canonical tynn workflow with alternative storage — Linear, Jira, GitHub Projects, etc. Built-in providers are `tynn` (MCP to tynn-the-service) and `tynn-lite` (file-based at `<project>/.tynn-lite/`). Plugin-registered providers fill any other storage.

**Manifest:** include `"pm-providers"` in your `provides` array. Optionally add the `category` field as `"integration"` (legacy classification — derives the same label).

**Entry file:**

```ts
import { createPlugin, definePmProvider, type PmProvider } from "@agi/sdk";

export default createPlugin({
  activate(api) {
    const linear = definePmProvider("linear", "Linear")
      .description("Linear issue tracker as PM provider")
      .fields([
        { id: "apiKey", label: "Linear API key", type: "password" },
        { id: "teamId", label: "Team id", type: "text" },
      ])
      .factory((config): PmProvider => {
        // config receives { apiKey, teamId, ... } from gateway.json
        // agent.pm.config when this provider is selected.
        return new LinearPmProvider(config);  // your implementation
      })
      .build();

    api.registerPmProvider(linear);
  },
});
```

**Configuration:** owners select your provider per project via `gateway.json`:

```json
{
  "agent": {
    "pm": {
      "provider": "linear",
      "config": { "apiKey": "...", "teamId": "..." }
    }
  }
}
```

**Reserved ids:** `tynn` and `tynn-lite` are reserved for the built-in implementations. Registering with those ids throws at registration time.

**Implementing PmProvider:** the canonical interface is in `@agi/sdk` (`PmProvider` type). Twelve methods cover read (getProject / getNext / getTask / getStory / findTasks / getComments) + write (setTaskStatus / addComment / updateTask / createTask / iWish) + optional (getActiveFocusProgress). See `packages/gateway-core/src/pm/tynn-provider.ts` and `packages/gateway-core/src/pm/tynn-lite-provider.ts` for two reference implementations.

**Composition with the plan tool:** see `agi/docs/agents/plan-vs-pm.md` — plan IDs use `plan_<ulid>` prefix, PM IDs don't; storage paths must not overlap; state machines stay independent.

## Verification Checklist

- [ ] Directory is in marketplace repo under `plugins/plugin-<name>/`
- [ ] `package.json` has `"aionima"` field with valid `id`, `name`, `version`, `description`, `aionimaVersion`, `permissions`, `entry`
- [ ] `"aionima"` field includes `provides` array with correct capability labels
- [ ] `"aionima"` field includes `depends` array (empty if no dependencies)
- [ ] `"entry"` path resolves to an existing file
- [ ] Entry in `marketplace.json` catalog (with `provides` and `depends`)
- [ ] Gateway starts with `pnpm dev` — plugin appears in startup logs without errors
- [ ] Plugin appears in `GET /api/plugins` response with `provides` array
- [ ] Plugin appears in marketplace browse tab with correct capability badges
- [ ] `GET /api/marketplace/catalog?provides=<label>` correctly filters
- [ ] Any registered HTTP routes respond correctly (curl test each one)
- [ ] `deactivate()` cleans up all resources (no dangling timers or open sockets)
- [ ] If plugin has `depends`, install fails with useful error when deps are missing
