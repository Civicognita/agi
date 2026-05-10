# agi doctor — diagnostic recipe

Walk-through for using the `agi doctor` family of commands when the
gateway is misbehaving. Order matters: each step narrows the failure
class before the next.

The interactive `agi doctor` TUI (s144 t574) is in flight; for now,
the subcommands below are individually invokable from the shell and
collectively cover the same diagnostic ground.

---

## When the gateway won't start

```bash
# 1. First — what does the service say?
agi status

# 2. Schema-validate every config the gateway reads at boot.
#    Catches the most common pre-boot failure (cycle 150 incident).
agi doctor schema
# Or for scripts/CI:
agi doctor schema --json

# 3. If schema is clean, look at the recent log tail for crash patterns.
agi doctor logs --lines 2000
```

Exit codes:
- `agi doctor schema` exits 1 if any file fails validation; output names
  the file + the dotted path of the bad field.
- `agi doctor logs` exits 1 if any known crash pattern matched; output
  groups matches by category (schema-error / port-conflict / segfault /
  unhandled-rejection / container-exit-nonzero / restart-loop / OOM).

## When something works "but feels wrong"

```bash
# 1. Run general infra health checks (Caddy, Podman, hosted projects, etc.)
agi doctor

# 2. Read a specific config key without firing the full editor
agi doctor config get hosting.enabled
agi doctor config get gateway.port
agi doctor config get workspace.projects

# 3. If a hosted project is flapping, identify which one
agi projects             # lists all hosted projects with status
agi projects logs <slug> # tails container logs
```

## When you need to share state with someone

```bash
# Diagnostic dump bundle — secrets-redacted, ready to share
agi doctor dump
# Path printed on stdout. Bundle includes:
#   - full diagnostic-check output
#   - sanitized gateway.json (password/apiKey/token/*Secret*/credential redacted)
#   - system info (OS / Node / podman / git / memory)
#   - recent log tails from ~/.agi/logs/ and /tmp/agi.log
#   - per-project type info from the workspace
```

**Review the bundle before sharing.** Log tails are NOT redacted; they
may contain sensitive runtime values that secrets-redaction won't catch.

## When you need to fix config without breaking things

```bash
# Single-key write with full Zod validation pre-write.
# The file on disk never enters an invalid state mid-edit.
agi doctor config set gateway.port 4100
agi doctor config set hosting.enabled true
agi doctor config set workspace.projects '["/srv/proj-a","/srv/proj-b"]'
```

`set` coerces values automatically (`"true"`/`"false"` → boolean,
integer strings → number, `"null"` → null, JSON literals are parsed,
anything else stays a string). Atomic write (temp + rename) means an
interrupted `set` can't corrupt the file.

## When the test VM is the diagnostic target

```bash
# Run the doctor suite inside the test VM
agi test-vm services-status

# Validate the test VM's mounted source against schema
agi test-vm services-version

# Re-mount fresh source if drift is suspected
agi test-vm remount
```

## Notes

- Subcommands are SAFE to run repeatedly — `doctor` is read-mostly;
  only `doctor config set` mutates disk. The atomic write makes even
  that recoverable from interruption.
- The TUI shell (s144 t574, multi-cycle) will eventually wrap these
  subcommands in an interactive menu. Until then, the subcommand surface
  is the recommended entry point.
- Every subcommand respects the `--json` flag where machine-readable
  output makes sense (schema, dump, config get).
