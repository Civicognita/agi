# Testing and Shipping: Pre-Ship Checklist, CI, Verification

This document covers the mandatory pre-ship process, the CI pipeline, the git workflow, and how to add new tests.

## Mandatory Pre-Ship Steps

Before every commit and push, without exception:

### 1. pnpm build

```bash
pnpm build
```

This runs (from `package.json` root build script):
1. `vite build` in `ui/dashboard/` — produces `ui/dashboard/dist/`
2. `tsdown` — builds all 6 TypeScript entry points to their respective `dist/` directories

If `pnpm build` fails, do not commit. The build catches compile errors that `typecheck` does not always surface (e.g., missing imports, broken re-exports in tsdown entry points).

### 2. pnpm typecheck

```bash
pnpm typecheck
```

Runs `tsc --noEmit` across the full monorepo. This validates TypeScript types without producing output. It catches:
- Type mismatches between packages
- Missing type exports
- Incorrect generic parameter usage
- Breaking changes to shared interfaces

Both checks must pass before a commit. Never skip either step.

### 3. Same-commit help-text + docs sweep

Whenever a commit changes a CLI surface — adds a subcommand, changes a flag, alters the deployed behavior of an existing one — the matching surfaces must be updated in the **same commit**:

- **`scripts/agi-cli.sh` help block** — the `agi help` output the owner reads in the terminal. New subcommands need entries in the help dispatcher; revised behavior needs the description line refreshed (no leftover "WIP", "MVP", or "TODO" markers from earlier shipping cycles).
- **`docs/human/cli.md`** — the canonical CLI reference. Every subcommand shown by `agi help` should appear here with the same name, same flags, and a one-line description that matches the help output.
- **Adjacent docs in `docs/human/` and `docs/agents/`** — if a subcommand is documented inline elsewhere (e.g. `testing.md` for `test-vm`, `huggingface.md` for `models`), refresh those references too.

**Why this matters:** help text is not audited by anything. Type-checks pass, tests pass, the CLI works — and the help text can stay wrong indefinitely. Drift surfaced during the v0.4.0 sweep included `agi bash` describing itself as "(MVP surface; logging + policy WIP)" eight versions after both shipped (v0.4.149 → v0.4.177). The fix is *prevention in the same commit*, not *detection later*.

**Quick sanity check before committing a CLI change:**

```bash
pnpm docs-check          # warn-only, exit 0 with findings (default)
pnpm docs-check:strict   # exit 2 on any drift (use in CI gates)
```

The lint (`scripts/check-docs-vs-help.sh`) parses `agi help` and `docs/human/cli.md` and reports three classes of drift:

1. Subcommands present in `agi help` but missing from `cli.md` (and not in the small allow-list of subcommands documented in sibling pages — `test-vm` → `testing.md`, `models` → `huggingface.md`, etc.).
2. `### agi <name>` sections in `cli.md` that don't correspond to any live subcommand.
3. `WIP|MVP|TODO|FIXME` markers leaking into the help text — exactly the drift class that survived from v0.4.149's `bash CMD` shipping until v0.4.177's catch-up.

Default is **warn-only** so legitimate sibling-doc placements don't block work; use `:strict` in CI gates that should hard-fail on drift. As legitimate omissions get codified into the lint's allow-list (in `check-docs-vs-help.sh`), the strict gate becomes safe to promote to PR-required.

### 4. Curl-test backend API endpoints

Test every endpoint you added or modified. Examples:

```bash
BASE="http://localhost:3100"

# Health / overview
curl -s "$BASE/api/dashboard/overview?input=%7B%22windowDays%22%3A90%7D" | jq .

# Channel status
curl -s "$BASE/api/channels/telegram" | jq .

# Plugin list
curl -s "$BASE/api/gateway/plugins" | jq .

# Files API (requires private network — loopback qualifies)
curl -s "$BASE/api/files/tree?root=docs" | jq .
curl -s "$BASE/api/files/read?path=docs/agents/README.md" | jq '.content | length'

# System upgrade check
curl -s "$BASE/api/system/update-check" | jq .

# POST example
curl -s -X POST "$BASE/api/channels/telegram/start" | jq .
```

Run `pnpm dev` in a terminal, then run curl tests in another. Verify that:
- 200 responses contain the expected shape
- 400 is returned for bad input
- 404 is returned for unknown entities/IDs
- 403 is returned for private-network-only endpoints accessed from localhost (localhost is private, so test with a spoofed IP or skip)

## Unit Tests (Vitest)

**All vitest runs go through the VM.** A safety guard in `vitest.config.ts` throws an error if `AIONIMA_TEST_VM` is not set, preventing accidental host execution. Running `pnpm test` from the host routes through `scripts/test-vm-run.sh unit`, which executes vitest inside the VM with `AIONIMA_TEST_VM=1`.

Tests live alongside source files or in `__tests__/` directories within each package.

```bash
pnpm test                 # Run all Vitest tests (routed through VM)
pnpm test --reporter=verbose  # Verbose output
pnpm test packages/entity-model  # Run tests for one package
pnpm test --watch         # Watch mode for development
```

### Writing a new unit test

```ts
// packages/entity-model/src/__tests__/my-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { MyStore } from "../my-store.js";

describe("MyStore", () => {
  let db: InstanceType<typeof Database>;
  let store: MyStore;

  beforeEach(() => {
    // Use an in-memory database for tests
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT NOT NULL PRIMARY KEY,
        type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        verification_tier TEXT NOT NULL DEFAULT 'unverified',
        coa_alias TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS my_table (
        id TEXT NOT NULL PRIMARY KEY,
        entity_id TEXT NOT NULL REFERENCES entities(id),
        category TEXT NOT NULL,
        value REAL NOT NULL DEFAULT 0,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    // Seed a test entity
    db.prepare(
      "INSERT INTO entities (id, type, display_name, verification_tier, coa_alias, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("test-entity-1", "person", "Test User", "unverified", "$E1", new Date().toISOString(), new Date().toISOString());

    store = new MyStore(db);
  });

  it("creates a record and retrieves it by ID", () => {
    const record = store.create({
      entityId: "test-entity-1",
      category: "test",
      value: 42,
      metadata: { key: "value" },
    });

    expect(record.id).toBeTruthy();
    expect(record.entityId).toBe("test-entity-1");
    expect(record.category).toBe("test");
    expect(record.value).toBe(42);
    expect(record.metadata).toEqual({ key: "value" });

    const found = store.findById(record.id);
    expect(found).not.toBeNull();
    expect(found?.value).toBe(42);
  });

  it("returns null for unknown ID", () => {
    const result = store.findById("nonexistent-id");
    expect(result).toBeNull();
  });

  it("updates a record", () => {
    const created = store.create({ entityId: "test-entity-1", category: "test", value: 1 });
    const updated = store.update(created.id, { value: 99 });
    expect(updated?.value).toBe(99);
  });

  it("deletes a record", () => {
    const created = store.create({ entityId: "test-entity-1", category: "test", value: 1 });
    expect(store.delete(created.id)).toBe(true);
    expect(store.findById(created.id)).toBeNull();
  });
});
```

### Writing tests for HTTP routes

For plugin HTTP routes, test the handler logic directly without spinning up Fastify:

```ts
// packages/plugin-<name>/src/__tests__/routes.test.ts
import { describe, it, expect, vi } from "vitest";
import { createMockApi } from "./test-helpers.js";

describe("plugin-<name> routes", () => {
  it("GET /api/<name>/status returns running true", async () => {
    // Create a mock request/reply pair
    const request = { body: undefined, query: {}, params: {}, clientIp: "127.0.0.1" };
    let sentData: unknown;
    const reply = {
      code: (n: number) => ({ send: (d: unknown) => { sentData = { status: n, data: d }; } }),
      send: (d: unknown) => { sentData = d; },
    };

    // Activate the plugin against a mock API
    const api = createMockApi();
    const plugin = (await import("../index.js")).default;
    await plugin.activate(api);

    // Get the registered handler
    const handler = api.getHandler("GET", "/api/<name>/status");
    await handler(request, reply);

    expect(sentData).toEqual({ running: true });
  });
});
```

## VM-Based End-to-End Tests (Multipass)

Full-system tests run inside an ephemeral Ubuntu VM via Multipass. This validates `install.sh`, API endpoints, onboarding, and plugin installs on a clean machine — catching breakages that unit tests and typechecking miss.

### Prerequisites

```bash
sudo snap install multipass
```

### VM Lifecycle

```bash
pnpm test:vm:create    # Create Ubuntu 24.04 VM with all workspace repos mounted
pnpm test:vm:setup     # Install Node 22 + pnpm inside VM, run pnpm install
pnpm test:vm:destroy   # Tear down the VM
pnpm test:vm:ssh       # SSH into the VM
```

The VM mounts all workspace repos: AGI → `/mnt/agi`, PRIME → `/mnt/aionima-prime`, ID → `/mnt/agi-local-id`. A test config fixture at `test/fixtures/gateway-test.json` points to these mount paths.

### Running All VM Tests

```bash
pnpm test                            # Unit tests (vitest inside VM)
pnpm test:e2e                        # System e2e (install → API → onboarding → plugins)
pnpm test:e2e:ui                     # Playwright UI tests (host browser → VM)
pnpm test:all                        # All tiers
./scripts/test-e2e-vm.sh --fresh     # Destroy + recreate VM first
./scripts/test-e2e-vm.sh --quick     # Skip plugin install tests
./scripts/test-e2e-vm.sh --cleanup   # Destroy VM after tests
```

The orchestrator runs four test suites in sequence:

1. **Install Test** (`tests/e2e-vm/test-install.sh`) — runs inside VM via `multipass exec`
2. **API Tests** (`tests/e2e-vm/test-api.sh`) — runs from host against VM IP
3. **Onboarding Flow** (`tests/e2e-vm/test-onboarding.sh`) — runs from host against VM IP
4. **Plugin Install Tests** (`tests/e2e-vm/test-plugins.sh`) — runs inside VM

### Test Suite Details

#### Install Test (`tests/e2e-vm/test-install.sh`)

Runs `install.sh` with `AIONIMA_REPO=/mnt/agi` (clones from local mount) and `AIONIMA_SKIP_HARDENING=1`. Verifies:

- `aionima` user exists
- Node 22+ installed
- pnpm installed
- `/opt/agi/` has package.json and built dist directories
- systemd unit installed and enabled
- `.env` exists with 0600 permissions
- Service starts and `/health` responds with `ok: true`
- Dashboard serves HTML at `/`

#### API Tests (`tests/e2e-vm/test-api.sh`)

Curl-based tests from host against `http://<vm-ip>:3100`:

- `GET /health` — 200, `ok: true`, has `uptime`
- `GET /api/onboarding/state` — 200, has `steps`
- `GET /api/onboarding/owner-profile` — 200
- `GET /api/onboarding/channels` — 200
- `POST /api/onboarding/ai-keys` — accepts JSON, returns 200
- `POST /api/onboarding/owner-profile` — accepts JSON, returns 200
- `GET /api/system/stats` — 200
- `GET /api/dev/status` — 200
- Dashboard serves HTML

#### Onboarding Flow (`tests/e2e-vm/test-onboarding.sh`)

Exercises the full onboarding state machine:

1. Reads initial state (all steps pending)
2. POSTs AI keys — verifies step marked complete
3. POSTs owner profile — verifies step marked complete
4. GETs channel config
5. POSTs reset — verifies steps return to pending

#### Plugin Tests (`tests/e2e-vm/test-plugins.sh`)

Validates the plugin install framework on a clean VM:

- Checks plugin directories exist in `/opt/agi/packages/plugin-*`
- Runs `installedCheck` commands (redis-cli, mysql, psql, etc.) — expects failure on fresh VM
- Installs redis-server via apt — verifies `installedCheck` passes, service runs, `redis-cli ping` returns PONG

### Files to Modify When Adding New VM Tests

| File | Change |
|------|--------|
| `tests/e2e-vm/test-api.sh` | Add new `check_status` or `check_json_key` calls for new API endpoints |
| `tests/e2e-vm/test-install.sh` | Add new `check` calls for new install.sh verification steps |
| `tests/e2e-vm/test-plugins.sh` | Add new entries to the `CHECKS` associative array for new plugin services |
| `tests/e2e-vm/test-onboarding.sh` | Add new steps for new onboarding flow endpoints |
| `scripts/test-e2e-vm.sh` | Add new `run_suite` calls for entirely new test suites |
| `scripts/test-vm.sh` | Modify VM spec (CPU, RAM, disk, cloud-init packages) |

### Key Design Notes

- **Health endpoint is `/health`** (not `/api/health`). Port is 3100 (config default).
- **`AIONIMA_SKIP_HARDENING=1`** is used in the VM to avoid UFW/iptables interfering with test networking.
- **JSON assertions use python3** (available in Ubuntu by default) — no extra dependencies needed.
- **Tests exit non-zero on any failure** so the orchestrator correctly reports suite pass/fail.

### Known VM Gotchas

**1. git safe.directory** — The mounted repo at `/mnt/agi` has different ownership than the `aionima` user created by `install.sh`. Before running `install.sh`, you MUST set safe.directory for all users:

```bash
multipass exec aionima-test -- sudo git config --system --add safe.directory /mnt/agi
multipass exec aionima-test -- sudo git config --system --add safe.directory /mnt/agi/.git
multipass exec aionima-test -- sudo -u aionima git config --global --add safe.directory /mnt/agi
multipass exec aionima-test -- sudo -u aionima git config --global --add safe.directory /mnt/agi/.git
```

Without this, `install.sh` fails at `git clone` with "dubious ownership."

**2. Native modules** — The clone from `/mnt/agi` copies the host-compiled native binaries (`better-sqlite3`, `node-pty`). These must be rebuilt inside the VM:

```bash
multipass exec aionima-test -- sudo -u aionima env HOME=/home/aionima bash << 'SCRIPT'
cd /home/aionima/_projects/agi
cd node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3 && npm run build-release
cd /home/aionima/_projects/agi/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty && npm run install
SCRIPT
```

Without this, the CLI crashes with "Failed to load native module: pty.node."

**3. upgrade.sh assumes git repo** — `install.sh` calls `upgrade.sh` at the end, which does `git pull` inside `/opt/agi`. Since the VM's `/opt/agi` is not a git clone (it's an empty dir), this step fails. For dev testing, skip deploy and run directly from the cloned repo:

```bash
multipass exec aionima-test -- sudo -u aionima env HOME=/home/aionima bash << 'SCRIPT'
cd /home/aionima/_projects/agi && mkdir -p data && node cli/dist/index.js run
SCRIPT
```

**4. Syncing uncommitted changes** — The VM clone captures the git state at clone time. For uncommitted local changes, copy files from the mount:

```bash
multipass exec aionima-test -- sudo -u aionima cp /mnt/agi/path/to/file.ts /home/aionima/_projects/agi/path/to/file.ts
# Then rebuild
multipass exec aionima-test -- sudo -u aionima env HOME=/home/aionima bash -c 'cd /home/aionima/_projects/agi && pnpm build'
```

**5. pnpm approve-builds** — pnpm 10.5 blocks native module builds behind an interactive prompt even with `approve-builds-automatically=true` in `.npmrc`. The direct rebuild approach (gotcha #2) bypasses this.

## End-to-End Tests (Playwright)

```bash
pnpm test:e2e             # Run all Playwright tests
pnpm test:e2e --debug     # Run with Playwright inspector
```

E2E tests are in `ui/dashboard/e2e/` (or wherever `playwright.config.ts` points). They test the full dashboard in a real browser against a running gateway.

### Writing an E2E test

```ts
// ui/dashboard/e2e/docs-page.spec.ts
import { test, expect } from "@playwright/test";

test("docs page shows file tree and renders markdown", async ({ page }) => {
  await page.goto("/docs");

  // File tree sidebar should appear
  await expect(page.locator("text=Documentation")).toBeVisible();

  // Click a file in the tree
  await page.click("text=README.md");

  // Markdown content should render
  await expect(page.locator("h1")).toContainText("Agent Documentation");
});
```

## CI Pipeline (GitHub Actions)

The CI workflow runs on every push and pull request to `main`. It does not run upgrade.sh — CI only validates.

CI steps:
1. `pnpm install` — install all dependencies
2. `pnpm typecheck` — full monorepo type check
3. `pnpm lint` — oxlint across all packages
4. `AIONIMA_TEST_VM=1 pnpm vitest run` — Vitest unit and integration tests (CI sets the env var to bypass the host guard since GitHub Actions is already isolated)

The CI configuration is in `.github/workflows/`. Do not push code that breaks CI. If CI was passing before your changes and fails after, the breakage is your responsibility to fix before merging.

### Checking CI locally before pushing

```bash
pnpm check        # typecheck + lint combined
pnpm test         # unit tests
pnpm build        # build (not in CI but mandatory pre-ship)
```

## Git Workflow

### Always check ALL outstanding changes

Before staging, run `git status` and review every modified file — not just the files from your current task. Include any pre-existing uncommitted work:

```bash
git status
git diff          # unstaged changes
git diff --cached # staged changes
```

### Ship immediately after clean builds

After `pnpm build` and `pnpm typecheck` pass, commit and push right away. Do not accumulate changes across multiple tasks without committing.

```bash
git add packages/plugin-<name>/src/index.ts
git add packages/plugin-<name>/package.json
git add docs/agents/adding-a-plugin.md
git commit -m "Add <name> plugin with X capability"
git push
```

### Commit message conventions

- `Add` — wholly new feature or file
- `Update` — enhancement to existing feature
- `Fix` — bug fix
- `Refactor` — code restructuring without behavior change
- `Remove` — delete files or features
- `Docs` — documentation only

Commit messages should explain the "why" when non-obvious.

### Never commit

- `.env` files or files containing secrets
- `data/entities.db` or any runtime data files
- `node_modules/`
- `dist/` output (it is generated on deploy)
- PRIME corpus runtime state (the PRIME repo is external — never write runtime data there)

## Linting and Formatting

```bash
pnpm lint         # oxlint — run linter
pnpm format       # oxfmt — format TypeScript files
```

oxlint is faster than ESLint and catches the same class of errors. oxfmt is the formatter. Run both before committing.

If `pnpm lint` reports errors, fix them before committing. Do not use `eslint-disable` or `oxlint-disable` comments unless you have a specific, documented reason.

## Files to Modify When Adding New Tests

### Unit tests for a new package or store

| File | Change |
|------|--------|
| `packages/<name>/src/__tests__/<name>.test.ts` | Create — Vitest test file |
| `packages/<name>/package.json` | Confirm Vitest is in `devDependencies` (it is inherited from root in most cases) |

### E2E tests for a new dashboard page

| File | Change |
|------|--------|
| `ui/dashboard/e2e/<name>.spec.ts` | Create — Playwright test for the new page |
| `playwright.config.ts` | Usually no change needed — picks up all `*.spec.ts` in the e2e directory |

### CI for new test commands

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | Add new test command step if it is not covered by `pnpm test` |

## Testing Plugin Changes (Marketplace Repo)

Plugin tests use `testActivate()` from `@agi/sdk/testing`. Each plugin that registers stacks, runtimes, or services should have a test file at `plugins/plugin-<name>/src/index.test.ts` that verifies:

- **Correct registration counts** — right number of stacks, services, runtimes
- **GHCR image references** — all container images use `ghcr.io/civicognita/*`, never vanilla upstream
- **Stack requirements** — correct `expected` vs `provided` requirements (e.g., TALL expects `laravel`, doesn't provide it)
- **Shared container flags** — database stacks have `shared: true` and `databaseConfig` with setup/teardown
- **Project categories** — stacks target the right project types

Example:

```typescript
import { describe, it, expect } from "vitest";
import { testActivate } from "@agi/sdk/testing";
import plugin from "./index.js";

describe("PostgreSQL plugin", () => {
  it("uses GHCR images for all services", async () => {
    const reg = await testActivate(plugin);
    for (const svc of reg.services) {
      expect(svc.containerImage).toMatch(/^ghcr\.io\/civicognita\/postgres:\d+$/);
    }
  });
});
```

## Testing Config Changes (AGI Repo)

Config-level tests (e.g., `config/src/required-plugins.test.ts`) validate structural correctness of JSON config files. These catch regressions like a required plugin being accidentally removed.

## Pre-Ship Checklist Summary

Before every commit and push:

- [ ] `pnpm build` — passes with no errors
- [ ] `pnpm typecheck` — passes with no type errors
- [ ] `pnpm lint` — no lint errors
- [ ] `git status` — review ALL changed files, not just task files
- [ ] Curl-test every new or modified API endpoint
- [ ] New unit tests written for new store methods, business logic, or plugin changes
- [ ] Plugin tests verify GHCR image refs and stack requirements
- [ ] No secrets, `.env` files, or `dist/` in staged files
- [ ] Commit message follows conventions (`Add`, `Update`, `Fix`, etc.)
- [ ] `pnpm test` — Unit tests pass (in VM)
- [ ] `pnpm test:e2e` — System e2e tests pass (for install.sh, API, or plugin changes)
- [ ] Push immediately after commit — do not wait
