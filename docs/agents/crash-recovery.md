# Crash Recovery — Architecture

This doc is for agents extending the self-heal / safemode subsystem. For
user-facing behavior see [docs/human/crash-recovery.md](../human/crash-recovery.md).

## Components

| File | Role |
|---|---|
| `packages/gateway-core/src/boot-recovery.ts` | Marker read/write, reconcilers, recovery helpers |
| `packages/gateway-core/src/safemode-state.ts` | In-memory singleton + change events |
| `packages/gateway-core/src/safemode-investigator.ts` | Evidence collection + classification + report writer |
| `packages/gateway-core/src/local-model-runtime.ts` | Thin SmolLM2 wrapper (narrative generation) |
| `packages/gateway-core/src/admin-api.ts` | `/api/admin/safemode[,/exit]` and `/api/admin/incidents[,/:id]` |
| `packages/skills/src/skills/incident-investigation.skill.md` | Aion's prompt for the narrative section |
| `ui/dashboard/src/components/SafemodeCallout.tsx` | Red banner on Admin Dashboard |
| `ui/dashboard/src/components/IncidentsList.tsx` | Historical incidents list |
| `ui/dashboard/src/lib/safemode-guard.tsx` | Client-side redirect to `/admin` while safemode is active |

## Marker schema

`~/.agi/shutdown-state.json`:

```json
{
  "version": 1,
  "shutdownAt": "2026-04-13T19:04:00.000Z",
  "reason": "sigterm" | "sigint" | "restart" | "upgrade",
  "pid": 57055,
  "externals": {
    "idPostgresContainer": "aionima-id-postgres",
    "idService": "aionima-id.service"
  },
  "projects": [{ "slug": "...", "containerName": "..." }],
  "models":   [{ "modelId": "...", "containerName": "..." }]
}
```

**Write:** Step −1 of `server.close()` in `server.ts`, BEFORE any subsystem
tears down its state. Uses `hostingManager.snapshotRunning()` and
`modelContainerManager.snapshotRunning()`.

**Read/consume:** Step 1b2 of `startGatewayServer()`, AFTER logger init and
BEFORE anything else. `readAndConsumeShutdownMarker()` deletes the file
even on parse failure — a corrupt marker on disk could otherwise mask a
real crash on the next boot.

## Boot state machine

```
logger init
  │
  ▼
readAndConsumeShutdownMarker()
  ├── marker exists  → ensureExternals()
  │                    reconcileProjects(marker.projects)
  │                    reconcileModels(marker.models)
  │                    isSafemodeBoot=false
  │
  └── marker missing → ensureExternals()
                       safemodeState.enter("crash_detected")
                       isSafemodeBoot=true
  │
  ▼
... rest of boot ...
  │
  ▼
if isSafemodeBoot:
  void runInvestigator(log, { localModel, notificationStore })
```

## Reconcilers

All reconcilers are **no-throw**: they log failures and return a structured
report. Boot must continue even when externals are unreachable.

- `reconcileExternals(marker, log)` — start postgres container + id service,
  wait up to 15s for port 5433.
- `reconcileProjects(list, log)` — `podman start` each listed container that
  isn't currently running.
- `reconcileModels(list, log)` — same, for model containers.
- `recoverAllManagedContainers(log)` — used by the admin "Recover now"
  endpoint when no marker exists (post-crash). Discovers containers via
  `podman ps --filter label=aionima.managed=true` and the
  `model-containers.json` heartbeat file.

## Adding a new classification

`safemode-investigator.ts` uses heuristic regex matches against collected
evidence. To add a new class:

1. Add to the `Classification` union type.
2. Add a branch to `classifyIncident()` with:
   - A regex matched against the evidence sections most likely to show the
     symptom.
   - `confidence` (high/medium/low).
   - `summary` (one sentence).
   - `autoRecoverable` (can the standard "Recover now" flow fix it?).
   - `recommendedActions` array.
3. If the new class needs new evidence (e.g. a different command), add a
   collector to `collectEvidence()` and include it in the report template.
4. Regenerate the local model's fine-tuning dataset (future) with the new
   class examples.

## Middleware

Mutation block lives in `server-runtime-state.ts` as an `onRequest` hook
that runs **after** auth. Allow-list:
- Any `GET`, `HEAD`, `OPTIONS`
- `/api/admin/*` (all methods)
- `/health`, `/api/health`

Everything else returns `503 safemode_active` with the full snapshot
attached, so the dashboard can render a useful error state.

## Extension points

- **More externals:** Add to the `externals` stanza in `ShutdownMarker`
  and extend `reconcileExternalsByName()`. Pattern: one check per
  dep, each with its own start command and readiness probe.
- **New `agi` CLI subcommands:** Each hits the admin API over loopback;
  no new auth needed.
- **Fine-tuned incident model:** Swap `ops.localModel.modelId` in
  `gateway.json` once a LoRA adapter is merged. `LocalModelRuntime` doesn't
  care which model backs it as long as the HF container exposes
  `/v1/chat/completions`.

## Testing

- `test/unit/boot-recovery.test.ts` covers marker read/write, reconciler
  decisions, and classification.
- `test/integration/safemode.test.ts` kills `-9` the gateway, restarts,
  asserts safemode is active, report exists, and exit-safemode clears it.
- `test/integration/clean-restart.test.ts` restarts gracefully and asserts
  safemode never activates and previously-running containers come back.

All tests run inside the Multipass Dev VM — a host guard in
`vitest.config.ts` blocks host-level runs.
