# Windows Dev-Readiness — Plan / Checklist

**Status:** plan (not yet implemented) · **Audience:** the Windows agent · **Scope owner:** $A0

This is the hand-off brief for making the **`repos/agi` development environment**
work on a Windows machine, so that Aion itself can then be made Windows-ready.
It is **dev-environment readiness only** — being able to clone, install,
typecheck, lint, test, and build the repo on Windows, and run the parts that are
genuinely cross-platform. **Runtime porting** (making the deployed gateway,
hosting, and VM subsystems run on Windows) is a separate, larger effort called
out in §4 but not planned here.

---

## 1. Two-track reality

The repo splits cleanly into two layers with very different Windows stories:

**Track A — cross-platform Node/TS core (the dev-readiness target).**
`@agi/gateway-core`, `@agi/cli`, `ui/dashboard`, `config`, the channels, and the
whole test/build toolchain are plain Node 22 + TypeScript. These *should* run on
Windows with the fixes below. The success gate (§5) lives entirely here.

**Track B — Linux-runtime-bound subsystems (out of scope here).**
46 source/script files reference `podman` / `multipass` / `systemctl`. Project
hosting (podman containers), the test VM (multipass), and service management
(systemd) are Linux-native. They are **not** part of dev-readiness — a Windows
dev can build and unit-test the code around them without them running. Porting
them is the "make Aion Windows-ready" runtime work (§4).

The fastest way to sidestep Track B entirely for development is **WSL2** (§3,
recommended). Native-Windows dev (§3, alternative) is only needed to test
true-Windows behavior of Track A.

---

## 2. Checklist — Track A dev-readiness

### 2.1 Toolchain
- [ ] **Node `>=22.12.0`** (repo `engines`), **pnpm `10.5.2`** (exact, via
      `corepack enable` — the repo pins `packageManager`), **git**.
- [ ] **Native build toolchain** for the two native modules — **`node-pty`** and
      **`@node-rs/argon2`** (both `win32-x64`). First check whether pnpm pulls
      prebuilt binaries for Windows (likely for `@node-rs/argon2`; verify
      `node-pty`). If a source build is triggered, install **Visual Studio Build
      Tools** (C++ workload) + Python 3. `node-pty` only matters for the
      terminal-spawning features; auth (`@node-rs/argon2`) is load-bearing for
      the gateway.

### 2.2 Line endings (do this first — cheap, prevents subtle breakage)
- [ ] Add a **`.gitattributes`** at the repo root. There is none today, so a
      Windows checkout will rewrite `.sh` scripts and test fixtures to CRLF,
      breaking bash execution and byte-exact fixture assertions. Minimum:
      ```gitattributes
      * text=auto eol=lf
      *.sh text eol=lf
      *.{ts,tsx,js,mjs,json,md} text eol=lf
      *.png binary
      ```
      Then renormalize (`git add --renormalize .`) in a dedicated commit.

### 2.3 The `agi` CLI wrapper
- [ ] `scripts/agi-cli.sh` (and `/usr/local/bin/agi`) is **bash** and shells out
      to bash/podman/multipass for system ops — it will not run natively on
      Windows. For **dev**, none of the core gates (§5) need it: they run through
      `pnpm` scripts directly. Decision for the Windows agent:
      - **WSL2 path:** the wrapper works as-is inside WSL. Nothing to do.
      - **Native path:** add a thin `agi.cmd` / `agi.ps1` shim that forwards the
        *dev-safe* subcommands (`chat`, `doctor`-lite, `taskmaster`, anything
        that is pure-Node) to `tsx cli/src/index.ts <args>`, and clearly errors
        on the Linux-runtime subcommands (`run`, `hosting`, `test-vm`, service
        control) that can't work natively yet.

### 2.4 Bash scripts (28 total)
- [ ] The dev-relevant ones are `scripts/test-run.sh`, `check-docs-vs-help.sh`,
      `orphan-check.sh`, `check-route-collisions.sh`, `check-staged-tree.sh`.
      They assume bash + coreutils (`grep`, `sed`, `find`). Under **WSL2 or Git
      Bash** they should run; verify each and note any GNU-vs-BSD/coreutils
      quirks. The rest (`test-vm.sh`, `upgrade.sh`, `install.sh`, runtime-image
      builders) are Track B — not dev-readiness.

### 2.5 Path handling
- [ ] 39 hardcoded POSIX absolute paths (`/opt`, `/usr`, `/tmp`, `/home`) exist
      in `packages/gateway-core/src` + `cli/src`. Most are **runtime** paths used
      by the deployed gateway/hosting (Track B), not by dev commands. The dev
      gates (§5) should not hit them. **Action:** run the gates on Windows; for
      each failure, check whether a hardcoded path (or a POSIX assumption like
      `/tmp`, `os.homedir()` layout, or `path.posix` vs `path.win32`) is the
      cause, and fix only the ones that block dev/test. Leave runtime paths for
      Track B.
- [ ] Audit tests specifically for `/tmp` and POSIX-path fixtures — these are the
      most likely dev-gate failures on Windows.

### 2.6 Env & shell assumptions in tests
- [ ] Some tests set `AIONIMA_TEST_VM=1` and may assume a POSIX shell for
      `execSync`/`execFileSync` calls. Grep tests for `execSync`/`spawn` with
      bash-isms and confirm they either skip on Windows or use `shell:true`
      portably.

---

## 3. Recommended dev setup

**Primary (recommended): WSL2 (Ubuntu) on the Windows box.**
Near-native Linux dev parity — bash scripts, podman, and the Linux runtime all
work, so both Track A *and* much of Track B are exercisable, with minimal
porting. This is the low-friction path to "developing on Windows" and is almost
certainly what unblocks the owner fastest.

**Alternative (only if true-native-Windows behavior must be validated): Git Bash
+ prebuilt/compiled native modules.** Needed to catch genuine `win32` path/shell
bugs in Track A before Aion ships to Windows end-users. Higher friction; pursue
after the WSL2 path is green.

---

## 4. Out of scope here — runtime porting ("make Aion Windows-ready")

Called out so the boundary is explicit; **not** planned in this doc:
- **Hosting** — podman container orchestration → needs a Windows container
  strategy (Docker Desktop / WSL2 backend, or a different model).
- **Test VM** — multipass → a Windows-compatible VM/provisioning approach.
- **Service management** — systemd unit control → Windows Services / NSSM / a
  process manager.
- **Deploy layout** — `/opt/agi`, `/opt/agi-prime`, `/usr/local/bin/agi` → a
  Windows install location + path scheme.
- **`upgrade.sh` / `install.sh`** — bash installers → PowerShell equivalents.

These become tractable once Track A is dev-ready and the code can be built and
unit-tested on Windows.

---

## 5. Success gate (dev-ready = all green on the Windows dev box)

```
corepack enable && pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @agi/db-schema build
pnpm test          # unit suite (bash test-run.sh — run under WSL2/Git Bash)
pnpm --filter @agi/dashboard build
```

When these pass on Windows (WSL2 first, then native as needed), the repo is
dev-ready and the Windows agent can begin the Track B runtime porting.

---

## 6. Open questions for the owner / Windows agent
- WSL2 acceptable as the **supported** Windows dev environment, or must native
  Windows (Git Bash) be a first-class dev target too?
- Is `node-pty` needed in the Windows dev target (terminal spawning), or can the
  features that use it be excluded from the initial Windows build?
- Target Windows arch — `x64` only, or also `arm64` (affects native-module
  prebuilt availability)?
