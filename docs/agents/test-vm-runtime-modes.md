# Test-VM runtime modes — catalog + test-mode contract

**Status:** s123 audit, 2026-04-27. Owner-clarified that the test VM does several things that look "production-shaped" but are leaking from production into the test context. This document catalogs what the test VM does, categorizes each behavior as **needed-for-testing** or **production-leaking**, and specifies the migration path for the leaking ones (gate behind `runtimeMode === "test-vm"` per s122).

---

## Runtime modes

Three modes inferred at gateway boot (see `/api/system/runtime-mode`):

| Mode | Trigger | Meaning |
|------|---------|---------|
| `production` | default | The owner's actual gateway. All features available. |
| `test-vm` | `AIONIMA_TEST_VM=1` env or `hostname` matches `^agi-test\b` | Running inside the multipass test VM. Features that recurse or are destructive in this context are hidden/stubbed. |
| `dev` | `NODE_ENV=development` | Host-side dev gateway. All features available; no special hiding. |

Override: `AIONIMA_RUNTIME_MODE` env wins over auto-detection.

---

## Test VM behavior catalog

### A. Mount + source layout (TESTING — keep)

| Behavior | Source | Verdict |
|----------|--------|---------|
| Mount host's `~/_projects/_aionima/agi` → `/mnt/agi` | `test-vm.sh` `services-setup` | TESTING — live source mount enables iterating without rebuild |
| Mount host's `_projects/_aionima/prime` → `/mnt/agi-prime` | `test-vm.sh` | TESTING |
| Mount host's `_projects/_aionima/id` → `/mnt/agi-local-id` | `test-vm.sh` | TESTING |

### B. Build + run (MIXED)

| Behavior | Source | Verdict |
|----------|--------|---------|
| Run `pnpm build` for db-schema + dashboard + tsdown during services-start | `test-vm.sh` services-start | TESTING — VM needs a fresh build matching the mounted source |
| Run `pnpm install` on first services-setup | `test-vm.sh` | TESTING |
| Build ID service (`npm run build` in agi-local-id) | `test-vm.sh` | TESTING |
| HostingManager initialize (load projects + start containers) | gateway boot | **PRODUCTION-LEAKING** — test VM has no real hosted projects to manage. Already gated via `hosting.enabled=false` in test VM gateway.json (v0.4.245 added `regenerateCaddyfile` enabled-guard). |
| Caddy systemd service running | `test-vm.sh` services-setup | TESTING — needed to serve test.ai.on dashboard |

### C. Project hosting (PRODUCTION-LEAKING — gate behind runtimeMode)

| Behavior | Source | Verdict |
|----------|--------|---------|
| Auto-fetch project tiles for sample-* fixtures | services-start seed | TESTING — fixtures need tiles to drive Playwright |
| `agi marketplace install` runs from inside VM | gateway boot | **PRODUCTION-LEAKING** — VM should not auto-install marketplace plugins at boot; surfaces a confusing "60 / 11 installed" line. Migration: add a runtimeMode-gate around marketplace auto-install in services-start. |
| Upgrade pipeline auto-pulls + restarts gateway | gateway upgrade | **PRODUCTION-LEAKING** — VM mounts dev source; upgrade is meaningless. Migration: hide upgrade button in dashboard when `runtimeMode === "test-vm"` (covered by s122 t463). |
| Contributing-mode toggle visible | gateway config | **PRODUCTION-LEAKING** — fixed in s122 (project-detail + projects routes force-disable when test-vm). |
| Aionima-collection sacred-project tiles | gateway config | **PRODUCTION-LEAKING** — fixed in s122 (force-hidden via contributing flag) + s119 (consolidated view also hidden in test-vm). |

### D. Recursive operations (PRODUCTION-LEAKING — disable)

| Behavior | Source | Verdict |
|----------|--------|---------|
| Spawning another test VM from inside the VM dashboard | nested `agi test-vm create` | **DISABLED** — must not be reachable. Migration: hide test-vm spawn buttons + confirm CLI itself errors if invoked from inside an agi-test VM. |
| Running `agi upgrade` from inside the VM | gateway upgrade | **DISABLED** — same as upgrade-pipeline above. |
| Running `agi marketplace publish` from inside the VM | gateway marketplace | **DISABLED** — VM is consumer-only for marketplace work. |

---

## Test-mode contract

A feature is **test-mode-safe** when:

1. It does not invoke nested test-VM operations (`agi test-vm`, `agi-test-vm` direct).
2. It does not write to the production source the VM mounts (host's `~/_projects/_aionima/`).
3. It does not invoke the upgrade pipeline.
4. It is reachable from the test-vm dashboard for verification purposes.

A feature that fails any of (1)-(3) must be **gated behind `runtimeMode !== "test-vm"`**.

Pattern: `import { useIsTestVm } from "@/hooks/useRuntimeMode.js"`, then `if (isTestVm) return null;` on the offending render block, OR force-disable the underlying flag (e.g. contributing-mode in s122).

For backend: `process.env["AIONIMA_TEST_VM"] === "1"` is the equivalent gate inside server code paths, when the dashboard layer can't fully cover the surface.

---

## Cross-refs

- `feedback_test_mode_awareness` memory — runtime-mode flag rationale
- `feedback_no_local_tests` memory — VM is the testing surface
- `s122` (VIP) — runtime-mode keystone implementation
- `s119` (VIP) — Aionima consolidated view (gates on test-vm)
- `s121` (VIP) — testingUxEligible flag
- `agi/scripts/test-vm.sh` — VM provisioning + services lifecycle
- `agi/packages/gateway-core/src/hosting-manager.ts` — `regenerateCaddyfile` guard (v0.4.245)
