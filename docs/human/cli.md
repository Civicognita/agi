# CLI Commands Reference

The `aionima` CLI provides commands for starting the gateway, checking health, managing channels, and running the configuration wizard.

---

## Invoking the CLI

In the repository, use `pnpm cli <command>`:

```bash
pnpm cli run
pnpm cli status
pnpm cli doctor
```

In production (installed to `/opt/aionima`), use `aionima <command>` directly if the CLI is in your PATH, or `node /opt/aionima/cli/dist/index.js <command>`.

---

## Global Options

These options apply to all commands:

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to `aionima.json`. Default: `aionima.json` in the current directory. |
| `--host <host>` | Gateway host for commands that query the running gateway. Default: `127.0.0.1`. |
| `--port <port>` | Gateway port. Default: `3100`. |
| `-v, --verbose` | Enable verbose output. |
| `-q, --quiet` | Suppress non-essential output. |
| `--version` | Print the CLI version. |
| `--help` | Print help for the current command. |

---

## aionima run

Start the gateway.

```bash
aionima run
aionima run --config /opt/aionima/aionima.json
```

Reads `aionima.json`, starts the HTTP server, WebSocket server, channel adapters, and queue consumer. Serves the built dashboard from `ui/dashboard/dist/` if it exists.

Output:

```
Config loaded from aionima.json

  aionima gateway
  listen    127.0.0.1:3100
  state     ONLINE
  channels  2 configured
  dashboard http://127.0.0.1:3100
```

The process stays alive until `SIGINT` (Ctrl+C) or `SIGTERM` is received, at which point it shuts down gracefully: drains the message queue, stops channel adapters, closes the HTTP server.

**Environment variables used at startup:**

All `$ENV{VAR}` references in `aionima.json` are resolved from the environment. Load `.env` before running:

```bash
# Manual load
set -a; source .env; set +a
aionima run
```

The gateway automatically loads `.env` from the same directory as `aionima.json`.

---

## aionima status

Show the current gateway state and key metrics.

```bash
aionima status
aionima status --host 192.168.0.144 --port 3100
```

Queries the running gateway at `http://host:port/api/status`. Requires the gateway to be running.

Output:

```
  aionima status

  State       ONLINE
  Uptime      2h 14m
  Channels    3
  Entities    47
  Queue Depth 0
  WS Clients  2
```

Exits with code 1 if the gateway is unreachable.

---

## aionima doctor

Run self-diagnostics and print pass/fail results with fix instructions.

```bash
aionima doctor
```

Runs ten checks:

| Check | What It Verifies |
|-------|----------------|
| Config file | `aionima.json` exists and passes Zod validation |
| Data directory | `./data/` exists and is writable |
| Gateway reachable | HTTP ping to `host:port/api/ping` succeeds |
| Node.js version | Node.js 22+ |
| .env file | `/opt/aionima/.env` exists with mode `0600` |
| Primary API key | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set |
| Auth token | `AUTH_TOKEN` is set |
| Systemd service | `/etc/systemd/system/aionima.service` exists |
| Deploy directory | `/opt/aionima` exists |
| No secrets in config | Config does not contain raw API key patterns |

Output:

```
  aionima doctor

  ✓ Config file
  ✓ Data directory
  ✓ Gateway reachable
  ✓ Node.js (v22.14.0)
  ✗ .env file
    Create .env: touch /opt/aionima/.env && chmod 0600 /opt/aionima/.env
  ✗ Primary API key
    Set ANTHROPIC_API_KEY or OPENAI_API_KEY in /opt/aionima/.env

  2 issue(s) — 8/10 passed
```

Exits with code 1 if any check fails.

---

## aionima setup

Interactive configuration wizard. Generates `aionima.json` and `.env` from user input.

```bash
aionima setup
aionima setup --dir /opt/aionima
```

**Options:**

| Option | Description |
|--------|-------------|
| `-d, --dir <path>` | Target directory for the generated files. Default: current directory. |

The wizard runs nine phases:

1. Detect context (current directory vs deploy directory)
2. Owner identity (display name, DM policy)
3. Gateway settings (listen address, port)
4. LLM provider (Anthropic, OpenAI, or Ollama) and API key
5. Channel selection and per-channel secrets
6. Optional features (project hosting, voice, dashboard auth)
7. Workspace configuration
8. Generate and write files (with validation)
9. Print next steps

If `aionima.json` already exists in the target directory, the wizard offers to use it as a starting point (migrating existing values).

The `.env` file is created with `chmod 0600`. If `.env` already exists, new variables are appended and existing ones are preserved.

**Example session:**

```
  aionima setup
  Interactive configuration wizard

  Working directory: /home/user/aionima

  Owner Identity
  Display name [Owner]: Alice
  DM policy [1=Pairing (default), 2=Open]: 1

  Gateway
  Listen address [127.0.0.1]: 127.0.0.1
  Port [3100]: 3100
    Generated AUTH_TOKEN (saved to .env)

  LLM Provider
  Primary LLM provider [1=Anthropic (default), 2=OpenAI, 3=Ollama]: 1
  ANTHROPIC_API_KEY: [hidden]
  Model [claude-sonnet-4-6]: claude-sonnet-4-6
  Reply mode [1=Autonomous (default), 2=Human-in-loop]: 1

  Channels
  Which channels to enable? (space to toggle, enter to confirm)
  > [x] Telegram
    [ ] Discord
    [ ] Email (Gmail)
    [ ] Signal
    [ ] WhatsApp

  Telegram bot token: [hidden]
  Your Telegram user ID (numeric): 123456789

  ...

  Written: /home/user/aionima/aionima.json
  Written: /home/user/aionima/.env
  Set .env permissions to 0600

  Setup complete!

  Config:  /home/user/aionima/aionima.json
  Secrets: /home/user/aionima/.env

  Next steps:
    1. Review config:  cat aionima.json
    2. Start locally:  aionima run
    3. Check health:   aionima doctor
```

---

## aionima channels

Subcommands for managing channel adapters.

### aionima channels list

List channels configured in `aionima.json`.

```bash
aionima channels list
```

Output:

```
  Configured Channels

  Channel   Status    Config
  telegram  enabled   custom
  discord   disabled  default
```

### aionima channels test \<id\>

Send a test message through a channel (Phase 2 — not yet wired in the current build).

```bash
aionima channels test telegram
```

---

## aionima config

Subcommands for configuration management.

### aionima config validate

Validate `aionima.json` against the Zod schema and print any errors.

```bash
aionima config validate
aionima config validate --config /path/to/aionima.json
```

Output on success:

```
  Config Validation

  File: /home/user/aionima/aionima.json

  ✓ Valid configuration
```

Output on failure:

```
  Config Validation

  File: /home/user/aionima/aionima.json

  ✗ Invalid configuration:
    • agent.model: Required
    • channels.0.id: String must contain at least 1 character(s)
```

Exits with code 1 on validation failure.

### aionima config show

Print the resolved configuration (with `$ENV{}` references expanded).

```bash
aionima config show
```

Output:

```
  Resolved Configuration
  Source: aionima.json

  {
    "gateway": {
      "host": "127.0.0.1",
      "port": 3100,
      "state": "ONLINE"
    },
    ...
  }
```

Note: `config show` resolves `$ENV{}` references. The output may contain actual token values — handle it with care.

---

## Environment Variables

The CLI and gateway read these environment variables:

| Variable | Description |
|---------|-------------|
| `AUTH_TOKEN` | Bearer token for gateway API auth |
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
| `JWT_SECRET` | Dashboard session JWT signing secret |
| `AIONIMA_USER` | Linux user for upgrade.sh (default: owner of `/opt/aionima`) |
| `AIONIMA_REPO_DIR` | Repository directory for upgrade.sh |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (config invalid, gateway unreachable, checks failed) |

---

## Development Commands

These are npm scripts in `package.json`, not `aionima` CLI commands:

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start gateway with tsx hot-reload |
| `pnpm dev:dashboard` | Start Vite dev server (port 5173) |
| `pnpm build` | Build dashboard + backend |
| `pnpm typecheck` | Type-check the full monorepo |
| `pnpm lint` | Run oxlint |
| `pnpm format` | Run oxfmt (format in place) |
| `pnpm check` | typecheck + lint |
| `pnpm test` | Run Vitest |
| `pnpm test:e2e` | Run Playwright e2e tests |
| `pnpm tm status` | Show Taskmaster job status |
| `pnpm tm jobs` | List Taskmaster jobs |
