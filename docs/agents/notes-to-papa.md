# Notes to Papa (Papaclaw)

This is a living reference for Papa (the OpenClaw agent) when working on the Aionima project. It covers the current state, how things work, and how to contribute. Read this before starting any work.

**Last updated by:** Claude Code (2026-03-08)

## Who's Who

- **Owner**: wishborn (the human, founder of Civicognita)
- **Aionima**: The AI assistant being built by this project — the product
- **Papa (Papaclaw)**: Aionima's mentor, running via OpenClaw in a Podman container on this machine
- **Coding agent**: Whichever AI coding agent is currently building the project (currently Claude Code, but this role may change)

## What Aionima Is

Aionima is an autonomous AI gateway — a personal AI assistant that connects messaging channels (Telegram, Discord, Signal, WhatsApp, Gmail) to an agent pipeline. It's not just a chatbot; it's the infrastructure for an **impact-based economy** called Impactinomics. Every action the agent takes is auditable via a Chain of Accountability (COA), and every entity has a verifiable identity (GEID).

The consumer brand (future) is **Koru**. The internal protocol is called **Mycelium Protocol**.

## Where Things Are

### Your Container Environment

Your workspace root is `/mnt/projects`. This maps to `~/temp_core` on the host.

| Repo | Container Path | GitHub | Purpose |
|------|---------------|--------|---------|
| **AGI** | `/mnt/projects/agi` | `Civicognita/agi` | Main monorepo — gateway, dashboard, channels |
| **PRIME** | `/mnt/projects/aionima-prime` | `Civicognita/aionima` | Knowledge corpus, Mycelium Protocol spec, persona, 0TERMS |
| **BOTS** | `/mnt/projects/aionima-bots` | `Civicognita/bots` | Bolt-On Taskmaster System — background worker dispatch |
| **MARKETPLACE** | `/mnt/projects/aionima-marketplace` | `Civicognita/aionima-marketplace` | All plugins (21+), catalog in `marketplace.json` |
| **OpenClaw** | `/mnt/projects/openclaw` | `openclaw/openclaw` | OpenClaw source repo (for plugin development) |

### Runtime Data (`~/.agi/` on the host)

All runtime data lives in `~/.agi/` on the host — NOT in the repo or service directory.

| Path | Purpose |
|------|---------|
| `~/.agi/aionima.json` | Runtime config (single source of truth) |
| `~/.agi/entities.db` | SQLite entity database |
| `~/.agi/chat-history/` | Chat session history |
| `~/.agi/secrets/` | TPM2-sealed credentials |

**Critical rules:**
- NEVER write config, db, or runtime data to the repo (`/mnt/projects/agi/`) or service dir (`/opt/aionima/`)
- NEVER write runtime data to the PRIME corpus
- Config changes go through the dashboard UI or API, not by editing files in the repo
- Contributing mode is toggled via the dashboard Contributing page (`POST /api/dev/switch`)

### Production

| Path | Purpose |
|------|---------|
| `/opt/aionima/` | Production AGI — git clone, code only, no runtime data |
| `/opt/aionima-prime/` | Production PRIME corpus (read-only for runtime) |
| `/opt/aionima-bots/` | Production BOTS task system |
| `/opt/aionima-marketplace/` | Production MARKETPLACE — all plugins |

**Start with `/mnt/projects/agi/CLAUDE.md`** (symlinked to `AGENTS.md`). That is the single source of truth for any AI agent working on this project. Read it fully before doing anything else.

## The Monorepo Structure (AGI)

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
  voice/                      STT/TTS pipeline
  plugins/                    Plugin lifecycle & discovery
  marketplace/                Marketplace manager (discovery, install/uninstall)
  trpc-api/                   tRPC router definitions
  agent-bridge/               Agent invocation logic
  aion-sdk/                   AionSDK — plugin development kit
channels/
  telegram/                   Telegram adapter (grammy)
  discord/                    Discord adapter (discord.js)
  gmail/                      Gmail OAuth2 adapter
  signal/                     Signal adapter (signal-cli REST)
  whatsapp/                   WhatsApp Business API adapter
ui/
  dashboard/                  React dashboard (Vite + Tailwind + TanStack Query)
scripts/
  deploy.sh                   Production deployment
docs/
  agents/                     Technical guides for AI agents (you're reading one)
  human/                      Human-readable guides
  governance/                 Governance specs
```

## Plugin System

**All plugins live in the MARKETPLACE repo** — not in AGI. This includes editor, mysql, postgres, redis, adminer, node-runtime, php-runtime, stacks, and all others (21+ total).

AGI discovers plugins at boot via `discoverMarketplacePlugins()`, which scans the configured marketplace directory. The marketplace catalog is `marketplace.json` in the marketplace repo root.

Plugins marked `"bakedIn": true` are pre-installed during onboarding and can't be uninstalled. All other plugins can be installed/uninstalled via the dashboard Marketplace page or the `manage_marketplace` agent tool.

### If You're Building a Plugin

1. Create it in the MARKETPLACE repo under `plugins/plugin-<name>/`
2. Add it to `marketplace.json` catalog
3. Follow the AionSDK plugin interface (see `packages/aion-sdk/` or `docs/agents/adding-a-plugin.md`)
4. Plugins activate via `activate(api)` and can register routes, tools, channels, and subdomain routes

### Agent Tools

Six consolidated agent tools handle system management via action discriminator pattern:
- `manage_marketplace` — install/uninstall/list marketplace plugins
- `manage_plugins` — enable/disable/configure loaded plugins
- `manage_config` — read/write runtime config
- `manage_stacks` — framework stack operations
- `manage_system` — system status, upgrade, restart
- `manage_hosting` — project hosting, Caddy, domains

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22, TypeScript 5.7 (strict) |
| Package manager | pnpm 10.5 |
| Backend | Fastify 5, tRPC 11, better-sqlite3 |
| Frontend | React 19, Vite 6, Tailwind CSS 4, TanStack Query |
| Bundler | tsdown (esbuild-based) |
| Testing | Vitest (unit), Playwright (e2e) |
| Linting | oxlint, oxfmt |
| CI | GitHub Actions |

## How We Work

### Development Commands

```bash
pnpm dev              # Backend with hot-reload (tsx watch), port 3200 in dev
pnpm dev:dashboard    # Dashboard dev server (Vite, port 5173)
pnpm build            # Build all: dashboard (Vite) + backend (tsdown)
pnpm typecheck        # tsc --noEmit (full monorepo)
pnpm lint             # oxlint
pnpm test             # Vitest
pnpm test:e2e         # Playwright
```

### Pre-Ship Protocol (Mandatory)

Before EVERY commit, you must run:

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm typecheck
```

If `pnpm install --frozen-lockfile` fails, the lockfile is stale. Run `pnpm install` (without `--frozen-lockfile`) to update it, then include `pnpm-lock.yaml` in your commit. **Production deploy uses `--frozen-lockfile` and will fail if the lockfile is out of date.**

Also curl-test any backend API endpoints you changed. Never ship untested code.

### Your Workflow (Code → Test → Deploy)

1. Make changes in `/mnt/projects/agi`
2. `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck` — must pass
3. `pnpm test` and `pnpm test:e2e` — run tests (Playwright is installed in your container)
4. `git add` + `git commit` + `git push` to main
5. Trigger the production upgrade:
   ```bash
   curl -s -X POST https://ai.on/api/system/upgrade
   ```
6. Verify the upgrade took:
   ```bash
   curl -s https://ai.on/api/system/status
   ```

You are autonomous — work independently, don't wait for wishborn to trigger upgrades.

### Git Workflow

- Always check `git status` for ALL outstanding changes — not just your current task files
- Ship immediately after clean builds — commit and push, don't wait to be asked
- CI runs typecheck + lint + test on every push/PR to main
- Check `git log` for recent history — don't duplicate work already done

### Documentation Rule

When adding or changing a feature, update the corresponding doc in BOTH `docs/agents/` (technical) AND `docs/human/` (readable) before shipping.

## Multi-Repo Architecture

AGI, PRIME, BOTS, and MARKETPLACE are **four independent repos** — not submodules. AGI resolves their paths at runtime from config (`prime.dir`, `bots.dir`, `marketplace.dir`).

- Production: `/opt/aionima` (AGI), `/opt/aionima-prime` (PRIME), `/opt/aionima-bots` (BOTS), `/opt/aionima-marketplace` (MARKETPLACE)
- Contributing mode: switches to dev fork paths via `dev.primeDir` / `dev.botsDir` / `dev.marketplaceDir` in runtime config
- Each repo has a `protocol.json` — AGI checks semver compatibility at boot
- Contributing mode is toggled via the dashboard Contributing page — not by editing config files
- `deploy.sh` pulls all 4 repos with structured JSON logging per phase

## Contributing UX (Sacred Projects)

- Sacred projects (AGI, PRIME, BOTS, ID) are only visible in Contributing mode.
- Sacred projects are pinned at the top of the Projects list with a gold star + indigo card.
- Sacred projects are immutable: no rename/delete (UI + backend guardrails).
- Missing sacred repos show **Not provisioned** instead of erroring.

## Deployment

Production runs at `/opt/aionima/` as a systemd service (`aionima.service`). It's its own git clone. `scripts/deploy.sh` pulls all 4 repos, runs `pnpm install --frozen-lockfile` + `pnpm build`, then restarts the service only if backend checksums changed.

The dashboard detects new commits (60s poll) and shows an upgrade button. Clicking it triggers `POST /api/system/upgrade`. The upgrade UI shows step-by-step progress with colored status dots per deploy phase.

**Hosting:** Only projects with explicit `enabled: true` in config get hosted — there is no auto-hosting.

**From your container**, reach the production Aionima service at `https://ai.on` (Caddy reverse proxy to port 3100).

Key API endpoints:
| Endpoint | Purpose |
|----------|---------|
| `POST https://ai.on/api/system/upgrade` | Trigger production deploy (git pull + build + restart) |
| `GET https://ai.on/api/system/status` | Check system status and deployed commit |
| `POST https://ai.on/api/dev/switch` | Toggle contributing mode (requires restart) |
| `DELETE https://ai.on/api/projects` | Delete a project (preview-then-confirm safety pattern) |

### Caddyfile & Hosting

HostingManager auto-generates `/etc/caddy/Caddyfile` on startup, split into SYSTEM DOMAINS and PROJECT DOMAINS sections. Plugins can register subdomain routes via `api.registerSubdomainRoute()`. Custom entries (like `papa.ai.on`) must be placed between the `# --- BEGIN CUSTOM ---` and `# --- END CUSTOM ---` markers to survive regeneration.

| Domain | Target | Source |
|--------|--------|--------|
| `ai.on` | Production Aionima (port 3100) | Auto (HostingManager) |
| `db.ai.on` | Database Portal (via gateway) | Auto (built-in system domain in HostingManager) |
| `papa.ai.on` | Papa/OpenClaw (port 18789) | Custom block |

## The Competitive Moat (What Makes This Different)

These are the systems that matter most — they're what separate Aionima from every other AI assistant:

- **COA (Chain of Accountability)** — `packages/coa-chain/` — every agent action is auditable
- **Impact Scoring** — `packages/entity-model/src/impact.ts` — 0SCALE formula
- **Verification Tiers** — unverified -> verified -> sealed
- **GEID (Global Entity ID)** — `packages/entity-model/src/geid.ts` — Ed25519 portable identity
- **Entity Map** — signed portable profiles
- **0TERMS / Lexicon** — formal definitions in PRIME repo
- **Mycelium Protocol** — agent identity, state, and memory system (spec in `MYCELIUM.md` in PRIME)

## Project Management (Tynn)

We track all work in **Tynn** (a project management MCP server). Use `next` to find what to work on, `find` to list versions/stories/tasks, `show` for details, `create` to add work, and `done` to mark it complete.

If you don't have Tynn access, coordinate with the coding agent or wishborn on what to pick up.

## Things to Watch Out For

1. **Runtime data** — NEVER write to the repo dir, service dir, or PRIME corpus. Everything goes in `~/.agi/`
2. **Config changes** — go through the dashboard or API, not by editing files in the repo
3. **The `compose.yml`** in the home dir is NOT in use — don't start Docker Compose alongside systemd services
4. **Your container** — you're in Podman. Use `host.containers.internal` to reach the host. Your SSH keys are mounted read-only at `/home/node/.ssh`
5. **Caddyfile** — custom entries MUST be between the `BEGIN/END CUSTOM` markers or HostingManager will delete them on next restart
6. **`pnpm dev` port** — Dev runs on port 3200 to avoid conflicting with production on 3100
7. **Lockfile** — if you add/change dependencies, `pnpm install --frozen-lockfile` will fail. Run `pnpm install` to update it and commit `pnpm-lock.yaml`
8. **Untracked workspace files** — `.openclaw/`, `HEARTBEAT.md`, `IDENTITY.md`, `SOUL.md`, `TOOLS.md`, `USER.md`, `data/`, `memory/` are your OpenClaw workspace files. Don't commit them to AGI.
9. **Playwright** — system deps and Chromium are installed in your container. `pnpm test:e2e` works.

## Agent Docs Index

Read these in `docs/agents/` to understand specific subsystems:

| Document | What It Covers |
|----------|---------------|
| `config-schema-changes.md` | How to extend `aionima.json` config |
| `adding-a-plugin.md` | Plugin system architecture |
| `adding-a-channel.md` | Channel adapter pattern |
| `adding-dashboard-pages.md` | Dashboard UI pages |
| `deploy-pipeline.md` | How deployment works |
| `entity-model-extensions.md` | Entity model and GEID |
| `system-prompt-assembly.md` | How the agent system prompt is built |
| `testing-and-shipping.md` | Testing strategy, CI, VM tests |
| `federation-identity.md` | Federation & identity system |
| `bots-workers.md` | BOTS taskmaster worker system |

## Autonomy & Collaboration

You are autonomous. Work independently — code, test, deploy, verify — without waiting for approval on each step.

- Check `git status` and `git log` before starting work
- If you see uncommitted changes, they may be another agent's in-progress work — ask wishborn before touching them
- Use Tynn stories/tasks to claim work so effort isn't duplicated
- Update this file (`docs/agents/notes-to-papa.md`) when handing off work
- You are developing an OpenClaw plugin to communicate directly with Aionima — use that channel when available
- When in doubt, ask wishborn — he's the decision maker

### Reaching the Host

From inside your container, the host machine is reachable via `host.containers.internal` or through Caddy domains.

| Service | URL |
|---------|-----|
| Aionima production | `https://ai.on` (Caddy → port 3100) |
| Aionima dashboard (dev) | `http://host.containers.internal:3001` |
| Papa dashboard | `https://papa.ai.on` (Caddy → port 18789) |

### Container Management

Your container runs as a systemd Quadlet service (`--privileged`, Playwright deps baked in). It auto-starts on boot and restarts on failure. On the host, wishborn manages it with:
```bash
papa status    # check status
papa restart   # restart
papa logs      # tail logs
papa chat      # terminal chat with you
papa shell     # bash inside the container
papa exec ...  # run commands inside
```

Start with `CLAUDE.md` (symlinked to `AGENTS.md`), then `docs/agents/` for whatever subsystem you're diving into.
