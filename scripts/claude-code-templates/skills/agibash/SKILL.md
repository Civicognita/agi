---
name: agibash
description: Use this skill when you want to deliberately invoke `agi bash` semantics for a shell exec — typically when (a) you need explicit caller attribution (e.g. AGI_CALLER=taskmaster:<job>, batch-script:<id>) different from the default `claude-code:<session>`, (b) you're scripting a sequence of shell commands as one logical unit, or (c) you want to confirm the routing path is active before a critical exec. For ordinary one-off shell calls, the PreToolUse hook (~/.claude/hooks/agi-bash-router.sh) auto-wraps every Bash tool call — use this skill when you want explicit control over the routing.
allowed-tools: Bash
---

# agibash — explicit shell routing through Aion's secure entryway

The Aionima rule (story #104, #105, #108) is: **every shell exec flows through `agi bash`** so the invocation lands in the JSONL log surface at `~/.agi/logs/agi-bash-YYYY-MM-DD.jsonl` with caller attribution and is filtered by the hot-reloadable `bash.policy` in `~/.agi/gateway.json`.

Two surfaces for this rule:

1. **PreToolUse hook** (`~/.claude/hooks/agi-bash-router.sh`) — fires on every Bash tool call. Already-wrapped commands (`agi bash …`, `agi <subcmd>`, dev-script bash) pass through; unwrapped commands are blocked with a structured nudge that lists the rewrite. Default caller: `claude-code:<session-id>`. Bypass: `AGI_ROUTER_BYPASS=1` env var (logged for audit).

2. **This skill** — explicit invocation when you need a non-default caller, want to script a batch, or are running an exec where the routing path matters more than ergonomics.

## When to use this skill

Trigger this skill (and forward to a Bash call) when:

- You're acting on behalf of a Taskmaster job and want `AGI_CALLER=taskmaster:<job-id>` so the audit trail attributes the exec to the right work item.
- You're scripting a batch of related commands and want them grouped under a single caller for clustering in the log substrate.
- You need to verify the routing path is active before a critical operation (e.g., before an upgrade) — the skill makes the wrap explicit so a reader of your turn sees the routing.

For everything else (ad-hoc `ls`, `git status`, file reads, etc.), let the PreToolUse hook do its job — invoking this skill on routine commands is unnecessary ceremony.

## How to invoke

Forward the Bash call wrapped through `agi bash`, with `AGI_CALLER` set to your chosen identifier. Pattern:

```bash
AGI_CALLER='taskmaster:42' agi bash '<your shell command>'
```

Or for a sequence — chain with `&&` inside the wrap:

```bash
AGI_CALLER='taskmaster:42' agi bash 'cd /tmp && grep -r foo bar/'
```

The single-quote wrap escapes inner shell metachars; for commands with literal single quotes, use the `bash -c` form:

```bash
AGI_CALLER='taskmaster:42' agi bash -c "echo \"can't escape easily\""
```

## Collision protocol

If `agi bash` returns a non-zero exit, two cases matter:

- **Exit 126 + stderr "blocked by policy"**: the bash.policy in `~/.agi/gateway.json` rejected the command. The denial reason is in the stderr line. Choose: (a) re-issue with `allow_overrides` updated in gateway.json (and document the override in tynn — it's a policy widening), or (b) accept the block and route through the agi CLI subcommand that legitimately performs the operation.

- **Exit 1/127 + stderr "Unknown command"**: the deployed agi binary at `/usr/local/bin/agi` doesn't yet expose `bash`. This is a deploy-state issue — the live binary predates v0.4.149. Fall back to the dev-source wrap:

  ```bash
  bash /home/wishborn/temp_core/agi/scripts/agi-cli.sh bash '<your shell command>'
  ```

  Then **document the deploy gap in tynn** (open an iwish on s108 follow-ups) so the upgrade path closes the gap.

## Caller attribution patterns

| Caller value | Use when |
|---|---|
| `human` | (default if unset) the human at the terminal is driving |
| `claude-code:<session-id>` | (auto-set by the router hook) the assistant ran an unwrapped Bash that the hook routed |
| `chat-agent` / `chat-agent:<session>` | (set by gateway-side migration, s105) Aion's chat agent runtime invoking shell_exec |
| `taskmaster:<job-id>` | a Taskmaster phase that included a shell step |
| `cron-prompt:<cron-id>` | a scheduled-task plugin handler that ran shell |
| `batch:<descriptor>` | a script grouping related commands under one logical unit |

The `caller` field is restricted to `[a-zA-Z0-9_:.-]+`; malformed values are stored as `invalid` to prevent JSON-injection attempts.

## Cross-references

- `~/temp_core/CLAUDE.md` § 3 — Blocker Protocol (the rule's source)
- `agi/docs/human/cli.md` § agi bash — surface reference
- tynn story #108 — the routing harness mechanism this skill is part of
- tynn story #104 — the gateway-side `agi bash` subcommand this skill calls into
- tynn story #105 — the gateway-side caller migration that proves the routing pattern in production code
