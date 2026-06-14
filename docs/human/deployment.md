# Deployment, Upgrades, and Systemd

This document covers how Aionima is deployed to production, how the upgrade process works, and how the systemd service is managed.

---

## Overview

Aionima uses a **multi-repo architecture** with independent git repositories:

| Repo | Production Path | Purpose |
|------|----------------|---------|
| **AGI** | `/opt/agi` | Gateway server, dashboard, plugins |
| **PRIME** | `/opt/agi-prime` | Knowledge corpus (Mycelium Protocol) |
| **Plugin Marketplace** | `/opt/agi-marketplace` | Code plugins (runtimes, stacks, workers, etc.) |
| **MApp Marketplace** | `/opt/agi-mapp-marketplace` | Declarative JSON MagicApps |

Identity (OAuth, entity registration) is built into the AGI gateway — there is no separate `/opt/agi-local-id` repo. Each repo is a standalone git clone on the server. There are no submodules.

The upgrade flow is:

```
1. Developer pushes to main branch on GitHub
2. Dashboard detects new commits (polls every 60 seconds)
3. Operator clicks "Upgrade" in the dashboard
4. Gateway calls POST /api/system/upgrade
5. upgrade.sh runs: pull all repos -> protocol check -> build -> conditionally restart
```

**Never run `upgrade.sh` manually** unless explicitly needed. The normal path is always through the dashboard Upgrade button.

---

## First-Time Deployment

### Step 1 -- Clone All Repositories

```bash
# AGI (main gateway — required)
git clone git@github.com:Civicognita/agi.git /opt/agi

# PRIME (knowledge corpus — optional)
git clone git@github.com:Civicognita/aionima.git /opt/agi-prime

# MARKETPLACE (plugin marketplace — optional)
git clone git@github.com:Civicognita/agi-marketplace.git /opt/agi-marketplace
```

> Note: there is no separate ID repo — identity is built into AGI.

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
cd /opt/agi
pnpm install
pnpm build
```

### Step 4 -- Run the Setup Wizard

```bash
pnpm cli setup --dir /opt/agi
```

This creates `/opt/agi/gateway.json` and `/opt/agi/.env`.

### Step 5 -- Configure Repository Paths

Add repo paths to `~/.agi/gateway.json`:

```json
{
  "prime": {
    "dir": "/opt/agi-prime"
  },
  "marketplace": {
    "dir": "/opt/agi-marketplace"
  }
}
```

### Step 6 -- Run the Deployment Script

```bash
cd /opt/agi
bash scripts/upgrade.sh
```

### Step 7 -- Start the Service

```bash
sudo systemctl start agi
sudo systemctl status agi
```

---

## upgrade.sh -- What It Does

The deployment script (`scripts/upgrade.sh`) emits structured JSON logs for each phase, which the dashboard parses to show real-time progress.

### Phase 1 -- Pull AGI

```bash
git pull --ff-only
```

Only fast-forward merges are allowed. If the repo has diverged, the pull fails and deployment stops.

### Phase 2 -- Pull PRIME

```bash
cd /opt/agi-prime && git pull --ff-only
```

Non-fatal -- if PRIME pull fails, deployment continues in degraded mode.

### Phase 3 -- Pull MARKETPLACE

```bash
cd /opt/agi-marketplace && git pull --ff-only
```

Non-fatal -- plugins still work from the previous build cache.

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
npx tsx scripts/build-marketplace.ts /opt/agi-marketplace
ln -sfn /opt/agi/node_modules /opt/agi-marketplace/node_modules
```

The symlink allows bundled plugins to resolve external dependencies (like `better-sqlite3`) that are marked as `external` in the bundle config. Without it, Node.js can't find the packages because it resolves bare specifiers relative to the importing file's location.

### Phase 6 -- Checksum Comparison

Backend dist directories are checksummed before and after the build. If the checksums match, no restart is needed (frontend-only change).

Backend directories tracked:
- `cli/dist/`
- `packages/gateway-core/dist/`

### Phase 7 -- Conditional Restart

If backend files changed, the service is restarted. Frontend-only changes take effect immediately on the next request (zero-downtime).

### Phase 8 -- Deployed Commit Marker

```bash
git rev-parse HEAD > /opt/agi/.deployed-commit
```

The dashboard reads this to detect available updates.

---

## Systemd Service

The service unit is installed at `/etc/systemd/system/agi.service`. The canonical source is `scripts/agi.service` in the AGI repo.

```ini
[Unit]
Description=Aionima Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=wishborn
Group=wishborn
WorkingDirectory=/opt/agi

# Trust Caddy's local CA so Node.js accepts self-signed certs for *.ai.on domains.
Environment=NODE_EXTRA_CA_CERTS=/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt

ExecStart=/usr/bin/node /opt/agi/cli/dist/index.js run
# Restart=always (not on-failure) — the dashboard's Gateway Restart button
# (POST /api/gateway/restart) and `agi restart` both send SIGTERM to the
# process, which the gateway handles as a clean shutdown (exit 0). With
# Restart=on-failure, systemd treats clean exits as success and does NOT
# bring the service back up. Restart=always brings it back regardless of
# exit code; `systemctl stop agi` still stops it cleanly.
Restart=always
RestartSec=5
TimeoutStopSec=10
KillMode=mixed
StandardOutput=journal
StandardError=journal
SyslogIdentifier=agi

[Install]
WantedBy=multi-user.target
```

### Service Management Commands

```bash
# Start the service
sudo systemctl start agi

# Stop the service
sudo systemctl stop agi

# Restart the service
sudo systemctl restart agi

# View service status
sudo systemctl status agi

# View live logs
sudo journalctl -u agi -f

# View recent logs
sudo journalctl -u agi -n 100
```

---

## Dashboard Upgrade Flow

1. The dashboard polls `GET /api/system/update-status` every 60 seconds.
2. The endpoint compares the repo HEAD SHA against the `.deployed-commit` file.
3. If they differ, the dashboard shows an "Upgrade available" badge.
4. Clicking "Upgrade" sends `POST /api/system/upgrade`.
5. The gateway spawns `scripts/upgrade.sh` and streams structured JSON logs via WebSocket.
6. Each phase (pull-agi, pull-prime, build, etc.) is shown in real time.
7. When upgrade.sh exits, the dashboard shows "Upgrade complete" (or an error).
8. If the backend changed and the service restarted, the WebSocket connection drops briefly. The dashboard reconnects automatically within 3 seconds.

---

## Protocol Versioning

Each repository has a `protocol.json` that declares its name, version, and protocol version. The AGI repo additionally declares minimum required protocol versions for PRIME and ID.

At boot, the gateway reads `protocol.json` from all deployed repos and checks semver compatibility. If a repo's directory doesn't exist (not deployed), it's silently skipped. If a directory exists but `protocol.json` is missing, or versions are incompatible, a warning is logged and the system runs in degraded mode.

---

## Rollback

There is no automated rollback. If a deployment breaks the service:

1. SSH into the server.
2. Check the service logs: `sudo journalctl -u agi -n 50`.
3. If the issue is in the code, revert the commit in the repo and redeploy.
4. If the config was changed, edit `/opt/agi/gateway.json` and restart.

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

Application logs are written to `/opt/agi/logs/`. Logs rotate at 10 MB with up to 5 rotated files kept.

---

## Off-Grid Install (Air-Gapped / No Internet After Install)

Aionima can run fully offline once the aion-micro GGUF is pre-staged. There are two paths:

### Path A — Internet available at install time (recommended)

The default install automatically downloads the aion-micro GGUF during step 7b:

```bash
sudo bash install.sh
```

`install.sh` downloads `wishborn/aion-micro-v1` from HuggingFace Hub to `~/.agi/models/aion-micro/aion-micro-v1.gguf` and writes `ops.aionMicro.localGgufPath` into `gateway.json`. After install, the box can be isolated from the internet and aion-micro will continue working.

If the model is in a private HF repo, pass a token:

```bash
AIONIMA_HF_TOKEN=hf_xxx sudo bash install.sh
```

To skip model pre-fetch (e.g., in a CI environment where Lemonade will pull on first use):

```bash
AIONIMA_PREFETCH_MODELS=0 sudo bash install.sh
```

### Path B — True air-gap (no internet at any point)

Obtain the GGUF on a networked machine and transfer it to the target box:

```bash
# On a networked machine:
curl -L -o aion-micro-v1.gguf \
  "https://huggingface.co/wishborn/aion-micro-v1/resolve/main/aion-micro-v1.gguf"

# Transfer aion-micro-v1.gguf to the air-gapped box, then:
AIONIMA_GGUF_PATH=/path/to/aion-micro-v1.gguf sudo bash install.sh
```

`install.sh` copies the file to `~/.agi/models/aion-micro/aion-micro-v1.gguf` and patches `gateway.json` in one step.

### What `localGgufPath` does

When `ops.aionMicro.localGgufPath` is set in `gateway.json`, `AionMicroManager` sends the absolute file path as the model identifier to Lemonade's `/v1/chat/completions` API. Lemonade (llama.cpp-backed) treats an absolute path as a direct GGUF file load rather than a catalog lookup — no HF Hub call is made.

To verify the setup after install:

```bash
agi doctor          # should pass with no model-related warnings
agi status          # gateway should show "online"
# In the dashboard, send a chat message — aion-micro should respond
```

### Manual GGUF staging (after initial install)

If the install completed without the GGUF (e.g., model wasn't published yet):

```bash
# Download (when internet becomes available):
mkdir -p ~/.agi/models/aion-micro
curl -L -o ~/.agi/models/aion-micro/aion-micro-v1.gguf \
  "https://huggingface.co/wishborn/aion-micro-v1/resolve/main/aion-micro-v1.gguf"

# Then add localGgufPath to gateway.json:
agi config ops.aionMicro.localGgufPath ~/.agi/models/aion-micro/aion-micro-v1.gguf
agi restart
```

Or use the Lemonade plugin's pull tool from the dashboard: Settings → Lemonade → pull `wishborn/aion-micro-v1`.
