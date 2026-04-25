---
name: agibash
description: The canonical bash surface for this workspace. Every shell exec the assistant runs flows through `agi bash` so the invocation lands in the JSONL log substrate at `~/.agi/logs/agi-bash-YYYY-MM-DD.jsonl` with caller attribution and is gated by the hot-reloadable `bash.policy` in `~/.agi/gateway.json`. The PreToolUse hook (`~/.claude/hooks/agi-bash-router.sh`) transparently rewrites every plain Bash tool call to `agi bash '<cmd>'` — no manual wrapping, no friction. Invoke this skill *explicitly* when you want to override the default caller (e.g. `AGI_CALLER=taskmaster:<job>`), batch a sequence under one logical audit unit, or verify the routing path before a critical operation.
allowed-tools: Bash
---

# agibash — the canonical shell surface for Aionima

The Aionima rule (story #104, #105, #108) is: **every shell exec flows through `agi bash`** so the invocation lands in the JSONL log surface at `~/.agi/logs/agi-bash-YYYY-MM-DD.jsonl` with caller attribution and is filtered by the hot-reloadable `bash.policy` in `~/.agi/gateway.json`.

`agi bash` IS the bash replacement in this workspace. There is no parallel "raw bash" path you should be reaching for.

## The two surfaces

1. **PreToolUse hook** (`~/.claude/hooks/agi-bash-router.sh`) — fires on every Bash tool call and **transparently rewrites** the command to `agi bash '<cmd>'` via the hook's `hookSpecificOutput.updatedInput.command` payload. Already-wrapped commands (`agi bash …`, dev-source wrap, `agi <subcmd>`) pass through unchanged. Default caller: `claude-code:<session-id>`. Bypass: `AGI_ROUTER_BYPASS=1` (logged for audit). **You don't need to do anything to get routing — just call `Bash(...)` and the hook handles the wrap.**

2. **This skill** — invoke it explicitly when you want **non-default behavior**: a different `AGI_CALLER`, a batch under one logical audit unit, or a pre-critical-exec verification that the routing path is active. Otherwise, plain `Bash(...)` is fine — the hook does the routing for you.

## When to invoke this skill

Trigger this skill (and forward to a Bash call with the explicit wrap) when:

- You're acting on behalf of a Taskmaster job and want `AGI_CALLER=taskmaster:<job-id>` so the audit trail attributes the exec to the right work item.
- You're scripting a batch of related commands and want them grouped under a single caller (`AGI_CALLER=batch:<descriptor>`) for clustering in the log substrate.
- You need to verify the routing is active before a critical operation (e.g., before an upgrade, before a destructive `rm`) — making the wrap explicit puts the routing on the page where a reader can see it.

For ordinary one-off calls (`ls`, `git status`, `grep`, file probes), let the hook do its job. Manually invoking this skill on routine commands is unnecessary ceremony — but it's never wrong.

## How to invoke

The wrapped form, with optional `AGI_CALLER` set to your chosen identifier:

```bash
AGI_CALLER='taskmaster:42' agi bash '<your shell command>'
```

For a sequence — chain with `&&` inside the wrap:

```bash
AGI_CALLER='taskmaster:42' agi bash 'cd /tmp && grep -r foo bar/'
```

For commands with literal single quotes, use the `bash -c` form:

```bash
AGI_CALLER='taskmaster:42' agi bash -c "echo \"can't escape easily\""
```

## Caller attribution patterns

| Caller value | Use when |
|---|---|
| `human` | (default if unset) the human at the terminal is driving |
| `claude-code:<session-id>` | (auto-set by the router hook on transparent rewrites) the assistant ran a plain `Bash(...)` that the hook routed |
| `chat-agent` / `chat-agent:<session>` | (set by gateway-side migration, s105) Aion's chat agent runtime invoking shell_exec |
| `taskmaster:<job-id>` | a Taskmaster phase that included a shell step |
| `cron-prompt:<cron-id>` | a scheduled-task plugin handler that ran shell |
| `batch:<descriptor>` | a script grouping related commands under one logical unit |

The `caller` field is restricted to `[a-zA-Z0-9_:.-]+`; malformed values are stored as `invalid` to prevent JSON-injection attempts.

## Collision protocol

If `agi bash` returns a non-zero exit, two cases matter:

- **Exit 126 + stderr "blocked by policy"**: the bash.policy in `~/.agi/gateway.json` rejected the command. The denial reason is in the stderr line. Choose: (a) re-issue with `allow_overrides` updated in gateway.json (and document the override in tynn — it's a policy widening), or (b) accept the block and route through the agi CLI subcommand that legitimately performs the operation.

- **Exit 1/127 + stderr "Unknown command"**: the deployed agi binary at `/usr/local/bin/agi` doesn't yet expose `bash`. This is a deploy-state issue — the live binary predates v0.4.149. Fall back to the dev-source wrap (which the hook also recognizes as already-wrapped):

  ```bash
  bash /home/wishborn/temp_core/agi/scripts/agi-cli.sh bash '<your shell command>'
  ```

  Then **document the deploy gap in tynn** (open an iwish on s108 follow-ups) so the upgrade path closes the gap.

## Cross-references

- `~/temp_core/CLAUDE.md` § 3 — Blocker Protocol (the rule's source)
- `agi/docs/human/cli.md` § agi bash — surface reference
- tynn story #108 — the routing harness mechanism this skill is part of
- tynn story #104 — the gateway-side `agi bash` subcommand this skill calls into
- tynn story #105 — the gateway-side caller migration that proves the routing pattern in production code
