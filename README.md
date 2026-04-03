# Aionima

Autonomous gateway for the Aionima hive-mind. Connects messaging channels (Telegram, Discord, Signal, WhatsApp, Email) to an AI agent pipeline with impact tracking, project management, and local network hosting.

## System Requirements

### Required

| Dependency | Version | Purpose |
|------------|---------|---------|
| **Node.js** | >= 22.0.0 | Runtime (via [NodeSource](https://github.com/nodesource/distributions)) |
| **pnpm** | 10.5.2 | Package manager (via `corepack enable pnpm`) |
| **Git** | any | Version control, deployment, project management |
| **SQLite** | (bundled) | Primary data store (via `better-sqlite3` native module) |
| **systemd** | any | Service management (`aionima.service`) |
| **Ubuntu Linux** | 22.04+ | Host OS |

### Project Hosting (optional, enabled via config)

| Dependency | Version | Purpose |
|------------|---------|---------|
| **Caddy** | latest | HTTP reverse proxy / static file server for `*.ai.on` |
| **dnsmasq** | latest | Wildcard DNS resolution for `*.ai.on` on the LAN |
| **PHP-FPM** | any | Only needed if hosting PHP projects |

Run `sudo bash scripts/hosting-setup.sh` to install Caddy + dnsmasq, or trigger it from the dashboard UI.

### Messaging Channels (optional, per channel)

| Dependency | Purpose | Notes |
|------------|---------|-------|
| **Telegram Bot Token** | Telegram channel | Via [@BotFather](https://t.me/BotFather) |
| **Discord Bot Token** | Discord channel | Via Discord Developer Portal |
| **Signal-CLI** | Signal channel | JVM app, runs in REST API mode (`http://localhost:8080`). Requires Java 21+ |
| **Gmail OAuth2 credentials** | Email channel | `clientId`, `clientSecret`, `refreshToken` |
| **WhatsApp Business API** | WhatsApp channel | Webhook-based |

Channels degrade gracefully - if a channel's external service is unavailable, the gateway starts without it.

### LLM Providers

| Provider | Required? | Notes |
|----------|-----------|-------|
| **Anthropic API** | Primary | API key in config or `ANTHROPIC_API_KEY` env var |
| **Ollama** | Optional | Local/offline fallback at `http://localhost:11434` |
| **OpenAI API** | Optional | Alternative provider |

## Quick Start

```bash
# Install dependencies
corepack enable pnpm
pnpm install

# Configure
cp aionima.example.json aionima.json
# Edit aionima.json with your API keys, channel tokens, etc.

# Development
pnpm dev              # Start gateway with hot-reload
pnpm dev:dashboard    # Start dashboard dev server

# Production build
pnpm build
```

## Deployment

Deployment is automated through the dashboard:

1. **Push to `main`** — GitHub webhook notifies the server; dashboard also polls every 60s
2. **User clicks "Upgrade"** in the dashboard UI
3. **`POST /api/system/upgrade`** triggers `scripts/deploy.sh`, which:
   - Pulls latest from the repo (`git pull --ff-only`)
   - Builds everything (`pnpm build` — Vite + tsdown)
   - Snapshots backend checksums before syncing
   - Rsyncs built artifacts to `/opt/aionima` (backend, frontend, plugins, channels, PRIME knowledge, skills)
   - Copies only native deps (better-sqlite3, node-pty) — not the full pnpm store
   - Compares checksums after sync — **restarts the service only if backend changed** (frontend updates are zero-downtime)
   - Writes `.deployed-commit` marker for update detection

The systemd service (`aionima.service`) runs from `/opt/aionima` as the `wishborn` user.

## CI/CD

GitHub Actions runs on every push/PR to `main`:
- `pnpm install --frozen-lockfile`
- `pnpm typecheck` (tsc --noEmit)
- `pnpm lint` (oxlint)
- `pnpm test` (vitest)

## Network

| Port | Service | Protocol |
|------|---------|----------|
| 3100 | Gateway (HTTP + WebSocket) | TCP |
| 80 | Caddy (project hosting) | TCP |
| 53 | dnsmasq (DNS) | TCP/UDP |

### Firewall (UFW)

If UFW is active, allow the gateway port:

```bash
sudo ufw allow 3100/tcp
# For project hosting:
sudo ufw allow 80/tcp
sudo ufw allow 53/tcp
sudo ufw allow 53/udp
```

## Project Structure

```
aionima/
  cli/                        # CLI entry point (Commander.js)
  config/                     # Config schema (Zod validation)
  packages/
    gateway-core/             # HTTP/WS server, agent pipeline, core engine
    entity-model/             # SQLite entity store, message queue
    channel-sdk/              # Channel plugin interface
    coa-chain/                # Chain of Accountability audit logger
    memory/                   # Composite memory adapter
    skills/                   # Skill file loader
    voice/                    # STT/TTS pipeline (Whisper, Edge TTS)
    plugins/                  # Plugin lifecycle & discovery
    trpc-api/                 # tRPC router definitions
    agent-bridge/             # Agent invocation logic
    plugin-editor/            # Editor plugin
    plugin-mysql/             # MySQL service plugin
    plugin-postgres/          # PostgreSQL service plugin
    plugin-redis/             # Redis service plugin
    plugin-node-runtime/      # Node.js runtime plugin
    plugin-php-runtime/       # PHP-FPM runtime plugin
  channels/
    telegram/                 # Telegram adapter (grammy)
    discord/                  # Discord adapter (discord.js)
    email/                    # Gmail OAuth2 adapter
    signal/                   # Signal adapter (signal-cli REST)
    whatsapp/                 # WhatsApp Business API adapter
  ui/
    dashboard/                # React dashboard (Vite + Tailwind + TanStack Query)
  scripts/
    deploy.sh                 # Production deployment
    aionima.service           # systemd unit file
    hosting-setup.sh          # Caddy + dnsmasq installation
    hosting-teardown.sh       # Reverse of setup
  .aionima/                   # PRIME knowledge corpus
  skills/                     # Agent skill definitions
  data/                       # Runtime data (entities.db, etc.)
```

## Security & Compliance

Aionima implements a unified control system aligned to SOC 2, HIPAA, PCI DSS, GDPR, NIST SP 800-53, and ISO 27001. See [docs/human/security.md](docs/human/security.md) for the full reference.

| Control Domain | Implementation | Config |
|----------------|---------------|--------|
| Audit logging | COA chain with source IP, integrity hash chain, configurable retention | `logging.retentionDays` (365), `logging.hotRetentionDays` (90) |
| Encryption at rest | AES-256-GCM field-level encryption for PII | `compliance.encryptionAtRest`, `compliance.encryptionKey` |
| MFA/2FA | TOTP (RFC 6238) with recovery codes | `compliance.requireMfa` |
| Incident response | Breach tracking with GDPR 72h / HIPAA 60d notification clocks | Incident API |
| Privacy | GDPR erasure (right to deletion), consent tracking, data export | Entity API |
| Vendor management | Third-party processor tracking with DPA/BAA status, annual review | Vendor API |
| Backup & recovery | Scheduled SQLite backups with retention | `backup.enabled`, `backup.retentionDays` |
| Session management | Server-side revocation, API key lifecycle with expiration | Session API |
| CI security | Dependency audit, secrets scanning | `.github/workflows/security.yml` |

Run `aionima doctor` to verify your compliance posture.

## Key Config Paths

| Path | Purpose |
|------|---------|
| `aionima.json` | Main configuration |
| `.env` | Environment variables (API keys) |
| `/etc/caddy/Caddyfile` | Auto-generated by HostingManager |
| `/etc/dnsmasq.d/ai-on.conf` | DNS wildcard config |
| `/etc/systemd/system/aionima.service` | systemd unit |
| `data/entities.db` | SQLite database |

## Common Commands

```bash
pnpm start            # Start gateway (production)
pnpm dev              # Start with hot-reload (tsx watch)
pnpm dev:dashboard    # Dashboard dev server (Vite, port 5173)
pnpm build            # Build all: dashboard (Vite) + backend (tsdown)
pnpm typecheck        # tsc --noEmit (full monorepo)
pnpm lint             # oxlint
pnpm format           # oxfmt
pnpm check            # typecheck + lint combined
pnpm test             # vitest (unit/integration)
pnpm test:e2e         # Playwright (e2e)
```
