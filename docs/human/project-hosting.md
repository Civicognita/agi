# Project Hosting

Aionima can host local projects and services on your LAN using Caddy as a reverse proxy, dnsmasq for local DNS, and Podman for container isolation. Projects are accessible via human-readable hostnames on your local network (e.g. `myapp.ai.on`).

> **Universal monorepo model (s150).** Every project — code-served or Desktop-served — has a `repos/` directory and a network face. The `type` field in `<projectPath>/project.json` is the single classifier; it discriminates between projects that serve code (web-app, static-site, api-service, php-app, art, writing) and projects that serve a Desktop bundle of MApp tiles (ops, media, literature, documentation, backup-aggregator). The legacy `category` and `hosting.containerKind` fields have been retired (see `_discovery/pm-hosting-reconciliation.md` for the full reconciliation).

---

## Enabling Project Hosting

Project hosting is disabled by default. To enable it, set the following in `gateway.json`:

```json
{
  "hosting": {
    "enabled": true,
    "lanIp": "192.168.0.144",
    "baseDomain": "ai.on",
    "portRangeStart": 4000,
    "containerRuntime": "podman"
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Enable the hosting infrastructure |
| `lanIp` | `192.168.0.144` | LAN IP address for DNS and Caddy binding |
| `baseDomain` | `ai.on` | Base domain for hosted projects |
| `portRangeStart` | `4000` | Start of the port range for reverse proxies |
| `containerRuntime` | `podman` | Container runtime (only `podman` supported) |
| `statusPollIntervalMs` | `10000` | How often to poll container status |
| `domainAliases` | `[]` | Extra domains that proxy to the gateway dashboard |

---

## Infrastructure Requirements

### Caddy

Caddy is the reverse proxy that routes requests from `*.ai.on` to the appropriate container. Aionima generates a `Caddyfile` dynamically and reloads it when projects are added or removed.

Install Caddy:

```bash
sudo apt install caddy
# or
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo apt-key add -
echo "deb https://dl.cloudsmith.io/public/caddy/stable/debian.bullseye main" | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### dnsmasq

dnsmasq provides local DNS resolution so `*.ai.on` resolves to your LAN IP.

Install and configure:

```bash
sudo apt install dnsmasq
```

Add to `/etc/dnsmasq.conf`:

```
address=/.ai.on/192.168.0.144
```

Restart dnsmasq:

```bash
sudo systemctl restart dnsmasq
```

Point your router or client devices at your server's IP as the DNS server.

### Podman

Podman runs containers without a daemon (rootless). Install it:

```bash
sudo apt install podman
```

Verify rootless containers work:

```bash
podman run --rm hello-world
```

### Automated Setup

The `scripts/hosting-setup.sh` script installs and configures all three components:

```bash
bash scripts/hosting-setup.sh
```

---

## Project Types

The `type` field in `<projectPath>/project.json` discriminates two container shapes — code-served vs Desktop-served. The dispatch helper `servesDesktopFor(type, registry)` reads the type registry's explicit `servesDesktop` flag first, then falls back to the canonical id sets below.

### Code-served (the project's own code produces the network face)

| Type id | Typical project | Container shape |
|---------|-----------------|----------------|
| `web-app` | React/Vue/Next/Nuxt apps | Stack-driven (`stack-nextjs`, `stack-react-vite`, `stack-nuxt`, etc.) |
| `static-site` | Static HTML/Vite-only output | Caddy static, `dist/` served from `repos/<name>/dist` |
| `api-service` | Node/Go/Rust/FastAPI services | Stack-driven (`stack-node-app`, `stack-fastapi`, `stack-go-app`, …) |
| `php-app` | Laravel / WordPress / loose `.php` | `aionima-php-runtime` Apache image |
| `art` | Code that produces media art | Stack-driven (mostly static) |
| `writing` | Markdown content with a code-driven SSG | Stack-driven |

### Desktop-served (Aion Desktop bundle serves the network face)

| Type id | Typical project | Container shape |
|---------|-----------------|----------------|
| `ops` | Operations dashboards, monitoring | nginx:alpine + generated MApp Desktop, tiles from `hosting.mapps[]` |
| `media` | Image / video / asset libraries | nginx:alpine + MApp tiles |
| `literature` | Book-style content, chronicles | nginx:alpine + MApp tiles |
| `documentation` | Project family docs aggregator | nginx:alpine + MApp tiles |
| `backup-aggregator` | Cross-repo backup index | nginx:alpine + MApp tiles |

Additional project types can be added by runtime plugins (see [Plugins](./plugins.md)). Plugin manifests should NOT set a `category` — `id` alone identifies the type, and the gateway derives Desktop-served vs code-served from the canonical sets in `agi/packages/gateway-core/src/project-types.ts`.

> **Retired (s150 t640):** the `monorepo` project type was removed. Every project IS a monorepo per the universal-monorepo directive; a sibling "monorepo" type contradicted the model. Boot sweep remaps existing `type: "monorepo"` to `"web-app"`.

---

## Managing Projects

### Adding a Project

Projects are added via the dashboard (Projects section). Configuration lives at the project root: `<projectPath>/project.json`. Pre-s130 location (`~/.agi/{slug}/project.json`) and the intermediate `<projectPath>/.agi/project.json` are migrated transparently.

For example, a code-served project at `/home/user/_projects/myapp/`:

```json
{
  "name": "My App",
  "type": "web-app",
  "description": "Customer-facing storefront.",
  "hosting": {
    "enabled": true,
    "hostname": "myapp",
    "mode": "production",
    "startCommand": "node dist/server.js",
    "docRoot": null,
    "internalPort": 3000,
    "stacks": [{ "stackId": "stack-nextjs", "addedAt": "2026-04-01T00:00:00Z" }]
  }
}
```

A Desktop-served project (e.g. operations dashboards) looks like:

```json
{
  "name": "Civicognita Ops",
  "type": "ops",
  "description": "Operations dashboards for Civicognita.",
  "hosting": {
    "enabled": true,
    "hostname": "civicognita-ops",
    "mode": "production",
    "mapps": ["ops-monitor", "incident-board"]
  }
}
```

Both projects are then accessible at `https://<hostname>.ai.on` on your LAN.

### Project Hosting Fields

| Field | Description |
|-------|-------------|
| `enabled` | Whether hosting is active for this project |
| `hostname` | Subdomain under the base domain (e.g. `myapp` → `myapp.ai.on`) |
| `type` | Project type id (mirrors top-level `type`; drives container shape) |
| `mode` | `production` or `development` |
| `startCommand` | Command to run the project (code-served only) |
| `docRoot` | Document root for static file serving (code-served only) |
| `internalPort` | Port the app listens on inside the container |
| `runtimeId` | Plugin runtime ID (e.g. `node-24`, `php-8.4`) |
| `mapps` | List of MApp IDs to render as Desktop tiles (Desktop-served only) |
| `stacks` | Installed stacks (code-served only — boot sweep strips for Desktop-served) |
| `tunnelUrl` / `tunnelId` | Cloudflare named-tunnel state |
| `viewer` | Single MApp viewer (legacy single-viewer path; superseded by `mapps[]` for new projects) |

> **Removed (s150 t634):** the `containerKind` field on `hosting` is no longer schema-enforced. The dashboard payload still computes a `containerKind` value from `type` for back-compat consumers; that surface lands gone in a follow-up SDK rev.

### Desktop-served container shape

Projects with a Desktop-served type (`ops`, `media`, `literature`, `documentation`, `backup-aggregator`) often have no codebase to "run" and no custom UI to host — what they need is a curated set of MApps (a Budget MApp, a Whitepaper Brainstorming MApp, a Model Training MApp, etc.). For those projects, set `type` to one of the Desktop-served ids and list the MApp IDs in `hosting.mapps[]`.

When the gateway boots the container, it:

1. Reads each MApp's `manifest.json` from `~/.agi/mapps/cache/<mappId>/`.
   IDs without a manifest still render as **placeholder tiles** so the
   operator sees the configured layout even before the MApp is installed.
2. Generates an `index.html` in `~/.agi/mapps/host/<hostname>/` with one
   tile per configured MApp.
3. Starts an `nginx:alpine` container with the host directory bind-mounted
   read-only at `/usr/share/nginx/html`. The MApp Desktop is served at
   `https://<hostname>.ai.on/`.

### Per-MApp standalone routing

Tile clicks on the MApp Desktop resolve to `https://<hostname>.ai.on/<mappId>/`.
The gateway writes one of two things to that slot during dispatch:

- **Installed MApp** — the gateway leaves `<hostHtmlDir>/<mappId>/`
  alone, so the MApp's bundled HTML/JS/assets serve directly. (When
  the MApp Marketplace populates entries with bundles, that's where
  they go.)
- **Uninstalled MApp** — the gateway writes a per-MApp "not installed
  yet" placeholder page at `<hostHtmlDir>/<mappId>/index.html`. Tile
  clicks resolve to a project-aware install-CTA page instead of
  nginx's generic 404.

The placeholder page links back to `/` (the MApp Desktop) so the
operator can return without the browser back button.

### Dashboard Controls

The Projects page in the dashboard shows each hosted project with:
- Hostname and URL
- Container status (running, stopped, error)
- Start / Stop / Restart buttons
- Log stream button (opens container logs)
- Tunnel URL (if a Cloudflare quick tunnel is active)

---

## Container Runtime (Podman)

Each project runs in an isolated Podman container. Containers are named `aionima-{project-dir-name}` for identification.

Container lifecycle:
- **Start**: Aionima calls `podman run` with the appropriate image, environment variables, and volume mounts.
- **Stop**: Aionima calls `podman stop {container-name}`.
- **Restart**: Stop followed by start.
- **Status**: Aionima polls `podman ps` every `statusPollIntervalMs` milliseconds.

Rootless Podman is preferred for security. The gateway does not require root access to manage containers.

---

## Container Images

All project containers use custom GHCR images (`ghcr.io/civicognita/*`) instead of vanilla upstream images. These images come pre-installed with all common extensions and tools for their ecosystem, eliminating runtime compilation and "missing extension" errors.

### Node.js Runtime

The `aionima-node-runtime` plugin provides Node.js 24, 22, and 20 LTS runtimes using `ghcr.io/civicognita/node:{version}`. The custom image includes build tools (python3, make, g++, git) for native npm modules like `sharp` and `bcrypt`, plus corepack for pnpm/yarn support.

### PHP Runtime

The `aionima-php-runtime` plugin provides PHP 8.5, 8.4, 8.3, and 8.2 runtimes using `ghcr.io/civicognita/php-apache:{version}`. The custom image includes all common PHP extensions (gd, intl, pdo_pgsql, pdo_mysql, redis, imagick, zip, bcmath, opcache, pcntl, sockets, exif, sodium), Composer, and Apache with mod_rewrite enabled.

---

## Database Service Plugins

Database services are managed by service plugins. Each uses a custom GHCR image with common extensions pre-installed — databases are ready to use immediately after container start with no runtime compilation.

| Plugin | Service | Default Port | Container Image | Pre-installed |
|--------|---------|-------------|----------------|---------------|
| `aionima-postgres` | PostgreSQL 17, 16, 15 | 5432 | `ghcr.io/civicognita/postgres:{version}` | pgvector, PostGIS, pg_trgm, uuid-ossp, hstore |
| `aionima-mysql` | MariaDB 11.4, 10.11, 10.6 | 3306 | `ghcr.io/civicognita/mariadb:{version}` | utf8mb4, dev-friendly defaults |
| `aionima-redis` | Redis 7.4, 7.2, 6.2 | 6379 | `ghcr.io/civicognita/redis:{version}` | Append-only persistence, LRU eviction |

Database stacks are shared — one PostgreSQL container serves all projects that use it. Each project gets its own database, username, and password. Extensions like pgvector are already compiled into the image; projects just need `CREATE EXTENSION vector;`.

Services can be managed via the dashboard Projects page → project details → Stacks section.

---

## Cloudflare Quick Tunnels

Quick tunnels provide temporary public URLs for projects without requiring a domain name or public IP. This is useful for sharing work in progress or testing webhooks.

To start a tunnel for a project:

1. Open the project in the dashboard.
2. Click "Start Tunnel".
3. The gateway launches `cloudflared tunnel --url` and captures the assigned URL (e.g. `https://random-words.trycloudflare.com`).

The tunnel URL is displayed in the project card and updated in real time. Tunnels are stopped when the project is stopped or when the gateway shuts down.

Cloudflared must be installed:

```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
```

---

## Port Pool

Aionima allocates ports from a pool starting at `portRangeStart` (default: 4000). Each hosted project gets one port from the pool. The port is used for the Caddy → container reverse proxy route.

If a port in the pool is already in use by another process, Aionima increments to the next port until a free one is found.

---

## Caddyfile Generation

Aionima generates a `Caddyfile` from the list of currently hosted projects and reloads Caddy using `sudo caddy reload --config /etc/caddy/Caddyfile`.

An example generated Caddyfile:

```
myapp.ai.on {
    reverse_proxy localhost:4000
}

api.ai.on {
    reverse_proxy localhost:4001
}

*.ai.on {
    respond "Not found" 404
}
```

The gateway dashboard itself is served at the base domain (`ai.on`) and any configured `domainAliases`.

---

## Troubleshooting

### Project Container Does Not Start

- Check the container logs: `podman logs agi-{hostname}`.
- Verify the container image is available: `podman images`.
- Ensure the `startCommand` in `<projectPath>/project.json` is correct (code-served projects only).
- Run `agi doctor` — the s150 t641 project-shape diagnostic flags drift in `<projectPath>/project.json` against the canonical s150 model.

### Hostname Not Resolving

- Confirm dnsmasq is running: `systemctl status dnsmasq`.
- Confirm the `address=/.ai.on/192.168.0.144` line is in `/etc/dnsmasq.conf`.
- Verify the client device is using your server as its DNS server.
- Test with `nslookup myapp.ai.on 192.168.0.144`.

### Caddy Reload Fails

- Check Caddy's error log: `sudo journalctl -u caddy -n 50`.
- Validate the generated Caddyfile syntax: `sudo caddy validate --config /etc/caddy/Caddyfile`.
- Ensure the `caddy` binary is in the PATH and has sudo permissions configured.

### Port Conflict

If the allocated port is already in use, the container fails to start. Check `ss -tlnp | grep :4000` to see what is using the port. Adjust `portRangeStart` to a free range.
