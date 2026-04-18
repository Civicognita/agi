# Project Hosting

Aionima can host local web projects and services on your LAN using Caddy as a reverse proxy, dnsmasq for local DNS, and Podman for container isolation. Projects are accessible via human-readable hostnames on your local network (e.g. `myapp.ai.on`).

---

## Enabling Project Hosting

Project hosting is disabled by default. To enable it, set the following in `gateway.json`:

```json
{
  "hosting": {
    "enabled": true,
    "lanIp": "192.168.0.144",
    "baseDomain": "ai.on",
    "containerRuntime": "podman"
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Enable the hosting infrastructure |
| `lanIp` | `192.168.0.144` | LAN IP address for DNS and Caddy binding |
| `baseDomain` | `ai.on` | Base domain for hosted projects |
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

Each project has a type that determines how it is run and hosted.

| Type | Runtime | Container Image | Notes |
|------|---------|----------------|-------|
| `node` | Node.js | Plugin-configured | Runs `npm start` or configured start command |
| `php` | PHP-FPM | Plugin-configured | Requires `plugin-php-runtime` |
| `static` | Caddy (static files) | None | Serves files directly from disk |

Additional project types can be added by runtime plugins (see the [Plugins](./plugins.md) document).

---

## Managing Projects

### Adding a Project

Projects are added via the dashboard (Projects section). The AGI stores all project configuration in `~/.agi/{projectSlug}/project.json` — nothing is written inside the project directory itself.

For example, a project at `/home/user/myproject` stores its config at `~/.agi/home-user-myproject/project.json`:

```json
{
  "name": "My App",
  "type": "node",
  "hosting": {
    "enabled": true,
    "hostname": "myapp",
    "mode": "production",
    "startCommand": "node dist/server.js",
    "docRoot": null,
    "internalPort": 3000
  }
}
```

The project is then accessible at `http://myapp.ai.on` on your LAN.

### Project Hosting Fields

| Field | Description |
|-------|-------------|
| `enabled` | Whether hosting is active for this project |
| `hostname` | Subdomain under the base domain (e.g. `myapp` → `myapp.ai.on`) |
| `mode` | `production` or `development` |
| `startCommand` | Command to run the project (for non-static types) |
| `docRoot` | Document root for static file serving |
| `internalPort` | Port the app listens on inside the container |
| `runtimeId` | Plugin runtime ID (e.g. `node-22`, `php-8.5`) |

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

## Podman Network

All hosted project containers run on a dedicated Podman network named `aionima`. This network is created automatically on first boot and is idempotent (re-creation is a no-op).

Containers communicate with Caddy via their Podman network IP addresses — no host port bindings are used for project containers. This eliminates port conflicts and port pool exhaustion.

---

## Caddyfile Generation

Aionima generates a `Caddyfile` from the list of currently hosted projects and reloads Caddy using `sudo caddy reload --config /etc/caddy/Caddyfile`.

An example generated Caddyfile:

```
myapp.ai.on {
    reverse_proxy 10.89.0.2:3000
}

api.ai.on {
    reverse_proxy 10.89.0.3:8000
}
```

Each entry uses the container's IP on the `aionima` Podman network and the container's internal listen port. The gateway dashboard itself is served at the base domain (`ai.on`) and any configured `domainAliases`.

---

## Troubleshooting

### Project Container Does Not Start

- Check the container logs: `podman logs aionima-{project-name}`.
- Verify the container image is available: `podman images`.
- Ensure the `startCommand` in `~/.agi/{projectSlug}/project.json` is correct.

### Hostname Not Resolving

- Confirm dnsmasq is running: `systemctl status dnsmasq`.
- Confirm the `address=/.ai.on/192.168.0.144` line is in `/etc/dnsmasq.conf`.
- Verify the client device is using your server as its DNS server.
- Test with `nslookup myapp.ai.on 192.168.0.144`.

### Caddy Reload Fails

- Check Caddy's error log: `sudo journalctl -u caddy -n 50`.
- Validate the generated Caddyfile syntax: `sudo caddy validate --config /etc/caddy/Caddyfile`.
- Ensure the `caddy` binary is in the PATH and has sudo permissions configured.

### Container IP Not Assigned

If a container starts but Caddy cannot reach it, the Podman network IP may not have been assigned. Inspect the container:

```bash
podman inspect aionima-myapp --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
```

Restart the project from the dashboard to trigger a fresh IP assignment and Caddyfile regeneration.
