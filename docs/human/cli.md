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

The `Service:` line combines two checks:

| Output | Meaning |
|---|---|
| `running` | systemd unit is active **and** Fastify is bound to the gateway port. The service is genuinely up. |
| `running but unresponsive` | systemd unit is active but Fastify did not bind. The process is alive but won't serve requests — usually means a fatal boot error (route collision, plugin init failure, schema rejection). Run `agi logs` for the actual error; if route-related, `pnpm route-check` will catch duplicate registrations. |
| `inactive` / `failed` | systemd unit is down. |

The unresponsive state was added (v0.4.190) because `agi status` previously reported `running` when systemd was up but Fastify had crashed at boot — leading to confusing 502s from the dashboard with no obvious cause from the status output.

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

Run grouped self-diagnostic checks (s144 t582 — bare form now routes to the TS commander surface).

```bash
agi doctor              # full grouped diagnostic
agi doctor --json       # machine-readable for scripting / CI
agi doctor --with-aion  # appends aion-micro-powered analysis of failures
```

Check groups: **core** (config file + Zod validation), **auth** (Local-ID reachable, sealed credentials), **repos** (per-project clone state), **git state** (branch + remotes per repo), **plugins** (cache integrity), **network** (ports / certificates / Caddy parse-errors), **containers** (running + flapping + orphan analysis), **hosting** (per-project hostname + breaker state), **project shape** (s150 t641 per-project layout validation), **dev** (PAx fork checkouts when contributing mode active), **gateway** (HTTP reachability + state), **lemonade** (backend reachable + model cache).

Exits 0 on all-pass, 1 when any failed (warnings don't fail).

#### agi doctor health

The legacy 5-check infra health surface (Node.js / pnpm / Caddy / podman / hosted projects / flapping). Pre-s144-t582 this was the bare-form behavior; kept available for scripts/CI continuity that depended on the older shape.

```bash
agi doctor health
```

#### agi doctor schema

Walk every on-disk config file the gateway reads at boot and validate each
against its Zod schema. Catches the class of failure that crash-looped the
gateway in cycle 150 (project.json shape drift after the s140 layout
migration; unhandled ZodError in fire-and-forget addStack). Run this BEFORE
attempting upgrade or restart whenever schema validation might fail.

```bash
agi doctor schema           # human-readable report
agi doctor schema --json    # machine-readable for scripting / CI
```

Currently validates: `~/.agi/gateway.json` (AionimaConfigSchema) plus every
discovered `<workspace>/<project>/project.json` (ProjectConfigSchema). Exits
with code 1 when any error is found. Plugin manifests are validated in a
follow-up slice once their schema lands.

#### agi doctor dump

Write a diagnostic bundle to `~/.agi/doctor-dumps/dump-<timestamp>.json` for
incident triage. The bundle includes the full diagnostic-check output, a
sanitized copy of `gateway.json` (secret-bearing keys redacted by name —
`password`, `apiKey`, `token`, `*Secret*`, `*credential*`, `private_key`),
system info (OS / Node / podman / git versions + memory), tails of recent
logs from `~/.agi/logs/` and `/tmp/agi.log`, and per-project type info from
the workspace.

```bash
agi doctor dump
```

The dump path is printed on stdout; share the file with whoever is helping
diagnose. Sensitive values are redacted but log tails are not — review the
bundle before sharing externally.

#### agi doctor config

Safe-edit cycle for `gateway.json` keys: read or write a single dotted-path
value, with full-config Zod validation before writing. The file on disk
never enters an invalid state mid-edit — validation failure rolls back
without touching `gateway.json`.

```bash
agi doctor config get gateway.port
agi doctor config set gateway.port 4100
agi doctor config set workspace.projects '["/srv/proj-a","/srv/proj-b"]'
```

`set` coerces values automatically: `true`/`false` → boolean, integer
strings → number, `null` → null, JSON object/array literals are parsed,
anything else stays a string. Atomic write via temp + rename so an
interrupted command can't corrupt the file.

The interactive editor variant (open a chosen key in `$EDITOR`) lands
with the `agi doctor` TUI in s144 t574.

#### agi doctor logs

Tail recent logs and surface known crash patterns. Each match category
includes a count, sample lines, and a pointer to the relevant repair
surface. Categories: schema-error (ZodError / ZodIssue), port-conflict
(EADDRINUSE), segfault, unhandled-rejection, container-exit-nonzero,
restart-loop / fuse-popped, OOM.

```bash
agi doctor logs                # default 500 lines per file
agi doctor logs --lines 2000   # cap is 5000 per file
```

Reads from `~/.agi/logs/` (top 5 most-recent .log/.jsonl files) and
`/tmp/agi.log`. Pure pattern matching — no journalctl shell-out yet.

---

### agi iw — iterative-work operator commands

Operator kill switch for runaway iterative-work loops (s159 t692).
When Aion is stuck looping on a project's iterative-work and you need
to break the loop without restarting the gateway:

```bash
agi iw stop --project /home/wishborn/_projects/work/proj-a
agi iw stop --all
```

Both flip `iterativeWork.enabled = false` on the affected project(s)
in `project.json` AND force-clear any in-flight tracking in the
scheduler. After the stop, the next `agi doctor logs` sweep should
show no fresh fire entries for that project. Re-enable via the
dashboard's Iterative Work tab when the underlying issue is fixed.

The `--all` form is the nuclear option: hits every project in the
configured `workspace.projects` directories. Use when you can't
identify the looping project from logs alone.

---

### agi issue — per-project issue registry (Wish #21)

Agent-curated registry for failures Aion (or Claude Code) hits when
attempting an expected action. Each project has its own
`<projectPath>/k/issues/` directory: one Markdown file per issue
(frontmatter + body), plus `index.json` for fast hash lookup.

```bash
# List issues across all projects (aggregate)
agi issue list

# List issues for one project
agi issue list --project /home/wishborn/_projects/_aionima

# Free-text search (Slice 2): tokens AND-combined; case-insensitive;
# tag:<name> + status:<s> structured filters
agi issue search "plaid webhook" --project /home/wishborn/_projects/_aionima
agi issue search "tag:auth status:open" --project /home/wishborn/_projects/_aionima
agi issue search "deadlock tag:postgres" --project /home/wishborn/_projects/_aionima

# Show full issue body
agi issue show i-001 --project /home/wishborn/_projects/_aionima

# File a new issue (auto-dedups via symptom-hash)
agi issue file --project /home/wishborn/_projects/_aionima \
  --title "Taskmaster runaway loop" \
  --symptom "Same job re-queued every 30s; only fix is gateway restart" \
  --tool taskmaster --exit 1 --tags taskmaster,runaway-loop

# Mark as fixed with a resolution note
agi issue fix i-001 --project /home/wishborn/_projects/_aionima \
  --resolution "Fixed in agi v0.4.x via per-key cooldown"

# Slice 6: backfill from ~/.agi/logs/agi-bash-*.jsonl audit log.
# Promotes blocked + non-zero-exit entries to issues; symptom-hash
# auto-dedups so recurring patterns roll up.
agi issue from-bash-log --project /home/wishborn/_projects/_aionima              # last 7 days
agi issue from-bash-log --project /home/wishborn/_projects/_aionima --days 30
agi issue from-bash-log --project /home/wishborn/_projects/_aionima --dry-run    # preview candidates

# Slice 5: raw-tier auto-capture sink. Tools/agents record failures via
# recordRawCapture() (JSONL append-only at <project>/k/issues/raw.jsonl);
# operator triages the list + promotes interesting captures to curated.
agi issue raw list --project /home/wishborn/_projects/_aionima                   # list captures
agi issue raw promote r-abc123-001 --project /home/wishborn/_projects/_aionima   # promote one
agi issue raw clear --project /home/wishborn/_projects/_aionima                  # operator reset
```

**Dedup model.** Filing computes a `symptom_hash` from the normalized
symptom + tool + exit_code. If the hash matches an existing issue in
the project's `index.json`, the existing issue's `occurrences` is
incremented + an "Investigation log" entry appended. Otherwise a new
file is created with id `i-NNN`.

**Statuses.** `open` (default on creation) → `known` (acknowledged but
not yet fixed) → `fixed` (closed via `agi issue fix`). `wont-fix`
available for issues we explicitly accept.

**Where to file:** the project where the failure occurred. For
Aionima-system failures (Aion failing to ingest a model, gateway boot
issues, etc.) file against `_aionima`. Per-app failures file against
the app project.

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

List all hosted projects with their type, status, container running-state, hostname, and port. Supports two subcommands for per-project operations.

```bash
agi projects                       # list (default)
agi projects logs <slug> [opts]    # tail container logs
agi projects restart <slug>        # restart container via gateway API
```

#### `agi projects` (list)

Shows one row per project with these columns:

| Column | Meaning |
|---|---|
| Name | Display name from `project.json` (falls back to slug) |
| Type | `web-app` / `static-site` / `writing` / `api-service` / etc. |
| Status | `enabled` (hosting on) / `disabled` |
| Run | `up` (container running) / `down` (enabled but no container) / `-` (disabled or no hostname) |
| Hostname | `<hostname>.ai.on` (Caddy reverse-proxy target) |
| Port | Internal container port |

The Run column probes a single `podman ps` snapshot — at-a-glance check for which hosted projects are actually serving without dropping into raw podman.

#### `agi projects logs <slug>`

Tails the project'\\''s container logs via `podman logs`. The `<slug>` argument matches against the slug folder, the project'\\''s display name, or its hostname.

Options:

- `--tail N` — number of lines (default 50)
- `-f` / `--follow` — stream new lines (Ctrl+C to stop)

```bash
agi projects logs kronos-trader --tail 100
agi projects logs civicognita_web -f
```

#### `agi projects restart <slug>`

POSTs to the gateway'\\''s `/api/hosting/restart` endpoint to restart the project'\\''s container in place. Useful when a hosted project hangs or you'\\''ve deployed new code to it. Same matcher as `logs`. The gateway reports back with `ok: true` on success or a structured error if the restart fails.

```bash
agi projects restart kronos-trader
```

Symmetric with the dashboard'\\''s "Restart" action — same gateway endpoint, same effect; this is the CLI surface for the same operation.

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

### agi project-migrate

Run a project-folder migration script for a specific story-id. Each migration is idempotent; defaults to dry-run mode (read-only audit) so the report can be reviewed before any irreversible operation.

```bash
agi project-migrate s140 --dry-run    # audit current state vs target shape
agi project-migrate s140 --execute    # NOT YET implemented (will run the migration)
```

**Available migrations.**

- **s140** — Project folder restructure. Each non-sacred project moves to a flat top-level layout: `k/` (with `plans/`, `knowledge/`, `pm/`, `memory/`, `chat/` subfolders) + `repos/` + `sandbox/` (new) + a single `project.json` config at the project root holding both project- and per-repo configuration. Stacks attach to repos rather than to projects. Sacred projects (Aionima five + PAx four) are skipped.

The dry-run reports per-project: folder-shape diff, per-repo git state (clean/dirty/unpushed), current stack attachments to remap, and the sacred skip list.

---

### agi scan

Run a security scan against a project path (or any directory) through the gateway's `/api/security` HTTP API. Polls the scan to completion, renders findings grouped by severity, and exits with a CI-friendly code based on what was found.

```bash
agi scan /opt/agi                                 # default scanners, severity=high gate
agi scan /home/me/myproj --types=sast,secrets     # narrow scanner set
agi scan ~/.agi/plugins/cache/foo --severity=medium  # promote medium to gate
agi scan list                                     # recent scan runs
agi scan view <scanId>                            # full scan + findings detail
agi scan cancel <scanId>                          # abort an in-flight scan
```

**Scanners.** Default set is `sast,sca,secrets,config`. Implementations live under `packages/security/scanners/` — SAST checks for XSS, SQL injection, command injection, path traversal, SSRF, dynamic-code execution patterns, and prototype pollution; SCA matches dependency lockfiles against CVE advisories; Secrets detects API keys, tokens, and private keys; Config checks `.env` exposure, debug-mode leaks, Dockerfile root user, and missing lockfiles.

**Exit codes** (CI-friendly):

| Exit | Meaning |
|------|---------|
| 0 | Scan completed clean (no findings ≥ `--severity` threshold) |
| 1 | Medium/low findings only |
| 2 | High/critical findings (gate fail) |
| 3 | Scan failed or was cancelled |
| 4 | Invocation error — gateway unreachable, missing path, bad args |

**Severity threshold.** `--severity=high` (default) treats medium/low as warnings (exit 1) and high/critical as fail (exit 2). Set `--severity=medium` to gate on medium too. Available levels: `critical`, `high`, `medium`, `low`, `info`.

**Where the scan runs.** The gateway `ScanRunner` (`packages/security/scan-runner.ts`) executes locally inside the gateway process, persists results to the `agi_data` Postgres `scan_runs` + `security_findings` tables, and exposes them via the dashboard's Security pages and the `/api/security` REST surface. The CLI is a thin client over that API.

### agi bash

Run an arbitrary shell command through Aion's secure entryway. Every invocation logs a structured record to `~/.agi/logs/agi-bash-YYYY-MM-DD.jsonl` and is filtered by a configurable policy.

```bash
agi bash echo hello                  # tokenized form
agi bash 'ls -la /tmp'               # quoted form
agi bash -c 'ls -la | grep tmp'      # explicit -c (the -c is dropped before forwarding)
```

**Why this exists.** Aion is the single secure entryway to your system. Every shell exec — whether you're the human at the terminal, the chat agent acting on your behalf, Taskmaster running a queued job, or a cron-fired prompt — should flow through one logged surface. That produces (1) a complete audit trail, (2) one policy enforcement point, and (3) the substrate for future pattern mining (Aion observing how the system is used → crystallizing common patterns into Plugins and MApps).

**Caller attribution.** Set `AGI_CALLER` to identify the origin (defaults to `human`):

```bash
AGI_CALLER='chat-agent:abc123' agi bash 'echo from agent'
```

**Log record shape** (one JSON line per invocation):

| Field | Description |
|-------|-------------|
| `ts` | ISO 8601 UTC timestamp, millisecond precision |
| `caller` | `human` (default) or set via `AGI_CALLER` |
| `cwd` | Working directory at invocation time |
| `cmd_hash` | sha256(cmd) truncated to 12 hex chars — stable across repeats for clustering |
| `exit_code` | Inner command's exit code (or `126` when blocked by policy) |
| `duration_ms` | Wall-clock duration |
| `stdout_bytes` / `stderr_bytes` | Byte counts only — output content is never logged |
| `blocked` | `true` when policy rejected the command |
| `denial_reason` | Populated when `blocked: true` (matched pattern or path) |
| `audit_note` | Populated when an `allow_overrides` rule was used |

**Policy.** Configured at `~/.agi/gateway.json` under `bash.policy`. The default deny set is always active and protects production paths (`/opt/aionima`, `/opt/aionima-prime`, `/opt/aionima-id`) plus obvious destructive idioms (`rm -rf /`, `systemctl stop agi`, etc.). User config extends defaults:

```json
{
  "bash": {
    "policy": {
      "deny_patterns": ["my-additional-regex"],
      "allow_overrides": ["explicitly-permitted-pattern"]
    }
  }
}
```

`allow_overrides` are checked first — a matched override beats every deny pattern. The override path produces an `audit_note` in the log so reviewers can see when defaults were bypassed.

The policy is read from disk at every invocation — config changes take effect immediately, no restart needed.

**Current limitations:**

- Output is buffered to capture byte counts. Long-running / interactive commands like `tail -f` will appear to hang until they exit. A `--stream` mode that skips byte counts is a follow-up.
- ~~Caller migration (chat-agent runtime, Taskmaster shell-exec plugin, cron-prompt runner) lands in story **#105**.~~ **Shipped v0.4.150** — chat-agent shell tools (shell-exec.ts, agent-tools.ts disk probe) route through `agi bash` with `AGI_CALLER=chat-agent`. Taskmaster + cron-prompt run shell ops via the same `shell_exec` tool registry, so they inherit the routing.

---

## Routing protocol (harness side — story #108)

The `agi bash` subcommand is the **server-side** half of the routing rule: `agi bash <cmd>` produces a JSONL record with caller attribution and policy enforcement. The **client-side** half — making sure every shell exec the assistant issues uses that surface — is enforced by a Claude Code PreToolUse hook.

### Install

The hook + skill ship as templates inside this repo (`agi/scripts/claude-code-templates/`). Install them via:

```bash
agi setup-claude-hooks
```

The installer is **idempotent** — safe to re-run; it copies the hook + skill into `~/.claude/` and patches `~/.claude/settings.json` with a deduplicated PreToolUse Bash hook entry. Routing activates on the next Claude Code session start.

### How it works

1. **PreToolUse hook** at `~/.claude/hooks/agi-bash-router.sh` is wired in `~/.claude/settings.json` with `matcher: "Bash"`. It fires before every Bash tool call.

2. **Decision logic**:
   - Already-wrapped (`agi bash …`, `bash …agi-cli.sh bash`, `agi <subcmd>`): exit 0 with empty stdout, allow unchanged.
   - Empty command, or `AGI_ROUTER_BYPASS=1` env var set: exit 0, allow (bypass logged for audit).
   - Otherwise: emit a `hookSpecificOutput.updatedInput.command` payload that wraps the command as `agi bash '<cmd>'` and let Claude Code execute the rewritten form. The assistant's plain `Bash(...)` call runs as `agi bash '...'` with no friction — no re-issue, no block.

3. **Wrap form** is picked by probing the live binary — `agi bash '<cmd>'` when `/usr/local/bin/agi help` shows the `bash CMD` line, otherwise the dev-source `bash <path>/agi-cli.sh bash '<cmd>'`.

4. **Caller** is auto-set to `claude-code:<session-id>` when the assistant's call is auto-routed; explicit invocations via the `agibash` skill set it differently (e.g., `taskmaster:<job>`, `batch:<id>`).

### Rewrite payload format

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": { "command": "agi bash '<original-cmd>'" }
  }
}
```

The hook emits this on stdout for unwrapped commands, then exits 0. Claude Code substitutes `tool_input.command` and runs the rewritten form. The assistant sees only the result; no stderr nudge appears unless something else fails.

### Audit log

Every routing decision (allow / block / bypass) is appended to `~/.agi/logs/agi-bash-router.log` with a UTC ISO timestamp and a hashed command identifier. The log file is the substrate for understanding when wraps were skipped and whether the discipline holds.

### `agibash` skill

`~/.claude/skills/agibash/SKILL.md` is for **explicit control** when the auto-rewrite default isn't enough — Taskmaster jobs that need their own caller, batch sequences grouped under one logical audit unit, or pre-critical exec verification where the routing intent should appear on the page. The skill is **not** required for routine commands; the hook's transparent rewrite covers those.

### Bypass discipline

Setting `AGI_ROUTER_BYPASS=1` skips routing for that one Bash call. The bypass is **logged** in `~/.agi/logs/agi-bash-router.log` with the cmd_hash. Use it only when:

- The exec is structurally outside the entryway (the agi binary itself, the dev-source wrap, debugging the router).
- You've documented why in tynn (open a wish on s108 follow-ups).

A pattern of bypasses without documentation is the signal that the router needs a new carve-out — not that bypass is fine.

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
