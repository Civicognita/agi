#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# agi-test — single test runner entrypoint for Aion + humans
# ---------------------------------------------------------------------------
# Invoked via the `agi` CLI as `agi test [kind] [pattern] [options]`. This
# script is NOT meant to be executed directly — go through `agi test …` so
# every automation (humans, workers, Aion) hits the same entry.
#
# Kinds (flag):
#   --unit        Vitest inside the test VM   (default)
#   --e2e         Playwright headless against test.ai.on (the default for owner-watch)
#   --e2e-ui      Playwright UI runner — interactive browser-based test runner
#                 (watch mode, traces, run controls). Use when driving tests by hand.
#   --e2e-headed  Playwright --headed — visible auto-running tests, no UI shell.
#                 Use when the goal is "watch the test execute" without the runner UI.
#   --spot <f>    Spot tests for feature <f> (hardware|marketplace|lemonade|project-types|all)
#   --all         Run every tier in sequence
#
# Common options:
#   --list        List candidate specs for the chosen kind; exit 0
#   --help, -h    Print this usage
#
# Pattern (positional):
#   Names a spec. For unit/e2e/e2e-ui/e2e-headed modes the pattern is
#   matched against spec filenames first (case-insensitive substring),
#   with content-grep as fallback. For spot mode the positional is the
#   feature name.
#
# Examples:
#   agi test dashboard                  Run packages/gateway-core/src/dashboard.test.ts
#   agi test --e2e mapps-walk           Run e2e/walk/mapps-walk.spec.ts (headless)
#   agi test --e2e-ui chat-workflow     Open Playwright UI runner with chat-workflow loaded
#   agi test --e2e-headed mapps-walk    Run mapps-walk visibly (no UI shell)
#   agi test --spot hardware            Run spot hardware feature test
#   agi test --list                     Enumerate unit specs
#
# Exit codes:
#   0 = all passed   1 = one or more failed
#   2 = no match     3 = VM/setup error
# ---------------------------------------------------------------------------
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Default REPO_DIR is the script's parent (the deployed /opt/agi/ tree).
# AGI_TEST_DEV_REPO_DIR (s146 t602): override to point at the dev tree
# (typically ~/temp_core/agi). Closes the spec-discovery gap that blocked
# /loop verification of brand-new specs across cycles 178/179/183/185 —
# the test VM already mounts dev source live so the runtime target
# matches; only this script's `find … -iname …` step needed to know
# about the dev path.
#
# s148 (2026-05-09): when the env var isn't set AND the script is running
# from /opt/agi (the deployed tree), AUTO-prefer ~/temp_core/agi as
# REPO_DIR if it looks like a valid dev tree. Owner directive: "agi test
# should discover specs from host dev source, not /opt/agi production
# tree" — make this the default behavior so devs don't need to remember
# the env var. /opt/agi remains the fallback when no dev tree exists
# (production-only installs).
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -n "${AGI_TEST_DEV_REPO_DIR:-}" ]; then
  if [ -d "$AGI_TEST_DEV_REPO_DIR" ] && [ -f "$AGI_TEST_DEV_REPO_DIR/package.json" ]; then
    REPO_DIR="$(cd "$AGI_TEST_DEV_REPO_DIR" && pwd)"
    echo "[agi test] AGI_TEST_DEV_REPO_DIR set; resolving specs from $REPO_DIR" >&2
  else
    echo "[agi test] AGI_TEST_DEV_REPO_DIR='$AGI_TEST_DEV_REPO_DIR' invalid (not a dir or missing package.json); using default $REPO_DIR" >&2
  fi
elif [[ "$REPO_DIR" == /opt/agi* ]]; then
  # s148 — auto-prefer the dev tree for spec discovery so brand-new specs
  # are runnable pre-deploy without extra env-var ceremony.
  CANDIDATE_DEV="${HOME:-/root}/temp_core/agi"
  if [ -d "$CANDIDATE_DEV" ] && [ -f "$CANDIDATE_DEV/package.json" ]; then
    REPO_DIR="$(cd "$CANDIDATE_DEV" && pwd)"
    echo "[agi test] auto-preferring dev tree for spec discovery: $REPO_DIR (override with AGI_TEST_DEV_REPO_DIR or run from a tree that doesn't have $CANDIDATE_DEV)" >&2
  fi
fi
VM_NAME="agi-test"
VM_TEST_SCRIPT="$SCRIPT_DIR/test-vm.sh"
TEST_RUN_SCRIPT="$SCRIPT_DIR/test-run.sh"

KIND="unit"
PATTERN=""
LIST_MODE=0

usage() {
  sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

die()  { echo "[agi test] $1" >&2; exit "${2:-3}"; }
log()  { echo "[agi test] $*"; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --unit)    KIND="unit"; shift ;;
    --e2e)     KIND="e2e"; shift ;;
    --e2e-ui)  KIND="e2e-ui"; shift ;;
    --e2e-headed) KIND="e2e-headed"; shift ;;
    --spot)    KIND="spot"; shift ;;
    --all)     KIND="all"; shift ;;
    --list)    LIST_MODE=1; shift ;;
    --help|-h) usage ;;
    --*)       die "unknown flag: $1" ;;
    *)
      if [ -z "$PATTERN" ]; then PATTERN="$1"; else PATTERN="$PATTERN $1"; fi
      shift
      ;;
  esac
done

# ---------------------------------------------------------------------------
# List mode
# ---------------------------------------------------------------------------
if [ "$LIST_MODE" -eq 1 ]; then
  case "$KIND" in
    e2e|e2e-ui)
      echo "# e2e specs (playwright, matched by filename)"
      (cd "$REPO_DIR" && find e2e -type f -name "*.spec.ts" 2>/dev/null | sort)
      ;;
    spot)
      echo "# spot feature names"
      printf 'hardware\nmarketplace\nlemonade\nproject-types\nall\n'
      ;;
    *)
      echo "# unit specs (vitest, matched by filename)"
      (cd "$REPO_DIR" && find packages cli config -type f -name "*.test.ts" 2>/dev/null | sort)
      ;;
  esac
  exit 0
fi

# ---------------------------------------------------------------------------
# VM preflight (shared)
# ---------------------------------------------------------------------------
preflight() {
  if ! command -v multipass >/dev/null 2>&1; then
    die "multipass not installed on host"
  fi
  local state
  state="$(multipass info "$VM_NAME" --format csv 2>/dev/null | tail -1 | cut -d',' -f2)"
  if [ -z "$state" ] || [ "$state" = "state" ]; then
    die "VM '$VM_NAME' not found — run 'pnpm test:vm:create' first"
  fi
  if [ "$state" != "Running" ]; then
    log "VM '$VM_NAME' is '$state' — starting..."
    multipass start "$VM_NAME" >/dev/null || die "failed to start VM"
  fi

  # Auto-align VM with host source when versions drift (s134 t517 cycle 117
  # learning: services-restart doesn't rebuild dashboard; services-align
  # does. Skipping the align silently runs tests against a stale dashboard
  # bundle and leads to false-skip / false-pass results).
  # Set AGI_TEST_SKIP_ALIGN=1 to bypass for fast iteration on a known-fresh VM.
  if [ "${AGI_TEST_SKIP_ALIGN:-0}" = "1" ]; then
    return 0
  fi
  local host_version vm_version
  host_version=$(grep -m1 '"version"' "$REPO_DIR/package.json" 2>/dev/null \
    | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
  vm_version=$(multipass exec "$VM_NAME" -- bash -c "curl -sk https://test.ai.on/health 2>/dev/null" 2>/dev/null \
    | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
    | tr -d '\r\n ')
  if [ -n "$host_version" ] && [ -n "$vm_version" ] && [ "$host_version" != "$vm_version" ]; then
    # s146 t602 cycle 186: detect VM-ahead-of-host and auto-skip the align.
    # /loop sessions naturally race the dev tree ahead of /opt/agi/ between
    # owner-triggered upgrades. "Aligning" downgrades the VM to host's
    # version, which is the wrong direction during dev iteration AND was
    # observed to leave services stopped (cycle 185). Use sort -V to
    # compare semver-ish strings; if VM > host, log + skip.
    local newer
    newer="$(printf '%s\n%s\n' "$host_version" "$vm_version" | sort -V | tail -1)"
    if [ "$newer" = "$vm_version" ] && [ "$vm_version" != "$host_version" ]; then
      log "VM at v${vm_version} > host at v${host_version} (dev ahead of /opt/agi/) — skipping services-align (auto)"
      log "set AGI_TEST_DEV_REPO_DIR to resolve specs from your dev tree (e.g. ~/temp_core/agi)"
      return 0
    fi
    log "VM at v${vm_version}, host at v${host_version} — running services-align (set AGI_TEST_SKIP_ALIGN=1 to skip)"
    # Keep stderr visible — silent failures hid a 30+ cycle build-skip bug
    # (cycle 119 root cause). pipefail propagates the actual exit status.
    set -o pipefail
    if ! bash "$VM_TEST_SCRIPT" services-align 2>&1 | tail -8; then
      log "services-align failed; running tests against potentially stale VM"
    fi
    set +o pipefail
  fi
}

# ---------------------------------------------------------------------------
# Pattern resolution — filename first, then content-grep fallback
# ---------------------------------------------------------------------------
resolve_unit_spec() {
  local pat="$1"
  if [ -f "$REPO_DIR/$pat" ]; then
    echo "$pat"; return 0
  fi
  local found
  # s146 t602 cycle 186: handle patterns containing `/` (e.g.
  # "gateway-core/mapp-storage-routes"). -iname matches basenames only,
  # so a `/` in the pattern always misses. Try -iwholename first when
  # pattern contains a slash; fall back to -iname for plain names.
  if [[ "$pat" == */* ]]; then
    found="$(cd "$REPO_DIR" && find packages cli config -type f -iwholename "*${pat// /*}*.test.ts" 2>/dev/null | sort | head -1)"
    if [ -n "$found" ]; then echo "$found"; return 0; fi
  fi
  found="$(cd "$REPO_DIR" && find packages cli config -type f -iname "*${pat// /*}*.test.ts" 2>/dev/null | sort | head -1)"
  if [ -n "$found" ]; then echo "$found"; return 0; fi
  found="$(cd "$REPO_DIR" && find packages cli config -type f -name "*.test.ts" -exec grep -l -iE "$pat" {} \; 2>/dev/null | sort | head -1)"
  if [ -n "$found" ]; then echo "$found"; return 0; fi
  return 1
}

resolve_e2e_spec() {
  local pat="$1"
  if [ -f "$REPO_DIR/$pat" ]; then
    echo "$pat"; return 0
  fi
  local found
  # s146 t602 cycle 186: see resolve_unit_spec — same fix for `/` in
  # patterns like "walk/mapp-editor-screens-step".
  if [[ "$pat" == */* ]]; then
    found="$(cd "$REPO_DIR" && find e2e -type f -iwholename "*${pat// /*}*.spec.ts" 2>/dev/null | sort | head -1)"
    if [ -n "$found" ]; then echo "$found"; return 0; fi
  fi
  found="$(cd "$REPO_DIR" && find e2e -type f -iname "*${pat// /*}*.spec.ts" 2>/dev/null | sort | head -1)"
  if [ -n "$found" ]; then echo "$found"; return 0; fi
  return 1
}

# ---------------------------------------------------------------------------
# Dashboard bundle freshness (s146 t603 cycle 188)
# ---------------------------------------------------------------------------
#
# The test VM mounts dev source live but the dashboard is a Vite-built
# static bundle, not source. When `services-align` is auto-skipped (cycle
# 186 t602 logic for dev-ahead-of-host), the bundle stays at whatever was
# last built — typically days behind dev source after a /loop session.
#
# Cycle 187 ate ~15 min of cycle budget rediscovering this from a
# Playwright timeout. This helper detects the staleness via mtime
# comparison + auto-rebuilds inside the VM before `run_e2e` runs.
#
# Bypass: AGI_TEST_SKIP_BUILD=1 skips the freshness check + auto-build.
# Useful when iterating on a known-fresh bundle or when the build itself
# is the problem under test.
ensure_dashboard_bundle_fresh() {
  if [ "${AGI_TEST_SKIP_BUILD:-0}" = "1" ]; then
    return 0
  fi

  # The VM bind-mount path is /mnt/agi (per scripts/test-vm.sh
  # multipass mount setup). We compare mtimes inside the VM to avoid
  # any host/VM clock skew issues — a single shell process sees both.
  local mtime_check
  mtime_check="$(multipass exec "$VM_NAME" -- bash -c '
    set -uo pipefail
    cd /mnt/agi || { echo "missing-mount"; exit 0; }
    bundle="ui/dashboard/dist/index.html"
    if [ ! -f "$bundle" ]; then echo "no-bundle"; exit 0; fi
    bundle_mtime=$(stat -c %Y "$bundle" 2>/dev/null || echo 0)
    # Newest src mtime under ui/dashboard/src — covers tsx + ts + css + html.
    src_mtime=$(find ui/dashboard/src -type f \( -name "*.tsx" -o -name "*.ts" -o -name "*.css" -o -name "*.html" \) \
      -printf "%T@\n" 2>/dev/null | sort -n | tail -1 | cut -d. -f1)
    if [ -z "$src_mtime" ] || [ "$src_mtime" = "0" ]; then echo "no-src"; exit 0; fi
    if [ "$src_mtime" -gt "$bundle_mtime" ]; then
      echo "stale src=$src_mtime bundle=$bundle_mtime"
    else
      echo "fresh"
    fi
  ' 2>/dev/null)"

  case "$mtime_check" in
    fresh)
      return 0 ;;
    missing-mount|no-bundle|no-src)
      log "dashboard bundle freshness: $mtime_check (skipping check)"
      return 0 ;;
    stale*)
      log "dashboard bundle stale ($mtime_check) — rebuilding (set AGI_TEST_SKIP_BUILD=1 to skip)"
      if ! multipass exec "$VM_NAME" -- bash -lc "cd /mnt/agi && pnpm --filter @agi/dashboard build 2>&1 | tail -5"; then
        log "dashboard build failed — running tests against potentially stale bundle"
      fi
      ;;
    *)
      log "dashboard freshness check returned unexpected output: '$mtime_check' (skipping)" ;;
  esac
}

# ---------------------------------------------------------------------------
# Runners
# ---------------------------------------------------------------------------
run_unit() {
  preflight
  if [ -z "$PATTERN" ]; then die "unit: missing <pattern>. Use 'agi test --list' to see candidates." 2; fi
  local spec
  spec="$(resolve_unit_spec "$PATTERN")" || die "no unit specs matched '$PATTERN'" 2
  log "unit → $spec (in $VM_NAME, max 5 min)"
  # `timeout 300` kills the invocation after 5 minutes so a hung test
  # doesn't block the host shell indefinitely. Vitest inside the VM
  # occasionally leaves worker processes pinned (open DB handles, unresolved
  # async handlers). Post-hang residue can be cleared with:
  #   multipass exec agi-test -- pkill -9 -f vitest
  multipass exec "$VM_NAME" -- bash -lc "cd /mnt/agi && timeout 300 env AIONIMA_TEST_VM=1 pnpm exec vitest run '$spec' --reporter=basic"
}

run_e2e() {
  preflight
  ensure_dashboard_bundle_fresh
  if [ -z "$PATTERN" ]; then die "e2e: missing <pattern>. Use 'agi test --e2e --list' to see candidates." 2; fi
  local spec
  spec="$(resolve_e2e_spec "$PATTERN")" || die "no e2e specs matched '$PATTERN'" 2
  # Playwright targets the VM's own production hostname. DNS is wired so
  # test.ai.on resolves directly to the VM IP, and the VM's own Caddy
  # serves it with internal TLS + reverse_proxy to 127.0.0.1:3100. No
  # host-side proxy hop. The VM IS its own production instance.
  local base_url="https://test.ai.on"
  # Verify reachability — if test.ai.on DNS isn't set up, fall back to
  # the VM IP directly (unencrypted, just for the one run).
  if ! curl -sk --connect-timeout 3 -o /dev/null -w "%{http_code}" "$base_url/api/system/stats" | grep -q "^2"; then
    local vm_ip
    vm_ip="$(multipass info "$VM_NAME" --format csv | tail -1 | cut -d',' -f3)"
    log "test.ai.on unreachable — verify host DNS points at $vm_ip; run 'pnpm test:vm:services-setup' to rewire"
    log "falling back to https://$vm_ip directly for this run"
    base_url="https://$vm_ip"
  fi
  log "e2e → $spec (against $base_url)"
  (cd "$REPO_DIR" && BASE_URL="$base_url" npx playwright test "$spec" --reporter=list)
}

run_e2e_ui() {
  preflight
  ensure_dashboard_bundle_fresh
  log "e2e-ui → test-run.sh e2e:ui (Playwright UI runner vs test.ai.on)${PATTERN:+ pattern=$PATTERN}"
  if [ -n "$PATTERN" ]; then
    bash "$TEST_RUN_SCRIPT" e2e:ui "$PATTERN"
  else
    bash "$TEST_RUN_SCRIPT" e2e:ui
  fi
}

run_e2e_headed() {
  preflight
  ensure_dashboard_bundle_fresh
  log "e2e-headed → test-run.sh e2e:headed (Playwright --headed vs test.ai.on)${PATTERN:+ pattern=$PATTERN}"
  if [ -n "$PATTERN" ]; then
    bash "$TEST_RUN_SCRIPT" e2e:headed "$PATTERN"
  else
    bash "$TEST_RUN_SCRIPT" e2e:headed
  fi
}

run_spot() {
  preflight
  local feature="${PATTERN:-all}"
  log "spot → feature=$feature"
  bash "$TEST_RUN_SCRIPT" spot "$feature"
}

run_all() {
  preflight
  log "all tiers → delegating to test-run.sh all"
  bash "$TEST_RUN_SCRIPT" all
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "$KIND" in
  unit)   run_unit ;;
  e2e)    run_e2e ;;
  e2e-ui) run_e2e_ui ;;
  e2e-headed) run_e2e_headed ;;
  spot)   run_spot ;;
  all)    run_all ;;
  *)      die "unknown kind: $KIND" ;;
esac
