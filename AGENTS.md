# Aionima — Agent Guidelines

This file is the single source of truth for any AI coding agent working on this project. It is provider-agnostic — Claude Code, Cursor, Copilot, Windsurf, or any other agent reads this to understand how to build, test, and contribute.

## Project Overview

Aionima is an autonomous AI gateway — a pnpm monorepo that connects messaging channels (Telegram, Discord, Signal, WhatsApp, Gmail) to an agent pipeline. It includes a React dashboard, plugin system, SQLite entity model, and service plugins for local project hosting.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 LTS, TypeScript 5.7 (strict) |
| Package manager | pnpm 10.5 (via `corepack enable pnpm`) |
| Backend | Fastify 5, tRPC 11, better-sqlite3 |
| Frontend | React 19, Vite 6, Tailwind CSS 4, TanStack Query |
| Bundler | tsdown (esbuild-based, 6 entry points) |
| Testing | Vitest (unit/integration), Playwright (e2e) |
| Linting | oxlint, oxfmt |
| CI | GitHub Actions (typecheck + lint + test on push/PR to main) |

## Monorepo Layout

```
cli/                          CLI entry point (Commander.js)
config/                       Config schema (Zod validation)
packages/
  gateway-core/               HTTP/WS server, agent pipeline, core engine
  entity-model/               SQLite entity store, message queue
  channel-sdk/                Channel plugin interface
  coa-chain/                  Chain of Accountability audit logger
  memory/                     Composite memory adapter
  skills/                     Skill file loader
  voice/                      STT/TTS pipeline (Whisper, Edge TTS)
  plugins/                    Plugin lifecycle & discovery
  aion-sdk/                   Developer SDK for building plugins
  trpc-api/                   tRPC router definitions
  agent-bridge/               Agent invocation logic
channels/
  telegram/                   Telegram adapter (grammy)
  discord/                    Discord adapter (discord.js)
  gmail/                      Gmail OAuth2 adapter
  signal/                     Signal adapter (signal-cli REST)
  whatsapp/                   WhatsApp Business API adapter
ui/
  dashboard/                  React dashboard (Vite + Tailwind + TanStack Query)
scripts/
  upgrade.sh                   Production deployment
  aionima.service             systemd unit file
  hosting-setup.sh            Caddy + dnsmasq installation
skills/                       Agent skill definitions
data/                         Runtime data (entities.db, etc.)
```

## Plugin SDK & ADF

Aionima has two developer-facing layers: the **SDK** (for plugins) and the **ADF** (for core code).

### SDK (`@aionima/sdk`)

The SDK is the public API for building marketplace plugins. All plugins should import from `@aionima/sdk`, never from `@aionima/plugins` directly.

**Plugin entry pattern:**

```ts
import { createPlugin } from "@aionima/sdk";

export default createPlugin({
  async activate(api) {
    // api.registerStack(), api.registerSettingsPage(), etc.
  },
});
```

**Chainable builders** — the SDK provides `define*()` helpers for type-safe registration:

| Builder | Registers via | Use case |
|---------|--------------|----------|
| `defineStack()` | `api.registerStack()` | Framework/runtime/database stacks |
| `defineRuntime()` | `api.registerRuntime()` | Runtime version definitions |
| `defineService()` | `api.registerService()` | Container services |
| `defineSettings()` | `api.registerSettingsSection()` | Config UI sections |
| `defineTool()` | `api.registerAgentTool()` | Agent-callable tools |
| `defineAction()` | `api.registerAction()` | UI/shell/API actions |
| `definePanel()` | `api.registerProjectPanel()` | Project dashboard panels |
| `defineSkill()` | `api.registerSkill()` | Agent skills |
| `defineTheme()` | `api.registerTheme()` | Visual themes |
| `defineKnowledge()` | `api.registerKnowledge()` | Documentation namespaces |
| `defineWorkflow()` | `api.registerWorkflow()` | Multi-step automations |
| `defineSidebar()` | `api.registerSidebarSection()` | Dashboard nav sections |
| `defineChannel()` | `api.registerChannel()` | Messaging channel adapters |
| `defineProvider()` | `api.registerProvider()` | LLM provider integrations |
| `defineScan()` | `api.registerScanProvider()` | Security scan providers |
| `defineWorker()` | `api.registerWorker()` | Worker task specialists |

**Testing:** `import { testActivate } from "@aionima/sdk/testing"` provides a mock `AionimaPluginAPI` for unit tests.

**Key files:** `packages/aion-sdk/src/index.ts` (entry), `packages/aion-sdk/src/create-plugin.ts` (factory), `packages/aion-sdk/src/define-*.ts` (builders).

### ADF (Application Development Framework)

The ADF is for **AGI core code only**, not plugins. It provides module-scoped singletons initialized at boot via `initADF()`:

- `Log()` — structured logger
- `Config()` — config accessor
- `Workspace()` — workspace info
- `Security()` — security scan runner and findings (requires `@aionima/security`)

Plugins get the same capabilities through `api.getLogger()`, `api.getConfig()`, etc. — they never use ADF facades.

**Key file:** `packages/aion-sdk/src/adf-context.ts`

### Deep Reference Docs

- `docs/agents/adding-a-plugin.md` — Step-by-step plugin creation guide
- `docs/agents/plugin-schema.md` — Full registration surface reference (29 `register*()` methods)
- `docs/agents/stack-management.md` — Stack system architecture
- `docs/human/plugins.md` — User-facing plugin documentation

## Development Commands

```bash
pnpm dev              # Backend with hot-reload (tsx watch)
pnpm dev:dashboard    # Dashboard dev server (Vite, port 3001)
pnpm build            # Build all: dashboard (Vite) + backend (tsdown)
pnpm typecheck        # tsc --noEmit (full monorepo)
pnpm lint             # oxlint
pnpm format           # oxfmt
pnpm check            # typecheck + lint combined
pnpm test             # Vitest (unit/integration)
pnpm test:e2e         # Playwright (e2e)
```

## Coding Style & Conventions

- TypeScript strict mode everywhere — no `any` unless absolutely necessary
- Prefer `const` over `let`; never use `var`
- Use named exports, not default exports
- Keep functions small and focused; extract when logic is reused
- Error handling at system boundaries (user input, external APIs) — trust internal code
- No over-engineering: solve the current problem, not hypothetical future ones

## Testing

**ALL tests run inside a Multipass VM — never run vitest directly on the host.** A safety guard in `vitest.config.ts` throws if `AIONIMA_TEST_VM` is not set.

```bash
# VM lifecycle
pnpm test:vm:create    # Create Ubuntu 24.04 VM with all repos mounted
pnpm test:vm:setup     # Install Node 22 + pnpm, run pnpm install inside VM
pnpm test:vm:destroy   # Tear down the VM
pnpm test:vm:ssh       # SSH into the VM

# Run tests (all require VM to be set up first)
pnpm test              # Unit tests (vitest inside VM)
pnpm test:e2e          # System e2e (install → API → onboarding → plugins)
pnpm test:e2e:ui       # Playwright UI tests (host browser → VM)
pnpm test:all          # All tiers
```

The VM mounts all workspace repos: AGI → `/mnt/agi`, PRIME → `/mnt/aionima-prime`, ID → `/mnt/aionima-local-id`. A test config fixture at `test/fixtures/aionima-test.json` points to these mount paths.

CI (GitHub Actions) sets `AIONIMA_TEST_VM=1` to bypass the host guard — it runs vitest directly since GitHub Actions is already isolated.

- **Pre-ship (mandatory):** Before every commit+push, run `pnpm build && pnpm typecheck`. Also curl-test backend API endpoints to verify they work. Never ship untested code.

## Git Workflow

- Always check `git status` for ALL outstanding changes — not just current-task files
- Ship immediately after clean builds — commit and push, don't wait to be asked
- CI (GitHub Actions) runs typecheck, lint, and tests on every push/PR to main

## Deployment

Deployment is automated through the dashboard — **never run upgrade.sh manually** unless explicitly asked.

### Multi-Repo Architecture

The system is built from **independent git repos** — not submodules.

| Repo | Production Path | Dev Path | Source |
|------|----------------|----------|--------|
| AGI | `/opt/aionima` | (dev workspace) | `@Civicognita/agi` |
| PRIME | `/opt/aionima-prime` | `/opt/aionima-prime_dev` | `@Civicognita/aionima` |
| ID | `/opt/aionima-local-id` | `/opt/aionima-local-id_dev` | `@Civicognita/aionima-local-id` |
| Plugin Marketplace | `/opt/aionima-marketplace` | `/opt/aionima-marketplace_dev` | `@Civicognita/aionima-marketplace` |
| MApp Marketplace | `/opt/aionima-mapp-marketplace` | — | `@Civicognita/aionima-mapp-marketplace` |

AGI resolves repo paths at runtime from config (`prime.dir`, `idService.dir`, `marketplace.dir`, `mappMarketplace.dir`). Dev mode (`dev.enabled: true`) switches to dev directories automatically.

**Two marketplaces:** The **Plugin Marketplace** (`aionima-marketplace`) contains code plugins (runtimes, stacks, workers, settings pages) discovered at boot via `discoverMarketplacePlugins()`. The **MApp Marketplace** (`aionima-mapp-marketplace`) contains declarative JSON MagicApps installed on-demand from the dashboard. These are separate repos — do not confuse them.

### Protocol Versioning

Each repo has a `protocol.json` at its root. AGI checks semver compatibility at boot — incompatible versions log warnings and run in degraded mode.

### Deploy Flow

1. **Push to `main`** — GitHub webhook notifies the server; dashboard also polls every 60s
2. **User clicks "Upgrade"** in the dashboard UI
3. **`POST /api/system/upgrade`** triggers `scripts/upgrade.sh`, which:
   - Pulls AGI, PRIME, ID, and MARKETPLACE repos (structured JSON logging per phase)
   - Checks protocol compatibility across repos
   - `pnpm install --frozen-lockfile && pnpm build`
   - Snapshots backend checksums **before/after** build
   - **Restarts the service only if backend changed**
   - Writes `.deployed-commit` marker for update detection

Key paths: service runs from `/opt/aionima`, systemd unit at `/etc/systemd/system/aionima.service`, config at `/opt/aionima/aionima.json`, secrets in `/opt/aionima/.env`.

### Dev Mode

Toggle via dashboard (`POST /api/dev/switch`) or config file. Dev mode:
- Reads PRIME from `dev.primeDir` (default: `/opt/aionima-prime_dev`)
- Adds `fork_id` to COA audit records for traceability
- Requires restart after toggle

## Data & Storage Paths

| Path | Purpose |
|------|---------|
| `/opt/aionima-prime/` | **PRIME knowledge corpus (production) — NEVER write runtime data here** |
| `~/.agi/` | Runtime data root (config, db, secrets, chat history) |
| `~/.agi/aionima.json` | Runtime config (single source — NOT in repo or service dir) |
| `~/.agi/entities.db` | SQLite entity database |
| `~/.agi/chat-history/` | Chat session history (JSON files per session) |
| `~/.agi/secrets/` | TPM2-sealed credentials |
| `/opt/aionima/` | Production deployment target — code only, no runtime data or config |

**Critical rule:** The PRIME corpus is a knowledge store. Runtime data (chat history, logs, caches, config, database) must never be stored in the repo, service dir, or PRIME. All runtime data lives in `~/.agi/`.

## Documentation

Two documentation sets live in `docs/`:

- **`docs/human/`** — Human-readable guides for dashboard readers. Covers every feature with clear explanations, no agent jargon.
- **`docs/agents/`** — Technical guides for AI agents extending and maintaining the system. Includes exact file paths, step-by-step procedures, and files-to-modify tables.
- **`docs/governance/`** — Governance specs (verification protocol, impact scoring, agent invocation).

### Documentation Rules

- When adding or changing a feature, **update the corresponding human doc AND agent doc** before shipping.
- New features require a new doc entry (or update to existing doc) before the commit.
- Agent docs must include file paths and modification steps.
- Human docs must be readable without technical context.
- `docs/agents/README.md` explains the documentation system itself.

### How Docs Are Served

Docs are served through the editor plugin (now in the marketplace repo). The dashboard has a `/docs` route at `ui/dashboard/src/routes/docs.tsx` with a two-column layout (file tree + rendered markdown). Shared markdown components are in `ui/dashboard/src/lib/markdown.tsx`. The `docs/` directory is synced to `/opt/aionima/docs/` via `upgrade.sh`.

---

## Workers & Taskmaster

**Workers** are plugin-provided task specialists. **Taskmaster** is the built-in job orchestration engine that discovers registered workers and dispatches them for background tasks. The agent dispatches work via the `taskmaster_dispatch` tool. Workers are registered by plugins via `api.registerWorker()`.

### Worker Domains

| Domain | Workers |
|--------|---------|
| code   | engineer, hacker, reviewer, tester |
| k      | analyst, cryptologist, librarian, linguist |
| ux     | designer.web, designer.cli |
| strat  | planner, prioritizer |
| comm   | writer.tech, writer.policy, editor |
| ops    | deployer, custodian, syncer |
| gov    | auditor, archivist |
| data   | modeler, migrator |

### Enforced Chains

| Trigger | Followed By |
|---------|-------------|
| hacker  | tester      |
| writer.*| editor      |
| modeler | linguist    |
| auditor | archivist   |

### Gate Types

- `auto` — Proceed automatically to next phase
- `checkpoint` — Pause for user review (approve/reject)
- `terminal` — Job complete (offer merge/archive)

### Adding Custom Workers

Plugins register workers via `api.registerWorker()` with the `defineWorker()` SDK builder. See `docs/sdk/builders.md` for the full builder reference.

### Configuration

```json
{
  "workers": {
    "autoApprove": false,
    "maxConcurrentJobs": 3,
    "workerTimeoutMs": 300000,
    "modelOverrides": {
      "code.hacker": { "model": "claude-opus-4-6" }
    }
  }
}
```

---

## Mycelium Protocol

Aionima's unique agent identity, state, and memory system. This is what differentiates Aionima agents from generic coding assistants.

**Full specification:** `prompts/mycelium.md`

### What It Provides

- **Boot sequence** — 5-phase agent initialization (load config, detect state, load context, ready)
- **Operational states** — ONLINE / LIMBO / OFFLINE / UNKNOWN with state-gating rules
- **Entity architecture** — #E0 (user), #O0 (org), $A0 (agent) identity chain
- **Persona & purpose** — Aionima as oracle to Impactivism
- **Session/frame management** — Context preservation across sessions
- **Memory protocol** — Local + distributed knowledge management

### The Moat: Impactinomics

These systems are the competitive advantage — the reason Aionima exists:

- **COA (Chain of Accountability)** — `packages/coa-chain/` — every agent action is auditable
- **Impact scoring** — `packages/entity-model/src/impact.ts` — 0SCALE formula
- **Verification tiers** — `packages/entity-model/src/store.ts` — unverified → verified → sealed
- **GEID (Global Entity ID)** — `packages/entity-model/src/geid.ts` — Ed25519 portable identity
- **Entity Map** — `packages/entity-model/src/entity-map.ts` — signed portable profiles
- **0TERMS / Lexicon** — `core/0TERMS.md`, `lexicon/` in PRIME repo — formal definitions
- **PRIME corpus** — `core/`, `knowledge/` in PRIME repo — authoritative knowledge base

Generic agents get project structure and build commands from this file. Mycelium-aware agents get the full identity/impact/accountability stack from `prompts/mycelium.md`.

---

## Agent-Specific Notes

### For All Agents

- Read this file first. It contains everything you need to build, test, and ship code.
- The PRIME corpus (external repo at configured `prime.dir`) is a knowledge store — read from it, never write runtime data there.
- When in doubt about architecture, check `docs/agents/` for step-by-step guides.

### Provider-Specific Config

Each AI coding tool stores its own config in its standard directory:

- **Claude Code:** `.claude/` — commands, worker prompts, settings
- **Cursor:** `.cursor/` (if present)
- **Other agents:** Use your tool's standard config directory

Worker definitions for Claude Code live in `.claude/agents/workers/`. Other providers would define equivalent workers in their own config dirs.
