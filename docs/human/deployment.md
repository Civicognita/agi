# Deployment, Upgrades, and Systemd

This document covers how Aionima is deployed to production, how the upgrade process works, and how the systemd service is managed.

---

## Overview

Aionima uses a **multi-repo architecture** with independent git repositories:

| Repo | Production Path | Purpose |
|------|----------------|---------|
| **AGI** | `/opt/aionima` | Gateway server, dashboard, plugins |
| **PRIME** | `/opt/aionima-prime` | Knowledge corpus (Mycelium Protocol) |
| **Plugin Marketplace** | `/opt/aionima-marketplace` | Code plugins (runtimes, stacks, workers, etc.) |
| **MApp Marketplace** | `/opt/aionima-mapp-marketplace` | Declarative JSON MagicApps |
| **ID** | `/opt/aionima-local-id` | OAuth credential broker and identity service |

Each repo is a standalone git clone on the server. There are no submodules. If a companion repo directory doesn't exist during deployment, deploy.sh auto-clones it.

The upgrade flow is:

```
1. Developer pushes to main branch on GitHub
2. Dashboard detects new commits (polls every 60 seconds)
3. Operator clicks "Upgrade" in the dashboard
4. Gateway calls POST /api/system/upgrade
5. deploy.sh runs: pull all repos -> protocol check -> build -> conditionally restart
```

**Never run `deploy.sh` manually** unless explicitly needed. The normal path is always through the dashboard Upgrade button.

---

## First-Time Deployment

### Step 1 -- Clone All Repositories

```bash
# AGI (main gateway — required)
git clone git@github.com:Civicognita/agi.git /opt/aionima

# PRIME (knowledge corpus — optional)
git clone git@github.com:Civicognita/aionima.git /opt/aionima-prime

# MARKETPLACE (plugin marketplace — optional)
git clone git@github.com:Civicognita/aionima-marketplace.git /opt/aionima-marketplace

# ID (identity service — optional)
git clone git@github.com:Civicognita/aionima-local-id.git /opt/aionima-local-id
```

### Step 2 -- Install Node.js and pnpm

```bash
# Node.js 22 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

# pnpm via corepack
sudo corepack enable pnpm
```

### Step 3 -- Install Dependencies and Build

```bash
cd /opt/aionima
pnpm install
pnpm build
```

### Step 4 -- Run the Setup Wizard

```bash
pnpm cli setup --dir /opt/aionima
```

This creates `/opt/aionima/aionima.json` and `/opt/aionima/.env`.

### Step 5 -- Configure Repository Paths

Add repo paths to `~/.agi/aionima.json`:

```json
{
  "prime": {
    "dir": "/opt/aionima-prime"
  },
  "marketplace": {
    "dir": "/opt/aionima-marketplace"
  },
  "idService": {
    "local": {
      "enabled": true,
      "port": 3200,
      "subdomain": "id"
    },
    "dir": "/opt/aionima-local-id"
  }
}
```

When `idService.local.enabled` is `true`, the gateway manages a local ID service at `id.ai.on` instead of using the central `id.aionima.ai` service.

### Step 6 -- Run the Deployment Script

```bash
cd /opt/aionima
bash scripts/deploy.sh
```

### Step 7 -- Start the Service

```bash
sudo systemctl start aionima
sudo systemctl status aionima
```

---

## deploy.sh -- What It Does

The deployment script (`scripts/deploy.sh`) emits structured JSON logs for each phase, which the dashboard parses to show real-time progress.

### Phase 1 -- Pull AGI

```bash
git pull --ff-only
```

Only fast-forward merges are allowed. If the repo has diverged, the pull fails and deployment stops.

### Phase 2 -- Pull PRIME

```bash
cd /opt/aionima-prime && git pull --ff-only
```

Non-fatal -- if PRIME pull fails, deployment continues in degraded mode.

### Phase 3 -- Pull MARKETPLACE

```bash
cd /opt/aionima-marketplace && git pull --ff-only
```

Non-fatal -- plugins still work from the previous build cache.

### Phase 3c -- Pull ID

```bash
cd /opt/aionima-local-id && git pull --ff-only
```

Non-fatal -- if ID pull fails, the identity service continues running from its last good state.

### Phase 3d -- Build ID Service

When `idService.local.enabled` is `true` in the config, the ID service is built and restarted:

1. `npm install` — installs all dependencies (including devDependencies like `typescript`)
2. `npm run build` — compiles TypeScript
3. `npx drizzle-kit migrate` — runs database migrations (non-fatal if it fails)
4. `sudo systemctl restart aionima-local-id` — restarts the service

### Phase 4 -- Protocol Compatibility Check

Each repo has a `protocol.json` at its root:

```json
{
  "name": "aionima-agi",
  "version": "0.5.0",
  "protocol": "1.0.0",
  "requires": {
    "aionima-prime": ">=1.0.0"
  }
}
```

The script checks that protocol files exist in all deployed repos. Repos whose directory doesn't exist on disk are silently skipped. At boot, the gateway does a full semver compatibility check and logs warnings if versions are incompatible.

### Phase 5 -- Install and Build

```bash
pnpm install --frozen-lockfile
pnpm build
```

### Phase 5b -- Build Marketplace Plugins

Marketplace plugins are bundled with `tsdown`, and a symlink is created from the marketplace directory to AGI's `node_modules/`:

```bash
npx tsx scripts/build-marketplace.ts /opt/aionima-marketplace
ln -sfn /opt/aionima/node_modules /opt/aionima-marketplace/node_modules
```

The symlink allows bundled plugins to resolve external dependencies (like `better-sqlite3`) that are marked as `external` in the bundle config. Without it, Node.js can't find the packages because it resolves bare specifiers relative to the importing file's location.

### Phase 6 -- Checksum Comparison

Backend dist directories are checksummed before and after the build. If the checksums match, no restart is needed (frontend-only change).

Backend directories tracked:
- `cli/dist/`
- `packages/gateway-core/dist/`
- `channels/telegram/dist/`
- `channels/discord/dist/`
- `channels/gmail/dist/`
- `packages/plugin-*/src/`

### Phase 7 -- Conditional Restart

If backend files changed, the service is restarted. Frontend-only changes take effect immediately on the next request (zero-downtime).

### Phase 8 -- Deployed Commit Marker

```bash
git rev-parse HEAD > /opt/aionima/.deployed-commit
```

The dashboard reads this to detect available updates.

---

## Systemd Service

The service unit is installed at `/etc/systemd/system/aionima.service`.

```ini
[Unit]
Description=Aionima Gateway
After=network.target

[Service]
Type=simple
User=wishborn
WorkingDirectory=/opt/aionima
ExecStart=node cli/dist/index.js run
Restart=on-failure
RestartSec=5s
EnvironmentFile=/opt/aionima/.env

[Install]
WantedBy=multi-user.target
```

### Service Management Commands

```bash
# Start the service
sudo systemctl start aionima

# Stop the service
sudo systemctl stop aionima

# Restart the service
sudo systemctl restart aionima

# View service status
sudo systemctl status aionima

# View live logs
sudo journalctl -u aionima -f

# View recent logs
sudo journalctl -u aionima -n 100
```

---

## Dashboard Upgrade Flow

1. The dashboard polls `GET /api/system/update-status` every 60 seconds.
2. The endpoint compares the repo HEAD SHA against the `.deployed-commit` file.
3. If they differ, the dashboard shows an "Upgrade available" badge.
4. Clicking "Upgrade" sends `POST /api/system/upgrade`.
5. The gateway spawns `scripts/deploy.sh` and streams structured JSON logs via WebSocket.
6. Each phase (pull-agi, pull-prime, build, etc.) is shown in real time.
7. When deploy.sh exits, the dashboard shows "Upgrade complete" (or an error).
8. If the backend changed and the service restarted, the WebSocket connection drops briefly. The dashboard reconnects automatically within 3 seconds.

---

## Protocol Versioning

Each repository has a `protocol.json` that declares its name, version, and protocol version. The AGI repo additionally declares minimum required protocol versions for PRIME and ID.

At boot, the gateway reads `protocol.json` from all deployed repos and checks semver compatibility. If a repo's directory doesn't exist (not deployed), it's silently skipped. If a directory exists but `protocol.json` is missing, or versions are incompatible, a warning is logged and the system runs in degraded mode.

---

## Rollback

There is no automated rollback. If a deployment breaks the service:

1. SSH into the server.
2. Check the service logs: `sudo journalctl -u aionima -n 50`.
3. If the issue is in the code, revert the commit in the repo and redeploy.
4. If the config was changed, edit `/opt/aionima/aionima.json` and restart.

---

## Monitoring

### Health Check

```bash
# AGI gateway health
curl http://127.0.0.1:3100/health
# Response: { "ok": true, "state": "ONLINE", "uptime": 123.45, "channels": 0, "sessions": 0 }
```

### ID Service Health

When the local ID service is enabled, the gateway performs a dual health check:

1. `GET http://localhost:3200/health` — basic liveness probe
2. `GET http://localhost:3200/federation/whoami` — functional endpoint that verifies views and database

The dashboard connection indicator shows:
- **Green** — both endpoints respond OK (`"connected"`)
- **Yellow** — liveness OK but functional endpoint broken (`"degraded"`)
- **Red** — service unreachable (`"error"`)

This prevents false-green status when the ID service is partially broken (e.g., health endpoint works but HTML views are missing).

### TLS Certificates

All `*.ai.on` domains use Caddy's internal PKI (`tls internal`), which generates a local root CA and per-domain leaf certificates. Certificate management is fully automatic:

- **Root CA installation:** `caddy trust` is run during hosting setup (`hosting-setup.sh`) and verified at every gateway boot. This installs the Caddy root CA into the system trust store so browsers and curl trust the self-signed certificates.
- **Leaf cert renewal:** Caddy automatically renews leaf certificates for each virtual host before they expire. No manual intervention is needed.
- **Root CA lifetime:** The internal root CA is valid for 10 years. If it's regenerated (e.g., Caddy reinstallation), the gateway automatically re-runs `caddy trust` at the next boot.

Both core system domains (dashboard, db portal, ID service) and project virtual hosts use the same internal CA. All cert operations are handled by Caddy and the gateway's HostingManager — no manual commands are needed after initial setup.

### Log Files

Application logs are written to `/opt/aionima/logs/`. Logs rotate at 10 MB with up to 5 rotated files kept.
