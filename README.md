# Aionima

> The autonomous AI gateway — your personal AI's secure entryway.

Aionima ($A0) is a self-hosted AGI system: an agent identity, a messaging-channel hub, a project host, a plugin marketplace, and a developer framework all in one. It's built on the **Agent Development Framework (ADF)** — a foundation any AI app can stand on, with Aionima as its first and primary reference consumer.

**Why it matters.** Every action through Aionima produces a verifiable impact record via the Chain of Accountability ↔ Chain of Impact (COA<>COI) audit trail, quantified through the **Impactinomics** framework. Aionima makes impact measurable, accountable, and — eventually, on the Impactium blockchain — non-tradeable proof of work done in the world.

**What you get out of the box.** Telegram / Discord / Signal / WhatsApp / Email channels, a Taskmaster worker orchestrator (8 domains), a Plugin Marketplace + MApp Marketplace, project hosting on `*.ai.on` with public-share via Cloudflare Tunnels, an `agi` CLI for everything, and a React dashboard that's the operator's home base. Aion lives inside the system as the always-on agent — you talk to it, it does the work, the audit trail records who did what for whom.

---

## Install

One command on a fresh Ubuntu machine:

```bash
curl -fsSL https://raw.githubusercontent.com/Civicognita/agi/main/scripts/install.sh | sudo bash
```

The installer brings up Node.js, pnpm, Caddy, dnsmasq, Podman, Playwright (Chromium), clones every repo, builds, and starts the service. When it finishes, open the dashboard and complete onboarding.

To install as an existing user (instead of creating a new `aionima` user):

```bash
curl -fsSL https://raw.githubusercontent.com/Civicognita/agi/main/scripts/install.sh | sudo AIONIMA_USER=youruser bash
```

### After install

The installer configures this machine's DNS automatically. To access `*.ai.on` domains from **other devices** on your network, point their DNS to this machine's IP:

| Platform | How |
|----------|-----|
| **macOS** | System Settings → Network → DNS → add the server IP |
| **Windows** | Settings → Network & Internet → DNS → set to the server IP |
| **Linux** | Set `DNS=<server-ip>` in `/etc/systemd/resolved.conf` |
| **Router** | Set primary DNS to the server IP (affects all devices) |

### Upgrade

Subscribe to a **release channel** (`main` or `dev`) in Settings → Gateway → Network. The dashboard auto-detects updates; click **Upgrade** when notified, or via CLI:

```bash
agi upgrade
```

See [`docs/agents/upgrade-pipeline.md`](docs/agents/upgrade-pipeline.md) for the full upgrade flow.

---

## Features

Every feature has a deeper doc — follow the link when you want details.

### Agent + workflows

| Feature | What it is | Read |
|---------|-----------|------|
| **Aion agent pipeline** | Multi-channel routing → ADF agent → tool execution → COA<>COI capture | [`docs/human/agent-pipeline.md`](docs/human/agent-pipeline.md) · [`docs/agents/system-prompt-assembly.md`](docs/agents/system-prompt-assembly.md) |
| **Taskmaster** | Background orchestrator that decomposes work into worker phases (code, knowledge, UX, strategy, comms, ops, governance, data) | [`docs/human/taskmaster.md`](docs/human/taskmaster.md) · [`docs/agents/taskmaster.md`](docs/agents/taskmaster.md) |
| **Iterative-work loops** | Cron-driven autonomous agent cycles; race-to-DONE discipline | [`prompts/iterative-work.md`](prompts/iterative-work.md) |
| **Skills** | Per-task playbooks loaded into the agent context | [`docs/human/skills.md`](docs/human/skills.md) |
| **Browser sessions** | Persistent Playwright sessions: navigate / click / type / fill / screenshot, all from chat | [`docs/human/voice.md`](docs/human/voice.md) (in-context primitives) |

### Project + hosting

| Feature | What it is | Read |
|---------|-----------|------|
| **Project hosting** | Every project gets a `*.ai.on` virtual host (Caddy + dnsmasq + Podman rootless) | [`docs/human/project-hosting.md`](docs/human/project-hosting.md) |
| **Stack management** | Database / cache / queue stacks per project | [`docs/human/stack-management.md`](docs/human/stack-management.md) · [`docs/agents/stack-management.md`](docs/agents/stack-management.md) |
| **Cloudflare Tunnels** | Public-share any hosted project (quick + named tunnel modes) | [`docs/human/project-hosting.md`](docs/human/project-hosting.md#tunnels) |
| **Federation + ID** | Built-in identity (OAuth, entity registration) + Hive-ID federation hub | [`docs/human/federation.md`](docs/human/federation.md) · [`docs/agents/federation-identity.md`](docs/agents/federation-identity.md) |
| **Compliance / security** | GDPR + HIPAA controls, incident tracking, vendor management | [`docs/human/security.md`](docs/human/security.md) · [`docs/agents/compliance.md`](docs/agents/compliance.md) |

### Extensions

| Feature | What it is | Read |
|---------|-----------|------|
| **Plugin Marketplace** | Code plugins (runtimes, stacks, project types, themes, agent tools, workers) | [`docs/human/plugins.md`](docs/human/plugins.md) |
| **MApp Marketplace** | JSON-defined Magic Apps (Reader, Gallery, BuilderChat-style packaged surfaces) | [`docs/agents/magic-apps.md`](docs/agents/magic-apps.md) |
| **Channels** | Add new messaging adapters (Telegram, Discord, Signal, WhatsApp, Email, custom) | [`docs/agents/adding-a-channel.md`](docs/agents/adding-a-channel.md) |
| **HuggingFace integration** | Local model marketplace + runtime management | [`docs/human/huggingface.md`](docs/human/huggingface.md) · [`docs/agents/huggingface-integration.md`](docs/agents/huggingface-integration.md) |

### Operating

| Feature | What it is | Read |
|---------|-----------|------|
| **`agi` CLI** | Service lifecycle + diagnostics + projects + channels + marketplace + everything | [`docs/human/cli.md`](docs/human/cli.md) |
| **Configuration** | `~/.agi/gateway.json` — single source of truth for runtime config | [`docs/human/configuration.md`](docs/human/configuration.md) |
| **`agi doctor`** | Grouped self-diagnostic (core / auth / repos / git / plugins / network / containers / hosting / dev / gateway) + interactive menu | [`docs/agents/agi-doctor-recipe.md`](docs/agents/agi-doctor-recipe.md) |
| **State machine** | Gateway states (Initial / Limbo / Offline / Online) and what each gates | [`docs/agents/state-machine.md`](docs/agents/state-machine.md) |
| **Crash recovery** | Self-healing post-restart + safemode + incident reports | [`docs/human/crash-recovery.md`](docs/human/crash-recovery.md) · [`docs/agents/crash-recovery.md`](docs/agents/crash-recovery.md) |
| **Voice (STT/TTS)** | Speech in / speech out for owner-Aion interaction | [`docs/human/voice.md`](docs/human/voice.md) |

---

## Contributing

Aionima is open to contribution. Pick the path that matches your situation.

---

### Path A — Contributing Mode (you run Aionima)

If you have Aionima installed and running, Contributing Mode is the fastest way to develop against the live system. It provisions personal custodian forks on GitHub, clones them locally, and rewires the upgrade system so `agi upgrade` pulls from your forks instead of Civicognita. You can push a commit to your fork's `dev` branch and have it live in seconds.

**Enable it:**

1. Open **Settings → Gateway → Contributing** in the dashboard.
2. Toggle **Contributing Mode** on.
   - Aionima creates personal forks of all core repos under your GitHub account (or reuses existing ones).
   - The five fork clones appear under `~/_projects/_aionima/repos/`.
   - `gateway.json` is updated with your fork URLs.
3. Run `agi upgrade` (or click **Upgrade** in the dashboard).
   - The upgrade script rewrites each `/opt/*` origin from `Civicognita/<repo>` → `<your-login>/<repo>`.
   - Subsequent upgrades pull from your forks automatically.

**Development loop:**

```
edit code in ~/_projects/_aionima/repos/<repo>/
git add … && git commit && git push origin dev
agi upgrade                  # pulls your fork's dev branch into /opt/<repo>
```

The dashboard's **Contributing** tab shows each fork's status (branch, HEAD SHA, divergence from upstream). When upstream has moved ahead, the **Merge upstream → origin** button pulls the latest Civicognita commits into your fork automatically — including agentic conflict resolution for simple hunks.

**Submit a PR:**

The **Open PR to upstream** button on each fork card opens a pre-filled GitHub compare URL (`Civicognita/<repo>/compare/dev...<your-login>:dev`) in a new tab.

Full reference: [`docs/human/dev-mode.md`](docs/human/dev-mode.md)

---

### Path B — Fork and PR (no Aionima install required)

For a targeted change to a single repo, a plain GitHub fork works fine:

1. Fork the repo you want to change on GitHub.
2. Clone your fork, create a branch off `dev`.
3. Make your change, run `agi test <pattern>` if you have Aionima, or push and let CI validate.
4. Open a PR from `<your-login>/<repo>:your-branch` → `Civicognita/<repo>:dev`.

Both paths ultimately merge into `Civicognita/<repo>:dev`. `main` is the stable release branch — PRs always target `dev`.

---

### Where to start in the codebase

| Layer | Entry point | What lives here |
|-------|-------------|-----------------|
| **CLI** | [`cli/src/index.ts`](cli/src/index.ts) | `agi` command surface — service lifecycle, doctor, projects, upgrade. Commands live in [`cli/src/commands/`](cli/src/commands/). |
| **Gateway** | [`packages/gateway-core/src/server.ts`](packages/gateway-core/src/server.ts) | Fastify server boot, route registration, tool registry, agent invoker wiring. Boot sequence assembles state machine + tool surfaces + REST routes. |
| **Dashboard** | [`ui/dashboard/src/App.tsx`](ui/dashboard/src/App.tsx) | React + Vite + react-router. Routes live in [`ui/dashboard/src/routes/`](ui/dashboard/src/routes/). Reusable components in [`ui/dashboard/src/components/`](ui/dashboard/src/components/). |
| **Aion-SDK** | [`packages/aion-sdk/src/index.ts`](packages/aion-sdk/src/index.ts) | Public contracts plugins + MApps build against (`createPlugin`, `defineProvider`, `defineTool`, etc.). |
| **DB schema** | [`packages/db-schema/src/`](packages/db-schema/src/) | Drizzle schemas + migrations against the single `agi_data` Postgres. |
| **Prompts** | [`prompts/`](prompts/) | `taskmaster.md` (orchestrator), `workers/<domain>/<role>.md` (worker prompts), `iterative-work.md` (loop discipline), `mycelium.md` (agent identity). |

### What to read for each subsystem

| To work on | Start here |
|------------|------------|
| **Bootup + lifecycle** | [`docs/agents/state-machine.md`](docs/agents/state-machine.md) → [`docs/human/configuration.md`](docs/human/configuration.md) → [`docs/agents/upgrade-pipeline.md`](docs/agents/upgrade-pipeline.md) |
| **Services + stacks** | [`docs/human/stack-management.md`](docs/human/stack-management.md) → [`docs/agents/stack-management.md`](docs/agents/stack-management.md) |
| **Plugins** | [`docs/human/plugins.md`](docs/human/plugins.md) → [`docs/agents/adding-a-plugin.md`](docs/agents/adding-a-plugin.md) → [`docs/agents/plugin-schema.md`](docs/agents/plugin-schema.md) |
| **MApps** | [`docs/agents/magic-apps.md`](docs/agents/magic-apps.md) |
| **Agentic workflows** | [`docs/human/agent-pipeline.md`](docs/human/agent-pipeline.md) → [`docs/agents/system-prompt-assembly.md`](docs/agents/system-prompt-assembly.md) → [`docs/human/taskmaster.md`](docs/human/taskmaster.md) → [`docs/agents/taskmaster.md`](docs/agents/taskmaster.md) → [`docs/human/adf.md`](docs/human/adf.md) |
| **Dashboard pages** | [`docs/agents/adding-dashboard-pages.md`](docs/agents/adding-dashboard-pages.md) |
| **API endpoints** | [`docs/human/api-reference.md`](docs/human/api-reference.md) → [`docs/agents/adding-api-endpoints.md`](docs/agents/adding-api-endpoints.md) |
| **Channels** | [`docs/agents/adding-a-channel.md`](docs/agents/adding-a-channel.md) |
| **Testing + shipping** | [`docs/human/testing.md`](docs/human/testing.md) → [`docs/agents/testing-and-shipping.md`](docs/agents/testing-and-shipping.md) |
| **Contributing Mode** | [`docs/human/dev-mode.md`](docs/human/dev-mode.md) — full reference for fork provisioning + live-development loop |
| **ADF + Intelligence Protocols** | [`docs/human/adf.md`](docs/human/adf.md) — the framework Aionima sits on |

### Workflow rules

- **Branches:** develop on `dev`. Never push to `main`. Stable releases are merged from `dev` → `main` manually.
- **Tests:** unit tests run via `agi test <pattern>`. Playwright E2E via `agi test --e2e` (headless) or `agi test --e2e-ui` (visible).
- **Versioning:** bump `package.json` patch (`0.4.x`) in the same commit as any shippable change. The upgrade system uses version comparison to trigger restarts.
- **Same-commit doc guard:** if you change functionality, update the matching doc in [`docs/`](docs/) in the same commit.
- **Tynn (project management):** stories and tasks live in the Tynn MCP project. `mcp__tynn__next` shows what's in flight.

### Architecture (multi-repo)

Five independent git repos (not submodules):

| Repo | Purpose | Production path |
|------|---------|-----------------|
| **agi** (this repo) | Core gateway, dashboard, CLI | `/opt/agi` |
| **aionima** (PRIME corpus) | Knowledge corpus (Mycelium Protocol, Impactinomics) | `/opt/agi-prime` |
| **agi-marketplace** | Plugin Marketplace (code plugins) | `/opt/agi-marketplace` |
| **agi-mapp-marketplace** | MApp Marketplace (JSON apps) | `/opt/agi-mapp-marketplace` |

Each repo carries a `protocol.json` for semver compatibility checks at boot.

ADF UI primitives live as workspace siblings under [`@particle-academy/*`](https://github.com/Particle-Academy): `react-fancy`, `fancy-code`, `fancy-sheets`, `fancy-echarts`, `fancy-3d`, `fancy-screens`, `fancy-whiteboard`, `agent-integrations`. Maintenance + upstream PR flow documented in [`docs/agents/contributing-to-adf-packages.md`](docs/agents/contributing-to-adf-packages.md).

---

## Reference

### Network

| Port | Service |
|------|---------|
| 3100 | Gateway (HTTP + WebSocket) |
| 443 | Caddy (HTTPS, project hosting) |
| 53 | dnsmasq (wildcard DNS) |

### Data paths

All runtime data lives in `~/.agi/` — **never** in repos or `/opt/`.

| Path | Purpose |
|------|---------|
| `~/.agi/gateway.json` | Runtime config (single source of truth) |
| `~/.agi/entities.db` | Entity database |
| `~/.agi/plugins/cache/` | Installed plugins |
| `~/.agi/mapps/` | Installed MApps |
| `~/.agi/secrets/` | TPM2-sealed credentials (API keys, tokens) |
| `~/.agi/chat-history/` | Persisted chat sessions |
| `~/.agi/chat-images/` | Image blob storage (screenshots, uploads) |
| `~/.agi/memory/` | Agent memory (multi-file + `_map.md` index) |
| `~/.agi/models/` | HuggingFace model cache |
| `~/.agi/state/` | Taskmaster job state |
| `~/.agi/reports/` | Worker execution reports |
| `~/.agi/logs/` | Resource stats, system logs, audit logs |

### License

Proprietary — Civicognita. All rights reserved.
