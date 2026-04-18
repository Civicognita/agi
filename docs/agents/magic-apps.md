# MagicApps

MagicApps (MApps) are JSON-defined packaged applications that bundle UI, container serving, and agentic capabilities into a single declarative unit. They are distributed via the **MApp Marketplace** repo (`@Civicognita/aionima-mapp-marketplace`).

## What is a MagicApp?

A MagicApp fills the gap between:
- **Runtimes** — provide language containers for dev projects (Node, PHP, Python)
- **Stacks** — provide knowledge, guides, and UI tools (NOT containers)

MagicApps provide **self-contained serving** for non-dev project types. They own the entire experience: what container runs, what the dashboard tab shows, and what the AI agent knows about the project.

## Distribution

Default MApps live in the MApp Marketplace repo and are pulled/installed on demand — **never manually place JSON files into `~/.agi/mapps/`**. MApps will eventually be compiled and signed for COA<>COI integrity.

## Architecture

```
MApp Marketplace
  └→ mapps/{author}/{slug}.json
       ├→ Container config (how to serve the content)
       ├→ Dashboard panel (auto-registered, shown as project tab)
       ├→ Agent prompts (AI context for this project type)
       ├→ Workflows (multi-step automations)
       └→ Tools (project toolbar actions)
```

## MApp Schema (mapp/1.0)

MApps are defined as JSON files validated against the `MAppDefinitionSchema` (Zod).

Install path: `~/.agi/mapps/{author}/{slug}.json`

### SDK Builder

```ts
import { defineMagicApp } from "@agi/sdk";

const reader = defineMagicApp("reader", "Reader", "civicognita")
  .description("E-reader for literature projects")
  .version("1.0.0")
  .category("viewer")
  .projectTypes(["writing"])
  .projectCategories(["literature"])
  .container({ image: "nginx:alpine", internalPort: 80, ... })
  .panel("Reader", [{ type: "iframe", ... }])
  .prompt({ id: "reader.assistant", label: "Writing Assistant", systemPrompt: "..." })
  .tool({ id: "word-count", label: "Word Count", action: "shell", command: "wc -w *.md" })
  .build();
```

## Categories

MApps are classified into 5 top-level categories:

| Category | Purpose | Examples |
|----------|---------|---------|
| `viewer` | Content consumption & display | Reader, Gallery, Code Browser, Dashboard Viewer |
| `production` | Asset creation & editing | Mind Mapper, Dev Workbench, Media Studio, Admin Editor |
| `tool` | Stateless input/output utilities | Project Analyzer, Ops Monitor, Book Continuity Tracker |
| `game` | Interactive games & simulations | (Future) |
| `custom` | Catch-all | (User-defined) |

### Project Category Compatibility

MApps declare which project categories they serve via `projectCategories`:

`literature`, `app`, `web`, `media`, `administration`, `ops`, `monorepo`

Empty `projectCategories` means compatible with all types.

## Container Resolution Order

When `HostingManager.startContainer()` runs for a project:

1. **MagicApp** — checked first. If a MagicApp is set as the project's viewer, its container config is used.
2. **Stack** — if no MagicApp, checks installed stacks for `containerConfig`.
3. **Legacy** — fallback to hardcoded image constants.

## Dashboard Integration

The MApp desktop (`/magic-apps`) organizes apps into category Cards with icon buttons. Clicking an app opens a Project Picker filtered to compatible projects.

In project detail, the **MagicApps tab** allows:
- Setting a **Content Viewer** (non-dev projects) via `PUT /api/projects/viewer`
- **Attaching/detaching** MApps via `PUT/DELETE /api/projects/magic-apps`
- **Opening** MApps in floating/docked modals

## MAppDefinition Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$schema` | string | Yes | Must be `"mapp/1.0"` |
| `id` | string | Yes | Unique slug identifier |
| `name` | string | Yes | Display name |
| `author` | string | Yes | Creator identifier |
| `version` | string | Yes | Semver version |
| `description` | string | Yes | What this app does |
| `icon` | string | No | Emoji character (not slug) |
| `license` | string | No | License identifier |
| `category` | enum | Yes | `viewer`, `production`, `tool`, `game`, `custom` |
| `projectTypes` | string[] | No | Project types this app serves (empty = all) |
| `projectCategories` | string[] | No | Project categories (empty = all) |
| `permissions` | array | Yes | Security permissions declared |
| `container` | object | No | Container config (image, ports, volumes) |
| `panel` | object | Yes | Dashboard tab with widgets |
| `pages` | array | No | Multi-step form pages |
| `constants` | array | No | Formula constants (C-column) |
| `output` | object | No | Output configuration |
| `prompts` | array | No | AI context prompts |
| `workflows` | array | No | Multi-step automations |
| `tools` | array | No | Project toolbar tools |
| `theme` | object | No | Visual customization |
| `chain` | object | No | On-chain metadata (future) |

## COA<>COI Tracking

MApp lifecycle events are tracked via the Impactinomics COA<>COI chain:

| Work Type | When | COA<>COI Example |
|-----------|------|------------------|
| `mapp_mint` | User creates a new MApp | `#E0.#O0.$A1.MINT(~fancy-ide)<>~$MA1` |
| `mapp_publish` | MApp published to marketplace | `#E0.#O0.$A1.PUBLISH(~fancy-ide)<>$MA42` |
| `mapp_install` | User installs a MApp | `#E0.#O0.$A0.INSTALL($MA42)<>~$MA1` |
| `mapp_execute` | MApp form submitted/processed | `#E0.#O0.$A0.EXECUTE(~reader)<>C005` |

**Registration IDs:**
- `~$MA{n}` — local MApp registration (not on HIVE)
- `$MA{n}` — global marketplace registration
- IDs 0-9 are numeric; after 9, SHA256 string IDs

## Default MApps (Marketplace)

| App | Category | Project Categories |
|-----|----------|--------------------|
| Reader | viewer | literature |
| Gallery | viewer | media |
| Code Browser | viewer | app, web, monorepo |
| Dashboard Viewer | viewer | administration, ops |
| Mind Mapper | production | literature |
| Dev Workbench | production | app, web, monorepo |
| Media Studio | production | media |
| Admin Editor | production | administration |
| Runbook Editor | production | ops |
| Project Analyzer | tool | app, web, monorepo |
| Ops Monitor | tool | ops |

## Key Files

| File | Purpose |
|------|---------|
| `packages/aion-sdk/src/mapp-schema.ts` | Canonical schema (MPx 1.0) with interfaces |
| `config/src/mapp-schema.ts` | Zod validation schema for JSON files |
| `packages/aion-sdk/src/define-magic-app.ts` | Chainable SDK builder |
| `packages/gateway-core/src/mapp-discovery.ts` | Boot-time discovery + category migration |
| `packages/gateway-core/src/mapp-registry.ts` | In-memory registry with query methods |
| `packages/gateway-core/src/mapp-executor.ts` | Form submission execution engine |
| `packages/gateway-core/src/hosting-manager.ts` | Container resolution (MApp → Stack → Legacy) |
| `ui/dashboard/src/routes/magic-apps.tsx` | MApp desktop (category Cards) |
| `ui/dashboard/src/components/MagicAppPicker.tsx` | Project detail tab (viewer, attach/detach) |
| `ui/dashboard/src/components/MagicAppModal.tsx` | Floating/docked MApp window |
| `ui/dashboard/src/lib/magic-app-instances.ts` | Instance state management |

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/dashboard/magic-apps` | List all registered MApps |
| `GET` | `/api/dashboard/magic-apps/:id` | Get single MApp detail |
| `POST` | `/api/mapps/scan` | Security scan a MApp definition |
| `POST` | `/api/mapps/install` | Install a MApp (scan + register) |
| `POST` | `/api/mapps/execute` | Execute a MApp form submission |
| `PUT` | `/api/projects/viewer` | Set Content Viewer for a project |
| `PUT` | `/api/projects/magic-apps` | Attach a MApp to a project |
| `DELETE` | `/api/projects/magic-apps` | Detach a MApp from a project |
| `GET` | `/api/magic-apps/instances` | List open MApp instances |
| `POST` | `/api/magic-apps/instances` | Open new instance |
| `PUT` | `/api/magic-apps/instances/:id/state` | Save instance state |
| `PUT` | `/api/magic-apps/instances/:id/mode` | Change instance mode |
| `DELETE` | `/api/magic-apps/instances/:id` | Close instance |
