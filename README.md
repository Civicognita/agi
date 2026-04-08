# Aionima

Autonomous AI gateway. Connects messaging channels (Telegram, Discord, Signal, WhatsApp, Email) to an agent pipeline with impact tracking, project hosting on `*.ai.on`, a plugin marketplace, MagicApps, and a React dashboard.

## Install

One command on a fresh Ubuntu machine:

```bash
curl -fsSL https://raw.githubusercontent.com/Civicognita/agi/main/scripts/install.sh | sudo bash
```

This installs everything: Node.js, pnpm, Caddy, dnsmasq, Podman, clones all repos, builds, and starts the service. When it finishes, open the dashboard and complete onboarding.

To install as an existing user (instead of creating a new `aionima` user):

```bash
curl -fsSL https://raw.githubusercontent.com/Civicognita/agi/main/scripts/install.sh | sudo AIONIMA_USER=youruser bash
```

### After Install

The installer configures this machine's DNS automatically. To access `*.ai.on` domains from **other devices** on your network, point their DNS to this machine's IP:

| Platform | How |
|----------|-----|
| **macOS** | System Settings > Network > DNS > add the server IP |
| **Windows** | Settings > Network & Internet > DNS > set to the server IP |
| **Linux** | Set `DNS=<server-ip>` in `/etc/systemd/resolved.conf` |
| **Router** | Set primary DNS to the server IP (affects all devices) |

## Upgrade

Via dashboard (click "Upgrade" when an update is available) or CLI:

```bash
agi upgrade
```

Pulls all repos, rebuilds native modules, builds, and restarts if backend changed.

## Architecture

Five independent git repos (not submodules):

| Repo | Purpose | Production Path |
|------|---------|-----------------|
| **AGI** (this repo) | Core gateway, dashboard, CLI | `/opt/aionima` |
| **PRIME** | Knowledge corpus (Mycelium Protocol, Impactinomics) | `/opt/aionima-prime` |
| **Plugin Marketplace** | Code plugins (runtimes, stacks, workers) | `/opt/aionima-marketplace` |
| **MApp Marketplace** | Declarative JSON MagicApps | `/opt/aionima-mapp-marketplace` |
| **ID Service** | OAuth credential broker, session gateway | `/opt/aionima-local-id` |

Each repo has `protocol.json` for semver compatibility checks at boot.

## Core Features

- **Plugin Marketplace** — 40+ official plugins: runtimes (Node, PHP, Python), database stacks (PostgreSQL, MySQL, Redis), project types, themes, agent tools, workers
- **MagicApps** — JSON-defined packaged apps (Reader, Gallery, BuilderChat) that serve as project UIs
- **Project Hosting** — Every project gets a `*.ai.on` virtual host. Caddy reverse proxy + dnsmasq wildcard DNS + Podman rootless containers
- **Agent Pipeline** — Multi-channel message routing with COA (Chain of Accountability) audit trail
- **Workers & Taskmaster** — Background task orchestration across 8 domains (code, knowledge, UX, strategy, comms, ops, governance, data)
- **PRIME Corpus** — Mycelium Protocol for agent identity, Impactinomics for impact scoring, formal lexicon
- **Dev Mode** — Toggle to read from PRIME forks with COA traceability

## CLI

```bash
agi status          # Service + infra status, update check
agi upgrade         # Pull, rebuild, build, restart
agi logs [N]        # Tail gateway logs
agi restart         # Restart the service
agi doctor          # Health diagnostics
agi config [key]    # Read config values
agi projects        # List hosted projects
```

## Network

| Port | Service |
|------|---------|
| 3100 | Gateway (HTTP + WebSocket) |
| 3200 | ID Service (local) |
| 443 | Caddy (HTTPS, project hosting) |
| 53 | dnsmasq (wildcard DNS) |

## Data Paths

All runtime data lives in `~/.agi/` — never in repos or `/opt/`.

| Path | Purpose |
|------|---------|
| `~/.agi/aionima.json` | Runtime config |
| `~/.agi/entities.db` | Entity database |
| `~/.agi/plugins/cache/` | Installed plugins |
| `~/.agi/secrets/` | TPM2-sealed credentials (API keys, tokens) |

## Development

```bash
pnpm dev              # Gateway with hot-reload
pnpm dev:dashboard    # Dashboard dev server (Vite, port 3001)
pnpm build            # Build all
pnpm typecheck        # tsc --noEmit
pnpm test             # Unit tests (Multipass VM required)
```

## License

Proprietary — Civicognita. All rights reserved.
