# Testing

Aionima uses a VM-based testing strategy. All tests run inside a Multipass Ubuntu VM — never directly on the host. This prevents crashes and ensures tests run against a clean, reproducible environment.

---

## Host Safety Guard

A guard in `vitest.config.ts` throws an error if the `AIONIMA_TEST_VM` environment variable is not set. This prevents accidentally running vitest on the host machine, which can crash the server.

Running `pnpm test` from the host automatically routes through the VM via `scripts/test-vm-run.sh unit` — you never need to set `AIONIMA_TEST_VM` manually during local development.

---

## VM Lifecycle

Before running tests, the VM must be created and set up:

```bash
pnpm test:vm:create    # Create an Ubuntu 24.04 VM with all workspace repos mounted
pnpm test:vm:setup     # Install Node 22 + pnpm inside the VM, run pnpm install
```

Once set up, the VM persists between test runs. To tear it down:

```bash
pnpm test:vm:destroy   # Destroy the VM completely
```

To SSH into the VM for debugging:

```bash
pnpm test:vm:ssh       # Open a shell inside the VM
```

### Multi-Repo Mounts

The VM mounts all workspace repos so tests can access the full system:

| Host Path | VM Mount | Purpose |
|-----------|----------|---------|
| AGI repo | `/mnt/agi` | Core monorepo |
| PRIME repo | `/mnt/aionima-prime` | Knowledge corpus |
| ID repo | `/mnt/agi-local-id` | Identity service |

A test config fixture at `test/fixtures/gateway-test.json` points to these VM mount paths so tests resolve repos correctly.

If mounts become stale (e.g., after a host reboot), the VM scripts detect and re-mount automatically.

### Marketplace seeder — `installed: <plugins> / <mapps>`

When `agi test-vm services-start` runs, the seeder pulls Plugin
Marketplace and MApp Marketplace catalogs and reports a count line:

```
==> Seeding official MApps from marketplace...
    installed: 60 / 11
```

That count reflects what was available **at the time the test VM
seeder snapshot was published**. The seeder fetches from the
upstream `Civicognita/main` HEAD of each marketplace repo, **not**
from the dev forks where day-to-day work lives (`wishborn/dev` for
agents working in this workspace).

#### qa → DONE merge dependency

This shapes the `qa → DONE` pathway for any task that ships a
catalog entry:

1. Agent ships to `wishborn/agi-marketplace:dev` or
   `wishborn/agi-mapp-marketplace:dev` and walks the tynn task to
   `qa` with the verification plan.
2. The qa-batch surfaces in test VM only after a cross-repo PR
   merges `wishborn/<repo>:dev → Civicognita/<repo>:main`. That
   merge is **owner-only** per the
   `feedback_never_push_upstream` rule.
3. Once merged, the next `services-start` (or full
   `test-vm setup`) reseeds the marketplace catalogs and the new
   entries become installable.
4. Owner verifies per the test plan and walks tasks to `done` /
   `finished` in tynn.

> **Owner upgrade isn't just verification — it's also the merge
> mechanism.** The autonomous loop can drive catalog ships to
> `qa` but cannot drive them to `done` because the merge step is
> owner-only by policy.

This is structural, not a loop-discipline failure. Tasks that
land catalog content correctly belong in qa with explicit owner
test plans (per `feedback_qa_filing_must_include_test_plan_for_owner`)
until the merge step happens.

---

## Test Tiers

### 1. Unit Tests (Vitest)

Unit tests verify individual functions, stores, and business logic in isolation.

```bash
agi test <pattern>     # Run unit tests matching <pattern> (routed through VM)
agi test               # Run the full unit suite
```

Under the hood, this executes `scripts/agi-test.sh` which runs vitest inside the VM with `AIONIMA_TEST_VM=1` set. (The legacy `pnpm test` shorthand still works and routes to the same script.)

#### Database fixture (story #106 — schema-per-test against real Postgres)

Tests that touch the database connect to the **test VM's real Postgres** (`agi_data`, owned by `agi` role). Each call to `createTestDb()` from `packages/gateway-core/src/test-utils/db-fixture.ts` allocates a fresh `test_<random>` schema, runs the dashboard-subset DDL into it, and returns a drizzle `NodePgDatabase` with `search_path` pinned to that schema. `close()` drops the schema; `reset()` truncates fixture tables between tests.

**Connection URL** resolves in order:

1. `AGI_TEST_DATABASE_URL` env (test override)
2. `DATABASE_URL` env (matches the production resolution path)
3. Default: `postgres://agi:aionima@localhost:5432/agi_data` — the test VM's Postgres

**Important: the test VM must be running for DB-touching tests.** `RUN_LOCAL=1` no longer applies to fixtures that talk to Postgres. If the VM is down, `createTestDbConnection()` raises a clear error directing you to run `agi test-vm services-status`.

**The test runner auto-restarts services on version drift.** `agi test`'s preflight (in `scripts/test-run.sh`) compares the VM-running AGI version (from `https://ai.on/health`) against host `package.json` and, if they differ, runs `agi test-vm services-restart` and waits up to 30s for `/health` to come back ONLINE before running the test. The VM mounts the host repo as live source (`/mnt/agi`), so a service restart is enough to pick up everything on dev — you never need to manually rebuild or recreate the VM to test the active codebase.

Manual escape hatches if you need them outside a test run:

```bash
agi test-vm services-status     # Confirm Postgres: active
agi test-vm services-start      # If anything is stopped
agi test-vm services-version    # Compare VM-running AGI vs host source — exit 2 when stale
agi test-vm services-restart    # Pick up host source changes without recreating the VM
```

`services-version` exits with code `2` and a stale-warning so external CI can fail-fast if it ever runs Playwright outside the auto-restart preflight path.

Per-test overhead is ~50–200ms (schema create + DDL); a full dashboard run finishes in under 10s.

This replaces an earlier in-process `@electric-sql/pglite` fixture that introduced a second Postgres-compatible engine — the project's single-source-of-truth principle (memory `feedback_single_source_of_truth_db`) now holds end-to-end. The hand-written `SCHEMA_DDL` constant in `db-fixture.ts` is a deliberate mirror of the drizzle table objects in `@agi/db-schema`; replacing it with the real production migration path is a follow-up.

### 2. System End-to-End Tests

System e2e tests spin up a fresh install inside the VM and validate the full stack — install scripts, API endpoints, onboarding flow, and plugin installs.

```bash
pnpm test:e2e          # Run all system e2e tests
```

Four test suites run in sequence:

1. **Install test** — runs `install.sh` on a blank VM, verifies Node.js, pnpm, deploy directory, systemd service, `.env` skeleton, and health endpoint.
2. **API tests** — curl-based tests against every core endpoint (health, onboarding, system stats, dashboard).
3. **Onboarding flow** — walks the full onboarding state machine: AI keys, owner profile, channel config, reset.
4. **Plugin install tests** — verifies plugin `installedCheck` commands, installs a test service, confirms it works.

### 3. UI End-to-End Tests (Playwright)

Playwright tests run a real browser on the host against the gateway running inside the VM. Three modes — pick by intent:

```bash
agi test --e2e <pattern>            # Headless (default for owner-watch + CI)
agi test --e2e-ui <pattern>         # Interactive Playwright UI runner — driven by hand
agi test --e2e-headed <pattern>     # Visible auto-running tests, no UI shell
```

When to use which:
- **`--e2e`** (headless): the right default. Faster, doesn't disrupt the desktop, same DOM extraction. Use for CI + most owner-driven runs.
- **`--e2e-ui`** (interactive): the Playwright UI runner — a browser-based test runner with watch mode, run controls, traces, and debugging. Use when you want to drive the tests by hand or pause/inspect mid-run.
- **`--e2e-headed`** (visible auto-run): like `--e2e` but the browser window is visible. Use when the goal is "watch the test execute" without needing the UI shell. Slower than headless; useful for owner-attended live verification of a single spec.

Pattern arg matches against spec filename (case-insensitive substring); omit to run all specs.

#### Dev-side spec discovery — `AGI_TEST_DEV_REPO_DIR`

`agi test --e2e <pattern>` resolves specs against `/opt/agi/` by default (where `agi-cli.sh` lives). During /loop sessions where the dev tree at `~/temp_core/agi/` runs ahead of `/opt/agi/` between owner-triggered upgrades, brand-new specs added on dev source are invisible to the wrapper.

Set `AGI_TEST_DEV_REPO_DIR` to point at the dev tree to make `find e2e -iname …` resolve from there:

```bash
AGI_TEST_DEV_REPO_DIR=$HOME/temp_core/agi agi test --e2e walk/my-new-spec
```

The wrapper validates the path (must be a directory + contain `package.json`); falls back to the default if invalid. The test VM mounts dev source live, so the runtime target already matches dev — only the spec-discovery path needed the override. Same env var works for unit specs (`--unit`) too.

#### Auto-skip when VM > host

When the test VM is at a newer version than `/opt/agi/` (typical mid-/loop), the wrapper auto-skips `services-align` rather than downgrading the VM. To force alignment regardless, set `AGI_TEST_SKIP_ALIGN=0` and run `agi test-vm services-align` manually. To skip alignment entirely (e.g. iterating on a known-fresh VM), set `AGI_TEST_SKIP_ALIGN=1`.

#### Auto-rebuild dashboard bundle — `AGI_TEST_SKIP_BUILD`

The test VM mounts dev source live but the dashboard is a Vite-built static bundle, not source. When `services-align` is auto-skipped (above), the bundle stays at whatever was last built — typically days behind dev source after a /loop session. Symptom: Playwright timeouts on `getByText` for elements your dev source clearly defines, because the served HTML is from an older build.

Before each `--e2e` / `--e2e-ui` / `--e2e-headed` run, the wrapper compares the mtime of `ui/dashboard/dist/index.html` against the newest mtime under `ui/dashboard/src/` (`.tsx` / `.ts` / `.css` / `.html`). When src is newer, runs `pnpm --filter @agi/dashboard build` inside the VM before launching Playwright.

Set `AGI_TEST_SKIP_BUILD=1` to bypass — useful when iterating on a known-fresh bundle or when the build itself is the problem under test.

### Run All Tiers

```bash
pnpm test:all          # Unit + system e2e + UI e2e
```

---

## CI

GitHub Actions runs in an isolated Ubuntu container and sets `AIONIMA_TEST_VM=1` to bypass the host safety guard. CI runs `vitest run` directly — no Multipass needed since the CI environment is already isolated.

CI steps:

1. `pnpm install`
2. `pnpm typecheck`
3. `pnpm lint`
4. `AIONIMA_TEST_VM=1 pnpm vitest run`

---

## When to Run Tests

| Scenario | Command |
|----------|---------|
| After changing business logic or stores | `pnpm test` |
| After changing `install.sh` or `upgrade.sh` | `pnpm test:e2e` |
| After adding or modifying API endpoints | `pnpm test:e2e` |
| After changing the onboarding flow | `pnpm test:e2e` |
| After changing dashboard UI | `agi test --e2e <spec>` (headless); `--e2e-ui` to drive interactively |
| After changing plugin image refs or stack dependencies | `pnpm test` (plugin tests) |
| After changing `required-plugins.json` | `pnpm test` |
| Before shipping a release | `pnpm test:all` |

---

## Quick Reference

| Command | What it tests | Speed |
|---------|--------------|-------|
| `pnpm test` | Unit tests (vitest in VM) | Seconds |
| `pnpm test:e2e` | Full system on a clean VM (install, API, onboarding, plugins) | ~5 minutes |
| `agi test --e2e <spec>` | Dashboard UI against VM (headless) | ~1 minute |
| `agi test --e2e-ui <spec>` | Playwright UI runner (interactive) | persistent until you close it |
| `agi test --e2e-headed <spec>` | Visible auto-run, no UI shell | ~1-2 minutes |
| `pnpm test:all` | All three tiers | ~7 minutes |
| `pnpm test:vm:create` | Create the test VM | ~2 minutes |
| `pnpm test:vm:setup` | Install deps in the VM | ~3 minutes |
| `pnpm test:vm:destroy` | Tear down the VM | Seconds |
| `pnpm test:vm:ssh` | SSH into the VM | Instant |
