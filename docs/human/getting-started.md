# Getting Started

This guide walks you through cloning the repository, configuring Aionima, running it locally, and connecting your first channel.

---

## Prerequisites

Before starting, ensure the following are installed and available in your `PATH`:

| Requirement | Version | Check |
|------------|---------|-------|
| Node.js | 22 LTS or newer | `node --version` |
| pnpm | 10.5 or newer | `pnpm --version` |
| Git | Any recent version | `git --version` |

If pnpm is not installed:

```bash
corepack enable pnpm
```

Node.js 22 LTS is available from [NodeSource](https://github.com/nodesource/distributions) or via `nvm`.

---

## Step 1 — Clone the Repository

```bash
git clone <your-repo-url> aionima
cd aionima
```

---

## Step 2 — Install Dependencies

```bash
pnpm install
```

This installs all workspace packages. It may take a minute on first run because it compiles the native `better-sqlite3` addon.

---

## Step 3 — Run the Setup Wizard

The fastest way to create a valid configuration is the interactive setup wizard:

```bash
pnpm cli setup
```

The wizard walks through:

1. **Owner identity** — your display name and DM policy for unknown senders.
2. **Gateway** — the listen address and port (default: `127.0.0.1:3100`).
3. **LLM provider** — Anthropic (Claude), OpenAI, or Ollama, plus your API key.
4. **Channels** — which channels to enable, with prompts for their secrets.
5. **Optional features** — project hosting, voice pipeline, dashboard auth.
6. **Workspace** — root directory and project directories.

The wizard writes two files:
- `aionima.json` — the configuration file, with `$ENV{VAR}` references for secrets.
- `.env` — the secrets file, created with `chmod 0600` permissions.

If you prefer to configure manually, copy the example config:

```bash
cp aionima.example.json aionima.json
```

Then edit `aionima.json` and create `.env` with your secrets.

---

## Step 4 — Configure the LLM Provider

Open `.env` and set your API key. For Claude (Anthropic):

```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
AUTH_TOKEN=<a-random-token-for-dashboard-access>
```

The `AUTH_TOKEN` protects the gateway HTTP API. If you are running locally and accessing only via loopback, the loopback address is automatically exempt from auth checks. For remote access, set a strong token.

In `aionima.json`, the agent section should look like:

```json
{
  "agent": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "replyMode": "autonomous"
  }
}
```

Valid `replyMode` values:
- `autonomous` — the agent replies directly to the channel without any human approval step.
- `human-in-loop` — the agent's response is held in the dashboard for operator approval before sending.

---

## Step 5 — Build the Dashboard

The dashboard must be built before it can be served:

```bash
pnpm build
```

This runs `vite build` for the dashboard and `tsdown` for the backend. The built dashboard lands in `ui/dashboard/dist/`. The gateway serves it from disk — no separate process is needed.

To skip the backend build and only build the dashboard:

```bash
pnpm build:dashboard
```

---

## Step 6 — Start the Gateway

```bash
pnpm dev
```

This starts the gateway with `tsx watch`, which restarts automatically when source files change. You will see output like:

```
Config loaded from aionima.json

  aionima gateway
  listen    127.0.0.1:3100
  state     ONLINE
  channels  1 configured
  dashboard http://127.0.0.1:3100
```

Open `http://127.0.0.1:3100` in your browser to access the dashboard.

To run without hot-reload (production-like):

```bash
pnpm start
```

---

## Step 7 — Verify Health

In another terminal:

```bash
pnpm cli doctor
```

The doctor command runs ten checks and reports pass/fail with fix instructions:

```
  aionima doctor

  ✓ Config file
  ✓ Data directory
  ✓ Gateway reachable
  ✓ Node.js (v22.x.x)
  ✓ .env file
  ✓ Primary API key
  ✓ Auth token
  ✓ Systemd service
  ✓ Deploy directory
  ✓ No secrets in config

  All checks passed (10/10)
```

If any check fails, the output includes a specific fix command.

---

## Step 8 — Connect Your First Channel (Telegram)

Telegram is the simplest channel to set up.

### Create a Bot

1. Open Telegram and start a conversation with `@BotFather`.
2. Send `/newbot` and follow the prompts to name your bot.
3. BotFather replies with a bot token in the format `123456789:AAFxxxxxxx`.

### Add the Token to .env

```bash
# in .env
TELEGRAM_BOT_TOKEN=123456789:AAFxxxxxxx
```

### Add Your Telegram User ID

You need to tell Aionima which Telegram user ID belongs to the owner. Find your numeric user ID using `@userinfobot` in Telegram.

### Configure aionima.json

```json
{
  "channels": [
    {
      "id": "telegram",
      "enabled": true,
      "config": {
        "botToken": "$ENV{TELEGRAM_BOT_TOKEN}"
      }
    }
  ],
  "owner": {
    "displayName": "Your Name",
    "dmPolicy": "pairing",
    "channels": {
      "telegram": "123456789"
    }
  }
}
```

Replace `"123456789"` with your actual Telegram user ID.

### Restart and Test

Restart the gateway:

```bash
# stop with Ctrl+C, then:
pnpm dev
```

Open your Telegram bot and send it a message. You should receive a reply within a few seconds.

Check the dashboard's Communication → Telegram page to see the message log and channel status.

---

## Troubleshooting

### Gateway Does Not Start

Run `pnpm cli doctor` and follow the fix instructions for any failing checks. The most common causes are a missing or invalid `aionima.json`, a missing `ANTHROPIC_API_KEY`, or a port conflict on 3100.

### Telegram Does Not Reply

- Confirm the bot token is correct by visiting `https://api.telegram.org/bot<TOKEN>/getMe` in a browser.
- Check the dashboard's Communication → Telegram page for error logs.
- Ensure `channels[0].enabled` is `true` in `aionima.json`.

### Dashboard Is Blank

The dashboard must be built first: `pnpm build`. If you see a blank page after building, check the browser console for errors.

### Config Validation Errors

```bash
pnpm cli config validate
```

This prints validation errors with field paths. Fix them in `aionima.json` and restart.

---

## Development Workflow

| Command | What It Does |
|---------|-------------|
| `pnpm dev` | Start gateway with hot-reload |
| `pnpm dev:dashboard` | Start Vite dev server for the dashboard (port 5173) |
| `pnpm build` | Build dashboard + backend (required before `pnpm start`) |
| `pnpm typecheck` | Type-check the full monorepo |
| `pnpm lint` | Run oxlint |
| `pnpm format` | Run oxfmt (format files in place) |
| `pnpm test` | Run Vitest unit tests (routed through VM) |
| `pnpm test:e2e` | Run system e2e tests (install, API, onboarding, plugins) |
| `pnpm test:e2e:ui` | Run Playwright UI tests (host browser against VM) |

When working on the dashboard UI, run `pnpm dev:dashboard` alongside `pnpm dev`. The Vite dev server proxies API requests to the gateway on port 3100 and provides HMR for the frontend.
