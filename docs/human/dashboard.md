# Dashboard UI Guide

The Aionima dashboard is a React 19 single-page application served directly by the gateway on port 3100. It provides real-time status, monitoring, and control over every aspect of the system.

---

## Accessing the Dashboard

By default, the dashboard is available at:

```
http://127.0.0.1:3100
```

If you have configured a different host or port in `aionima.json`, use that address instead. The dashboard is served from `ui/dashboard/dist/` — it must be built before it is available:

```bash
pnpm build
```

The gateway serves the built static files from disk on every request, so there is no need to restart the gateway after rebuilding the dashboard. Frontend updates are zero-downtime.

---

## WebSocket Connection

The dashboard connects to the gateway via WebSocket on the same port as HTTP. The WebSocket URL is determined automatically from the page URL (`ws://` or `wss://` depending on the page protocol).

The connection is used for:
- Real-time message log updates
- Channel status changes
- Gateway state transitions
- System resource metrics

If the WebSocket disconnects, the dashboard automatically attempts to reconnect every three seconds. During reconnection, the UI continues to display the last known data.

### Connection Status Indicator

The header bar shows a row of colored dots representing the health of each core system component. The indicator polls `GET /api/system/connections` every 30 seconds.

| Dot | Component | Green | Yellow | Red |
|-----|-----------|-------|--------|-----|
| **AGI** | Gateway server | Always green (you're looking at it) | -- | -- |
| **PRIME** | Knowledge corpus | Corpus loaded, entries readable | Directory not found | Error reading corpus |
| **Workspace** | Project directories | Projects accessible | No projects configured | Dirs inaccessible |
| **ID** | Identity service | Health + functional endpoint OK | Health OK but app broken (degraded) | Service unreachable |

The ID dot only appears when `idService.local.enabled` is `true` in the config. When using the central ID service (`id.aionima.ai`), the dot shows green and is labeled "Central".

**Degraded status (yellow)** means the ID service's liveness probe (`/health`) responds but a functional endpoint (`/federation/whoami`) fails. This typically indicates a build issue (e.g., missing HTML view templates) where the service is running but can't serve pages.

---

## Theme

The dashboard uses the Catppuccin color palette with support for both dark and light modes. The active theme is determined by your OS or browser preference. No manual toggle is required; the theme switches automatically.

---

## Sidebar Navigation

The sidebar organizes the dashboard into sections. Each section groups related pages.

### Impactinomics

| Page | Purpose |
|------|---------|
| Overview | Impact score summary, entity counts, activity timeline, leaderboard |
| COA Explorer | Browse Chain of Accountability audit entries; filter by entity, channel, or date |

The Impactinomics section shows the aggregate output of the entity model. Impact scores are computed from entity activity and verification tier. The COA Explorer lets you trace every agent invocation back to its accountability fingerprint.

### Projects

The Projects section lists hosted projects — code repositories or web applications running on the local network via Caddy reverse proxy. Each project shows its hostname, status, runtime type, and quick controls (start/stop/restart container).

This section is only populated if `hosting.enabled` is `true` in `aionima.json`.

#### Database in the Development Tab

When a project's hosting panel is expanded, the Development tab includes database version selectors for PostgreSQL and MariaDB. Selecting a version displays:

- **Connection URL** — a full connection string (e.g. `postgresql://postgres:aionima@localhost:5432/aionima`) with a copy button
- **TablePlus button** — a link that opens the connection directly in TablePlus (if installed)

If the database service is not running, a message prompts you to start it first.

#### Database Portal

A database icon button in the header bar opens the **Database Portal** at `https://db.ai.on` in a new tab. The portal is a standalone page listing all registered database management tools (starting with Adminer). The portal is served by the Adminer plugin and requires Caddy to be configured with a `db.ai.on` reverse proxy block.

### Communication

The Communication section contains one page per configured channel. Pages share a common layout:

- **Status indicator** — running, stopped, or error
- **Start / Stop / Restart** buttons — send control commands to the channel plugin
- **Message log** — a filtered, real-time stream of messages flowing through that channel, showing sender entity, message content, and timestamp

Available channel pages:

| Page | Channel |
|------|---------|
| Telegram | Telegram Bot API adapter |
| Discord | Discord Gateway adapter |
| Email | Gmail OAuth2 adapter |
| Signal | signal-cli REST adapter |
| WhatsApp | WhatsApp Business API adapter |

Only channels that are configured in `aionima.json` appear in the sidebar.

### Knowledge

The Knowledge section provides access to the PRIME knowledge corpus (stored in an external repo at the path configured by `prime.dir`, default `/opt/aionima-prime`). It allows browsing and reading corpus documents. Writing from the dashboard editor is not supported — the corpus is managed via its own source repository.

### Documentation

The Documentation section renders the human-facing documentation files from `docs/human/`. This is the in-app help system. Documents are served as rendered Markdown.

### Gateway

The Gateway section covers the technical internals of the running gateway.

| Page | Purpose |
|------|---------|
| Plugins | List loaded plugins, their status, registered hooks, and registered routes |
| Workflows | View and manage active BOTS jobs (plans, task queues) |
| Logs | Live log stream from the gateway process with level filtering |
| Settings | Plugin-provided settings pages (database versions, credentials, services) plus gateway config |
| Onboarding | Re-run the guided setup wizard to update API keys, OAuth, or 0ME interviews |

The Settings section is a sidebar group with dynamically injected pages from plugins. Each plugin can register a settings page with sections for toggles, text inputs, runtime managers (install/uninstall container images), and service controls (start/stop). For example:

- **Settings > PostgreSQL** — install/uninstall PostgreSQL container images (17, 16, 15); configure default credentials and port
- **Settings > MySQL / MariaDB** — install/uninstall MariaDB container images (11.4, 10.11, 10.6); configure default credentials and port
- **Settings > Adminer** — start/stop the Adminer database management service
- **Settings > Gateway** — core gateway configuration

#### Onboarding

The Onboarding page provides a guided setup wizard. On first launch (FIRSTBOOT), the wizard takes over the full screen and walks you through initial configuration. After the first run, you can re-visit it from the Gateway sidebar to update any step.

**Steps:**

1. **Aionima ID** — Connect your Aionima ID account at `id.aionima.ai`. This is a centralized identity service that handles OAuth flows for Google and GitHub on your behalf. Click "Connect" to open a popup, log in (or create an account), connect your services, and approve the handoff. The popup closes automatically and your connected services (owner email, owner GitHub, agent email, agent GitHub) appear in the dashboard. This single step replaces what used to be four separate OAuth steps.

2. **AI Provider Keys** — Enter your Anthropic and/or OpenAI API keys. Each key is validated with a test API call before saving. At least one valid key is needed for the agent to function.

3. **Owner Profile** — Set the owner display name and DM policy for the gateway.

4. **Channels** — Connect messaging channels (Telegram, Discord, Signal, WhatsApp, Gmail). You can skip and configure later.

5. **0ME: Mind** — An interactive chat interview where the agent asks about your intellectual interests and curiosities. After a few exchanges, it produces a structured summary saved to `data/0ME/MIND.md`.

6. **0ME: Soul** — Same interview format focused on your purpose, motivations, and values. Saved to `data/0ME/SOUL.md`.

7. **0ME: Skill** — Same interview format focused on your professional skills and expertise. Saved to `data/0ME/SKILL.md`.

Every step can be skipped and revisited later. The onboarding state is tracked in `data/onboarding-state.json` — delete this file to trigger FIRSTBOOT again.

### System

The System section covers infrastructure and administration.

| Page | Purpose |
|------|---------|
| Resources | CPU, memory, disk usage of the host machine |
| Services | Status of the `aionima` systemd service; start/stop/restart |
| Admin | Upgrade via dashboard (triggers `deploy.sh`), view `.deployed-commit` status |

#### Upgrading via Dashboard

The Admin page shows whether the deployed version matches the repository HEAD. When the repository has new commits, an "Upgrade" button appears. Clicking it sends `POST /api/system/upgrade`, which runs `deploy.sh` in the background. The log output streams back to the dashboard via WebSocket.

The upgrade process does not restart the service if only frontend files changed. Backend changes trigger an automatic service restart.

#### Network Shares

The Admin page includes a **Network Shares** section for managing Samba file shares. Two shares are available:

- **Dropbox** — exposes `/home/wishborn/_dropbox` on the network
- **Projects** — exposes `/home/wishborn/temp_core` on the network

Each share has a toggle switch to enable or disable it. When enabled, the share block is added to `/etc/samba/smb.conf` and `smbd` is restarted. When disabled, the block is removed and the service restarts.

Below each enabled share, connection links are shown for all platforms:

- **Windows**: `\\nexus\Dropbox` (UNC path)
- **macOS / Linux**: `smb://nexus/Dropbox`

The link matching your detected OS is highlighted. Each link has a copy button for easy use.

---

## Chat Flyout

A chat flyout is accessible from any dashboard page. It opens a side panel where you can type messages directly to the agent, just as if you were messaging via a connected channel. This is useful for testing agent behavior without needing a Telegram or Discord account configured.

The chat flyout uses the owner entity's identity, which gives it sealed-tier access (all tools, no restrictions).

---

## Keyboard Shortcuts

| Shortcut | Action |
|---------|--------|
| `Ctrl+K` / `Cmd+K` | Open command palette (search pages, jump to sections) |
| `Esc` | Close open flyouts or modals |
| `?` | Show keyboard shortcut help overlay |

The command palette accepts fuzzy search across all page names, entity names, and recent log entries.

---

## Installing as a Desktop or Mobile App

The dashboard can be installed as a standalone app on any device — no app store required.

**Desktop (Chrome/Edge):** Click the install icon in the browser address bar (or the three-dot menu → "Install Aionima"). The dashboard opens in its own window without browser chrome.

**Mobile (Android):** Tap the "Add to Home Screen" prompt that appears, or use the browser menu → "Install app". The dashboard launches full-screen from the home screen.

**Mobile (iOS Safari):** Tap Share → "Add to Home Screen".

The installed app auto-updates whenever the gateway deploys new code — no manual update step needed. The app requires a live connection to the gateway; it does not work offline.

---

## API Backing the Dashboard

The dashboard communicates with the gateway via two mechanisms:

- **tRPC** — for typed, structured queries (entity data, impact scores, channel status, plugin list).
- **REST** — for file operations, system control (upgrade, restart), and log streaming.
- **WebSocket** — for real-time event push (new messages, state transitions, resource metrics).

All API requests include the `Authorization: Bearer <AUTH_TOKEN>` header. The token is read from the `auth.tokens` array in `aionima.json`, resolved from `$ENV{AUTH_TOKEN}`. Requests from loopback (`127.0.0.1`, `::1`) bypass auth when no token is configured.
