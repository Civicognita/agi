# Spot Tests

Per-feature integration tests that exercise specific surfaces of a configured AGI gateway. Run individually for fast feedback during development, or as part of the full e2e suite.

## Tests

Each script in this directory tests one feature surface. Scripts:
- Must be runnable standalone (no test-runner harness required)
- Use the `agi` CLI as the entry point (no direct curls of the internal :3100 port)
- Exit 0 on pass, non-zero on fail
- Print clear PASS/FAIL lines for each check

| Script | Tests |
|---|---|
| `marketplace.sh` | Catalog list, install/uninstall round-trip, alias resolution |
| `project-types.sh` | Create + verify one project of each registered project type |
| `hardware.sh` | `/api/machine/hardware` probe + `agi doctor` machine sections |
| `lemonade.sh` | Lemonade proxy reachability, model pull/load round-trip |

## Run from host (against the test VM)

```bash
pnpm test:spot marketplace
pnpm test:spot hardware
pnpm test:spot project-types
pnpm test:spot lemonade
pnpm test:spot all                    # sequential, full spot-test pass
```

## Run inside the VM directly

```bash
multipass exec agi-test -- bash /mnt/agi/test/spot-tests/marketplace.sh
```

## Adding a new spot test

1. Create `test/spot-tests/<feature>.sh` following the existing pattern (header + helpers + checks + summary)
2. Wire it into `scripts/test-vm-run.sh`'s `spot)` case
3. Add a `pnpm test:spot:<feature>` script in `package.json`
4. Document the test surface in this README's table

## Why spot tests vs unit / e2e

- **Unit tests** (`pnpm test`) run vitest against in-process modules with mocks. Fast, no gateway.
- **Spot tests** (`pnpm test:spot <feature>`) run bash assertions against a real gateway one feature at a time. Faster than `e2e`; deeper than `unit`; lets you isolate a regression to a single surface.
- **E2E tests** (`pnpm test:e2e`) run install + onboarding + multi-feature flows end-to-end. Slow; comprehensive.
