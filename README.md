# Aionima

Autonomous AI gateway for the Aionima platform. Connects messaging channels (Telegram, Discord, Signal, WhatsApp, Email) to an agent pipeline with impact tracking (COA), project hosting on `*.ai.on`, a plugin marketplace, MagicApps, and a React dashboard.

## Architecture

Aionima is a **pnpm monorepo** with four companion repos:

| Repo | Purpose | Production Path |
|------|---------|-----------------|
| **AGI** (this repo) | Core gateway, dashboard, CLI | `/opt/aionima` |
| **PRIME** | Knowledge corpus, Mycelium Protocol, lexicon | `/opt/aionima-prime` |
| **Marketplace** | Plugin catalog (40+ official plugins) | `/opt/aionima-marketplace` |
| **ID Service** | OAuth credential broker, session gateway | `/opt/aionima-local-id` |

These are independent git repos, not submodules. Each has `protocol.json` for semver compatibility checks at boot.

## Core Features

### Plugin Marketplace

ALL plugins live in the Marketplace repo — never in AGI's `packages/` directory. Plugins extend the gateway with runtimes, stacks, project types, themes, agent tools, MagicApps, and more via 30 `register*()` methods on the SDK.

```bash
# Marketplace structure
/opt/aionima-marketplace/
  marketplace.json          # Catalog (40+ plugins)
  plugins/
    plugin-node-runtime/    # Node.js 22/24 runtimes
    plugin-stack-nextjs/    # Next.js stack (guides + tools)
    plugin-reader-literature/  # Reader MagicApp
    plugin-reader-media/       # Gallery MagicApp
    ...
```

Plugins are auto-installed from `config/required-plugins.json` during deploy.

### MagicApps ($P0)

MagicApps are JSON-defined packaged applications that bundle UI, container serving, and agentic capabilities. They serve non-dev project types (literature, media) and extend dev projects with additional tooling.

- **Reader** — e-reader for literature projects (nginx + marked.js SPA)
- **Gallery** — media gallery for art projects (nginx + responsive grid SPA)
- **BuilderChat** — AI-powered MagicApp creation via 3-phase guided design

MagicApps open as floating/docked modal windows with persistent state (survives crash/browser close). Each instance is project-anchored.

### Project Hosting

Every project gets a `*.ai.on` virtual host automatically:
- **Dev projects** (web, app, monorepo, ops) → container via runtime + stacks
- **Content projects** (literature, media) → container via MagicApp viewer
- Caddy reverse proxy + dnsmasq wildcard DNS on the LAN
- Podman rootless containers with SELinux labels

### Dev Mode

Toggle via dashboard or config. Dev mode:
- Reads PRIME from `dev.primeDir` (fork, not production)
- Adds `fork_id` to COA audit records for traceability
- Switches all core repos to owner forks

### PRIME Corpus

The PRIME knowledge corpus (separate repo) provides:
- **Mycelium Protocol** — agent identity, boot sequence, operational states
- **COA (Chain of Accountability)** — every agent action is auditable
- **0SCALE** — impact scoring formula
- **Entity taxonomy** — #E (person), #O (org), $A (agent), $P (plugin/MagicApp)
- **Lexicon** — formal term definitions

Read-only at runtime. Never write data to PRIME.

### ID Service

Local OAuth credential broker for agent identity:
- Google, GitHub OAuth providers
- Session gateway with JWT
- PostgreSQL-backed (auto-provisioned Podman container)

## System Requirements

| Dependency | Version | Purpose |
|------------|---------|---------|
| **Node.js** | >= 22.0.0 | Runtime (via NodeSource) |
| **pnpm** | 10.5 | Package manager (`corepack enable pnpm`) |
| **Podman** | latest | Rootless containers for project hosting |
| **Caddy** | latest | HTTPS reverse proxy for `*.ai.on` |
| **dnsmasq** | latest | Wildcard DNS on the LAN |
| **systemd** | any | Service management |
| **Ubuntu Linux** | 22.04+ | Host OS |

Run `sudo bash scripts/hosting-setup.sh` for Caddy + dnsmasq, or use the dashboard setup flow.

## Quick Start

```bash
corepack enable pnpm
pnpm install

# Configure
cp aionima.example.json ~/.agi/aionima.json
# Edit with API keys, channel tokens, etc.

# Development
pnpm dev              # Gateway with hot-reload
pnpm dev:dashboard    # Dashboard dev server (Vite, port 3001)

# Production
pnpm build            # Dashboard (Vite) + backend (tsdown)
```

## Project Structure

```
aionima/
  cli/                          CLI entry point (Commander.js)
  config/                       Config schema (Zod — aionima.json + project.json)
  packages/
    gateway-core/               HTTP/WS server, agent pipeline, hosting, MagicApps
    entity-model/               SQLite entity store, impact scoring, GEID
    channel-sdk/                Channel adapter interface
    coa-chain/                  Chain of Accountability audit logger
    memory/                     Composite memory adapter
    skills/                     Skill file loader
    voice/                      STT/TTS pipeline (Whisper, Edge TTS)
    plugins/                    Plugin lifecycle, discovery, registry (30 register methods)
    aion-sdk/                   Developer SDK (builders, ADF facades, testing utils)
    marketplace/                Marketplace manager (install, sync, catalog)
    security/                   Security scanning (SAST, SCA, secrets, config)
    workers/                    Worker task orchestration (Taskmaster)
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
  apps/
    screensaver/                Dashboard screensaver
    ios-companion/              iOS companion app
    android-companion/          Android companion app
    macos-desktop/              macOS desktop client
  scripts/
    deploy.sh                   Production deployment pipeline
    agi-cli.sh                  Standalone bash CLI (agi status/upgrade/logs)
    migrate-project-configs.sh  Schema migration for project.json files
    hosting-setup.sh            Caddy + dnsmasq installation
    aionima.service             systemd unit file
    test-vm.sh                  Multipass test VM lifecycle
  prompts/
    builder-chat.md             BuilderChat system prompt
  test/
    fixtures/                   Test fixtures (sample projects, config files)
  e2e/                          Playwright e2e tests
  docs/
    human/                      User-facing documentation
    agents/                     AI agent development guides
    sdk/                        Plugin SDK reference
    governance/                 Verification, impact scoring specs
```

## Testing

**ALL tests run inside a Multipass VM** — never on the host. A safety guard in `vitest.config.ts` throws if `AIONIMA_TEST_VM` is not set.

```bash
# VM lifecycle
pnpm test:vm:create        # Create Ubuntu 24.04 VM (2 CPU, 4GB RAM, 20GB disk)
pnpm test:vm:setup         # Install Node 22 + pnpm, run pnpm install
pnpm test:vm:destroy       # Tear down the VM
pnpm test:vm:ssh           # SSH into the VM

# Run tests
pnpm test                  # Unit tests (vitest inside VM)
pnpm test:e2e              # System e2e (install → API → onboarding → plugins)
pnpm test:e2e:ui           # Playwright UI tests (host browser → VM)
pnpm test:all              # All tiers
```

The VM mounts all workspace repos. Test config at `test/fixtures/aionima-test.json` points to VM mount paths. Sample project fixtures cover 12 project types (Laravel, Next.js, Node, PHP, Python, static, literature, media, etc.).

CI (GitHub Actions) sets `AIONIMA_TEST_VM=1` and runs vitest directly (already isolated).

## CLI (`agi`)

Standalone bash CLI for managing the gateway when the dashboard is down:

```bash
sudo ln -sf /opt/aionima/scripts/agi-cli.sh /usr/local/bin/agi

agi status          # Service + infra status, update check
agi logs [N]        # Tail gateway logs (or -f to follow)
agi upgrade         # Full deploy pipeline with parsed output
agi restart         # Restart the service
agi doctor          # Health check (node, pnpm, caddy, podman, disk)
agi config [key]    # Read config values (dot-path)
agi projects        # List hosted projects with status
```

## Deployment

Automated through the dashboard or `agi upgrade`:

1. Pull AGI, PRIME, Marketplace, ID repos
2. Check protocol compatibility
3. `pnpm install --frozen-lockfile`
4. `pnpm build` (Vite + tsdown)
5. Reconcile required plugins against marketplace
6. Migrate project configs to current schema
7. Checksum backend — restart only if changed

The systemd service runs from `/opt/aionima` as the configured user. All runtime data lives in `~/.agi/` (config, database, secrets, chat history, MagicApp state).

## Network

| Port | Service | Protocol |
|------|---------|----------|
| 3100 | Gateway (HTTP + WebSocket) | TCP |
| 3200 | ID Service (local) | TCP |
| 443 | Caddy (HTTPS, project hosting) | TCP |
| 53 | dnsmasq (DNS) | TCP/UDP |

## Security & Compliance

Unified control system aligned to SOC 2, HIPAA, PCI DSS, GDPR, NIST 800-53, and ISO 27001. See [docs/human/security.md](docs/human/security.md).

| Domain | Implementation |
|--------|---------------|
| Audit | COA chain with integrity hash, configurable retention (365d/90d hot) |
| Encryption | AES-256-GCM field-level for PII at rest |
| MFA | TOTP (RFC 6238) with recovery codes |
| Incidents | Breach tracking with GDPR 72h / HIPAA 60d clocks |
| Privacy | GDPR erasure, consent tracking, data export |
| Backups | Scheduled SQLite backups with retention |
| Sessions | Server-side revocation, API key lifecycle |

## Data Paths

| Path | Purpose |
|------|---------|
| `~/.agi/aionima.json` | Runtime config (single source of truth) |
| `~/.agi/entities.db` | SQLite entity database |
| `~/.agi/{slug}/project.json` | Per-project config (Zod-validated) |
| `~/.agi/magic-app-state.db` | MagicApp instance persistence |
| `~/.agi/plugins/cache/` | Installed marketplace plugins |
| `~/.agi/chat-history/` | Chat session history |
| `~/.agi/secrets/` | TPM2-sealed credentials |
| `~/.agi/memory/` | Agent memory |
| `~/.agi/logs/` | Structured log files |

## License

Proprietary — Civicognita. All rights reserved.
