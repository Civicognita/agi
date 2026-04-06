# MagicApps

MagicApps are JSON-defined packaged applications that bundle UI, container serving, and agentic capabilities into a single declarative unit.

## What is a MagicApp?

A MagicApp fills the gap between:
- **Runtimes** — provide language containers for dev projects (Node, PHP, Python)
- **Stacks** — provide knowledge, guides, and UI tools (NOT containers)

MagicApps provide **self-contained serving** for non-dev project types. They own the entire experience: what container runs, what the dashboard tab shows, and what the AI agent knows about the project.

## Architecture

```
Plugin (TypeScript)
  └→ registerMagicApp(definition)
       ├→ Container config (how to serve the content)
       ├→ Dashboard panel (auto-registered, shown as project tab)
       ├→ Agent prompts (AI context for this project type)
       ├→ Workflows (multi-step automations)
       └→ Tools (project toolbar actions)
```

## Registration

Plugins register MagicApps via `api.registerMagicApp()`:

```ts
import { createPlugin } from "@aionima/sdk";

export default createPlugin({
  async activate(api) {
    api.registerMagicApp({
      id: "reader",
      name: "Reader",
      description: "E-reader for literature projects",
      version: "1.0.0",
      category: "reader",
      projectTypes: ["writing"],
      projectCategories: ["literature"],
      containerConfig: {
        image: "nginx:alpine",
        internalPort: 80,
        volumeMounts: (ctx) => [
          `${ctx.projectPath}:/usr/share/nginx/html/content:ro,Z`,
        ],
        env: () => ({}),
      },
      panel: {
        label: "Reader",
        widgets: [
          { type: "status-display", statusEndpoint: "/status?path={projectPath}" },
          { type: "iframe", src: "/reader-frame?path={projectPath}", height: "600px" },
        ],
      },
    });
  },
});
```

## Container Resolution Order

When `HostingManager.startContainer()` runs for a project:

1. **MagicApp** — checked first. If a MagicApp is registered for the project's type, its `containerConfig` is used.
2. **Stack** — if no MagicApp, checks installed stacks for `containerConfig`.
3. **Legacy** — fallback to hardcoded image constants.

## Dashboard Integration

`registerMagicApp()` auto-registers a dashboard panel via `registerProjectPanel()`. The panel appears as a tab in the project detail view, filtered by `projectTypes`.

Widget endpoints support `{projectPath}` template substitution.

## SDK Builder

```ts
import { defineMagicApp } from "@aionima/sdk";

const reader = defineMagicApp("reader", "Reader")
  .description("E-reader for literature projects")
  .version("1.0.0")
  .category("reader")
  .projectTypes(["writing"])
  .projectCategories(["literature"])
  .container({ image: "nginx:alpine", internalPort: 80, ... })
  .panel("Reader", [{ type: "iframe", ... }])
  .agentPrompt({ id: "reader.assistant", label: "Writing Assistant", systemPrompt: "..." })
  .tool({ id: "word-count", label: "Word Count", action: "shell", command: "wc -w *.md" })
  .build();
```

## MagicAppDefinition Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier |
| `name` | string | Yes | Display name |
| `description` | string | Yes | What this app does |
| `version` | string | Yes | Semver version |
| `icon` | string | No | Icon name |
| `category` | enum | Yes | reader, gallery, dashboard, viewer, editor, custom |
| `projectTypes` | string[] | Yes | Project types this app serves |
| `projectCategories` | enum[] | Yes | Project categories |
| `containerConfig` | object | Yes | Container image, ports, volumes, env |
| `panel` | object | Yes | Dashboard tab with widgets |
| `agentPrompts` | array | No | AI context prompts |
| `workflows` | array | No | Multi-step automations |
| `tools` | array | No | Project toolbar tools |
| `theme` | object | No | Visual customization |
| `chain` | object | No | Future blockchain metadata |

## Current MagicApps

| App | Category | Project Types | Plugin |
|-----|----------|---------------|--------|
| Reader | reader | writing | plugin-reader-literature |
| Gallery | gallery | art | plugin-reader-media |

## Key Files

| File | Purpose |
|------|---------|
| `packages/gateway-core/src/magic-app-types.ts` | TypeScript interfaces |
| `config/src/magic-app-schema.ts` | Zod validation schema |
| `packages/aion-sdk/src/define-magic-app.ts` | SDK builder |
| `packages/plugins/src/registry.ts` | Registry storage + query |
| `packages/gateway-core/src/hosting-manager.ts` | Container resolution |
