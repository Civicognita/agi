# API Reference

Aionima exposes three API surfaces: **REST HTTP endpoints** (Fastify), a **tRPC router** for typed dashboard queries, and a **WebSocket event stream** for real-time updates. Most endpoints are restricted to private network access; loopback requests bypass authentication entirely.

---

## Authentication

Aionima uses a layered access model:

1. **Loopback bypass** — Requests from `127.0.0.1`, `::1`, or `::ffff:127.0.0.1` skip all auth checks.
2. **Private network gating** — Most `/api/*` routes only accept connections from RFC 1918 addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) and IPv6 link-local (`fe80::/10`). Non-private requests receive `403 Forbidden`.
3. **Bearer token** — When `auth.tokens` is configured in `aionima.json`, non-loopback requests must include:

```
Authorization: Bearer <AUTH_TOKEN>
```

4. **Dashboard auth** — When the dashboard user store is enabled, certain endpoints require JWT tokens obtained from `POST /api/auth/login`. Admin endpoints additionally require the `admin` role.

---

## Base URL

```
http://127.0.0.1:3100
```

Replace with your configured `gateway.host` and `gateway.port`.

---

## Endpoint Index

| Method | Path | Section | Access |
|--------|------|---------|--------|
| GET | `/health` | [Health](#get-health) | Loopback-exempt |
| GET | `/api/system/stats` | [System Stats](#get-apisystemstats) | Private network |
| GET | `/api/system/connections` | [Connections](#get-apisystemconnections) | Private network |
| GET | `/api/channels` | [Channels](#get-apichannels) | Private network |
| GET | `/api/channels/:id` | [Channels](#get-apichannelsid) | Private network |
| POST | `/api/channels/:id/start` | [Channels](#post-apichannelsidstart) | Private network |
| POST | `/api/channels/:id/stop` | [Channels](#post-apichannelsidstop) | Private network |
| POST | `/api/channels/:id/restart` | [Channels](#post-apichannelsidrestart) | Private network |
| GET | `/api/config` | [Config](#get-apiconfig) | Private network |
| PUT | `/api/config` | [Config](#put-apiconfig) | Private network |
| PATCH | `/api/config` | [Config](#patch-apiconfig) | Private network |
| POST | `/api/reload` | [System](#post-apireload) | Private network |
| GET | `/api/system/update-check` | [System](#get-apisystemupdate-check) | Private network |
| POST | `/api/system/upgrade` | [System](#post-apisystemupgrade) | Private network |
| POST | `/api/webhooks/push` | [System](#post-apiwebhookspush) | HMAC-verified |
| GET | `/api/projects` | [Projects](#get-apiprojects) | Private network |
| POST | `/api/projects` | [Projects](#post-apiprojects) | Private network |
| PUT | `/api/projects` | [Projects](#put-apiprojects) | Private network |
| DELETE | `/api/projects` | [Projects](#delete-apiprojects) | Private network |
| GET | `/api/projects/info` | [Projects](#get-apiprojectsinfo) | Private network |
| POST | `/api/projects/git` | [Projects](#post-apiprojectsgit) | Private network |
| GET | `/api/hosting/status` | [Hosting](#get-apihostingstatus) | Private network |
| GET | `/api/hosting/setup` | [Hosting](#get-apihostingsetup) | Private network |
| POST | `/api/hosting/enable` | [Hosting](#post-apihostingenable) | Private network |
| POST | `/api/hosting/disable` | [Hosting](#post-apihostingdisable) | Private network |
| PUT | `/api/hosting/configure` | [Hosting](#put-apihostingconfigure) | Private network |
| POST | `/api/hosting/restart` | [Hosting](#post-apihostingrestart) | Private network |
| POST | `/api/hosting/tunnel/enable` | [Hosting](#post-apihostingtunnelenable) | Private network |
| POST | `/api/hosting/tunnel/disable` | [Hosting](#post-apihostingtunneldisable) | Private network |
| GET | `/api/hosting/logs` | [Hosting](#get-apihostinglogs) | Private network |
| GET | `/api/hosting/log-sources` | [Hosting](#get-apihostinglog-sources) | Private network |
| GET | `/api/hosting/project-types` | [Hosting](#get-apihostingproject-types) | Private network |
| POST | `/api/hosting/tools/:toolId` | [Hosting](#post-apihostingtoolstoolid) | Private network |
| GET | `/api/hosting/client-setup/:os` | [Hosting](#get-apihostingclient-setupos) | Private network |
| GET | `/api/hosting/ca-cert` | [Hosting](#get-apihostingca-cert) | Private network |
| GET | `/db-portal` | [Hosting](#get-db-portal) | Private network |
| GET | `/api/db-portal/tools` | [Hosting](#get-apidb-portaltools) | Private network |
| POST | `/api/db-portal/register` | [Hosting](#post-apidb-portalregister) | Private network |
| GET | `/api/hosting-extensions` | [Hosting](#get-apihosting-extensions) | Private network |
| GET | `/api/hosting-extensions/:projectType` | [Hosting](#get-apihosting-extensionsprojecttype) | Private network |
| GET | `/api/stacks` | [Stacks](#get-apistacks) | Private network |
| GET | `/api/stacks/:id` | [Stacks](#get-apistacksid) | Private network |
| POST | `/api/hosting/stacks/add` | [Stacks](#post-apihostingstacksadd) | Private network |
| POST | `/api/hosting/stacks/remove` | [Stacks](#post-apihostingstacksremove) | Private network |
| GET | `/api/hosting/stacks` | [Stacks](#get-apihostingstacks) | Private network |
| GET | `/api/shared-containers` | [Stacks](#get-apishared-containers) | Private network |
| GET | `/api/shared-containers/:key/connection` | [Stacks](#get-apishared-containerskeyconnection) | Private network |
| GET | `/api/marketplace/sources` | [Marketplace](#get-apimarketplacesources) | Private network |
| POST | `/api/marketplace/sources` | [Marketplace](#post-apimarketplacesources) | Private network |
| DELETE | `/api/marketplace/sources/:id` | [Marketplace](#delete-apimarketplacesourcesid) | Private network |
| POST | `/api/marketplace/sources/:id/sync` | [Marketplace](#post-apimarketplacesourcesidsync) | Private network |
| GET | `/api/marketplace/catalog` | [Marketplace](#get-apimarketplacecatalog) | Private network |
| POST | `/api/marketplace/install` | [Marketplace](#post-apimarketplaceinstall) | Private network |
| DELETE | `/api/marketplace/installed/:pluginName` | [Marketplace](#delete-apimarketplaceinstalledpluginname) | Private network |
| GET | `/api/marketplace/installed` | [Marketplace](#get-apimarketplaceinstalled) | Private network |
| GET | `/api/marketplace/updates` | [Marketplace](#get-apimarketplaceupdates) | Private network |
| GET | `/api/plugins` | [Plugins](#get-apiplugins) | Private network |
| PUT | `/api/plugins/:id` | [Plugins](#put-apipluginsid) | Private network |
| GET | `/api/runtimes` | [Runtimes](#get-apiruntimes) | Private network |
| GET | `/api/runtimes/:projectType` | [Runtimes](#get-apiruntimesprojecttype) | Private network |
| GET | `/api/runtimes/installed` | [Runtimes](#get-apiruntimesinstalled) | Private network |
| POST | `/api/runtimes/:id/install` | [Runtimes](#post-apiruntimesidinstall) | Private network |
| POST | `/api/runtimes/:id/uninstall` | [Runtimes](#post-apiruntimesiduninstall) | Private network |
| GET | `/api/services` | [Services](#get-apiservices) | Private network |
| POST | `/api/services/:id/start` | [Services](#post-apiservicesidstart) | Private network |
| POST | `/api/services/:id/stop` | [Services](#post-apiservicesidstop) | Private network |
| POST | `/api/services/:id/restart` | [Services](#post-apiservicesidrestart) | Private network |
| GET | `/api/models` | [Models](#get-apimodels) | Private network |
| GET | `/api/prime/status` | [PRIME](#get-apiprimestatus) | Private network |
| POST | `/api/prime/switch` | [PRIME](#post-apiprimeswitch) | Private network |
| GET | `/api/dev/status` | [Contributing Mode](#get-apidevstatus) | Private network |
| POST | `/api/dev/switch` | [Contributing Mode](#post-apidevswitch) | Private network |
| GET | `/api/workers/jobs` | [Workers](#get-apiworkersjobs) | Private network |
| POST | `/api/workers/approve/:jobId` | [Workers](#post-apiworkersapprovejobid) | Private network |
| POST | `/api/workers/reject/:jobId` | [Workers](#post-apiworkersrejectjobid) | Private network |
| GET | `/api/plans` | [Plans](#get-apiplans) | Private network |
| GET | `/api/plans/:planId` | [Plans](#get-apiplansplanid) | Private network |
| POST | `/api/plans` | [Plans](#post-apiplans) | Private network |
| PUT | `/api/plans/:planId` | [Plans](#put-apiplansplanid) | Private network |
| DELETE | `/api/plans/:planId` | [Plans](#delete-apiplansplanid) | Private network |
| GET | `/api/comms` | [Comms](#get-apicomms) | Private network |
| GET | `/api/notifications` | [Notifications](#get-apinotifications) | Private network |
| POST | `/api/notifications/read` | [Notifications](#post-apinotificationsread) | Private network |
| POST | `/api/notifications/read-all` | [Notifications](#post-apinotificationsread-all) | Private network |
| GET | `/api/chat/sessions` | [Chat History](#get-apichatsessions) | Private network |
| GET | `/api/chat/sessions/:id` | [Chat History](#get-apichatsessionsid) | Private network |
| DELETE | `/api/chat/sessions/:id` | [Chat History](#delete-apichatsessionsid) | Private network |
| GET | `/api/machine/info` | [Machine Admin](#get-apimachineinfo) | Private network |
| POST | `/api/machine/hostname` | [Machine Admin](#post-apimachinehostname) | Private network |
| GET | `/api/machine/users` | [Machine Admin](#get-apimachineusers) | Private network |
| POST | `/api/machine/users` | [Machine Admin](#post-apimachineusers) | Private network |
| PUT | `/api/machine/users/:username` | [Machine Admin](#put-apimachineusersusername) | Private network |
| DELETE | `/api/machine/users/:username` | [Machine Admin](#delete-apimachineusersusername) | Private network |
| GET | `/api/machine/users/:username/ssh-keys` | [Machine Admin](#get-apimachineusersusernamessh-keys) | Private network |
| POST | `/api/machine/users/:username/ssh-keys` | [Machine Admin](#post-apimachineusersusernamessh-keys) | Private network |
| DELETE | `/api/machine/users/:username/ssh-keys/:index` | [Machine Admin](#delete-apimachineusersusernamessh-keysindex) | Private network |
| GET | `/api/agents` | [Machine Admin](#get-apiagents) | Private network |
| GET | `/api/agents/:id` | [Machine Admin](#get-apiagentsid) | Private network |
| POST | `/api/agents/:id/restart` | [Machine Admin](#post-apiagentsidrestart) | Private network |
| POST | `/api/auth/login` | [Machine Admin](#post-apiauthlogin) | Open |
| GET | `/api/auth/me` | [Machine Admin](#get-apiauthme) | Bearer token |
| GET | `/api/auth/status` | [Machine Admin](#get-apiauthstatus) | Open |
| GET | `/api/admin/users` | [Machine Admin](#get-apiadminusers) | Admin role |
| POST | `/api/admin/users` | [Machine Admin](#post-apiadminusers) | Admin role |
| PUT | `/api/admin/users/:id` | [Machine Admin](#put-apiadminusersid) | Admin role |
| DELETE | `/api/admin/users/:id` | [Machine Admin](#delete-apiadminusersid) | Admin role |
| POST | `/api/admin/users/:id/reset-password` | [Machine Admin](#post-apiadminusersidreset-password) | Admin role |
| GET | `/api/samba/shares` | [Machine Admin](#get-apisambashares) | Private network |
| POST | `/api/samba/shares/:name/enable` | [Machine Admin](#post-apisambasharenameenable) | Private network |
| POST | `/api/samba/shares/:name/disable` | [Machine Admin](#post-apisambasharedisable) | Private network |
| GET | `/api/onboarding/state` | [Onboarding](#get-apionboardingstate) | Private network |
| PATCH | `/api/onboarding/state` | [Onboarding](#patch-apionboardingstate) | Private network |
| POST | `/api/onboarding/reset` | [Onboarding](#post-apionboardingreset) | Private network |
| GET | `/api/onboarding/owner-profile` | [Onboarding](#get-apionboardingowner-profile) | Private network |
| POST | `/api/onboarding/owner-profile` | [Onboarding](#post-apionboardingowner-profile) | Private network |
| GET | `/api/onboarding/channels` | [Onboarding](#get-apionboardingchannels) | Private network |
| POST | `/api/onboarding/channels` | [Onboarding](#post-apionboardingchannels) | Private network |
| POST | `/api/onboarding/ai-keys` | [Onboarding](#post-apionboardingai-keys) | Private network |
| POST | `/api/onboarding/aionima-id/start` | [Onboarding](#post-apionboardingaionima-idstart) | Private network |
| GET | `/api/onboarding/aionima-id/poll` | [Onboarding](#get-apionboardingaionima-idpoll) | Private network |
| GET | `/api/onboarding/aionima-id/status` | [Onboarding](#get-apionboardingaionima-idstatus) | Private network |
| POST | `/api/onboarding/zero-me/chat` | [Onboarding](#post-apionboardingzero-mechat) | Private network |
| POST | `/api/onboarding/zero-me/save` | [Onboarding](#post-apionboardingzero-mesave) | Private network |
| GET | `/api/identity/:entityId` | [Identity](#get-apiidentityentityid) | Open |
| GET | `/api/identity/resolve/:geid` | [Identity](#get-apiidentityresolvegeid) | Open |
| GET | `/api/auth/providers` | [Identity](#get-apiauthproviders) | Open |
| POST | `/api/auth/start/:provider` | [Identity](#post-apiauthstartprovider) | Open |
| GET | `/api/auth/callback/:provider` | [Identity](#get-apiauthcallbackprovider) | Open |
| POST | `/api/sub-users` | [Sub-Users](#post-apisub-users) | Private network |
| GET | `/api/sub-users` | [Sub-Users](#get-apisub-users) | Private network |
| POST | `/api/visitor/challenge` | [Federation](#post-apivisitorchallenge) | Open |
| POST | `/api/visitor/verify` | [Federation](#post-apivisitorverify) | Open |
| GET | `/api/visitor/session` | [Federation](#get-apivisitorsession) | Bearer token |
| GET | `/.well-known/mycelium-node.json` | [Federation](#get-well-knownmycelium-nodejson) | Open |
| POST | `/api/files/read` | [File API](#post-apifilesread) | Private network |
| POST | `/api/files/write` | [File API](#post-apifileswrite) | Private network |
| POST | `/api/files/tree` | [File API](#post-apifilestree) | Private network |
| POST | `/api/files/project-read` | [File API](#post-apifilesproject-read) | Private network |
| POST | `/api/files/project-write` | [File API](#post-apifilesproject-write) | Private network |
| POST | `/api/files/project-tree` | [File API](#post-apifilesproject-tree) | Private network |

---

## REST Endpoints

### Health and Status

#### GET /health

Health check endpoint. Loopback-exempt — no auth required even from external IPs.

Response:

```json
{
  "ok": true,
  "state": "ONLINE",
  "uptime": 7423.5,
  "channels": 2,
  "sessions": 4
}
```

#### GET /api/system/stats

System resource metrics: CPU, memory, disk, and uptime.

Response:

```json
{
  "cpu": {
    "loadAvg": [1.2, 0.9, 0.7],
    "cores": 8,
    "usage": 15.3
  },
  "memory": {
    "total": 16384,
    "free": 8192,
    "used": 8192,
    "percent": 50
  },
  "disk": {
    "total": 512000,
    "used": 128000,
    "free": 384000,
    "percent": 25
  },
  "uptime": 86400,
  "hostname": "Nexus"
}
```

#### GET /api/system/connections

Core system connection status — AGI, PRIME, workspace, and ID service health.

Response:

```json
{
  "agi": {
    "status": "connected",
    "branch": "main",
    "commit": "abc1234",
    "uptime": 86400,
    "state": "ONLINE"
  },
  "prime": {
    "status": "connected",
    "dir": "/opt/aionima-prime",
    "entries": 142,
    "branch": "main"
  },
  "workspace": {
    "status": "connected",
    "configured": 5,
    "accessible": 5,
    "root": "/home/wishborn/temp_core"
  },
  "idService": {
    "status": "connected",
    "mode": "local",
    "url": "https://id.ai.on",
    "version": "standalone"
  }
}
```

**`prime.status`**: `"connected"` (corpus loaded), `"missing"` (directory not found), `"error"` (read failure).

**`workspace.status`**: `"connected"` (projects accessible), `"empty"` (no projects configured), `"error"` (dirs inaccessible).

**`idService.status`**: `"connected"` (healthy), `"degraded"` (liveness OK but functional endpoint broken), `"error"` (unreachable), `"central"` (using central ID service at id.aionima.ai). Only present when ID service is configured.

**`idService.mode`**: `"local"` (self-hosted ID service) or `"central"` (delegated to id.aionima.ai).

The dashboard connection indicator uses this endpoint to render colored dots in the header bar.

---

### Channels

#### GET /api/channels

List all registered messaging channels.

Response:

```json
[
  {
    "id": "telegram",
    "status": "running",
    "registeredAt": "2026-03-01T10:00:00.000Z"
  }
]
```

#### GET /api/channels/:id

Get details for a single channel.

- **`:id`** — Channel identifier (e.g., `telegram`, `discord`)

Response:

```json
{
  "id": "telegram",
  "status": "running",
  "registeredAt": "2026-03-01T10:00:00.000Z",
  "error": null,
  "capabilities": ["text", "media"]
}
```

Returns `404` if the channel is not registered.

#### POST /api/channels/:id/start

Start a stopped channel.

Response: `{ "ok": true }`

#### POST /api/channels/:id/stop

Stop a running channel.

Response: `{ "ok": true }`

#### POST /api/channels/:id/restart

Restart a channel (stop then start).

Response: `{ "ok": true }`

---

### Config

Config endpoints are only registered when a config file path is available. All require private network access.

#### GET /api/config

Read the current configuration (`aionima.json`).

Response: The full parsed config object.

#### PUT /api/config

Replace the entire configuration. Use with caution — this overwrites the full file.

Request body: Full config object.

Response:

```json
{ "ok": true, "message": "Config saved" }
```

#### PATCH /api/config

Merge a single key into the config using dot-notation. Preferred for targeted updates.

Request body:

```json
{ "key": "plugins.screensaver.design", "value": "aurora" }
```

Nested keys are resolved automatically — `"a.b.c"` sets `config.a.b.c`.

Response:

```json
{ "ok": true, "message": "Config saved" }
```

---

### System

#### POST /api/reload

Hot-reload the PRIME index and skill definitions without restarting the gateway. Only registered if the reload handler is configured.

Response:

```json
{
  "primeEntries": 142,
  "skillCount": 6,
  "timestamp": "2026-03-08T12:00:00.000Z"
}
```

#### GET /api/system/update-check

Check whether a newer version is available. Caches the result for 30 seconds to avoid repeated git fetches.

Response:

```json
{
  "updateAvailable": true,
  "localCommit": "abc1234",
  "remoteCommit": "def5678",
  "behindCount": 3,
  "commits": [
    { "hash": "def5678", "message": "Fix channel restart", "date": "2026-03-08" }
  ]
}
```

#### POST /api/system/upgrade

Trigger the deployment pipeline (`scripts/deploy.sh`). Returns `202 Accepted` immediately and broadcasts progress via WebSocket `system:upgrade` events. Concurrent upgrades are rejected with `409` (5-minute timeout).

Response:

```json
{ "ok": true, "message": "Upgrade started" }
```

#### POST /api/webhooks/push

GitHub push webhook receiver. Verifies the HMAC signature from the `X-Hub-Signature-256` header against the configured webhook secret. Only reacts to pushes to the `main` branch — broadcasts update availability via WebSocket when new commits are detected.

Headers:
- `X-Hub-Signature-256` — HMAC-SHA256 signature of the request body

Request body: GitHub push event payload (JSON).

Response: `{ "ok": true }`

---

### Projects

All project endpoints require private network access.

#### GET /api/projects

List workspace projects from the configured `workspace.projects` directories.

Response:

```json
[
  {
    "name": "my-app",
    "path": "/home/user/projects/my-app",
    "hasGit": true,
    "tynnToken": "abc123",
    "hosting": { "enabled": true, "hostname": "my-app.ai.on" },
    "detectedHosting": "nodejs",
    "projectType": "nodejs",
    "category": "web",
    "description": "My web application"
  }
]
```

#### POST /api/projects

Create a new project. Optionally clones from a git remote.

Request body:

```json
{
  "name": "new-project",
  "tynnToken": "abc123",
  "repoRemote": "https://github.com/user/repo.git",
  "category": "web",
  "type": "nodejs"
}
```

All fields are optional. If `repoRemote` is provided, the repo is cloned.

Response (`201`):

```json
{
  "ok": true,
  "name": "new-project",
  "slug": "new-project",
  "path": "/home/user/projects/new-project",
  "cloned": true
}
```

#### PUT /api/projects

Update project metadata (name, Tynn token, category).

Request body:

```json
{
  "path": "/home/user/projects/my-app",
  "name": "My App",
  "tynnToken": "abc123",
  "category": "web"
}
```

- **`path`** (required) — Absolute path to the project
- **`name`**, **`tynnToken`**, **`category`** — Optional fields to update. Set `tynnToken` to `null` to unlink.

Response: `{ "ok": true }`

#### DELETE /api/projects

Delete a project directory. Supports a two-phase flow: call without `confirm` to preview what will be deleted, then call with `confirm: true` to execute.

Request body:

```json
{ "path": "/home/user/projects/old-app", "confirm": true }
```

Preview response (without `confirm`):

```json
{
  "preview": true,
  "path": "/home/user/projects/old-app",
  "name": "old-app",
  "hasGit": true,
  "hosting": null
}
```

Confirmed response:

```json
{ "ok": true, "path": "/home/user/projects/old-app", "name": "old-app" }
```

#### GET /api/projects/info

Get git details for a specific project.

Query parameters:
- **`path`** (required) — Absolute path to the project

Response:

```json
{
  "path": "/home/user/projects/my-app",
  "branch": "main",
  "remote": "origin",
  "status": { "staged": 0, "modified": 2, "untracked": 1 },
  "commits": []
}
```

#### POST /api/projects/git

Execute git operations on workspace projects. This is a single endpoint with an action discriminator.

Request body:

```json
{ "path": "/home/user/projects/my-app", "action": "status" }
```

- **`path`** (required) — Absolute path to the project
- **`action`** (required) — One of the supported git actions

**Supported actions:**

| Action | Extra params | Description |
|--------|-------------|-------------|
| `init` | — | Initialize a new git repository |
| `clone` | `remote` | Clone from a remote URL |
| `status` | — | Get working tree status |
| `fetch` | — | Fetch from origin |
| `pull` | `rebase?` | Pull changes (optionally rebase) |
| `push` | `setUpstream?`, `remote?`, `branch?` | Push changes |
| `stage` | `files` | Stage files for commit |
| `unstage` | `files` | Unstage files |
| `commit` | `message` | Commit staged changes |
| `log` | — | Get commit history |
| `diff` | `staged?`, `path?` | Get diff output |
| `stash_list` | — | List stashes |
| `stash_save` | `message?` | Save current changes to stash |
| `stash_pop` | — | Pop the latest stash |
| `stash_drop` | `index?` | Drop a stash entry |
| `branch_list` | — | List branches |
| `branch_create` | `name` | Create a new branch |
| `branch_checkout` | `name` | Check out a branch |
| `branch_delete` | `name` | Delete a branch |
| `remote_list` | — | List remotes |
| `remote_add` | `name`, `url` | Add a remote |
| `remote_remove` | `name` | Remove a remote |

Branch names and file paths are validated for safety (no shell injection).

---

### Hosting

Hosting endpoints manage local project serving via Caddy reverse proxy and Podman containers. All require private network access. These routes are only registered when a hosting manager is configured.

#### GET /api/hosting/status

Get overall hosting infrastructure status and all hosted projects.

Response:

```json
{
  "infrastructure": {
    "caddy": "running",
    "podman": "running",
    "dnsmasq": "running"
  },
  "projects": [
    {
      "path": "/home/user/projects/my-app",
      "hostname": "my-app.ai.on",
      "type": "nodejs",
      "status": "running"
    }
  ]
}
```

#### GET /api/hosting/setup

Run the hosting infrastructure setup script (`scripts/hosting-setup.sh`). Returns a **Server-Sent Events (SSE)** stream with real-time output.

SSE event format:

```json
{ "type": "stdout", "text": "Installing Caddy..." }
{ "type": "stderr", "text": "Warning: ..." }
{ "type": "exit", "text": "0" }
{ "type": "error", "text": "Setup failed" }
```

#### POST /api/hosting/enable

Enable hosting for a project.

Request body:

```json
{
  "path": "/home/user/projects/my-app",
  "type": "nodejs",
  "hostname": "my-app.ai.on",
  "docRoot": "public",
  "startCommand": "npm start",
  "mode": "container",
  "internalPort": 3000,
  "runtimeId": "node-22"
}
```

- **`path`** (required) — Project directory
- All other fields are optional and depend on the project type

Response:

```json
{ "ok": true, "hosting": { "enabled": true, "hostname": "my-app.ai.on", "status": "running" } }
```

#### POST /api/hosting/disable

Disable hosting for a project. Stops the container/process and removes the Caddy route.

Request body:

```json
{ "path": "/home/user/projects/my-app" }
```

Response: `{ "ok": true }`

#### PUT /api/hosting/configure

Update hosting configuration for an already-hosted project without restarting.

Request body: Same shape as `POST /api/hosting/enable`.

Response:

```json
{ "ok": true, "hosting": { "enabled": true, "hostname": "my-app.ai.on", "status": "running" } }
```

#### POST /api/hosting/restart

Restart a hosted project's container or process.

Request body:

```json
{ "path": "/home/user/projects/my-app" }
```

Response:

```json
{ "ok": true, "hosting": { "enabled": true, "hostname": "my-app.ai.on", "status": "running" } }
```

#### POST /api/hosting/tunnel/enable

Enable a Cloudflare tunnel for a hosted project, making it accessible from the public internet.

Request body:

```json
{ "path": "/home/user/projects/my-app" }
```

Response:

```json
{ "ok": true, "tunnelUrl": "https://abc123.trycloudflare.com" }
```

#### POST /api/hosting/tunnel/disable

Disable the tunnel for a hosted project.

Request body:

```json
{ "path": "/home/user/projects/my-app" }
```

Response: `{ "ok": true }`

#### GET /api/hosting/logs

Retrieve logs for a hosted project.

Query parameters:
- **`path`** (required) — Project directory
- **`tail`** — Number of lines (1–10000, default `100`)
- **`source`** — Log source filter (see `/api/hosting/log-sources`)

Response:

```json
{ "logs": ["2026-03-08 12:00:00 Server started on port 3000", "..."] }
```

#### GET /api/hosting/log-sources

List available log sources for a hosted project.

Query parameters:
- **`path`** (required) — Project directory

Response:

```json
{ "sources": [{ "id": "container", "name": "Container" }, { "id": "caddy", "name": "Caddy" }] }
```

#### GET /api/hosting/project-types

List all supported project types and their hosting configurations.

Response:

```json
{ "types": [{ "id": "nodejs", "name": "Node.js", "modes": ["container", "process"] }] }
```

#### POST /api/hosting/tools/:toolId

Execute a hosting tool on a project (e.g., dependency install, build).

- **`:toolId`** — Tool identifier

Request body:

```json
{ "path": "/home/user/projects/my-app" }
```

Response:

```json
{ "ok": true, "output": "Dependencies installed successfully" }
```

#### GET /api/hosting/client-setup/:os

Download a setup script for configuring a client machine to use the Aionima hosting DNS and CA certificate.

- **`:os`** — Operating system: `linux`, `macos`, or `windows`

Response: Shell script (Linux/macOS) or PowerShell script (Windows) as a file attachment with the server's hostname, IP, and CA certificate baked in.

#### GET /api/hosting/ca-cert

Download the Caddy CA certificate (PEM format) for trusting locally-hosted HTTPS sites.

Response: PEM certificate file as attachment.

#### GET /db-portal

Serve the database portal HTML page — a landing page for accessing hosted database tools.

Response: HTML page.

#### GET /api/db-portal/tools

List registered database portal tools.

Response:

```json
{ "tools": [{ "id": "adminer", "name": "Adminer", "url": "https://adminer.ai.on", "description": "Database management", "icon": "database" }] }
```

#### POST /api/db-portal/register

Register a new tool in the database portal.

Request body:

```json
{
  "id": "adminer",
  "name": "Adminer",
  "url": "https://adminer.ai.on",
  "description": "Database management",
  "icon": "database"
}
```

- **`id`**, **`name`**, **`url`** (required)
- **`description`**, **`icon`** (optional)

Response: `{ "ok": true }`

#### GET /api/hosting-extensions

List all hosting extension fields contributed by plugins.

Response:

```json
{ "fields": [] }
```

#### GET /api/hosting-extensions/:projectType

List hosting extension fields for a specific project type. Filters dropdown options by available container images.

- **`:projectType`** — Project type identifier (e.g., `nodejs`, `php`)

Response:

```json
{ "fields": [] }
```

---

### Stacks

Stack endpoints manage service stacks (databases, caches, etc.) that can be attached to hosted projects. Routes are only registered when a stack registry and shared container manager are configured.

#### GET /api/stacks

List all available stacks.

Query parameters:
- **`category`** — Filter by project category
- **`stackCategory`** — Filter by stack category (e.g., `database`, `cache`)

Response:

```json
{ "stacks": [{ "id": "postgres-16", "name": "PostgreSQL 16", "category": "database" }] }
```

#### GET /api/stacks/:id

Get details for a specific stack definition.

- **`:id`** — Stack identifier

Response:

```json
{ "stack": { "id": "postgres-16", "name": "PostgreSQL 16", "category": "database", "image": "postgres:16" } }
```

Returns `404` if the stack is not found.

#### POST /api/hosting/stacks/add

Add a stack to a hosted project. Starts the container and configures networking.

Request body:

```json
{ "path": "/home/user/projects/my-app", "stackId": "postgres-16" }
```

Response:

```json
{ "ok": true, "stack": { "id": "postgres-16", "status": "running" } }
```

#### POST /api/hosting/stacks/remove

Remove a stack from a project. Stops and removes the container.

Request body:

```json
{ "path": "/home/user/projects/my-app", "stackId": "postgres-16" }
```

Response: `{ "ok": true }`

#### GET /api/hosting/stacks

List stacks attached to a specific project.

Query parameters:
- **`path`** (required) — Project directory

Response:

```json
{ "stacks": [{ "id": "postgres-16", "status": "running" }] }
```

#### GET /api/shared-containers

List all running shared containers (stacks used across multiple projects).

Response:

```json
{ "containers": [{ "key": "postgres-16", "image": "postgres:16", "status": "running", "projects": 3 }] }
```

#### GET /api/shared-containers/:key/connection

Get connection credentials for a shared container.

- **`:key`** — Container key
- **`project`** (required query) — Project path for scoped credentials

Response:

```json
{
  "host": "localhost",
  "port": 5432,
  "database": "my_app",
  "username": "my_app",
  "password": "generated_password",
  "connectionString": "postgresql://my_app:generated_password@localhost:5432/my_app"
}
```

---

### Marketplace

Plugin marketplace for discovering, installing, and managing plugins from external sources. All require private network access.

#### GET /api/marketplace/sources

List configured marketplace sources.

Response:

```json
[
  {
    "id": 1,
    "ref": "Civicognita/aionima-marketplace",
    "sourceType": "github",
    "name": "Official Marketplace",
    "description": "Aionima official plugins",
    "lastSyncedAt": "2026-03-08T12:00:00.000Z",
    "pluginCount": 21
  }
]
```

#### POST /api/marketplace/sources

Add a new marketplace source.

Request body:

```json
{ "ref": "user/plugin-repo", "name": "My Plugins" }
```

- **`ref`** (required) — GitHub `owner/repo` reference or local path
- **`name`** (optional) — Display name

Response:

```json
{ "id": 2, "ref": "user/plugin-repo", "sourceType": "github", "name": "My Plugins" }
```

#### DELETE /api/marketplace/sources/:id

Remove a marketplace source.

- **`:id`** — Source ID (numeric)

Response: `{ "ok": true }`

#### POST /api/marketplace/sources/:id/sync

Synchronize a source — re-scan the repository for plugin changes.

- **`:id`** — Source ID

Response:

```json
{ "ok": true, "pluginCount": 21 }
```

Returns `{ "ok": false, "error": "..." }` on failure.

#### GET /api/marketplace/catalog

Search the marketplace catalog.

Query parameters:
- **`q`** — Search query (matches name, description)
- **`type`** — Filter by plugin type
- **`category`** — Filter by category (e.g., `integration`, `tool`)

Response: Array of catalog items enriched with `installed` and `enabled` status.

#### POST /api/marketplace/install

Install a plugin from a marketplace source.

Request body:

```json
{ "pluginName": "plugin-hosting", "sourceId": 1 }
```

Response:

```json
{ "ok": true, "installPath": "/opt/aionima-marketplace/plugins/plugin-hosting" }
```

#### DELETE /api/marketplace/installed/:pluginName

Uninstall a marketplace plugin.

- **`:pluginName`** — Plugin package name

Response: `{ "ok": true }`

#### GET /api/marketplace/installed

List all installed marketplace plugins.

Response:

```json
[
  {
    "name": "plugin-hosting",
    "sourceId": 1,
    "type": "tool",
    "version": "1.0.0",
    "installedAt": "2026-03-01T10:00:00.000Z",
    "installPath": "/opt/aionima-marketplace/plugins/plugin-hosting",
    "sourceJson": {}
  }
]
```

#### GET /api/marketplace/updates

Check for available plugin updates.

Response:

```json
[
  {
    "pluginName": "plugin-hosting",
    "currentVersion": "1.0.0",
    "availableVersion": "1.1.0",
    "sourceId": 1
  }
]
```

---

### Plugins

Manage the lifecycle of installed plugins (enable/disable). These operate on the plugin registry, not the marketplace.

#### GET /api/plugins

List all installed plugins with their status.

Response:

```json
{
  "plugins": [
    {
      "id": "plugin-hosting",
      "name": "Hosting",
      "version": "1.0.0",
      "description": "Local project hosting",
      "author": "Aionima",
      "permissions": ["hosting"],
      "category": "tool",
      "active": true,
      "enabled": true,
      "bakedIn": false,
      "disableable": true
    }
  ]
}
```

#### PUT /api/plugins/:id

Enable or disable a plugin.

- **`:id`** — Plugin identifier

Request body:

```json
{ "enabled": false }
```

Returns `400` if the plugin is baked-in and non-disableable. Returns `{ "requiresRestart": true }` if the change needs a gateway restart.

Response:

```json
{ "ok": true, "requiresRestart": false }
```

---

### Plugin Dashboard Extensions

Plugins can contribute actions, panels, settings, sidebar sections, themes, system services, scheduled tasks, workflows, and full pages to the dashboard. These endpoints enumerate and execute those contributions.

#### GET /api/dashboard/plugin-actions

List plugin-contributed actions.

Query parameters:
- **`scope`** — Filter by action scope
- **`projectType`** — Filter by project type

Response: Array of action definitions with `pluginId`.

#### GET /api/dashboard/plugin-panels

List plugin-contributed dashboard panels.

Query parameters:
- **`projectType`** — Filter by project type

Response: Array of panel definitions with `pluginId`.

#### POST /api/dashboard/action/:id/execute

Execute a plugin action (either shell command or API handler).

- **`:id`** — Action identifier

Request body: Context object (varies by action, e.g., `{ "projectPath": "/path/to/project" }`).

Response:

```json
{ "ok": true, "output": "Action completed" }
```

Or on failure:

```json
{ "ok": false, "error": "Command failed" }
```

#### GET /api/dashboard/plugin-settings

List plugin settings sections for the settings page.

Response: Array of settings sections with `pluginId`.

#### GET /api/dashboard/plugin-sidebar

List plugin sidebar menu sections.

Response: Array of sidebar section definitions with `pluginId`.

#### GET /api/dashboard/plugin-themes

List plugin-contributed themes.

Response: Array of theme definitions with `pluginId`.

#### GET /api/dashboard/plugin-system-services

List system services contributed by plugins (e.g., Caddy, Podman). Checks installation and running status.

Response:

```json
{
  "services": [
    {
      "id": "caddy",
      "pluginId": "plugin-hosting",
      "name": "Caddy",
      "description": "Web server",
      "unitName": "caddy.service",
      "agentAware": true,
      "installed": true,
      "installable": true,
      "status": "running"
    }
  ]
}
```

#### POST /api/dashboard/system-services/:id/:action

Control a system service.

- **`:id`** — Service identifier
- **`:action`** — One of: `start`, `stop`, `restart`, `install`

Response:

```json
{ "ok": true, "output": "Service started" }
```

#### GET /api/dashboard/plugin-scheduled-tasks

List scheduled tasks from plugins.

Response: Array of task definitions with `pluginId`.

#### POST /api/dashboard/scheduled-tasks/:id/:action

Control a scheduled task.

- **`:id`** — Task identifier
- **`:action`** — One of: `enable`, `disable`, `run-now`

Response: `{ "ok": true }`

#### GET /api/dashboard/plugin-workflows

List plugin-contributed workflows.

Response: Array of workflow definitions with `pluginId`.

#### GET /api/dashboard/plugin-settings-pages

List plugin settings pages (full-page settings views).

Response: Array of page definitions with `pluginId`.

#### GET /api/dashboard/plugin-pages

List full dashboard pages contributed by plugins.

Query parameters:
- **`domain`** — Filter by page domain

Response: Array of page definitions with `pluginId`.

#### GET /api/dashboard/plugin-domains

List dashboard domains contributed by plugins.

Response: Array of domain definitions with `pluginId`.

---

### Runtimes

Manage language runtimes available for hosted projects (e.g., Node.js 22, Python 3.12). All require private network access.

#### GET /api/runtimes

List all registered runtime definitions.

Response:

```json
{ "runtimes": [{ "id": "node-22", "language": "nodejs", "version": "22", "image": "node:22" }] }
```

#### GET /api/runtimes/:projectType

Get runtimes available for a specific project type.

- **`:projectType`** — Project type (e.g., `nodejs`, `python`)

Response:

```json
{ "runtimes": [{ "id": "node-22", "language": "nodejs", "version": "22" }] }
```

#### GET /api/runtimes/installed

List installed runtime versions grouped by language.

Response:

```json
{ "installed": { "nodejs": ["22", "20"], "python": ["3.12"] } }
```

#### POST /api/runtimes/:id/install

Install a runtime version (pulls the container image).

- **`:id`** — Runtime identifier

Response:

```json
{ "ok": true, "runtimeId": "node-22", "version": "22" }
```

#### POST /api/runtimes/:id/uninstall

Uninstall a runtime version.

- **`:id`** — Runtime identifier

Response:

```json
{ "ok": true, "runtimeId": "node-22", "version": "22" }
```

---

### Services

Manage gateway-level services (not to be confused with plugin system services). All require private network access.

#### GET /api/services

List registered services and their status.

Response:

```json
{ "services": [{ "id": "hosting-manager", "status": "running" }] }
```

#### POST /api/services/:id/start

Start a service.

Response: `{ "ok": true }`

#### POST /api/services/:id/stop

Stop a service.

Response: `{ "ok": true }`

#### POST /api/services/:id/restart

Restart a service.

Response: `{ "ok": true }`

---

### Models

#### GET /api/models

List available AI models from a specific provider. Fetches live from the provider API.

Query parameters:
- **`provider`** (required) — One of: `anthropic`, `openai`, `ollama`

Provider-specific behavior:
- **Anthropic** — Fetches from `https://api.anthropic.com/v1/models` (or configured `baseUrl`), authenticated with `x-api-key`
- **OpenAI** — Fetches from `https://api.openai.com/v1/models` (or configured `baseUrl`), authenticated with `Authorization: Bearer`
- **Ollama** — Fetches from `http://127.0.0.1:11434/api/tags` (or configured `baseUrl`), no auth

Credentials are resolved from `bots.providers[provider]` in config, or fallback env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

Response:

```json
{
  "provider": "anthropic",
  "models": [
    { "id": "claude-sonnet-4-6-20250514", "name": "Claude Sonnet 4.6" }
  ]
}
```

---

### PRIME

Manage the PRIME knowledge corpus connection. Only registered when a PRIME loader is configured.

#### GET /api/prime/status

Get the current PRIME corpus source information.

Response:

```json
{
  "source": "Civicognita/aionima",
  "branch": "main",
  "entries": 142,
  "dir": "/opt/aionima-prime"
}
```

#### POST /api/prime/switch

Switch to a different PRIME source repository or branch.

Request body:

```json
{ "source": "Civicognita/aionima", "branch": "dev" }
```

- **`source`** (required) — Repository reference
- **`branch`** (optional) — Branch name

Response:

```json
{ "ok": true, "entries": 138 }
```

---

### Contributing Mode

Toggle development mode, which switches PRIME and MARKETPLACE to their dev directories.

#### GET /api/dev/status

Get contributing mode status and repo information. Requires admin role when dashboard auth is enabled.

Response:

```json
{
  "enabled": false,
  "githubAuthenticated": true,
  "agi": { "branch": "main", "commit": "abc1234" },
  "prime": { "branch": "main", "commit": "def5678" },
  "id": { "branch": "main", "commit": "ghi9012" }
}
```

#### POST /api/dev/switch

Enable or disable contributing mode. Requires GitHub authentication to enable. Requires admin role when dashboard auth is enabled. The change is logged to the Chain of Accountability.

Request body:

```json
{ "enabled": true }
```

Response:

```json
{
  "ok": true,
  "enabled": true,
  "primeDir": "/opt/aionima-prime_dev",
  "note": "Restart required for changes to take effect"
}
```

---

### Workers

Manage the Taskmaster job queue. All require private network access.

#### GET /api/workers/jobs

List all Taskmaster jobs.

Response:

```json
[
  {
    "id": "JOB-001",
    "description": "Refactor auth module",
    "status": "in_progress",
    "currentPhase": 2,
    "workers": ["engineer", "hacker"],
    "gate": "checkpoint",
    "createdAt": "2026-03-08T10:00:00.000Z"
  }
]
```

#### POST /api/workers/approve/:jobId

Approve a Taskmaster checkpoint, allowing the job to proceed to the next phase.

- **`:jobId`** — Job identifier

Response: `{ "ok": true }`

#### POST /api/workers/reject/:jobId

Reject a Taskmaster checkpoint, stopping the job.

- **`:jobId`** — Job identifier

Response: `{ "ok": true }`

---

### Plans

CRUD for agent work plans. Plan IDs follow the format `plan_[A-Z0-9]+`.

#### GET /api/plans

List plans for a project.

Query parameters:
- **`projectPath`** (required) — Absolute project path

Response:

```json
{ "plans": [{ "id": "plan_ABC123", "title": "Auth refactor", "projectPath": "/path", "steps": [], "body": "" }] }
```

Returns `400` if `projectPath` is missing.

#### GET /api/plans/:planId

Get a specific plan.

- **`:planId`** — Plan ID (format: `plan_[A-Z0-9]+`)

Query parameters:
- **`projectPath`** (required) — Absolute project path

Response: Full plan object. Returns `404` if not found.

#### POST /api/plans

Create a new plan.

Request body:

```json
{
  "title": "Auth refactor",
  "projectPath": "/home/user/projects/my-app",
  "steps": [{ "description": "Extract auth middleware", "done": false }],
  "body": "Detailed plan description"
}
```

Response (`201`): Created plan object with generated `id`.

#### PUT /api/plans/:planId

Update an existing plan.

- **`:planId`** — Plan ID

Request body:

```json
{
  "projectPath": "/home/user/projects/my-app",
  "title": "Updated title",
  "steps": [{ "description": "Extract auth middleware", "done": true }]
}
```

- **`projectPath`** (required)
- All other fields are optional — only provided fields are updated

Response: Updated plan object. Returns `404` if not found.

#### DELETE /api/plans/:planId

Delete a plan.

- **`:planId`** — Plan ID

Query parameters:
- **`projectPath`** (required) — Absolute project path

Response: `{ "ok": true }`. Returns `404` if not found.

---

### Comms and Notifications

#### GET /api/comms

Query the communications log (messages across all channels).

Query parameters:
- **`channel`** — Filter by channel ID
- **`direction`** — Filter by direction (`inbound` or `outbound`)
- **`limit`** — Max entries (default `50`, max `200`)
- **`offset`** — Pagination offset (default `0`)

Response:

```json
{
  "entries": [
    {
      "channel": "telegram",
      "direction": "inbound",
      "content": "Hello",
      "entityAlias": "user123",
      "timestamp": "2026-03-08T12:00:00.000Z"
    }
  ],
  "total": 150
}
```

#### GET /api/notifications

Get notifications.

Query parameters:
- **`limit`** — Max notifications (default `50`, max `200`)
- **`unreadOnly`** — Set to `"true"` to filter to unread only

Response:

```json
{
  "notifications": [
    { "id": "n1", "type": "system", "message": "Upgrade available", "read": false, "timestamp": "2026-03-08T12:00:00.000Z" }
  ],
  "unreadCount": 3
}
```

#### POST /api/notifications/read

Mark specific notifications as read.

Request body:

```json
{ "ids": ["n1", "n2"] }
```

Returns `400` if `ids` is not an array.

Response: `{ "ok": true }`

#### POST /api/notifications/read-all

Mark all notifications as read.

Response: `{ "ok": true }`

---

### Chat History

Persist and retrieve agent chat sessions. All require private network access. Only registered when chat persistence is configured.

#### GET /api/chat/sessions

List all saved chat sessions.

Response:

```json
{ "sessions": [{ "id": "session-abc", "title": "Auth refactor discussion", "createdAt": "2026-03-08T10:00:00.000Z" }] }
```

#### GET /api/chat/sessions/:id

Load a specific chat session.

- **`:id`** — Session identifier

Response: Full session object with messages. Returns `404` if not found.

#### DELETE /api/chat/sessions/:id

Delete a saved session.

- **`:id`** — Session identifier

Response: `{ "ok": true }`

---

### Machine Admin

Server administration endpoints for managing the host machine, Linux users, SSH keys, agents, dashboard authentication, and Samba shares. All require private network access. Dashboard auth endpoints use JWT tokens with role-based access.

#### GET /api/machine/info

Get machine hardware and OS information.

Response:

```json
{
  "hostname": "Nexus",
  "os": "Ubuntu 24.04",
  "kernel": "6.17.0-14-generic",
  "arch": "x86_64",
  "distro": "Ubuntu",
  "ip": "192.168.0.144",
  "cpuModel": "AMD Ryzen 7 5800X",
  "totalMemoryGB": 32
}
```

#### POST /api/machine/hostname

Change the machine hostname.

Request body:

```json
{ "hostname": "NewHostname" }
```

Response:

```json
{ "ok": true, "hostname": "NewHostname" }
```

#### GET /api/machine/users

List Linux user accounts.

Response:

```json
{
  "users": [
    {
      "username": "wishborn",
      "uid": 1000,
      "gid": 1000,
      "gecos": "Wishborn",
      "home": "/home/wishborn",
      "shell": "/bin/bash",
      "groups": ["sudo", "docker"],
      "sudo": true,
      "hasSSHKeys": true,
      "locked": false
    }
  ]
}
```

#### POST /api/machine/users

Create a new Linux user.

Request body:

```json
{
  "username": "newuser",
  "password": "secure-password",
  "shell": "/bin/bash",
  "addToSudo": false,
  "sshPublicKey": "ssh-ed25519 AAAA..."
}
```

- **`username`** (required)
- All other fields are optional

Response:

```json
{ "ok": true, "username": "newuser" }
```

#### PUT /api/machine/users/:username

Update a Linux user account.

- **`:username`** — Username to modify

Request body:

```json
{
  "shell": "/bin/zsh",
  "addToSudo": true,
  "removeFromSudo": false,
  "locked": false,
  "sshPublicKey": "ssh-ed25519 AAAA..."
}
```

All fields are optional.

Response:

```json
{ "ok": true, "username": "newuser" }
```

#### DELETE /api/machine/users/:username

Delete a Linux user account.

- **`:username`** — Username to delete

Query parameters:
- **`removeHome`** — Set to `"true"` to also remove the home directory

Response: `{ "ok": true }`

#### GET /api/machine/users/:username/ssh-keys

List SSH authorized keys for a user.

- **`:username`** — Username

Response:

```json
{
  "keys": [
    { "index": 0, "type": "ssh-ed25519", "key": "AAAA...", "comment": "user@host" }
  ]
}
```

#### POST /api/machine/users/:username/ssh-keys

Add an SSH public key to a user's authorized_keys.

- **`:username`** — Username

Request body:

```json
{ "key": "ssh-ed25519 AAAA... user@host" }
```

Response: `{ "ok": true }`

#### DELETE /api/machine/users/:username/ssh-keys/:index

Remove an SSH key by index.

- **`:username`** — Username
- **`:index`** — Key index (from the list endpoint)

Response: `{ "ok": true }`

#### GET /api/agents

List running agent instances.

Response:

```json
{
  "agents": [
    {
      "id": "aionima-main",
      "name": "Aionima",
      "type": "gateway",
      "status": "running",
      "uptime": 86400,
      "pid": 12345,
      "memoryMB": 256,
      "channels": 3,
      "lastActivity": "2026-03-08T12:00:00.000Z"
    }
  ]
}
```

#### GET /api/agents/:id

Get detailed info for a specific agent.

- **`:id`** — Agent identifier

Response:

```json
{
  "id": "aionima-main",
  "name": "Aionima",
  "type": "gateway",
  "status": "running",
  "uptime": 86400,
  "pid": 12345,
  "memoryMB": 256,
  "heapUsedMB": 128,
  "heapTotalMB": 512,
  "channels": 3,
  "lastActivity": "2026-03-08T12:00:00.000Z",
  "nodeVersion": "v22.0.0"
}
```

#### POST /api/agents/:id/restart

Restart an agent instance.

- **`:id`** — Agent identifier

Response: `{ "ok": true }`

#### POST /api/auth/login

Authenticate and obtain a JWT token. Only available when dashboard user store is enabled.

Request body:

```json
{ "username": "admin", "password": "secure-password" }
```

Response:

```json
{
  "ok": true,
  "token": "eyJhbG...",
  "user": { "id": "u1", "username": "admin", "role": "admin" }
}
```

Returns `401` for invalid credentials.

#### GET /api/auth/me

Get the currently authenticated user from a bearer token.

Headers: `Authorization: Bearer <token>`

Response:

```json
{
  "user": { "id": "u1", "username": "admin", "displayName": "Admin" },
  "session": { "role": "admin", "expiresAt": "2026-03-09T12:00:00.000Z" }
}
```

Returns `401` if the token is missing or invalid.

#### GET /api/auth/status

Check whether dashboard authentication is enabled.

Response:

```json
{ "enabled": true, "hasUsers": true, "userCount": 2 }
```

#### GET /api/admin/users

List dashboard users. Requires admin role.

Headers: `Authorization: Bearer <token>`

Response:

```json
{ "users": [{ "id": "u1", "username": "admin", "displayName": "Admin", "role": "admin" }] }
```

#### POST /api/admin/users

Create a dashboard user. Requires admin role.

Headers: `Authorization: Bearer <token>`

Request body:

```json
{ "username": "viewer", "displayName": "Viewer User", "password": "secure", "role": "viewer" }
```

Response:

```json
{ "ok": true, "user": { "id": "u2", "username": "viewer", "role": "viewer" } }
```

#### PUT /api/admin/users/:id

Update a dashboard user. Requires admin role.

- **`:id`** — User ID

Request body:

```json
{ "displayName": "New Name", "role": "admin", "disabled": false }
```

All fields are optional.

Response:

```json
{ "ok": true, "user": { "id": "u2", "username": "viewer", "role": "admin" } }
```

#### DELETE /api/admin/users/:id

Delete a dashboard user. Requires admin role. Cannot delete yourself.

- **`:id`** — User ID

Response: `{ "ok": true }`

#### POST /api/admin/users/:id/reset-password

Reset a dashboard user's password. Requires admin role.

- **`:id`** — User ID

Request body:

```json
{ "password": "new-secure-password" }
```

Response: `{ "ok": true }`

#### GET /api/samba/shares

List Samba network shares.

Response:

```json
{ "shares": [{ "name": "Projects", "path": "/home/wishborn/_projects", "enabled": true }] }
```

#### POST /api/samba/shares/:name/enable

Enable a Samba share.

- **`:name`** — Share name

Response: `{ "ok": true }`

#### POST /api/samba/shares/:name/disable

Disable a Samba share.

- **`:name`** — Share name

Response: `{ "ok": true }`

---

### Onboarding

First-run setup wizard endpoints. All require private network access.

#### GET /api/onboarding/state

Get the current onboarding state. Auto-detects step completion from config and secrets.

Response:

```json
{
  "aiKeys": "completed",
  "aionimaId": "pending",
  "ownerProfile": "completed",
  "channels": "pending",
  "zeroMeMind": "pending",
  "zeroMeSoul": "pending",
  "zeroMeSkill": "pending"
}
```

#### PATCH /api/onboarding/state

Manually update onboarding step states.

Request body: Partial state object with step overrides.

```json
{ "channels": "completed" }
```

Response: Updated full state object.

#### POST /api/onboarding/reset

Reset all onboarding steps to `"pending"`.

Response: Reset state object (all steps `"pending"`).

#### GET /api/onboarding/owner-profile

Get the owner's profile settings.

Response:

```json
{ "displayName": "Wishborn", "dmPolicy": "pairing" }
```

#### POST /api/onboarding/owner-profile

Set the owner's display name and DM policy.

Request body:

```json
{ "displayName": "Wishborn", "dmPolicy": "pairing" }
```

- **`displayName`** (required) — Must be non-empty
- **`dmPolicy`** (optional) — `"pairing"` or `"open"` (default: `"pairing"`)

Marks the `ownerProfile` step as completed.

Response: `{ "ok": true }`

#### GET /api/onboarding/channels

Get channel configuration for onboarding.

Response:

```json
{
  "channels": [
    { "id": "telegram", "enabled": true, "config": { "botToken": "***" } }
  ],
  "ownerChannels": { "telegram": "@username" }
}
```

#### POST /api/onboarding/channels

Configure a channel during onboarding.

Request body:

```json
{
  "channelId": "telegram",
  "enabled": true,
  "config": { "botToken": "123:ABC" },
  "ownerId": "@username"
}
```

- **`channelId`** (required)

Response: `{ "ok": true }`

#### POST /api/onboarding/ai-keys

Save and optionally validate AI provider API keys.

Request body:

```json
{ "anthropic": "sk-ant-...", "openai": "sk-...", "saveOnly": false }
```

- **`saveOnly`** — If `true`, persists without validation. If `false` (default), validates keys by making test API calls.

Keys are stored via the SecretsManager (TPM2-sealed when available, env fallback).

Response:

```json
{ "ok": true, "validated": { "anthropic": true, "openai": true } }
```

#### POST /api/onboarding/aionima-id/start

Initiate the Aionima ID linking flow. Calls the Aionima ID service to create a handoff.

Response:

```json
{ "url": "https://id.aionima.ai/link?handoff=abc123" }
```

Returns `502` if the ID service is unreachable.

#### GET /api/onboarding/aionima-id/poll

Poll the Aionima ID handoff status. The handoff expires after 15 minutes.

Response (pending):

```json
{ "status": "pending" }
```

Response (completed):

```json
{
  "status": "completed",
  "services": [
    { "provider": "google", "role": "owner", "accountLabel": "user@gmail.com" }
  ]
}
```

Other statuses: `"no_handoff"`, `"expired"`.

#### GET /api/onboarding/aionima-id/status

Get the current Aionima ID step status.

Response:

```json
{
  "step": "pending",
  "hasActiveHandoff": false,
  "services": []
}
```

#### POST /api/onboarding/zero-me/chat

Send a message in the Zero-Me personality interview. Uses Claude Haiku for conversational profiling.

Request body:

```json
{
  "domain": "MIND",
  "messages": [
    { "role": "user", "content": "I value clear thinking and logical analysis." }
  ]
}
```

- **`domain`** (required) — `"MIND"`, `"SOUL"`, or `"SKILL"`
- **`messages`** (required) — Conversation history in OpenAI message format

Returns `400` if `ANTHROPIC_API_KEY` is not set. Returns `502` on API error.

Response:

```json
{ "response": "That's a great foundation. Let me ask you about..." }
```

#### POST /api/onboarding/zero-me/save

Save a Zero-Me profile domain. Writes to `~/.agi/0ME/{domain}.md` and marks the corresponding onboarding step as completed.

Request body:

```json
{ "domain": "MIND", "content": "# Mind Profile\n\nValues: clarity, logic..." }
```

Response: `{ "ok": true }`

---

### Identity and Federation

#### GET /api/identity/:entityId

Look up an entity by internal ID.

- **`:entityId`** — Entity identifier

Response: Entity identity object. Returns `404` if not found.

#### GET /api/identity/resolve/:geid

Resolve an entity by Global Entity ID (GEID).

- **`:geid`** — URL-encoded GEID string

Response: Entity identity object. Returns `404` if GEID not found.

#### GET /api/auth/providers

List available OAuth providers.

Response:

```json
{ "providers": ["google", "github"] }
```

Returns an empty array if OAuth is not configured.

#### POST /api/auth/start/:provider

Start an OAuth authentication flow.

- **`:provider`** — Provider name (e.g., `google`, `github`)

Response:

```json
{ "authUrl": "https://accounts.google.com/o/oauth2/auth?..." }
```

Returns `501` if OAuth is not configured. Returns `400` if the provider is unsupported.

#### GET /api/auth/callback/:provider

OAuth callback handler. Creates or links an entity with the OAuth identity.

- **`:provider`** — Provider name

Query parameters:
- **`code`** (required) — Authorization code
- **`state`** (required) — CSRF state token

Response:

```json
{
  "entityId": "e123",
  "geid": "geid:abc",
  "address": "0x...",
  "provider": "google",
  "displayName": "User Name",
  "email": "user@example.com"
}
```

Returns `401` if authentication fails.

#### POST /api/sub-users

Create a sub-user entity with optional dashboard access.

Request body:

```json
{ "displayName": "Team Member", "username": "member1", "password": "secure", "role": "viewer" }
```

- **`displayName`**, **`username`**, **`password`** (required, non-empty)
- **`role`** (optional) — Dashboard role

Response (`201`):

```json
{
  "entityId": "e456",
  "geid": "geid:xyz",
  "address": "0x...",
  "dashboardUser": { "id": "u3", "username": "member1", "role": "viewer" }
}
```

Returns `409` if the username already exists.

#### GET /api/sub-users

List all sub-users (dashboard users).

Response:

```json
{ "users": [{ "id": "u3", "username": "member1", "displayName": "Team Member", "role": "viewer" }] }
```

#### POST /api/visitor/challenge

Request a cryptographic challenge for visitor authentication (cross-node federation).

Request body:

```json
{ "geid": "geid:abc", "homeNodeId": "node-xyz" }
```

Returns `501` if visitor auth is disabled. Returns `400` for invalid GEID format.

Response:

```json
{ "challenge": "random-challenge-string", "expiresAt": "2026-03-08T12:15:00.000Z" }
```

#### POST /api/visitor/verify

Verify a signed challenge for visitor authentication.

Request body:

```json
{ "challenge": "random-challenge-string", "signature": "base64-signature" }
```

Returns `401` if the signature is invalid.

Response:

```json
{
  "authenticated": true,
  "token": "visitor-jwt-token",
  "geid": "geid:abc",
  "homeNodeId": "node-xyz",
  "expiresAt": "2026-03-08T13:00:00.000Z"
}
```

#### GET /api/visitor/session

Verify a visitor session from a bearer token.

Headers: `Authorization: Bearer <visitor-token>`

Returns `401` if the token is missing, invalid, or expired.

Response:

```json
{ "geid": "geid:abc", "homeNodeId": "node-xyz", "role": "visitor", "expiresAt": "2026-03-08T13:00:00.000Z" }
```

#### GET /.well-known/mycelium-node.json

Public node manifest for federation discovery. Only served when a federation node is configured.

Response: Node manifest object containing node identity, capabilities, and endpoints.

#### Federation Router (/mycelium/*)

When a federation router is configured, all requests to `/mycelium/*` are proxied to it. The federation router handles cross-node governance, voting, and emergency sessions.

**Governance endpoints** (handled by the federation router):

| Method | Path | Description |
|--------|------|-------------|
| POST | `/fed/v1/governance/vote` | Submit a cross-node vote |
| GET | `/fed/v1/governance/active` | List active governance proposals |
| POST | `/fed/v1/governance/emergency` | Initiate an emergency session (anchor nodes only) |

---

### File API (Editor Plugin)

The editor plugin mounts these routes for reading and writing files from the dashboard. All require private network access.

#### Config File Endpoints

Used for `.claude/`, `.ai/`, `docs/` subtrees (relative to workspace root) and the external PRIME directory (absolute paths).

#### POST /api/files/read

Read a config file.

Request body:

```json
{ "path": ".claude/settings.json" }
```

Paths can be relative (within workspace root) or absolute (must be inside an allowed external directory like PRIME).

Response: File contents (string).

#### POST /api/files/write

Write a config file.

Request body:

```json
{ "path": ".claude/settings.json", "content": "{}" }
```

Response: `{ "ok": true }`

#### POST /api/files/tree

List files in a config directory.

Request body:

```json
{ "path": "docs/" }
```

Response: Array of file entries.

#### Project File Endpoints

Used for files within `workspace.projects` directories. Paths must be absolute and within a configured project directory.

#### POST /api/files/project-read

Read a project file.

Request body:

```json
{ "path": "/home/user/projects/my-app/src/index.ts" }
```

Response: File contents (string).

#### POST /api/files/project-write

Write a project file.

Request body:

```json
{ "path": "/home/user/projects/my-app/src/index.ts", "content": "export const app = {};" }
```

Response: `{ "ok": true }`

#### POST /api/files/project-tree

List files in a project directory.

Request body:

```json
{ "path": "/home/user/projects/my-app/src" }
```

Response: Array of file entries.

---

### Agent Tools

Six action-based tools available to Aionima agents. Each tool accepts an `action` discriminator and action-specific parameters. Requires the gateway to be in `ONLINE` state with `verified` or `sealed` entity tier.

#### manage_marketplace

Interact with the plugin marketplace.

| Action | Params | Description |
|--------|--------|-------------|
| `search` | `q?`, `type?`, `category?` | Search the catalog |
| `install` | `pluginName`, `sourceId` | Install a plugin |
| `uninstall` | `pluginName` | Uninstall a plugin |
| `list_sources` | — | List marketplace sources |
| `add_source` | `ref`, `name?` | Add a source |
| `sync_source` | `sourceId` | Sync a source |
| `list_installed` | — | List installed plugins |
| `check_updates` | — | Check for updates |

#### manage_plugins

Control plugin enable/disable state.

| Action | Params | Description |
|--------|--------|-------------|
| `list` | — | List all plugins with status flags |
| `enable` | `pluginId` | Enable a plugin |
| `disable` | `pluginId` | Disable a plugin |

#### manage_config

Read and write gateway configuration.

| Action | Params | Description |
|--------|--------|-------------|
| `read` | `key?` (dot-notation) | Read full config or a specific key |
| `write` | `config` (object) | Replace full config |
| `patch` | `key`, `value` | Merge a single key (dot-notation) |

#### manage_stacks

Manage service stacks for hosted projects.

| Action | Params | Description |
|--------|--------|-------------|
| `list` | `category?`, `stackCategory?` | List available stacks |
| `get` | `stackId` | Get stack details |
| `add` | `path`, `stackId` | Add stack to project |
| `remove` | `path`, `stackId` | Remove stack from project |
| `project_stacks` | `path` | List stacks for a project |

#### manage_system

System monitoring and control.

| Action | Params | Description |
|--------|--------|-------------|
| `status` | — | System metrics (CPU, memory, disk, uptime) |
| `upgrade` | — | Trigger deployment upgrade |

#### manage_hosting

Control project hosting.

| Action | Params | Description |
|--------|--------|-------------|
| `status` | — | Hosting infrastructure status |
| `enable` | `path`, `type?`, `hostname?`, `docRoot?`, `startCommand?`, `mode?`, `internalPort?`, `runtimeId?` | Enable hosting for a project |
| `disable` | `path` | Disable hosting |
| `restart` | `path` | Restart hosted project |
| `info` | `path` | Get hosting info for a project |
| `tunnel_enable` | `path` | Enable public tunnel |

---

### Dashboard (Legacy REST)

Legacy REST endpoints for the impact dashboard. These mirror the tRPC `dashboard.*` procedures and exist for backward compatibility. All are GET-only; non-GET requests return `405`.

#### GET /api/dashboard/overview

Aggregate impact overview.

Query parameters:
- **`windowDays`** — Lookback period (default `90`)
- **`recentLimit`** — Recent activity limit (default `20`)

Response: Dashboard overview object with metrics, recent activity, and entity counts.

#### GET /api/dashboard/timeline

Impact timeline data for charting.

Query parameters:
- **`bucket`** — Time bucket: `hour`, `day`, `week`, or `month` (default `day`)
- **`entityId`** — Filter by entity
- **`since`** — Start date (ISO 8601)
- **`until`** — End date (ISO 8601)

Returns `400` for invalid bucket values.

Response:

```json
{ "buckets": [], "bucket": "day", "since": "2026-01-01", "until": "2026-03-08" }
```

#### GET /api/dashboard/breakdown

Impact breakdown by dimension.

Query parameters:
- **`by`** — Dimension: `domain`, `channel`, or `workType` (default `domain`)
- **`entityId`**, **`since`**, **`until`** — Optional filters

Returns `400` for invalid dimension values.

Response:

```json
{ "dimension": "domain", "slices": [], "total": 0 }
```

#### GET /api/dashboard/leaderboard

Top-impact entities.

Query parameters:
- **`windowDays`** — Lookback period (default `90`)
- **`limit`** — Max entries (default `25`)
- **`offset`** — Pagination offset (default `0`)

Response:

```json
{ "entries": [], "windowDays": 90, "total": 0, "computedAt": "2026-03-08T12:00:00.000Z" }
```

#### GET /api/dashboard/entity/:id

Get a single entity's impact profile.

- **`:id`** — Entity ID

Query parameters:
- **`windowDays`** — Lookback period (default `90`)

Returns `404` if the entity is not found.

#### GET /api/dashboard/coa

Query the Chain of Accountability log.

Query parameters:
- **`entityId`** — Filter by entity
- **`fingerprint`** — Filter by action fingerprint
- **`workType`** — Filter by work type
- **`since`**, **`until`** — Date range (ISO 8601)
- **`limit`** — Max entries (default `50`, max `200`)
- **`offset`** — Pagination offset (default `0`)

Response: Paginated COA entries.

---

## tRPC Router

The tRPC router is available at `/api/trpc/*`. It is used by the React dashboard via the `@trpc/client` package.

tRPC calls are HTTP POST requests with the procedure name in the URL path and input in the request body. The dashboard client handles serialization.

### Procedure Groups

#### dashboard.*

Read-only queries that mirror the legacy REST dashboard endpoints.

| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| `dashboard.overview` | query | `windowDays?`, `recentLimit?` | Aggregate impact overview |
| `dashboard.timeline` | query | `bucket?`, `entityId?`, `since?`, `until?` | Impact timeline |
| `dashboard.breakdown` | query | `by?`, `entityId?`, `since?`, `until?` | Impact breakdown by dimension |
| `dashboard.leaderboard` | query | `windowDays?`, `limit?`, `offset?` | Top-impact entities |
| `dashboard.entityProfile` | query | `id`, `windowDays?` | Single entity profile |
| `dashboard.coa` | query | `entityId?`, `fingerprint?`, `workType?`, `since?`, `until?`, `limit?`, `offset?` | COA log entries |

#### config.*

Configuration management.

| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| `config.get` | query | — | Read current config |
| `config.save` | mutation | Config object | Write full config |

#### system.*

System operations.

| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| `system.checkUpdates` | query | — | Check for available upgrades |
| `system.upgrade` | mutation | — | Trigger deployment upgrade |

---

## WebSocket Events

The WebSocket server runs on the same port as HTTP (default 3100). Connect to `ws://127.0.0.1:3100`.

### Connection

For non-loopback connections, include the auth token:

```javascript
const ws = new WebSocket("ws://127.0.0.1:3100", {
  headers: { "Authorization": "Bearer <AUTH_TOKEN>" }
});
```

### Message Format

All messages are JSON objects with `type` and `payload` fields:

```json
{ "type": "state_changed", "payload": { "from": "LIMBO", "to": "ONLINE", "timestamp": "..." } }
```

### Client → Server Messages

| Type | Payload | Description |
|------|---------|-------------|
| `ping` | — | Keepalive ping |
| `dashboard:subscribe` | `{ topics: string[] }` | Subscribe to specific dashboard event topics |
| `dashboard:unsubscribe` | `{ topics: string[] }` | Unsubscribe from dashboard event topics |

### Server → Client Events

| Type | Payload | Description |
|------|---------|-------------|
| `pong` | — | Response to ping |
| `state_changed` | `{ from, to, timestamp }` | Gateway state transition |
| `impact:recorded` | Activity entry | Impact activity recorded |
| `entity:verified` | `{ entityId, tier }` | Entity verification tier changed |
| `coa:created` | COA entry | New Chain of Accountability record |
| `overview:updated` | Dashboard overview | Dashboard overview refreshed (debounced) |
| `project:activity` | `{ projectPath, timestamp, ... }` | Project work activity recorded |
| `system:upgrade` | `{ phase, message, timestamp }` | Upgrade pipeline progress |
| `system:update_available` | `{ updateAvailable, behindCount, ... }` | New update detected |
| `hosting:status` | Hosting status data | Hosting infrastructure status change |
| `workers:job_update` | `{ jobId, status, phase, ... }` | Taskmaster job status change |
| `notification:new` | Notification data | Real-time notification |
| `channel_event` | `{ channelId, event, data }` | Channel status change |
| `message_received` | `{ channelId, entityAlias, content, timestamp }` | Inbound message from channel |
| `message_sent` | `{ channelId, entityAlias, content, timestamp }` | Outbound message to channel |
| `resource_metrics` | `{ cpu, memory, disk }` | System resource update |
| `heartbeat` | `{ uptime, channels, sessions, queueDepth }` | Periodic status broadcast |

### Heartbeat

The gateway sends a native WebSocket ping every 30 seconds. Clients must respond with a pong within 10 seconds or the connection is terminated.

---

## Error Responses

All REST endpoints return errors in this format:

```json
{ "error": "Error message describing the problem" }
```

| HTTP Status | Meaning |
|------------|---------|
| `400` | Bad request (validation error, missing field) |
| `401` | Unauthorized (missing or invalid token) |
| `403` | Forbidden (private-network-only route accessed from public IP) |
| `404` | Resource not found |
| `405` | Method not allowed |
| `409` | Conflict (resource already exists, upgrade in progress) |
| `500` | Internal server error |
| `501` | Not implemented (feature not configured) |
| `502` | Bad gateway (upstream service unreachable) |
