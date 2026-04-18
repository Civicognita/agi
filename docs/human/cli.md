# CLI Reference

The `agi` command is the single entry point for managing the Aionima gateway from the terminal.

```bash
agi <command> [args]
```

Installed as a symlink: `/usr/local/bin/agi` → `/opt/agi/scripts/agi-cli.sh`

---

## Commands

### agi status

Show service state, deployed commit, update status, and infrastructure health.

```bash
agi status
```

```
Aionima Gateway Status

Service:          running
PID:              12345
Since:            Sat 2026-04-11 10:00:51 CDT
Memory:           478MB
Commit:           abc1234...
Update:           up to date (dev)
Port:             3100

Infrastructure
Caddy:            active
Podman:           installed (podman version 4.9.3)
dnsmasq:          active
Containers:       4 running
```

The update check compares against `origin/{channel}` where channel is read from `gateway.updateChannel` in `gateway.json` (default: `main`).

---

### agi logs

Tail gateway logs.

```bash
agi logs        # last 50 lines
agi logs 100    # last 100 lines
agi logs -f     # follow (live tail)
```

Reads from `~/.agi/logs/aionima.log`, falls back to `journalctl -u aionima` if the log file doesn't exist.

---

### agi upgrade

Pull latest code, build, and restart the gateway.

```bash
agi upgrade
```

Runs `scripts/upgrade.sh` and parses its structured JSON output into human-readable progress lines. Checks service health after completion.

---

### agi restart / start / stop

Service lifecycle commands.

```bash
agi restart     # restart the aionima systemd service
agi start       # start the service
agi stop        # stop the service
```

---

### agi doctor

Run infrastructure health checks.

```bash
agi doctor
```

Checks: Node.js version, pnpm, deploy directory, config file, Caddy, Podman (rootless), dnsmasq, gateway HTTP response, disk usage.

---

### agi config

Read configuration values from `~/.agi/gateway.json`.

```bash
agi config                    # print full config
agi config hosting.enabled    # read a specific dot-path key
agi config gateway.port       # nested keys work
```

---

### agi projects

List all hosted projects with their type, status, hostname, and port.

```bash
agi projects
```

---

### agi setup

Interactive configuration wizard. Generates `gateway.json` and `.env` from user input.

```bash
agi setup
```

Delegates to the Node.js setup wizard (`cli/dist/index.js setup`). Runs nine phases: owner identity, gateway settings, LLM provider, channels, optional features, workspace config, file generation, and next steps.

---

### agi setup-prompts

Configure the agent persona (SOUL.md, IDENTITY.md) and heartbeat prompt.

```bash
agi setup-prompts
```

---

### agi channels

Manage channel adapters.

```bash
agi channels list     # list configured channels
agi channels test <id>  # test a channel (future)
```

---

## Environment Variables

The gateway reads these from `~/.agi/.env` (loaded automatically at startup):

| Variable | Description |
|---------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `OPENAI_API_KEY` | OpenAI API key (also used for Whisper STT) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `GMAIL_CLIENT_ID` | Gmail OAuth2 client ID |
| `GMAIL_CLIENT_SECRET` | Gmail OAuth2 client secret |
| `GMAIL_REFRESH_TOKEN` | Gmail OAuth2 refresh token |
| `SIGNAL_API_URL` | signal-cli REST API base URL |
| `SIGNAL_PHONE_NUMBER` | Signal phone number (E.164) |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp Business API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp webhook verification token |

---

## Development Commands

These are npm scripts in `package.json`, used during development only:

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start gateway with tsx hot-reload |
| `pnpm dev:dashboard` | Start Vite dev server (port 5173) |
| `pnpm build` | Build dashboard + backend |
| `pnpm typecheck` | Type-check the full monorepo |
| `pnpm lint` | Run oxlint |
| `pnpm format` | Run oxfmt |
| `pnpm check` | typecheck + lint |
| `pnpm test` | Run Vitest (in VM) |
| `pnpm test:e2e` | Run Playwright e2e tests |
