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
| ID repo | `/mnt/aionima-local-id` | Identity service |

A test config fixture at `test/fixtures/aionima-test.json` points to these VM mount paths so tests resolve repos correctly.

If mounts become stale (e.g., after a host reboot), the VM scripts detect and re-mount automatically.

---

## Test Tiers

### 1. Unit Tests (Vitest)

Unit tests verify individual functions, stores, and business logic in isolation.

```bash
pnpm test              # Run all unit tests (routed through VM)
```

Under the hood, this executes `scripts/test-vm-run.sh unit`, which runs vitest inside the VM with `AIONIMA_TEST_VM=1` set.

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

Playwright tests run a real browser on the host against the gateway running inside the VM.

```bash
pnpm test:e2e:ui       # Run Playwright UI tests
```

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
| After changing dashboard UI | `pnpm test:e2e:ui` |
| After changing plugin image refs or stack dependencies | `pnpm test` (plugin tests) |
| After changing `required-plugins.json` | `pnpm test` |
| Before shipping a release | `pnpm test:all` |

---

## Quick Reference

| Command | What it tests | Speed |
|---------|--------------|-------|
| `pnpm test` | Unit tests (vitest in VM) | Seconds |
| `pnpm test:e2e` | Full system on a clean VM (install, API, onboarding, plugins) | ~5 minutes |
| `pnpm test:e2e:ui` | Dashboard UI in a browser against VM | ~1 minute |
| `pnpm test:all` | All three tiers | ~7 minutes |
| `pnpm test:vm:create` | Create the test VM | ~2 minutes |
| `pnpm test:vm:setup` | Install deps in the VM | ~3 minutes |
| `pnpm test:vm:destroy` | Tear down the VM | Seconds |
| `pnpm test:vm:ssh` | SSH into the VM | Instant |
