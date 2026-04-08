# Agent Documentation: How This Documentation System Works

This document explains the `docs/` directory structure, how documentation is served through the editor plugin, how the dashboard renders it, and how to add new documentation files.

## Directory Structure

```
docs/
  agents/         # Guides for AI agents extending the system
  human/          # Guides for human operators and developers
  governance/     # Policy, COA rules, decision records
```

All three subdirectories are served identically. The distinction is conceptual — agents use `docs/agents/`, humans use `docs/human/`, governance records live in `docs/governance/`.

## How Documentation Is Served

The documentation system has three layers: the editor plugin registers HTTP routes, the dashboard fetches from those routes, and `react-markdown` renders the content.

### Layer 1: Editor Plugin (ALLOWED_SUBTREES)

`packages/plugin-editor/src/index.ts` registers all file API routes. The constant that controls which directories are accessible is:

```ts
// packages/plugin-editor/src/index.ts
const ALLOWED_SUBTREES = [".aionima/", ".claude/", ".ai/", "docs/"];
// Also allows absolute paths inside the external PRIME directory (resolved from config)
```

`docs/` was added to this list to enable documentation browsing. Any path under `docs/` relative to the workspace root is readable via:

- `GET /api/files/read?path=docs/agents/README.md` — returns `{ content: string, size: number }`
- `GET /api/files/tree?root=docs` — returns `{ tree: FileNode[] }` (recursive)
- `PUT /api/files/write` — path must be inside an allowed subtree; writes are capped at 256 KB

All file API endpoints are gated to private-network IPs only (`isPrivateNetwork()` check). Requests from public IPs receive HTTP 403.

### Layer 2: Dashboard API Functions

`ui/dashboard/src/api.ts` exposes two functions specific to docs:

```ts
// fetchDocsTree — calls GET /api/files/tree?root=docs
export async function fetchDocsTree(): Promise<FileNode[]>

// fetchFile — calls GET /api/files/read?path=...
export async function fetchFile(path: string): Promise<{ content: string; size: number }>
```

`FileNode` is:

```ts
interface FileNode {
  name: string;
  path: string;          // relative to workspace root, e.g. "docs/agents/README.md"
  type: "file" | "dir";
  children?: FileNode[]; // present when type === "dir"
  ext?: string;          // "md", "ts", etc.
}
```

### Layer 3: Dashboard Route

`ui/dashboard/src/routes/docs.tsx` is the DocsPage component. It uses a two-column layout:

- Left column (256 px wide): `FileTree` component showing the `docs/` tree, filtered to `.md` files on click
- Right column (flex): `ReactMarkdown` with `remarkGfm` and the shared `markdownComponents`

The page loads the tree on mount and loads file content when a node is selected. Only `.md` files trigger a load — other extensions are ignored.

```ts
// Only select markdown files
if (!path.endsWith(".md")) return;
```

### Shared Markdown Components

`ui/dashboard/src/lib/markdown.tsx` exports `markdownComponents(opts?)`. Pass `{ prose: true }` for full-page rendering (DocsPage uses this). Pass no args for inline/chat rendering.

```ts
import { markdownComponents } from "@/lib/markdown.js";
const mdComponents = useMemo(() => markdownComponents({ prose: true }), []);
```

Catppuccin color variables used: `--color-mantle`, `--color-surface0`, `--color-blue`, `--color-subtext0`, `--color-border`, `--color-foreground`, `--color-muted-foreground`.

## Deployment

The production directory (`/opt/aionima/`) is its own git clone. `scripts/upgrade.sh` runs `git pull` which updates `docs/` along with everything else.

Documentation changes are zero-downtime — the backend reads files from disk on each request, so no restart is needed.

## Files That Make Up This System

| File | Role |
|------|------|
| `packages/plugin-editor/src/index.ts` | Registers file API routes; `ALLOWED_SUBTREES` includes `"docs/"` |
| `ui/dashboard/src/api.ts` | `fetchDocsTree()` and `fetchFile()` functions |
| `ui/dashboard/src/routes/docs.tsx` | DocsPage — two-column layout component |
| `ui/dashboard/src/lib/markdown.tsx` | Shared `markdownComponents()` factory |
| `ui/dashboard/src/router.tsx` | Route `{ path: "docs", element: <DocsPage /> }` |
| `ui/dashboard/src/components/AppSidebar.tsx` | Documentation section in sidebar nav |
| `scripts/upgrade.sh` | `git pull` updates docs alongside all other files |

## How to Add New Documentation

### Adding a file to an existing subdirectory

1. Create the `.md` file in `docs/agents/`, `docs/human/`, or `docs/governance/`.
2. It will appear automatically in the dashboard after the next deploy (or immediately in dev, since files are read from disk on request).

No code changes needed.

### Adding a new subdirectory under docs/

1. Create the directory and place at least one `.md` file in it.
2. The file tree walker (`walkDir` in the editor plugin) recurses automatically — no code change needed.
3. The new directory will appear in the sidebar file tree.

### Adding a new top-level docs section (outside docs/)

If you need a different top-level directory to be browsable, add its name (with trailing slash) to `ALLOWED_SUBTREES` in `packages/plugin-editor/src/index.ts`:

```ts
const ALLOWED_SUBTREES = [".aionima/", ".claude/", ".ai/", "docs/", "your-dir/"];
```

Note: The editor plugin also allows absolute paths inside the external PRIME directory (resolved from `prime.dir` config at plugin activation). No subtree entry is needed for those.

## Index of Agent Docs

| Document | Topic |
|----------|-------|
| [README.md](README.md) | This file — how the documentation system works |
| [testing-and-shipping.md](testing-and-shipping.md) | Pre-ship checklist, CI, unit/e2e/VM tests, VM gotchas |
| [federation-identity.md](federation-identity.md) | Federation & identity system — GEID, EntityMap, APIs, VM sandbox |
| [adding-api-endpoints.md](adding-api-endpoints.md) | How to add new API routes |
| [adding-a-channel.md](adding-a-channel.md) | How to add a new messaging channel |
| [adding-a-plugin.md](adding-a-plugin.md) | How to add a new plugin |
| [adding-dashboard-pages.md](adding-dashboard-pages.md) | How to add dashboard UI pages |
| [config-schema-changes.md](config-schema-changes.md) | How to extend the config schema |
| [upgrade-pipeline.md](upgrade-pipeline.md) | How deployment works |
| [entity-model-extensions.md](entity-model-extensions.md) | How to extend the entity model |
| [system-prompt-assembly.md](system-prompt-assembly.md) | How the agent system prompt is built |
| [bots-workers.md](bots-workers.md) | Workers & Taskmaster system |
| [notes-to-papa.md](notes-to-papa.md) | Living reference for Papa (OpenClaw agent) — project overview, conventions, current state |

### SDK Documentation (`docs/sdk/`)

| Document | Topic |
|----------|-------|
| [overview.md](../sdk/overview.md) | SDK overview — `createPlugin()`, builder mapping, import conventions |
| [builders.md](../sdk/builders.md) | All 14 `define*()` builders with methods, parameters, and examples |
| [plugin-api.md](../sdk/plugin-api.md) | Full `AionimaPluginAPI` interface — 29 registration methods, accessors, hooks |
| [testing.md](../sdk/testing.md) | `testActivate()`, `createMockAPI()`, and `MockRegistrations` for plugin testing |

## Pre-Ship Checklist

Before committing documentation changes:

- [ ] File is valid Markdown (headings, code blocks, tables are well-formed)
- [ ] File path is under `docs/agents/`, `docs/human/`, or `docs/governance/`
- [ ] Run `pnpm build` — no compile errors (docs changes do not affect build, but confirms no unrelated breakage)
- [ ] Run `pnpm typecheck` — passes
- [ ] Open dashboard at `/docs` and confirm the file appears and renders correctly
- [ ] `GET /api/files/read?path=docs/agents/your-file.md` returns the expected content
