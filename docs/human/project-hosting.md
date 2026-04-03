# Project Hosting

Aionima can host local web projects and services on your LAN using Caddy as a reverse proxy, dnsmasq for local DNS, and Podman for container isolation. Projects are accessible via human-readable hostnames on your local network (e.g. `myapp.ai.on`).

---

## Enabling Project Hosting

Project hosting is disabled by default. To enable it, set the following in `aionima.json`:

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

Projects are added via the dashboard (Projects section) or by placing an `.aionima-project.json` file in the project directory.

Example `.aionima-project.json`:

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

## Node.js Runtime Plugin

The `plugin-node-runtime` package provides:
- Node.js container image definitions
- `npm install` and `npm run build` pre-start hooks
- Environment variable injection for database connections

The plugin registers available Node.js versions with the plugin system. The dashboard Projects panel shows available versions.

---

## PHP Runtime Plugin

The `plugin-php-runtime` package provides:
- PHP-FPM container images (configured for PHP 8.5)
- Composer dependency installation
- Document root serving via Caddy + FPM

PHP projects are served via Caddy's FastCGI reverse proxy to the PHP-FPM process inside the container. The gateway generates the appropriate Caddy configuration block automatically.

---

## Database Service Plugins

Database services are managed by service plugins. Each plugin registers a service definition with a container image and default configuration.

| Plugin | Service | Default Port | Container Image |
|--------|---------|-------------|----------------|
| `plugin-mysql` | MySQL | 3306 | `mysql:8` |
| `plugin-postgres` | PostgreSQL | 5432 | `postgres:16` |
| `plugin-redis` | Redis | 6379 | `redis:7` |

Services are scoped to projects. When a project uses a database service, the gateway starts the service container and injects connection details as environment variables into the project container.

Services can be managed via the dashboard Projects page → project details → Services tab.

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

- Check the container logs: `podman logs aionima-{project-name}`.
- Verify the container image is available: `podman images`.
- Ensure the `startCommand` in `.aionima-project.json` is correct.

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
