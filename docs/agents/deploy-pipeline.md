# Deploy Pipeline: deploy.sh, Upgrade Flow

This document is a complete walkthrough of the Aionima deployment pipeline for AI agents modifying the deploy system.

## Overview

Deployment is triggered through the dashboard. Never run `scripts/deploy.sh` manually unless the dashboard is unavailable.

```
Developer pushes to `main`
         |
Dashboard polls /api/system/update-check every 60s
         |
User clicks "Upgrade" in the dashboard
         |
POST /api/system/upgrade
         |
scripts/deploy.sh runs as a child process
         |
Structured JSON logs streamed via WebSocket to dashboard
         |
Service restarts (if backend changed)
```

## Multi-Repo Architecture

Four independent git repos are pulled during deployment:

| Repo | Production Path | Config Key | Env Override |
|------|----------------|------------|--------------|
| AGI | `/opt/aionima` | (implicit -- always cwd) | -- |
| PRIME | `/opt/aionima-prime` | `prime.dir` | `AIONIMA_PRIME_DIR` |
| MARKETPLACE | `/opt/aionima-marketplace` | `marketplace.dir` | `AIONIMA_MARKETPLACE_DIR` |
| ID | `/opt/aionima-id` | `idService.dir` | `AIONIMA_ID_DIR` |

PRIME, MARKETPLACE, and ID are optional — if their directory doesn't exist, the pull phase is skipped silently.

## The deploy.sh Script

Location: `scripts/deploy.sh`

The script emits structured JSON to stdout for each phase:

```json
{"phase":"pull-agi","status":"start"}
{"phase":"pull-agi","status":"done","details":"AGI repo updated"}
```

### Phases

| Phase | What it does | Fatal? |
|-------|-------------|--------|
| `pull-agi` | `git pull --ff-only` in `/opt/aionima` | Yes |
| `pull-prime` | `git pull --ff-only` in PRIME dir | No (degraded mode) |
| `pull-marketplace` | `git pull --ff-only` in MARKETPLACE dir | No (plugins still cached) |
| `pull-id` | `git pull --ff-only` in ID dir | No (degraded mode) |
| `build-id` | `npm install && npm run build` in ID dir (if local ID enabled) | No |
| `protocol-check` | Verify `protocol.json` exists in deployed repos | No (warn) |
| `install` | `pnpm install --frozen-lockfile` | Yes |
| `build` | `pnpm build` | Yes |
| `build-marketplace` | Bundle marketplace plugins + symlink `node_modules` | No |
| `build-screensaver` | Build screensaver app if present | No |
| `systemd` | Update systemd unit if changed | Yes |
| `restart` | `sudo systemctl restart aionima` (if backend changed) | Yes |
| `complete` | Final status | -- |

#### ID Service Build

When `idService.local.enabled` is `true` in `~/.agi/aionima.json`, deploy.sh builds the ID service:

1. `npm install` — installs **all** dependencies (not `--omit=dev`) because `tsc` is a devDependency
2. `npm run build` — compiles TypeScript to `dist/`
3. `npx drizzle-kit migrate` — runs database migrations (non-fatal)
4. `sudo systemctl restart aionima-id` — restarts the service if running

**Important:** The ID service's HTML view templates live in `src/views/` and are resolved at runtime from `process.cwd()`, not from `dist/`. This is because `tsc` only compiles `.ts` files — it does not copy `.html` files. The systemd unit sets `WorkingDirectory=/opt/aionima-id`, so `process.cwd()` always points to the project root.

#### Marketplace Plugin Symlink

After building marketplace plugins, deploy.sh creates a symlink:

```bash
ln -sfn /opt/aionima/node_modules /opt/aionima-marketplace/node_modules
```

This allows bundled plugins (which mark packages like `better-sqlite3` as `external`) to resolve those dependencies from AGI's `node_modules/`. Without this, Node.js fails to resolve bare specifiers from the marketplace plugin location.

### Backend Checksum Detection

```bash
BACKEND_DIRS=(
  "cli/dist"
  "packages/gateway-core/dist"
  "channels/telegram/dist"
  "channels/discord/dist"
  "channels/gmail/dist"
)
```

Checksums are computed before and after build. Plugin `src/` directories are also checksummed. If no change, the service is not restarted (frontend-only update).

## Protocol Versioning

Each repo has a `protocol.json`:

**AGI** (`protocol.json`):
```json
{
  "name": "aionima-agi",
  "version": "0.5.0",
  "protocol": "1.0.0",
  "requires": {
    "aionima-prime": ">=1.0.0"
  }
}
```

**PRIME** (`protocol.json`):
```json
{
  "name": "aionima-prime",
  "version": "1.0.0",
  "protocol": "1.0.0"
}
```

**ID** (`protocol.json`):
```json
{
  "name": "aionima-id",
  "version": "1.0.0",
  "protocol": "1.0.0"
}
```

At boot, `packages/gateway-core/src/protocol-check.ts` reads all deployed repos and does semver range checking. Incompatible versions result in degraded mode warnings, not hard failures.

**Missing repos are silently skipped.** The protocol checker only reports a missing `protocol.json` as an error when the repo's directory actually exists on disk. If the directory doesn't exist (repo not deployed), it's skipped — this prevents noisy false errors for optional repos like PRIME and ID.

## Dashboard Upgrade Trigger

The upgrade endpoint in `packages/gateway-core/src/server-runtime-state.ts` spawns deploy.sh and parses JSON logs:

```ts
// Phase mapping for structured JSON logs
const phaseToUiPhase: Record<string, string> = {
  "pull-agi": "pulling",
  "pull-prime": "pulling",
  "pull-bots": "pulling",
  "pull-marketplace": "pulling",
  "pull-id": "pulling",
  "build-id": "building",
  "protocol-check": "pulling",
  "install": "building",
  "build": "building",
  "build-marketplace": "building",
  "build-screensaver": "building",
  "systemd": "restarting",
  "restart": "restarting",
  "restart-id": "restarting",
  "complete": "complete",
};
```

Non-JSON lines (raw git/pnpm output) are passed through as plain text.

## Path Resolution

`packages/gateway-core/src/resolve-paths.ts` provides:

- `resolvePrimeDir(config)` -- returns `dev.primeDir` when `dev.enabled`, else `prime.dir`

Taskmaster job state is stored in `.ai/jobs/` within the workspace root. Workers write handoff files to `.ai/handoff/`.

## Files to Modify

| File | Change |
|------|--------|
| `scripts/deploy.sh` | Add new phases, modify pull targets, adjust checksums |
| `packages/gateway-core/src/server-runtime-state.ts` | Update `phaseToUiPhase` if new deploy phases are added |
| `packages/gateway-core/src/protocol-check.ts` | Modify compatibility checking logic |
| `packages/gateway-core/src/resolve-paths.ts` | Add new repo path resolution |
| `config/src/schema.ts` | Add new dir/source/branch fields for additional repos |
| `protocol.json` (in each repo) | Bump version numbers when protocol changes |

## Verification Checklist

After modifying deploy.sh or the deploy pipeline:

- [ ] `bash -n scripts/deploy.sh` -- syntax check passes
- [ ] New phases emit JSON: `{"phase":"...","status":"start|done|error"}`
- [ ] `pnpm build` completes without errors
- [ ] Test full deploy: push to `main`, click Upgrade in dashboard
- [ ] Progress phases display correctly in dashboard
- [ ] Backend changes trigger a service restart
- [ ] Frontend-only changes do not restart the service
- [ ] `.deployed-commit` file is updated after deploy
- [ ] Protocol check runs at boot without errors
