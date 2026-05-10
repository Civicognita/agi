#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# agi-cli — standalone management CLI for the Aionima gateway
#
# Works independently of the Node.js service (bash-only, no dependencies).
# Install: sudo ln -sf /opt/agi/scripts/agi-cli.sh /usr/local/bin/agi
#
# Usage:
#   agi status          — service + infra status
#   agi logs [N]        — tail gateway logs (default 50 lines)
#   agi upgrade         — pull + build + restart (runs upgrade.sh)
#   agi restart         — restart the aionima service
#   agi start           — start the aionima service
#   agi stop            — stop the aionima service
#   agi doctor          — check infra health (caddy, podman, dnsmasq, ports)
#   agi config [key]    — read config value (dot-path, e.g. agi config hosting.enabled)
#   agi projects        — list hosted projects with status
#   agi iw stop --project <path>  — STOP iterative-work on one project
#   agi issue list / show / file / fix — per-project issue registry (Wish #21)
#                                    (kill switch — runs without gateway restart)
#   agi iw stop --all   — STOP iterative-work on ALL projects (nuclear option)
# ---------------------------------------------------------------------------
set -uo pipefail

# DEPLOY_DIR: where the AGI repo lives. Detect via script location (follow
# symlinks so /usr/local/bin/agi → /opt/agi/scripts/agi-cli.sh resolves to
# /opt/agi; and → /mnt/agi/scripts/agi-cli.sh resolves to /mnt/agi). Honor
# AIONIMA_DIR override for unusual installs.
_AGI_SCRIPT="${BASH_SOURCE[0]}"
while [ -L "$_AGI_SCRIPT" ]; do _AGI_SCRIPT="$(readlink -f "$_AGI_SCRIPT")"; done
DEPLOY_DIR="${AIONIMA_DIR:-$(cd -P "$(dirname "$_AGI_SCRIPT")/.." && pwd)}"
AGI_DIR="${HOME}/.agi"
CONFIG_FILE="${AGI_DIR}/gateway.json"
# AGI_LOG_DIR override is supported so unit tests can redirect log output
# to a tempdir without touching the user's real ~/.agi/logs/ tree. Default
# behavior is unchanged when the env var is unset.
LOG_DIR="${AGI_LOG_DIR:-${AGI_DIR}/logs}"
SERVICE="agi"

# Colors (respect NO_COLOR)
if [ -z "${NO_COLOR:-}" ] && [ -t 1 ]; then
  GREEN='\033[0;32m' RED='\033[0;31m' YELLOW='\033[0;33m'
  BLUE='\033[0;34m' MUTED='\033[0;90m' BOLD='\033[1m' RESET='\033[0m'
else
  GREEN='' RED='' YELLOW='' BLUE='' MUTED='' BOLD='' RESET=''
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info()  { echo -e "${BLUE}[info]${RESET} $*"; }
ok()    { echo -e "${GREEN}[ok]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[warn]${RESET} $*"; }
err()   { echo -e "${RED}[error]${RESET} $*" >&2; }
label() { printf "${BOLD}%-18s${RESET}" "$1"; }

is_running() {
  systemctl is-active --quiet "$SERVICE" 2>/dev/null
}

# Detect test-VM mode. The test VM has three distinguishing signals that
# real production never has simultaneously:
#   1. Hostname is "agi-test" (set by multipass).
#   2. AGI source is at /mnt/agi (bind-mounted from host workspace).
#   3. No systemd agi.service unit (the VM runs the gateway as a plain
#      `node cli/dist/index.js run` nohup job, not as a system service).
# When in test VM: upgrade = rebuild from /mnt/agi directly (no git pull,
# no release channel). When in production: delegate to upgrade.sh which
# pulls from gateway.updateChannel and builds /opt/agi.
is_test_vm() {
  [ "$(cat /etc/hostname 2>/dev/null)" = "agi-test" ] \
    && [ -d /mnt/agi ] \
    && [ -f /mnt/agi/package.json ]
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_status() {
  echo -e "${BOLD}Aionima Gateway Status${RESET}"
  echo ""

  # Service — combine systemd state with a port-bind probe so the surface
  # distinguishes "process up + Fastify bound" (truly running) from
  # "process up + Fastify never bound" (boot error after the systemd unit
  # came up — looks running but won't serve requests). Born from the
  # v0.4.187 → v0.4.188 hotfix where a route-collision crashed Fastify
  # at boot but systemd still reported "active"; agi status said "running"
  # while Caddy returned 502 to every dashboard request. (s101 t408)
  label "Service:"
  local _port
  _port="$(node -e "try{const c=JSON.parse(require('fs').readFileSync('${CONFIG_FILE}','utf-8'));console.log(c.gateway?.port??3100)}catch{console.log(3100)}" 2>/dev/null)"
  _port="${_port:-3100}"
  if is_running; then
    if curl -sf --max-time 2 "http://127.0.0.1:${_port}/api/system/stats" >/dev/null 2>&1; then
      echo -e "${GREEN}running${RESET}"
    else
      echo -e "${YELLOW}running but unresponsive${RESET} ${MUTED}— Fastify did not bind to port ${_port}. Run 'agi logs' to see the boot error; consider 'pnpm route-check' if the cause may be a duplicate route.${RESET}"
    fi
  else
    local state
    state="$(systemctl is-active "$SERVICE" 2>/dev/null || echo "unknown")"
    echo -e "${RED}${state}${RESET}"
  fi

  # PID + uptime
  local pid
  pid="$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null)"
  if [ -n "$pid" ] && [ "$pid" != "0" ]; then
    label "PID:"
    echo "$pid"
    local start
    start="$(systemctl show -p ActiveEnterTimestamp --value "$SERVICE" 2>/dev/null)"
    if [ -n "$start" ]; then
      label "Since:"
      echo "$start"
    fi
  fi

  # Memory
  local mem
  mem="$(systemctl show -p MemoryCurrent --value "$SERVICE" 2>/dev/null)"
  if [ -n "$mem" ] && [ "$mem" != "[not set]" ] && [ "$mem" != "infinity" ]; then
    label "Memory:"
    echo "$((mem / 1024 / 1024))MB"
  fi

  # Deployed commit
  if [ -f "$DEPLOY_DIR/.deployed-commit" ]; then
    label "Commit:"
    cat "$DEPLOY_DIR/.deployed-commit"
  fi

  # Remote check — use the configured update channel (dev or main)
  if [ -d "$DEPLOY_DIR/.git" ]; then
    cd "$DEPLOY_DIR"
    local channel
    channel="$(node -e "try { const c = JSON.parse(require('fs').readFileSync('${CONFIG_FILE}','utf-8')); console.log(c.gateway?.updateChannel === 'dev' ? 'dev' : 'main'); } catch { console.log('main'); }" 2>/dev/null)"
    channel="${channel:-main}"
    git fetch --quiet origin "$channel" 2>/dev/null
    local local_rev remote_rev
    local_rev="$(git rev-parse HEAD 2>/dev/null)"
    remote_rev="$(git rev-parse "origin/${channel}" 2>/dev/null)"
    if [ "$local_rev" != "$remote_rev" ]; then
      local behind
      behind="$(git rev-list --count "HEAD..origin/${channel}" 2>/dev/null || echo "?")"
      label "Update:"
      echo -e "${YELLOW}${behind} commit(s) behind (${channel})${RESET}"
    else
      label "Update:"
      echo -e "${GREEN}up to date (${channel})${RESET}"
    fi
  fi

  # Port
  label "Port:"
  node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('${CONFIG_FILE}','utf-8'));
      console.log(c.gateway?.port ?? 3100);
    } catch { console.log('3100 (default)'); }
  " 2>/dev/null || echo "3100 (default)"

  # Hosting infra
  echo ""
  echo -e "${BOLD}Infrastructure${RESET}"
  label "Caddy:"
  systemctl is-active caddy 2>/dev/null || echo "not installed"
  label "Podman:"
  if command -v podman &>/dev/null; then
    echo -e "${GREEN}installed${RESET} ($(podman --version 2>/dev/null | head -1))"
  else
    echo -e "${RED}not installed${RESET}"
  fi
  label "dnsmasq:"
  systemctl is-active dnsmasq 2>/dev/null || echo "not installed"

  # Running containers
  local containers
  containers="$(podman ps --filter label=aionima.managed=true --format '{{.Names}}' 2>/dev/null | wc -l)"
  label "Containers:"
  echo "${containers} running"
}

cmd_logs() {
  local lines="${1:-50}"
  local log_file="${LOG_DIR}/agi.log"

  if [ -f "$log_file" ]; then
    tail -n "$lines" "$log_file"
  else
    # Fallback to journalctl
    sudo journalctl -u "$SERVICE" --no-pager -n "$lines" --output cat
  fi
}

cmd_logs_follow() {
  local log_file="${LOG_DIR}/agi.log"

  if [ -f "$log_file" ]; then
    tail -f "$log_file"
  else
    sudo journalctl -u "$SERVICE" --no-pager -f --output cat
  fi
}

cmd_upgrade() {
  # Test-VM mode: source is already mounted + up to date via the host
  # bind mount. Just rebuild + restart the nohup gateway process. No
  # git pull, no release channel, no /opt/agi.
  if is_test_vm; then
    info "Test-VM upgrade — rebuilding from /mnt/agi (no pull)"
    cd /mnt/agi
    pnpm --filter @agi/db-schema build 2>&1 | tail -3 || { err "db-schema build failed"; exit 1; }
    pnpm --filter @agi/dashboard build 2>&1 | tail -3 || { err "dashboard build failed"; exit 1; }
    pnpm exec tsdown 2>&1 | tail -3 || { err "tsdown build failed"; exit 1; }
    # Restart the gateway nohup job managed by scripts/test-vm.sh services-start
    [ -f /tmp/agi.pid ] && kill "$(cat /tmp/agi.pid)" 2>/dev/null || true
    sleep 1
    nohup node cli/dist/index.js run > /tmp/agi.log 2>&1 &
    echo $! > /tmp/agi.pid
    # Wait for port 3100 (reliably bound after boot)
    local tries=0
    while ! curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/api/system/stats | grep -q "^2"; do
      tries=$((tries + 1))
      [ "$tries" -gt 20 ] && break
      sleep 2
    done
    if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/api/system/stats | grep -q "^2"; then
      ok "Test-VM gateway restarted on new build"
    else
      err "Test-VM gateway did not come back up"
      warn "Check: tail /tmp/agi.log"
      exit 1
    fi
    return 0
  fi

  if ! [ -d "$DEPLOY_DIR" ]; then
    err "Deploy directory not found: $DEPLOY_DIR"
    exit 1
  fi

  info "Starting upgrade..."
  cd "$DEPLOY_DIR"

  local deploy_script="$DEPLOY_DIR/scripts/upgrade.sh"
  if [ ! -x "$deploy_script" ]; then
    err "upgrade.sh not found or not executable"
    exit 1
  fi

  local upgrade_exit=0
  bash "$deploy_script" 2>&1 | while IFS= read -r line; do
    # Parse structured JSON output from upgrade.sh
    local phase status details
    phase="$(echo "$line" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));process.stdout.write(d.phase||'')}catch{}" 2>/dev/null)"
    status="$(echo "$line" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));process.stdout.write(d.status||'')}catch{}" 2>/dev/null)"
    details="$(echo "$line" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));process.stdout.write(d.details||'')}catch{}" 2>/dev/null)"

    if [ -n "$phase" ]; then
      case "$status" in
        start) info "[${phase}] Starting..." ;;
        done)  ok   "[${phase}] ${details:-Done}" ;;
        error) err  "[${phase}] ${details:-Failed}" ;;
        *)     echo "$line" ;;
      esac
    else
      # Non-JSON output — print as-is (build output, etc.)
      echo "  $line"
    fi
  done
  upgrade_exit=${PIPESTATUS[0]}

  echo ""
  if [ "$upgrade_exit" -ne 0 ]; then
    err "Upgrade failed (exit code $upgrade_exit)"
    warn "Check: agi logs 30"
  elif is_running; then
    ok "Upgrade complete — service is running"
  else
    err "Upgrade finished but service is not running"
    warn "Check: agi logs 30"
  fi
}

cmd_restart() {
  info "Restarting $SERVICE..."
  sudo systemctl restart "$SERVICE"
  sleep 2
  if is_running; then
    ok "Service restarted"
  else
    err "Service failed to start"
    warn "Check: agi logs 30"
  fi
}

cmd_start() {
  info "Starting $SERVICE..."
  sudo systemctl start "$SERVICE"
  sleep 2
  if is_running; then
    ok "Service started"
  else
    err "Service failed to start"
  fi
}

cmd_stop() {
  info "Stopping $SERVICE..."
  sudo systemctl stop "$SERVICE"
  ok "Service stopped"
}

cmd_safemode() {
  local action="${1:-status}"
  local gw_url
  gw_url="http://127.0.0.1:3100"
  case "$action" in
    status|"")
      echo -e "${BOLD}Safemode status${RESET}"
      curl -s "$gw_url/api/admin/safemode" | (command -v jq >/dev/null && jq . || cat)
      ;;
    exit)
      info "Exiting safemode (runs recovery)..."
      curl -s -X POST "$gw_url/api/admin/safemode/exit" | (command -v jq >/dev/null && jq . || cat)
      ;;
    *)
      err "Unknown safemode action: $action (use 'status' or 'exit')"
      exit 1
      ;;
  esac
}

cmd_incidents() {
  local action="${1:-list}"
  local gw_url
  gw_url="http://127.0.0.1:3100"
  case "$action" in
    list|"")
      echo -e "${BOLD}Recent incidents${RESET}"
      curl -s "$gw_url/api/admin/incidents" | (command -v jq >/dev/null && jq . || cat)
      ;;
    view)
      local id="${2:-}"
      if [ -z "$id" ]; then
        err "usage: agi incidents view <id>"
        exit 1
      fi
      curl -s "$gw_url/api/admin/incidents/$id"
      ;;
    *)
      err "Unknown incidents action: $action (use 'list' or 'view <id>')"
      exit 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# agi scan — security scanning surface (s109 prep, t365)
#
# Triggers a scan via the gateway's /api/security HTTP API, polls until
# completion, and renders findings to the terminal grouped by severity.
# Exit codes (CI-friendly):
#   0 — scan completed clean (no findings >= severityThreshold)
#   1 — scan completed with medium/low findings
#   2 — scan completed with high/critical findings
#   3 — scan failed or was cancelled
#   4 — invocation error (unreachable gateway, bad args)
# ---------------------------------------------------------------------------
cmd_scan() {
  local action="${1:-}"
  local gw_url="http://127.0.0.1:3100"

  # Subcommand dispatch — match before path-parsing so `agi scan list` etc.
  # don't treat their action verb as a target path.
  case "$action" in
    list)
      echo -e "${BOLD}Recent security scans${RESET}"
      curl -s "$gw_url/api/security/scans" | (command -v jq >/dev/null && jq . || cat)
      return 0
      ;;
    view)
      local id="${2:-}"
      if [ -z "$id" ]; then
        err "usage: agi scan view <scanId>"
        return 4
      fi
      echo -e "${BOLD}Scan ${id}${RESET}"
      curl -s "$gw_url/api/security/scans/$id" | (command -v jq >/dev/null && jq . || cat)
      echo ""
      echo -e "${BOLD}Findings${RESET}"
      curl -s "$gw_url/api/security/scans/$id/findings" | (command -v jq >/dev/null && jq . || cat)
      return 0
      ;;
    cancel)
      local id="${2:-}"
      if [ -z "$id" ]; then
        err "usage: agi scan cancel <scanId>"
        return 4
      fi
      curl -s -X POST "$gw_url/api/security/scans/$id/cancel" \
        | (command -v jq >/dev/null && jq . || cat)
      return 0
      ;;
    ""|"-h"|"--help"|"help")
      cat <<USAGE
Usage: agi scan <command|path> [options]

Commands:
  agi scan <path>              Run a scan on <path>, poll until done,
                               render findings grouped by severity.
  agi scan list                List recent scan runs.
  agi scan view <scanId>       Show details + findings for a scan.
  agi scan cancel <scanId>     Cancel an in-flight scan.

Options for run mode:
  --types=t1,t2     Comma-separated scanners (default: sast,sca,secrets,config)
  --severity=lvl    Min severity to surface in exit code (default: high)
                    One of: critical, high, medium, low, info

Examples:
  agi scan /opt/agi
  agi scan /home/wishborn/temp_core/agi --types=sast,secrets
  agi scan ~/.agi/plugins/cache/foo --severity=medium
USAGE
      return 0
      ;;
  esac

  # Run mode: $1 is the target path, optionally followed by --flags.
  local target="$1"
  shift || true
  local types="sast,sca,secrets,config"
  local severity="high"
  while [ $# -gt 0 ]; do
    case "$1" in
      --types=*)    types="${1#--types=}" ;;
      --severity=*) severity="${1#--severity=}" ;;
      *)            err "unknown option: $1"; return 4 ;;
    esac
    shift
  done

  if [ ! -e "$target" ]; then
    err "target path does not exist: $target"
    return 4
  fi
  target="$(cd -P "$target" 2>/dev/null && pwd)" || target="$1"

  # Health-check the gateway before posting the scan request — cheap probe
  # avoids a hang when the gateway is offline.
  if ! curl -s --max-time 3 "$gw_url/api/system/stats" >/dev/null 2>&1; then
    err "gateway unreachable at $gw_url — is agi running? (try: agi status)"
    return 4
  fi

  # Build the scan-types JSON array
  local types_json
  types_json=$(printf '%s' "$types" | awk -F, '{
    out="["
    for (i=1; i<=NF; i++) { if (i>1) out=out","; out=out"\""$i"\"" }
    print out"]"
  }')

  echo -e "${BOLD}Starting scan${RESET}: $target (types: $types)"
  local resp
  resp=$(curl -s -X POST "$gw_url/api/security/scans" \
    -H "Content-Type: application/json" \
    -d "{\"targetPath\":\"$target\",\"scanTypes\":$types_json,\"severityThreshold\":\"$severity\"}")
  local scan_id
  scan_id=$(printf '%s' "$resp" | (command -v jq >/dev/null && jq -r '.scanId // ""' || sed -E 's/.*"scanId"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'))
  if [ -z "$scan_id" ] || [ "$scan_id" = "unknown" ] || [ "$scan_id" = "null" ]; then
    err "could not create scan run; response: $resp"
    return 4
  fi
  ok "scan id: $scan_id"

  # Poll until status leaves running/pending. Cap at 5 minutes; longer
  # scans should be tracked via `agi scan view` rather than blocking the
  # terminal indefinitely.
  echo -n "  status:"
  local elapsed=0
  local status="running"
  local detail_json=""
  while [ "$elapsed" -lt 300 ]; do
    detail_json=$(curl -s "$gw_url/api/security/scans/$scan_id")
    status=$(printf '%s' "$detail_json" | (command -v jq >/dev/null && jq -r '.status // "unknown"' || sed -E 's/.*"status"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'))
    case "$status" in
      completed|failed|cancelled) break ;;
    esac
    printf ' %s' "$status"
    sleep 3
    elapsed=$((elapsed + 3))
  done
  echo ""

  case "$status" in
    cancelled) err "scan cancelled"; return 3 ;;
    failed)    err "scan failed"; printf '%s\n' "$detail_json" | (command -v jq >/dev/null && jq . || cat); return 3 ;;
    completed) ok "scan completed in ${elapsed}s" ;;
    *)         err "scan still ${status} after ${elapsed}s — use 'agi scan view $scan_id' to follow"; return 3 ;;
  esac

  # Render findings grouped by severity
  echo ""
  echo -e "${BOLD}Findings${RESET}"
  local findings_json
  findings_json=$(curl -s "$gw_url/api/security/scans/$scan_id/findings")
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$findings_json" | jq -r '
      group_by(.severity)
      | map({sev: .[0].severity, count: length, items: .})
      | sort_by(["critical","high","medium","low","info"] | index(.sev) // 999)
      | .[] |
        "\n[\(.sev | ascii_upcase)] \(.count) finding(s)\n" +
        (.items | map("  - \(.checkId // "no-id") · \(.title)\n      \(.description // "" | tostring | .[0:120])") | join("\n"))
    '
  else
    printf '%s\n' "$findings_json"
  fi

  # Exit code by severity threshold
  local high_count med_count
  high_count=$(printf '%s' "$findings_json" | (command -v jq >/dev/null && jq -r 'map(select(.severity=="critical" or .severity=="high")) | length' || echo 0))
  med_count=$(printf '%s' "$findings_json" | (command -v jq >/dev/null && jq -r 'map(select(.severity=="medium" or .severity=="low")) | length' || echo 0))
  echo ""
  if [ "$high_count" -gt 0 ]; then
    err "$high_count high/critical finding(s) — exit 2"
    return 2
  fi
  if [ "$med_count" -gt 0 ]; then
    warn "$med_count medium/low finding(s) — exit 1"
    return 1
  fi
  ok "scan clean — exit 0"
  return 0
}

cmd_doctor() {
  echo -e "${BOLD}Aionima Doctor${RESET}"
  echo ""
  local issues=0

  # Node.js
  label "Node.js:"
  if command -v node &>/dev/null; then
    ok "$(node --version)"
  else
    err "not installed"; issues=$((issues + 1))
  fi

  # pnpm
  label "pnpm:"
  if command -v pnpm &>/dev/null; then
    ok "$(pnpm --version)"
  else
    err "not installed"; issues=$((issues + 1))
  fi

  # Deploy dir
  label "Deploy dir:"
  if [ -d "$DEPLOY_DIR" ]; then
    ok "$DEPLOY_DIR"
  else
    err "missing: $DEPLOY_DIR"; issues=$((issues + 1))
  fi

  # Config
  label "Config:"
  if [ -f "$CONFIG_FILE" ]; then
    ok "$CONFIG_FILE"
  else
    warn "missing (will use defaults)";
  fi

  # Caddy — story #100 moved Caddy into a rootless user-scope container
  # on the aionima network. Prefer the containerized form; fall back to
  # legacy system Caddy only for pre-migration hosts.
  label "Caddy:"
  # SUDO_USER is only set when the script was launched via sudo. Doctor
  # is designed to work both ways (plain user invocation and sudo), so
  # default to the current user when SUDO_USER is absent rather than
  # crashing under `set -u`.
  local _sudo_user="${SUDO_USER:-$(whoami)}"
  if sudo -u "$_sudo_user" XDG_RUNTIME_DIR=/run/user/$(id -u "$_sudo_user" 2>/dev/null) \
       systemctl --user is-active --quiet agi-caddy 2>/dev/null \
     || systemctl --user is-active --quiet agi-caddy 2>/dev/null; then
    ok "agi-caddy (containerized, aionima) running"
  elif podman container exists agi-caddy 2>/dev/null \
     && [ "$(podman container inspect -f '{{.State.Status}}' agi-caddy 2>/dev/null)" = "running" ]; then
    ok "agi-caddy (containerized) running"
  elif systemctl is-active --quiet caddy 2>/dev/null; then
    warn "legacy system caddy active — story #100 cutover incomplete"; issues=$((issues + 1))
  elif command -v caddy &>/dev/null; then
    warn "installed but not running"; issues=$((issues + 1))
  else
    err "not installed"; issues=$((issues + 1))
  fi

  # Podman
  label "Podman:"
  if command -v podman &>/dev/null; then
    local rootless
    rootless="$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null)"
    if [ "$rootless" = "true" ]; then
      ok "rootless"
    else
      warn "not rootless"; issues=$((issues + 1))
    fi
  else
    err "not installed"; issues=$((issues + 1))
  fi

  # Ollama
  label "Ollama:"
  if command -v ollama &>/dev/null; then
    if systemctl is-active --quiet ollama 2>/dev/null; then
      local model_count
      model_count="$(ollama list 2>/dev/null | tail -n +2 | wc -l)"
      ok "running (${model_count} model(s))"
    else
      warn "installed but not running"
    fi
  else
    warn "not installed (text-gen uses slower transformers runtime)"
  fi

  # dnsmasq
  label "dnsmasq:"
  if systemctl is-active --quiet dnsmasq 2>/dev/null; then
    ok "running"
  else
    warn "not running"; issues=$((issues + 1))
  fi

  # Port
  local port
  port="$(node -e "try{const c=JSON.parse(require('fs').readFileSync('${CONFIG_FILE}','utf-8'));console.log(c.gateway?.port??3100)}catch{console.log(3100)}" 2>/dev/null)"
  label "Port $port:"
  if curl -sf "http://127.0.0.1:${port}/api/system/stats" >/dev/null 2>&1; then
    ok "responding"
  else
    warn "not responding"; issues=$((issues + 1))
  fi

  # Dev Mode origin alignment (Phase H.1) — only shown when Dev Mode is on.
  # Checks each /opt/*/.git origin against the corresponding dev.*Repo
  # from gateway.json so owners can see whether v0.4.66's
  # ensure_origin_remote has completed the one-time flip.
  local dev_enabled dev_agi_repo dev_prime_repo dev_id_repo
  dev_enabled="$(node -e "try{const c=JSON.parse(require('fs').readFileSync('${CONFIG_FILE}','utf-8'));console.log(c.dev?.enabled===true?'true':'false')}catch{console.log('false')}" 2>/dev/null)"
  if [ "$dev_enabled" = "true" ]; then
    dev_agi_repo="$(node -e "try{const c=JSON.parse(require('fs').readFileSync('${CONFIG_FILE}','utf-8'));process.stdout.write(c.dev?.agiRepo??'')}catch{}" 2>/dev/null)"
    dev_prime_repo="$(node -e "try{const c=JSON.parse(require('fs').readFileSync('${CONFIG_FILE}','utf-8'));process.stdout.write(c.dev?.primeRepo??'')}catch{}" 2>/dev/null)"
    dev_id_repo="$(node -e "try{const c=JSON.parse(require('fs').readFileSync('${CONFIG_FILE}','utf-8'));process.stdout.write(c.dev?.idRepo??'')}catch{}" 2>/dev/null)"
    _check_origin() {
      local name="$1" dir="$2" expected="$3"
      label "$name:"
      if [ ! -d "$dir/.git" ]; then
        warn "$dir not a git repo"; return
      fi
      local current
      current="$(git -C "$dir" remote get-url origin 2>/dev/null)" || {
        warn "could not read origin"; return
      }
      if [ -z "$expected" ]; then
        warn "no dev.*Repo configured — toggle Dev Mode off then on in dashboard"
        return
      fi
      if [ "$current" = "$expected" ]; then
        ok "origin → $current"
      else
        warn "origin → $current (expected $expected) — run 'agi upgrade'"
        issues=$((issues + 1))
      fi
    }
    _check_origin "AGI origin" "/opt/agi" "$dev_agi_repo"
    _check_origin "PRIME origin" "/opt/agi-prime" "$dev_prime_repo"
    _check_origin "ID origin" "/opt/agi-local-id" "$dev_id_repo"
  fi

  # NPU readiness probe — the chain that must be healthy for Lemonade/FLM
  # to use the AMD XDNA 2 NPU: device node → signed amdxdna module loaded →
  # FLM recognizes the device. Each step fails with a specific remediation
  # so the user knows exactly which knob to turn.
  if [ -e /sys/class/accel/accel0 ] || [ -d /sys/class/accel ] || [ -e /dev/accel/accel0 ]; then
    label "NPU device:"
    if [ -c /dev/accel/accel0 ]; then
      ok "/dev/accel/accel0"
    else
      warn "/dev/accel/accel0 missing — reload amdxdna kernel module"
      issues=$((issues + 1))
    fi

    label "amdxdna module:"
    # Read /proc/modules directly instead of piping lsmod → grep: the pipe
    # form triggers SIGPIPE under pipefail and returns 141, inverting the if.
    local loaded_signer=""
    if grep -q '^amdxdna ' /proc/modules 2>/dev/null; then
      local modinfo_out
      modinfo_out="$(modinfo amdxdna 2>/dev/null || true)"
      loaded_signer="$(echo "$modinfo_out" | awk -F': *' '/^signer:/ {print $2; exit}')"
      if [ -n "$loaded_signer" ]; then
        ok "loaded (signer: $loaded_signer)"
      else
        ok "loaded (unsigned — Secure Boot disabled)"
      fi
    else
      warn "not loaded — try: sudo modprobe amdxdna (and 'agi doctor' again)"
      issues=$((issues + 1))
    fi

    # Secure Boot / MOK enrollment. Uses `mokutil --test-key` (non-root
    # friendly) for enrolled detection; `--list-new` needs root so we fall
    # back to `sudo -n` and then to a marker file written by the installer.
    if dpkg -l amdxdna-dkms 2>/dev/null | grep -q '^ii'; then
      local sb_state
      sb_state="$(mokutil --sb-state 2>/dev/null || true)"
      if echo "$sb_state" | grep -qi 'SecureBoot enabled'; then
        label "MOK enrollment:"
        local mok_file=/var/lib/shim-signed/mok/MOK.der
        local mok_pending_marker=/var/lib/aionima/mok-enrollment-pending
        if [ ! -r "$mok_file" ]; then
          err "MOK file missing at $mok_file — re-run agi-lemonade-runtime installer"
          issues=$((issues + 1))
        else
          local test_out
          test_out="$(mokutil --test-key "$mok_file" 2>&1 || true)"
          if echo "$test_out" | grep -qi 'is already enrolled'; then
            ok "Aionima MOK enrolled (Secure Boot compatible)"
          else
            local new_out
            new_out="$(sudo -n mokutil --list-new 2>/dev/null || true)"
            local mok_fp
            mok_fp="$(openssl x509 -in "$mok_file" -inform DER -noout -fingerprint -sha1 2>/dev/null | cut -d= -f2 | tr -d : | tr '[:upper:]' '[:lower:]')"
            local new_fps
            new_fps="$(echo "$new_out" | grep -oE '[0-9a-f]{2}(:[0-9a-f]{2}){19}' | tr -d : | tr '[:upper:]' '[:lower:]')"
            if [ -n "$mok_fp" ] && echo "$new_fps" | grep -qx "$mok_fp"; then
              warn "pending — reboot and enroll at MokManager (password: aionima)"
            elif [ -f "$mok_pending_marker" ]; then
              warn "pending — reboot and enroll at MokManager (password: see $mok_pending_marker)"
            else
              err "MOK not enrolled — signed amdxdna module cannot load under Secure Boot. Reinstall agi-lemonade-runtime plugin to queue enrollment."
              issues=$((issues + 1))
            fi
          fi
        fi
      fi
    fi

    # IOMMU domain type for the NPU — amdxdna needs translated (DMA) mode
    # to bind SVA. Ubuntu's default on platform-attached devices is
    # identity (passthrough), which causes FLM to report "No NPU device
    # found" even with everything else healthy.
    local npu_bdf="" iommu_group_type=""
    npu_bdf="$(lspci -D -nn 2>/dev/null | awk '/17f0|1502/ && /Signal processing/ {print $1; exit}')"
    if [ -n "$npu_bdf" ] && [ -L "/sys/bus/pci/devices/$npu_bdf/iommu_group" ]; then
      local iommu_group
      iommu_group="$(readlink -f "/sys/bus/pci/devices/$npu_bdf/iommu_group" | sed 's|.*/||')"
      iommu_group_type="$(cat "/sys/kernel/iommu_groups/$iommu_group/type" 2>/dev/null || echo unknown)"
      label "NPU IOMMU domain:"
      case "$iommu_group_type" in
        DMA|DMA-FQ)
          ok "$iommu_group_type (SVA-compatible)"
          ;;
        identity)
          if [ -f /var/lib/aionima/iommu-reboot-pending ]; then
            warn "identity — reboot pending (GRUB cmdline updated by plugin installer)"
          elif grep -q 'amd_iommu=force_isolation' /proc/cmdline 2>/dev/null; then
            warn "identity — cmdline has force_isolation but driver may have claimed device early; reboot typically fixes this"
          else
            err "identity (passthrough) — blocks SVA binding. Add 'amd_iommu=force_isolation iommu.passthrough=0' to GRUB_CMDLINE_LINUX_DEFAULT and reboot. Reinstall agi-lemonade-runtime plugin to auto-fix."
            issues=$((issues + 1))
          fi
          ;;
        *)
          warn "$iommu_group_type — unexpected; expected DMA for NPU SVA support"
          ;;
      esac
    fi

    # NPU PCIe capabilities. The amdxdna driver calls iommu_sva_bind_device
    # on every open() — no non-SVA code path. AMD IOMMU's SVA enable gate
    # requires PASID + ATS + PRI on the endpoint. Some BIOS/AGESA revisions
    # expose PASID but omit ATS/PRI; when that happens, SVA returns
    # EOPNOTSUPP and no userspace can open /dev/accel/accel0. This is a
    # BIOS/firmware issue, not a Linux one — surface it as such so the user
    # doesn't burn hours chasing kernel configs.
    local npu_has_pasid=0 npu_has_ats=0 npu_has_pri=0
    if [ -n "$npu_bdf" ] && command -v lspci >/dev/null 2>&1; then
      label "NPU PCIe caps:"
      local caps_out
      caps_out="$(sudo -n lspci -vv -s "$npu_bdf" 2>/dev/null || lspci -v -s "$npu_bdf" 2>/dev/null || true)"
      echo "$caps_out" | grep -qiE 'Process Address Space ID|PASID' && npu_has_pasid=1
      echo "$caps_out" | grep -qiE 'Address Translation Service|\bATS\b' && npu_has_ats=1
      echo "$caps_out" | grep -qiE 'Page Request Interface|\bPRI\b' && npu_has_pri=1
      # Render: ✓ present, ✗ missing. PASID alone ≠ SVA-capable.
      local caps_str="PASID:"
      [ "$npu_has_pasid" -eq 1 ] && caps_str="${caps_str}ok" || caps_str="${caps_str}missing"
      caps_str="$caps_str ATS:"
      [ "$npu_has_ats" -eq 1 ] && caps_str="${caps_str}ok" || caps_str="${caps_str}missing"
      caps_str="$caps_str PRI:"
      [ "$npu_has_pri" -eq 1 ] && caps_str="${caps_str}ok" || caps_str="${caps_str}missing"
      if [ "$npu_has_pasid" -eq 1 ] && [ "$npu_has_ats" -eq 1 ] && [ "$npu_has_pri" -eq 1 ]; then
        ok "$caps_str"
      elif [ "$npu_has_pasid" -eq 1 ]; then
        err "$caps_str — BIOS-level blocker. NPU endpoint is missing ATS/PRI, which AMD IOMMU requires for SVA binding. amdxdna has no non-SVA path, so no userspace can open the device. Fix path: (1) BIOS → enable IOMMU + SR-IOV + PCIe ARI + any AMD IPU/NPU toggles; (2) update motherboard BIOS to the latest AGESA — Ryzen AI ATS/PRI exposure has shipped in several 2025-26 AGESA revisions; (3) if neither works, this NPU cannot be used from Linux on current firmware. Practical unblock: 'lemonade backends install llamacpp:rocm' uses the Radeon 890M iGPU instead."
        issues=$((issues + 1))
      else
        warn "$caps_str — unexpected; NPU should advertise at least PASID"
      fi
    fi

    # FastFlowLM + Lemonade userspace readiness. Capture output first to
    # avoid SIGPIPE/pipefail inverting the check.
    if command -v flm >/dev/null 2>&1; then
      label "FastFlowLM:"
      local flm_out
      flm_out="$(flm validate 2>&1 || true)"
      if echo "$flm_out" | grep -qi 'no npu device found'; then
        # Tailor the remediation to the most-likely root cause we've
        # already detected so the user sees ONE actionable line.
        if [ "$npu_has_pasid" -eq 1 ] && { [ "$npu_has_ats" -eq 0 ] || [ "$npu_has_pri" -eq 0 ]; }; then
          err "flm validate: No NPU device found — NPU missing PCIe ATS/PRI caps (see NPU PCIe caps above, BIOS-level blocker)."
        elif [ "$iommu_group_type" = "identity" ]; then
          err "flm validate: No NPU device found — IOMMU in passthrough mode blocks SVA binding (see above)."
        else
          err "flm validate: No NPU device found — check dmesg for 'amdxdna' errors."
        fi
        issues=$((issues + 1))
      else
        ok "flm validate passes"
      fi
    fi
  fi

  # Lemonade local AI server — the AGI-native local LLM backplane (Phase K.7).
  # Goes through /api/lemonade/status (the proxy we own) so the row
  # reflects what AGI sees, not what a direct Lemonade probe would say.
  # Always renders — invisible "plugin not installed" is the whole bug K.7
  # set out to fix. Four possible states surfaced explicitly:
  #   1. plugin not installed      → /api/lemonade/status 503/empty
  #   2. plugin installed, stopped → status JSON but running=false
  #   3. plugin running, no model  → running=true, modelLoaded=null
  #   4. plugin running, happy     → running=true with model + backends
  label "Lemonade:"
  local lemonade_resp
  lemonade_resp="$(curl -sS --max-time 5 http://127.0.0.1:3100/api/lemonade/status 2>/dev/null || true)"
  # Distinguish "empty" from "JSON-but-error" — empty means the proxy didn't
  # respond at all, which is how the gateway signals "plugin not installed".
  local lemonade_is_json="False"
  if [ -n "$lemonade_resp" ]; then
    lemonade_is_json="$(echo "$lemonade_resp" | python3 -c "import json,sys
try:
  d=json.load(sys.stdin)
  print('True' if isinstance(d, dict) else 'False')
except Exception:
  print('False')
" 2>/dev/null || echo False)"
  fi
  if [ "$lemonade_is_json" = "True" ]; then
    local lemonade_running lemonade_version lemonade_loaded lemonade_recipes
    lemonade_running="$(echo "$lemonade_resp" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('running', False))" 2>/dev/null || echo False)"
    if [ "$lemonade_running" = "True" ]; then
      lemonade_version="$(echo "$lemonade_resp" | python3 -c "import json,sys; print(json.load(sys.stdin).get('version', '?'))" 2>/dev/null)"
      lemonade_loaded="$(echo "$lemonade_resp" | python3 -c "import json,sys; print(json.load(sys.stdin).get('modelLoaded') or '(none)')" 2>/dev/null)"
      lemonade_recipes="$(echo "$lemonade_resp" | python3 -c "
import json,sys
d=json.load(sys.stdin)
recipes=d.get('recipes') or {}
installed=[]
for r,info in recipes.items():
    for be,bi in info.get('backends',{}).items():
        if bi.get('state')=='installed':
            installed.append(f'{r}:{be}')
print(','.join(installed) if installed else '(none)')
" 2>/dev/null)"
      if [ "$lemonade_loaded" = "(none)" ]; then
        warn "v${lemonade_version} running — backends:${lemonade_recipes} but no model loaded. Pull one: 'agi lemonade pull <model>'"
      else
        ok "v${lemonade_version} running — backends:${lemonade_recipes} loaded:${lemonade_loaded}"
      fi
    else
      warn "/api/lemonade/status responded but running=false — start the plugin from the dashboard or 'agi lemonade status'"
      issues=$((issues + 1))
    fi
  else
    warn "not installed (no /api/lemonade/status response) — install agi-lemonade-runtime from the Plugin Marketplace"
    issues=$((issues + 1))
  fi

  # Disk
  label "Disk:"
  local disk_pct
  disk_pct="$(df / --output=pcent | tail -1 | tr -d ' %')"
  if [ "$disk_pct" -gt 90 ]; then
    err "${disk_pct}% used"; issues=$((issues + 1))
  elif [ "$disk_pct" -gt 80 ]; then
    warn "${disk_pct}% used"
  else
    ok "${disk_pct}% used"
  fi

  # Hosted projects (story #110 — make `agi doctor` cover hosted-project state
  # alongside infra checks; same data source as `agi projects`'s RUN column).
  label "Hosted projects:"
  local total_enabled=0
  local down_names=""
  local flapping_names=""
  local running_containers
  running_containers="$(podman ps --format '{{.Names}}' 2>/dev/null || true)"
  for config_dir in "$AGI_DIR"/*/; do
    local cfg_file="${config_dir}project.json"
    [ -f "$cfg_file" ] || continue
    local probe
    probe="$(node -e "
      try {
        const data = JSON.parse(require('fs').readFileSync('${cfg_file}','utf-8'));
        const h = data.hosting || {};
        if (h.enabled && h.hostname) {
          const slug = require('path').basename(require('path').dirname('${cfg_file}'));
          const name = data.name || slug;
          console.log('enabled|' + name + '|agi-' + h.hostname);
        } else {
          console.log('|||');
        }
      } catch { console.log('|||'); }
    " 2>/dev/null)"
    [ "${probe%%|*}" = "enabled" ] || continue
    total_enabled=$((total_enabled + 1))
    local proj_name="${probe#enabled|}"
    proj_name="${proj_name%%|*}"
    local container="${probe##*|}"
    if ! printf '%s\n' "$running_containers" | grep -qx "$container"; then
      down_names="${down_names}${down_names:+, }${proj_name}"
    else
      # Container is up — probe RestartCount for chronic-fail detection
      # (story #110 t359). --restart=always (current podman policy)
      # silently restarts crashed containers; without this surface, a
      # project flapping 50 times an hour reads as "up" everywhere.
      # Threshold of 3 = generous for transient hiccups, tight enough
      # that a real misconfig shows up.
      local restart_count
      restart_count="$(podman inspect --format '{{.RestartCount}}' "$container" 2>/dev/null || echo 0)"
      if [ -n "$restart_count" ] && [ "$restart_count" -gt 3 ] 2>/dev/null; then
        flapping_names="${flapping_names}${flapping_names:+, }${proj_name}(${restart_count}x)"
      fi
    fi
  done
  if [ "$total_enabled" -eq 0 ]; then
    ok "no enabled projects"
  elif [ -z "$down_names" ] && [ -z "$flapping_names" ]; then
    ok "${total_enabled}/${total_enabled} up"
  else
    if [ -n "$down_names" ]; then
      local down_count
      down_count="$(printf '%s\n' "$down_names" | tr ',' '\n' | wc -l | tr -d ' ')"
      warn "${down_count}/${total_enabled} down: ${down_names} — see 'agi projects' for detail"
      issues=$((issues + 1))
    fi
    if [ -n "$flapping_names" ]; then
      label "Flapping projects:"
      warn "${flapping_names} — auto-restarted multiple times; check 'agi projects logs <slug>'"
      issues=$((issues + 1))
    fi
  fi

  echo ""
  if [ "$issues" -eq 0 ]; then
    ok "All checks passed"
  else
    warn "$issues issue(s) found"
  fi
}

cmd_config() {
  local key="${1:-}"
  if [ ! -f "$CONFIG_FILE" ]; then
    err "Config not found: $CONFIG_FILE"
    exit 1
  fi

  if [ -z "$key" ]; then
    cat "$CONFIG_FILE"
  else
    node -e "
      const c = JSON.parse(require('fs').readFileSync('${CONFIG_FILE}','utf-8'));
      const keys = '${key}'.split('.');
      let v = c;
      for (const k of keys) { if (v == null) break; v = v[k]; }
      if (v === undefined) { console.error('Key not found: ${key}'); process.exit(1); }
      console.log(typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v));
    " 2>/dev/null
  fi
}

cmd_ollama() {
  local subcmd="${1:-status}"
  shift 2>/dev/null || true
  if ! command -v ollama &>/dev/null; then
    err "Ollama not installed. Install with: curl -fsSL https://ollama.ai/install.sh | sh"
    exit 1
  fi
  case "$subcmd" in
    status)
      systemctl is-active ollama 2>/dev/null || echo "stopped"
      ollama list 2>/dev/null
      ;;
    start)  sudo systemctl start ollama && ok "Ollama started" ;;
    stop)   sudo systemctl stop ollama && ok "Ollama stopped" ;;
    pull)   ollama pull "$@" ;;
    list)   ollama list ;;
    *)      ollama "$subcmd" "$@" ;;
  esac
}

cmd_test_vm() {
  local subcmd="${1:-status}"
  shift 2>/dev/null || true
  local script="$DEPLOY_DIR/scripts/test-vm.sh"
  if [ ! -f "$script" ]; then
    err "test-vm.sh not found at $script"
    exit 1
  fi
  bash "$script" "$subcmd" "$@"
}

# Resolve a project slug or name to its container name (agi-<hostname>).
# Echoes the container name on stdout; returns 1 if no match.
_resolve_project_container() {
  local query="$1"
  for config_dir in "$AGI_DIR"/*/; do
    local cfg_file="${config_dir}project.json"
    [ -f "$cfg_file" ] || continue
    local match
    match="$(node -e "
      try {
        const data = JSON.parse(require('fs').readFileSync('${cfg_file}','utf-8'));
        const h = data.hosting || {};
        if (!h.enabled || !h.hostname) { process.exit(1); }
        const slug = require('path').basename(require('path').dirname('${cfg_file}'));
        const name = data.name || slug;
        const q = '${query}';
        if (slug === q || name === q || h.hostname === q) {
          console.log('agi-' + h.hostname);
          process.exit(0);
        }
        process.exit(1);
      } catch { process.exit(1); }
    " 2>/dev/null)"
    if [ -n "$match" ]; then
      echo "$match"
      return 0
    fi
  done
  return 1
}

# Resolve a project slug/name to its filesystem path. Echoes the path on
# stdout; returns 1 if no match. The slug folder under ~/.agi/ encodes
# the path with `/` mangled to `-` (and leading `/` dropped); this helper
# walks the project.json files and returns the original path the API
# expects.
_resolve_project_path() {
  local query="$1"
  for config_dir in "$AGI_DIR"/*/; do
    local cfg_file="${config_dir}project.json"
    [ -f "$cfg_file" ] || continue
    local match
    match="$(node -e "
      try {
        const data = JSON.parse(require('fs').readFileSync('${cfg_file}','utf-8'));
        const h = data.hosting || {};
        const slug = require('path').basename(require('path').dirname('${cfg_file}'));
        const name = data.name || slug;
        const q = '${query}';
        if (slug === q || name === q || (h.hostname && h.hostname === q)) {
          // Slug encodes the original path with / → - and leading / dropped.
          // Reverse the mangling to feed the API.
          console.log('/' + slug.replace(/-/g, '/'));
          process.exit(0);
        }
        process.exit(1);
      } catch { process.exit(1); }
    " 2>/dev/null)"
    if [ -n "$match" ]; then
      echo "$match"
      return 0
    fi
  done
  return 1
}

cmd_projects_restart() {
  local query="${1:-}"
  if [ -z "$query" ]; then
    err "agi projects restart: missing project slug"
    echo "Usage: agi projects restart <slug>" >&2
    return 2
  fi

  local proj_path
  proj_path="$(_resolve_project_path "$query")" || {
    err "no project matching '${query}' (try 'agi projects' for the list)"
    return 1
  }

  info "restarting project at ${proj_path}"
  local gw_url="http://127.0.0.1:3100"
  local response
  response="$(curl -s -X POST "$gw_url/api/hosting/restart" \
    -H "Content-Type: application/json" \
    --data "$(printf '{"path":"%s"}' "$proj_path")" 2>&1)"

  # Pretty-print if jq is available; otherwise pass through.
  if command -v jq >/dev/null 2>&1; then
    echo "$response" | jq .
  else
    echo "$response"
  fi

  # Detect failure shape — gateway returns {ok:false, error: ...} on 500.
  if echo "$response" | grep -q '"ok":false\|"error"'; then
    if echo "$response" | grep -q '"ok":true'; then
      ok "restart issued"
      return 0
    fi
    err "restart failed (see response above)"
    return 1
  fi
  ok "restart issued"
}

cmd_projects_logs() {
  local query="${1:-}"
  if [ -z "$query" ]; then
    err "agi projects logs: missing project slug"
    echo "Usage: agi projects logs <slug> [--tail N] [-f]" >&2
    return 2
  fi

  local container
  container="$(_resolve_project_container "$query")" || {
    err "no enabled project matching '${query}' (try 'agi projects' for the list)"
    return 1
  }

  shift || true
  local tail="50"
  local follow=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --tail) tail="${2:-50}"; shift 2 ;;
      -f|--follow) follow="-f"; shift ;;
      *) shift ;;
    esac
  done

  if ! podman container exists "$container" 2>/dev/null; then
    err "container ${container} does not exist (is the project hosted? 'agi projects' shows status)"
    return 1
  fi

  info "container: ${container} (tail=${tail}${follow:+, follow})"
  echo ""
  podman logs --tail "$tail" $follow "$container" 2>&1
}

cmd_iw() {
  # Iterative-work operator commands (s159 t692). Currently:
  #   agi iw stop --project <path>   — flip enabled=false + force-clear
  #                                     in-flight tracking for one project
  #   agi iw stop --all              — same, all projects (nuclear option)
  #
  # Use case: Taskmaster runaway loop where the only previous fix was
  # restarting the gateway. These endpoints break the loop without
  # restart so log capture + state inspection remain possible.
  local action="${1:-}"
  shift || true
  local gw_url="http://127.0.0.1:3100"
  local fmt
  fmt="$(command -v jq >/dev/null && echo "jq ." || echo "cat")"

  case "$action" in
    stop)
      local project=""
      local all=false
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --project) project="${2:-}"; shift 2 ;;
          --all) all=true; shift ;;
          *) err "Unknown flag: $1"; exit 1 ;;
        esac
      done
      if [ "$all" = true ]; then
        info "Stopping iterative-work on ALL projects (force-clear + enabled=false)"
        curl -s -X POST "$gw_url/api/projects/iterative-work/stop-all" | ($fmt)
      elif [ -n "$project" ]; then
        info "Stopping iterative-work on project: $project"
        local encoded
        encoded="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$project")"
        curl -s -X POST "$gw_url/api/projects/iterative-work/stop?path=$encoded" | ($fmt)
      else
        err "Usage: agi iw stop --project <absolute-path> | agi iw stop --all"
        exit 1
      fi
      ;;
    *)
      err "Unknown iw action: $action"
      echo "  Actions: stop --project <path> | stop --all"
      exit 1
      ;;
  esac
}

cmd_issue() {
  # Wish #21 Slice 1 — agent-curated issue registry CLI.
  # Reads/writes per-project k/issues/ via the gateway HTTP API so
  # concurrency control + index maintenance stay server-side.
  local action="${1:-list}"
  shift || true
  local gw_url="http://127.0.0.1:3100"
  local fmt
  fmt="$(command -v jq >/dev/null && echo "jq ." || echo "cat")"

  case "$action" in
    list)
      local project=""
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --project) project="${2:-}"; shift 2 ;;
          *) err "Unknown flag: $1"; exit 1 ;;
        esac
      done
      if [ -n "$project" ]; then
        local encoded
        encoded="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$project")"
        curl -s "$gw_url/api/projects/issues?path=$encoded" | ($fmt)
      else
        curl -s "$gw_url/api/issues" | ($fmt)
      fi
      ;;
    search)
      # Wish #21 Slice 2 — free-text search across title + body + tags
      # with tag:/status: structured filters.
      local project=""
      local query=""
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --project) project="${2:-}"; shift 2 ;;
          *) query="${query:+$query }$1"; shift ;;
        esac
      done
      if [ -z "$project" ] || [ -z "$query" ]; then
        err "Usage: agi issue search <query> --project <absolute-path>"
        echo "  Examples:" >&2
        echo "    agi issue search 'plaid webhook' --project /path/to/proj" >&2
        echo "    agi issue search 'tag:auth status:open' --project /path/to/proj" >&2
        exit 1
      fi
      local encoded_path encoded_q
      encoded_path="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$project")"
      encoded_q="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$query")"
      curl -s "$gw_url/api/projects/issues/search?path=$encoded_path&q=$encoded_q" | ($fmt)
      ;;
    show)
      local id="${1:-}"
      shift || true
      local project=""
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --project) project="${2:-}"; shift 2 ;;
          *) err "Unknown flag: $1"; exit 1 ;;
        esac
      done
      if [ -z "$id" ] || [ -z "$project" ]; then
        err "Usage: agi issue show <id> --project <absolute-path>"
        exit 1
      fi
      local encoded
      encoded="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$project")"
      curl -s "$gw_url/api/projects/issues/$id?path=$encoded" | ($fmt)
      ;;
    file)
      local project=""
      local title=""
      local symptom=""
      local tool=""
      local exit_code=""
      local tags=""
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --project) project="${2:-}"; shift 2 ;;
          --title) title="${2:-}"; shift 2 ;;
          --symptom) symptom="${2:-}"; shift 2 ;;
          --tool) tool="${2:-}"; shift 2 ;;
          --exit) exit_code="${2:-}"; shift 2 ;;
          --tags) tags="${2:-}"; shift 2 ;;
          *) err "Unknown flag: $1"; exit 1 ;;
        esac
      done
      if [ -z "$project" ] || [ -z "$title" ] || [ -z "$symptom" ]; then
        err "Usage: agi issue file --project <absolute-path> --title <t> --symptom <s> [--tool <t>] [--exit <n>] [--tags a,b,c]"
        exit 1
      fi
      local encoded
      encoded="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$project")"
      python3 -c "
import json,sys,urllib.request
body={'title':sys.argv[1],'symptom':sys.argv[2]}
if sys.argv[3]: body['tool']=sys.argv[3]
if sys.argv[4]: body['exit_code']=int(sys.argv[4])
if sys.argv[5]: body['tags']=[t.strip() for t in sys.argv[5].split(',') if t.strip()]
data=json.dumps(body).encode()
req=urllib.request.Request(sys.argv[6],data=data,headers={'Content-Type':'application/json'},method='POST')
with urllib.request.urlopen(req) as r: print(r.read().decode())
" "$title" "$symptom" "$tool" "$exit_code" "$tags" "$gw_url/api/projects/issues?path=$encoded" | ($fmt)
      ;;
    raw)
      # Wish #21 Slice 5 — raw-tier auto-capture management.
      # Subcommands: list / promote <id> / clear
      local sub="${1:-list}"
      shift || true
      local project=""
      local title=""
      local tags=""
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --project) project="${2:-}"; shift 2 ;;
          --title) title="${2:-}"; shift 2 ;;
          --tags) tags="${2:-}"; shift 2 ;;
          *) break ;;
        esac
      done
      if [ -z "$project" ]; then
        err "Usage: agi issue raw <list|promote <id>|clear> --project <absolute-path>"
        exit 1
      fi
      local encoded
      encoded="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$project")"
      case "$sub" in
        list)
          curl -s "$gw_url/api/projects/issues/raw?path=$encoded" | ($fmt)
          ;;
        promote)
          local raw_id="$1"
          if [ -z "$raw_id" ]; then
            err "Usage: agi issue raw promote <raw-id> --project <path> [--title <t>] [--tags a,b,c]"
            exit 1
          fi
          python3 -c "
import json,sys,urllib.request
body={}
if sys.argv[1]: body['title']=sys.argv[1]
if sys.argv[2]: body['tags']=[t.strip() for t in sys.argv[2].split(',') if t.strip()]
data=json.dumps(body).encode()
req=urllib.request.Request(sys.argv[3],data=data,headers={'Content-Type':'application/json'},method='POST')
with urllib.request.urlopen(req) as r: print(r.read().decode())
" "$title" "$tags" "$gw_url/api/projects/issues/raw/$raw_id/promote?path=$encoded" | ($fmt)
          ;;
        clear)
          curl -s -X DELETE "$gw_url/api/projects/issues/raw?path=$encoded" | ($fmt)
          ;;
        *)
          err "Unknown raw subcommand: $sub"
          echo "  Subcommands: list | promote <id> | clear" >&2
          exit 1
          ;;
      esac
      ;;
    from-bash-log)
      # Wish #21 Slice 6 — promote bash audit-log entries to issues.
      # Scans ~/.agi/logs/agi-bash-*.jsonl for the last --days N days,
      # groups blocked + non-zero-exit entries, files them via logIssue
      # (which auto-dedups via symptom-hash). Use --dry-run to see the
      # candidate list without filing.
      local project=""
      local days="7"
      local dryrun=""
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --project) project="${2:-}"; shift 2 ;;
          --days) days="${2:-}"; shift 2 ;;
          --dry-run) dryrun="true"; shift ;;
          *) err "Unknown flag: $1"; exit 1 ;;
        esac
      done
      if [ -z "$project" ]; then
        err "Usage: agi issue from-bash-log --project <absolute-path> [--days N] [--dry-run]"
        exit 1
      fi
      local encoded
      encoded="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$project")"
      python3 -c "
import json,sys,urllib.request
body={'days':int(sys.argv[1])}
if sys.argv[2]=='true': body['promote']=False
data=json.dumps(body).encode()
req=urllib.request.Request(sys.argv[3],data=data,headers={'Content-Type':'application/json'},method='POST')
with urllib.request.urlopen(req) as r: print(r.read().decode())
" "$days" "$dryrun" "$gw_url/api/projects/issues/from-bash-log?path=$encoded" | ($fmt)
      ;;
    fix)
      local id="${1:-}"
      shift || true
      local project=""
      local resolution=""
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --project) project="${2:-}"; shift 2 ;;
          --resolution) resolution="${2:-}"; shift 2 ;;
          *) err "Unknown flag: $1"; exit 1 ;;
        esac
      done
      if [ -z "$id" ] || [ -z "$project" ]; then
        err "Usage: agi issue fix <id> --project <absolute-path> [--resolution <text>]"
        exit 1
      fi
      local encoded
      encoded="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$project")"
      python3 -c "
import json,sys,urllib.request
body={'status':'fixed'}
if sys.argv[1]: body['resolution']=sys.argv[1]
data=json.dumps(body).encode()
req=urllib.request.Request(sys.argv[2],data=data,headers={'Content-Type':'application/json'},method='PATCH')
with urllib.request.urlopen(req) as r: print(r.read().decode())
" "$resolution" "$gw_url/api/projects/issues/$id?path=$encoded" | ($fmt)
      ;;
    *)
      err "Unknown issue action: $action"
      echo "  Actions: list [--project <path>] | search <query> --project <path> | show <id> --project <path> | file --project <path> --title <t> --symptom <s> [--tool] [--exit] [--tags] | fix <id> --project <path> [--resolution] | from-bash-log --project <path> [--days N] [--dry-run] | raw <list|promote <id>|clear> --project <path>"
      exit 1
      ;;
  esac
}

cmd_projects() {
  # Accept subcommands. Default (no arg) lists all projects.
  case "${1:-list}" in
    logs) shift; cmd_projects_logs "$@" ;;
    restart) shift; cmd_projects_restart "$@" ;;
    list|"") cmd_projects_list ;;
    *)
      err "Unknown projects subcommand: $1"
      echo "  Subcommands: list (default), logs <slug>, restart <slug>" >&2
      return 1 ;;
  esac
}

cmd_projects_list() {
  echo -e "${BOLD}Hosted Projects${RESET}"
  echo ""

  # Pre-count projects so the "No projects configured" line only shows when
  # the directory genuinely has none. The previous loop set `found=1` inside
  # a subshell (the `node -e | while read ...` pipeline) which never
  # propagated to the outer scope — so the empty-state message printed even
  # when projects existed (story #110 follow-up).
  local count=0
  for config_dir in "$AGI_DIR"/*/; do
    [ -f "${config_dir}project.json" ] && count=$((count + 1))
  done

  if [ "$count" -eq 0 ]; then
    echo "  No projects configured"
    return
  fi

  # Snapshot running containers ONCE rather than calling podman per project.
  # For N projects this is N→1 podman invocations.
  local running_containers
  running_containers="$(podman ps --format '{{.Names}}' 2>/dev/null || true)"

  for config_dir in "$AGI_DIR"/*/; do
    local config_file="${config_dir}project.json"
    [ -f "$config_file" ] || continue

    node -e "
      const fs = require('fs');
      const path = require('path');
      const data = JSON.parse(fs.readFileSync('${config_file}', 'utf-8'));
      const slug = path.basename(path.dirname('${config_file}'));
      const h = data.hosting || {};
      const name = data.name || slug;
      const type = h.type || 'unknown';
      const status = h.enabled ? 'enabled' : 'disabled';
      const host = h.hostname ? h.hostname + '.ai.on' : '-';
      const port = h.port || '-';
      const container = h.hostname ? 'agi-' + h.hostname : '';
      console.log(name + '|' + type + '|' + status + '|' + host + '|' + port + '|' + container);
    " 2>/dev/null | while IFS='|' read -r name type status host port container; do
      printf "  ${BOLD}%-25s${RESET} %-15s " "$name" "$type"
      if [ "$status" = "enabled" ]; then
        printf "${GREEN}%-10s${RESET}" "$status"
      else
        printf "${MUTED}%-10s${RESET}" "$status"
      fi
      # Running-state column: probe the snapshot for the project's container.
      # Disabled projects show a dash (no container expected).
      if [ "$status" = "enabled" ] && [ -n "$container" ]; then
        if printf '%s\n' "$running_containers" | grep -qx "$container"; then
          printf "${GREEN}%-6s${RESET}" "up"
        else
          printf "${RED}%-6s${RESET}" "down"
        fi
      else
        printf "${MUTED}%-6s${RESET}" "-"
      fi
      printf "%-25s %s\n" "$host" "$port"
    done
  done
}

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# HF models + providers (tynn #86)
#
# Wraps the gateway's /api/hf/* + /api/models endpoints so the CLI stays in
# lockstep with the dashboard. All state changes go through the gateway —
# we never shell out to podman or the filesystem directly, so hardware
# checks, disk budgets, and modelStore lifecycle tracking stay authoritative.
# ---------------------------------------------------------------------------

cmd_models() {
  local action="${1:-list}"
  shift || true
  local gw_url="http://127.0.0.1:3100"
  local fmt
  fmt="$(command -v jq >/dev/null && echo "jq ." || echo "cat")"

  case "$action" in
    list|"")
      info "Installed HF models"
      curl -s "$gw_url/api/hf/models" | ($fmt)
      ;;
    running)
      info "Running model containers"
      curl -s "$gw_url/api/hf/models?status=running" | ($fmt)
      ;;
    status)
      local id="${1:-}"
      if [ -z "$id" ]; then
        err "Usage: agi models status <model-id>"
        exit 1
      fi
      curl -s "$gw_url/api/hf/models/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$id")" | ($fmt)
      ;;
    install)
      local id="${1:-}"
      local backend="${2:-auto}"
      if [ -z "$id" ]; then
        err "Usage: agi models install <model-id> [backend]"
        echo "  backend: auto (default — Lemonade for GGUF, HF for everything else)"
        echo "           lemonade — force Lemonade pull"
        echo "           hf       — force HF Podman install"
        exit 1
      fi
      # K.3 slice 3 auto-detect: model names ending in -GGUF (or matching
      # the Lemonade catalog) route through Lemonade. Everything else
      # uses the existing HF Podman install path. Explicit `lemonade` or
      # `hf` second arg forces the route.
      local route="$backend"
      if [ "$route" = "auto" ]; then
        case "$id" in
          *-GGUF|*-gguf|*.gguf) route="lemonade" ;;
          *) route="hf" ;;
        esac
        info "auto-routing to $route based on model name"
      fi
      case "$route" in
        lemonade)
          info "Pulling $id via Lemonade…"
          curl -s -X POST "$gw_url/api/lemonade/models/pull" \
            -H "Content-Type: application/json" \
            --data "$(printf '{"model":"%s"}' "$id")" | ($fmt)
          ;;
        hf)
          info "Requesting HF install for $id (backend streams progress)…"
          curl -s -X POST "$gw_url/api/hf/install" \
            -H "Content-Type: application/json" \
            --data "$(python3 -c "import json,sys;print(json.dumps({'modelId':sys.argv[1]}))" "$id")" \
            | ($fmt)
          ;;
        *)
          err "Unknown backend: $route (use 'auto', 'lemonade', or 'hf')"
          exit 1
          ;;
      esac
      ;;
    start|stop|remove)
      local id="${1:-}"
      if [ -z "$id" ]; then
        err "Usage: agi models $action <model-id>"
        exit 1
      fi
      local encoded
      encoded="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$id")"
      # The gateway uses DELETE /api/hf/models/:id for remove (no path
      # suffix), POST /api/hf/models/:id/start|stop for lifecycle.
      if [ "$action" = "remove" ]; then
        curl -s -X DELETE "$gw_url/api/hf/models/$encoded" | ($fmt)
      else
        curl -s -X POST "$gw_url/api/hf/models/$encoded/$action" | ($fmt)
      fi
      ;;
    search)
      local query="${*:-}"
      if [ -z "$query" ]; then
        err "Usage: agi models search <query>"
        exit 1
      fi
      curl -s "$gw_url/api/hf/search?q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$query")" | ($fmt)
      ;;
    hardware)
      curl -s "$gw_url/api/hf/hardware" | ($fmt)
      ;;
    *)
      err "Unknown models action: $action"
      echo "  Actions: list, running, status <id>, install <id> [auto|lemonade|hf], start <id>, stop <id>, remove <id>, search <query>, hardware"
      exit 1
      ;;
  esac
}

cmd_providers() {
  local action="${1:-list}"
  shift || true
  local gw_url="http://127.0.0.1:3100"
  local fmt
  fmt="$(command -v jq >/dev/null && echo "jq ." || echo "cat")"

  case "$action" in
    list|"")
      info "Configured providers"
      curl -s "$gw_url/api/hf/providers" | ($fmt)
      ;;
    status)
      curl -s "$gw_url/api/models" | ($fmt)
      ;;
    set-default)
      local provider="${1:-}"
      local model="${2:-}"
      if [ -z "$provider" ]; then
        err "Usage: agi providers set-default <provider> [<model>]"
        exit 1
      fi
      # Uses PATCH /api/config — the agent's default provider + model live
      # on `config.agent.provider` / `config.agent.model`. The gateway
      # hot-reloads config so no restart is needed.
      local body
      if [ -n "$model" ]; then
        body="$(python3 -c "import json,sys;print(json.dumps({'agent':{'provider':sys.argv[1],'model':sys.argv[2]}}))" "$provider" "$model")"
      else
        body="$(python3 -c "import json,sys;print(json.dumps({'agent':{'provider':sys.argv[1]}}))" "$provider")"
      fi
      curl -s -X PATCH "$gw_url/api/config" \
        -H "Content-Type: application/json" \
        --data "$body" | ($fmt)
      ;;
    *)
      err "Unknown providers action: $action"
      echo "  Actions: list, status, set-default <provider> [<model>]"
      exit 1
      ;;
  esac
}

cmd_marketplace() {
  local action="${1:-list}"
  shift || true
  local gw="http://127.0.0.1:3100"
  local jq_or_cat
  jq_or_cat='jq .'
  command -v jq >/dev/null 2>&1 || jq_or_cat='cat'

  case "$action" in
    list|catalog)
      curl -sS "$gw/api/marketplace/catalog?type=plugin" | eval "$jq_or_cat"
      ;;
    installed)
      curl -sS "$gw/api/marketplace/installed" | eval "$jq_or_cat"
      ;;
    sources)
      curl -sS "$gw/api/marketplace/sources" | eval "$jq_or_cat"
      ;;
    dedupe|vacuum)
      # Remove orphan catalog rows whose sourceRef isn't in the active
      # sources list. Catches cruft from older syncs or deleted sources.
      info "vacuuming orphan marketplace catalog rows..."
      curl -sS -X POST "$gw/api/marketplace/dedupe" | eval "$jq_or_cat"
      ;;
    sync)
      # Sync every configured source. Dashboard normally batches this on
      # boot; this command lets the owner force a re-sync after pushing
      # marketplace changes (e.g. after a plugin rename or version bump).
      info "syncing every marketplace source..."
      local sources_json
      sources_json="$(curl -sS "$gw/api/marketplace/sources")"
      echo "$sources_json" | python3 -c "
import json, sys, subprocess
sources = json.load(sys.stdin)
for s in sources:
    sid = s.get('id')
    ref = s.get('ref', '?')
    print(f'  syncing source {sid} ({ref})...', flush=True)
    r = subprocess.run(
        ['curl', '-sS', '-X', 'POST', f'$gw/api/marketplace/sources/{sid}/sync'],
        capture_output=True, text=True,
    )
    try:
        result = json.loads(r.stdout)
        ok = result.get('ok')
        count = result.get('pluginCount', '?')
        err = result.get('error', '')
        if ok:
            print(f'    ok ({count} plugins)')
        else:
            print(f'    FAILED: {err}')
    except Exception as e:
        print(f'    parse error: {e}')
"
      ;;
    install)
      local name="${1:-}"
      [ -z "$name" ] && { err "Usage: agi marketplace install <plugin-name>"; exit 1; }
      info "installing $name..."
      curl -sS -X POST "$gw/api/marketplace/install" \
        -H "Content-Type: application/json" \
        --data "$(printf '{"name":"%s"}' "$name")" | eval "$jq_or_cat"
      ;;
    uninstall|remove)
      local name="${1:-}"
      [ -z "$name" ] && { err "Usage: agi marketplace uninstall <plugin-name>"; exit 1; }
      info "uninstalling $name..."
      curl -sS -X POST "$gw/api/marketplace/uninstall" \
        -H "Content-Type: application/json" \
        --data "$(printf '{"name":"%s"}' "$name")" | eval "$jq_or_cat"
      ;;
    *)
      err "Unknown marketplace action: $action"
      echo "  Actions: list, installed, sources, sync, dedupe, install <name>, uninstall <name>"
      exit 1
      ;;
  esac
}

cmd_lemonade() {
  local action="${1:-status}"
  local gw="http://127.0.0.1:3100"
  local jq_or_cat
  jq_or_cat='jq .'
  command -v jq >/dev/null 2>&1 || jq_or_cat='cat'

  case "$action" in
    status)
      curl -sS "$gw/api/lemonade/status" | eval "$jq_or_cat"
      ;;
    models|list)
      curl -sS "$gw/api/lemonade/models" | eval "$jq_or_cat"
      ;;
    pull)
      local model="${2:-}"
      [ -z "$model" ] && { err "Usage: agi lemonade pull <model>"; exit 1; }
      info "pulling $model from Lemonade catalog (this can take a while)..."
      curl -sS -X POST "$gw/api/lemonade/models/pull" \
        -H "Content-Type: application/json" \
        --data "$(printf '{"model":"%s"}' "$model")" | eval "$jq_or_cat"
      ;;
    load)
      local model="${2:-}"
      [ -z "$model" ] && { err "Usage: agi lemonade load <model>"; exit 1; }
      curl -sS -X POST "$gw/api/lemonade/models/load" \
        -H "Content-Type: application/json" \
        --data "$(printf '{"model":"%s"}' "$model")" | eval "$jq_or_cat"
      ;;
    unload)
      local model="${2:-}"
      [ -z "$model" ] && { err "Usage: agi lemonade unload <model>"; exit 1; }
      curl -sS -X POST "$gw/api/lemonade/models/unload" \
        -H "Content-Type: application/json" \
        --data "$(printf '{"model":"%s"}' "$model")" | eval "$jq_or_cat"
      ;;
    delete|rm)
      local model="${2:-}"
      [ -z "$model" ] && { err "Usage: agi lemonade delete <model>"; exit 1; }
      curl -sS -X POST "$gw/api/lemonade/models/delete" \
        -H "Content-Type: application/json" \
        --data "$(printf '{"model":"%s"}' "$model")" | eval "$jq_or_cat"
      ;;
    backends)
      local sub="${2:-list}"
      case "$sub" in
        list)
          # Backends are part of /status — extract from the recipes block.
          curl -sS "$gw/api/lemonade/status" | python3 -c "
import json, sys
d = json.load(sys.stdin)
recipes = d.get('recipes') or {}
if not recipes:
    print('(Lemonade not reachable)')
    sys.exit(0)
print(f\"{'recipe:backend':30s}  state\")
print('-' * 60)
for r, info in sorted(recipes.items()):
    for be, bi in info.get('backends', {}).items():
        print(f\"{r+':'+be:30s}  {bi.get('state','?')}\")
"
          ;;
        install)
          local spec="${3:-}"
          [ -z "$spec" ] && { err "Usage: agi lemonade backends install <recipe>:<backend>  (e.g. llamacpp:rocm)"; exit 1; }
          local recipe="${spec%%:*}"
          local backend="${spec##*:}"
          info "installing backend $recipe:$backend (download can be hundreds of MB)..."
          curl -sS -X POST "$gw/api/lemonade/backends/install" \
            -H "Content-Type: application/json" \
            --data "$(printf '{"recipe":"%s","backend":"%s"}' "$recipe" "$backend")" | eval "$jq_or_cat"
          ;;
        uninstall)
          local spec="${3:-}"
          [ -z "$spec" ] && { err "Usage: agi lemonade backends uninstall <recipe>:<backend>"; exit 1; }
          local recipe="${spec%%:*}"
          local backend="${spec##*:}"
          curl -sS -X POST "$gw/api/lemonade/backends/uninstall" \
            -H "Content-Type: application/json" \
            --data "$(printf '{"recipe":"%s","backend":"%s"}' "$recipe" "$backend")" | eval "$jq_or_cat"
          ;;
        *)
          err "Unknown backends action: $sub"
          echo "  Actions: list, install <recipe>:<backend>, uninstall <recipe>:<backend>"
          exit 1
          ;;
      esac
      ;;
    *)
      err "Unknown lemonade action: $action"
      echo "  Actions: status, models, pull <m>, load <m>, unload <m>, delete <m>, backends [list|install|uninstall]"
      exit 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# agi bash — unrestricted shell passthrough (story #104, task #329 — MVP)
#
# Runs an arbitrary command through Aion's secure entryway so that every
# terminal exec accumulates in one observable surface. This task is the
# foundation; logging meta-context (#330), policy gating (#331), and
# caller migrations (#332–334) layer on top in subsequent commits.
#
# Usage:
#   agi bash <command...>     run the command, return its exit code
#   agi bash -c '<command>'   explicit -c form (the leading -c is dropped
#                             before forwarding; the command string is
#                             passed to bash -c verbatim)
#
# Examples:
#   agi bash echo hello
#   agi bash 'ls -la /tmp'
#   agi bash -c 'ls -la | grep tmp'
#
# Why this passthrough exists rather than letting agents shell out
# directly: see ~/temp_core/CLAUDE.md § 3 (Blocker Protocol) and § 4
# (Pattern Substrate).
# ---------------------------------------------------------------------------
# Internal: log a single agi-bash invocation as one JSONL record.
#
# Daily file at ${LOG_DIR}/agi-bash-YYYY-MM-DD.jsonl mirrors the existing
# resource-stats-*.jsonl pattern in ~/.agi/logs/ so the substrate is
# uniformly shaped for the future ETL pipeline (see ~/temp_core/CLAUDE.md
# § 4 Pattern Substrate).
#
# Failure to write the log MUST NOT propagate to the caller's exit code —
# a broken log surface should never break a working command. Errors are
# silent here; future work can surface them via a dedicated dashboard.
_agi_bash_log() {
  local cmd="$1" exit_code="$2" stdout_bytes="$3" stderr_bytes="$4" \
        duration_ms="$5" started_iso="$6" caller="$7" cwd="$8" \
        blocked="${9:-false}" denial_reason="${10:-}" audit_note="${11:-}"

  local cmd_hash
  cmd_hash=$(printf '%s' "$cmd" | sha256sum | cut -c1-12)

  # Escape JSON-special chars in fields that flow from external input.
  # cmd is hashed and never logged raw, but cwd / denial_reason / audit_note
  # all need light escaping for JSON safety.
  local cwd_esc denial_esc audit_esc
  cwd_esc=$(printf '%s' "$cwd" | sed 's/\\/\\\\/g; s/"/\\"/g')
  denial_esc=$(printf '%s' "$denial_reason" | sed 's/\\/\\\\/g; s/"/\\"/g')
  audit_esc=$(printf '%s' "$audit_note" | sed 's/\\/\\\\/g; s/"/\\"/g')

  local log_dir="$LOG_DIR"
  mkdir -p "$log_dir" 2>/dev/null || return 0

  local log_file="$log_dir/agi-bash-$(date +%Y-%m-%d).jsonl"

  printf '{"ts":"%s","caller":"%s","cwd":"%s","cmd_hash":"%s","exit_code":%s,"duration_ms":%s,"stdout_bytes":%s,"stderr_bytes":%s,"blocked":%s,"denial_reason":"%s","audit_note":"%s"}\n' \
    "$started_iso" "$caller" "$cwd_esc" "$cmd_hash" "$exit_code" "$duration_ms" \
    "$stdout_bytes" "$stderr_bytes" "$blocked" "$denial_esc" "$audit_esc" \
    >>"$log_file" 2>/dev/null || return 0
}

# Internal: policy check for bash invocations (story #104, task #331).
#
# Reads ~/.agi/gateway.json bash.policy at every invocation (no caching —
# config is hot-swappable per CLAUDE.md). Honors AGI_CONFIG_PATH env
# override for testing. Default deny patterns are baked in and always
# active; user config in `bash.policy.deny_patterns` extends (does not
# replace) them, while `bash.policy.allow_overrides` is checked first so
# the user can explicitly permit a normally-blocked operation with an
# audit trail.
#
# Returns one line on stdout, parsed by the caller:
#   ALLOW                              — proceed normally
#   ALLOW_OVERRIDE:<matched-pattern>   — proceed, with audit note
#   DENY:<human-readable-reason>       — block with logged denial
_agi_bash_policy_check() {
  local cmd="$1"
  python3 - "$cmd" 2>/dev/null <<'PYEOF'
import sys, json, re, os

cmd = sys.argv[1] if len(sys.argv) > 1 else ""

DEFAULT_DENY = [
    r"(?:^|[\s;|&'\"])/opt/aionima(?:[/\s;|&'\"]|$)",
    r"(?:^|[\s;|&'\"])/opt/aionima-prime(?:[/\s;|&'\"]|$)",
    r"(?:^|[\s;|&'\"])/opt/aionima-id(?:[/\s;|&'\"]|$)",
    r"\brm\s+-rf\s+/\s*$",
    r"\brm\s+-rf\s+/\s",
    r"\bsystemctl\s+(?:stop|disable|mask)\s+(?:agi|aionima)\b",
]

config_path = os.environ.get("AGI_CONFIG_PATH") or os.path.expanduser("~/.agi/gateway.json")
try:
    with open(config_path) as f:
        cfg = json.load(f)
    user = (cfg.get("bash") or {}).get("policy") or {}
except Exception:
    user = {}

deny_patterns = DEFAULT_DENY + (user.get("deny_patterns") or [])
allow_overrides = user.get("allow_overrides") or []

# Allow overrides win — user is explicitly permitting a normally-blocked op.
for ov in allow_overrides:
    try:
        if re.search(ov, cmd):
            print(f"ALLOW_OVERRIDE:{ov}")
            sys.exit(0)
    except re.error:
        continue

for pat in deny_patterns:
    try:
        if re.search(pat, cmd):
            print(f"DENY:matches {pat}")
            sys.exit(0)
    except re.error:
        continue

print("ALLOW")
PYEOF
}

cmd_bash() {
  if [ "$#" -eq 0 ]; then
    err "agi bash: missing command"
    echo "Usage: agi bash <command...>" >&2
    echo "       agi bash -c '<command>'" >&2
    return 2
  fi

  # Drop a leading -c so `agi bash -c '<cmd>'` and `agi bash <cmd...>` both
  # forward identically to `bash -c "$*"`. The internal invocation always
  # uses bash -c; this lets callers paste either shape interchangeably.
  if [ "$1" = "-c" ]; then
    shift
    if [ "$#" -eq 0 ]; then
      err "agi bash -c: missing command string"
      return 2
    fi
  fi

  # Resolve caller. Default `human`; agents/Taskmaster/cron-prompt set
  # AGI_CALLER (e.g. AGI_CALLER=chat-agent:<session_id>) so the log
  # surface attributes the invocation correctly. Validate against a
  # conservative charset so a malformed caller can't inject JSON.
  #
  # Auto-attribution (story #108 t351): when AGI_CALLER is unset and
  # CLAUDECODE=1 (Claude Code's runtime sets this in every Bash tool
  # child env), default the caller to `claude-code` so harness-driven
  # shell ops are distinguishable from human-at-terminal in the
  # JSONL substrate. Future enhancement: include a session/turn id if
  # Claude Code ever exposes one in the env.
  local caller="${AGI_CALLER:-}"
  if [ -z "$caller" ]; then
    if [ "${CLAUDECODE:-0}" = "1" ]; then
      caller="claude-code"
    else
      caller="human"
    fi
  fi
  if ! [[ "$caller" =~ ^[a-zA-Z0-9_:.-]+$ ]]; then
    caller="invalid"
  fi

  local cmd="$*"
  local cwd
  cwd=$(pwd)

  local started_iso
  started_iso=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")

  # Policy check FIRST — denied commands are logged-and-rejected before
  # they can run. Hot-reload is automatic (config is read at every
  # invocation; no caching).
  local policy_result audit_note=""
  policy_result=$(_agi_bash_policy_check "$cmd")
  case "$policy_result" in
    DENY:*)
      local denial_reason="${policy_result#DENY:}"
      err "agi bash: blocked by policy — $denial_reason"
      _agi_bash_log "$cmd" "126" "0" "0" "0" "$started_iso" "$caller" "$cwd" "true" "$denial_reason" ""
      return 126
      ;;
    ALLOW_OVERRIDE:*)
      audit_note="override: ${policy_result#ALLOW_OVERRIDE:}"
      ;;
    ALLOW|"")
      :  # proceed normally
      ;;
    *)
      warn "agi bash: policy returned unexpected result: $policy_result — proceeding"
      ;;
  esac

  # Capture byte counts via tempfile buffer. Trade-off: this breaks
  # interactive / long-running commands like `tail -f` because output
  # is buffered until the inner command exits. The 99% case (short
  # commands) gets accurate byte counts; streaming mode is a future
  # follow-up (see story #104 follow-ups in tynn).
  local stdout_tmp stderr_tmp exit_code
  stdout_tmp=$(mktemp 2>/dev/null) || { bash -c "$cmd"; return $?; }
  stderr_tmp=$(mktemp 2>/dev/null) || { rm -f "$stdout_tmp"; bash -c "$cmd"; return $?; }

  local started_ns
  started_ns=$(date +%s%N)

  bash -c "$cmd" >"$stdout_tmp" 2>"$stderr_tmp"
  exit_code=$?

  local ended_ns duration_ms
  ended_ns=$(date +%s%N)
  duration_ms=$(( (ended_ns - started_ns) / 1000000 ))

  # Replay buffered output to the caller.
  cat "$stdout_tmp"
  cat "$stderr_tmp" >&2

  local stdout_bytes stderr_bytes
  stdout_bytes=$(wc -c <"$stdout_tmp" | tr -d ' ')
  stderr_bytes=$(wc -c <"$stderr_tmp" | tr -d ' ')

  rm -f "$stdout_tmp" "$stderr_tmp"

  _agi_bash_log "$cmd" "$exit_code" "$stdout_bytes" "$stderr_bytes" \
                "$duration_ms" "$started_iso" "$caller" "$cwd" "false" "" "$audit_note"

  return "$exit_code"
}

# ---------------------------------------------------------------------------
# agi setup-claude-hooks (story #108, task #350)
#
# Installs the AgiBash routing hook + agibash skill into ~/.claude/ and
# patches ~/.claude/settings.json with a PreToolUse Bash hook entry
# pointing at the installed hook script. Idempotent: running twice leaves
# the same end state.
#
# Templates ship in this repo under scripts/claude-code-templates/ so a
# fresh `agi install` followed by `agi setup-claude-hooks` produces a
# routed-by-default Claude Code experience without per-machine bespoke
# copying.
# ---------------------------------------------------------------------------
cmd_setup_claude_hooks() {
  local templates_dir="$DEPLOY_DIR/scripts/claude-code-templates"
  if [ ! -d "$templates_dir" ]; then
    err "Templates not found at $templates_dir"
    return 1
  fi

  if ! command -v jq >/dev/null 2>&1; then
    err "jq is required to patch ~/.claude/settings.json idempotently"
    info "Install with: sudo apt install jq"
    return 1
  fi

  info "Installing AgiBash routing hook + skill into ~/.claude/"

  # 1. Hook script
  mkdir -p "$HOME/.claude/hooks"
  cp "$templates_dir/hooks/agi-bash-router.sh" "$HOME/.claude/hooks/agi-bash-router.sh"
  chmod +x "$HOME/.claude/hooks/agi-bash-router.sh"
  ok "Installed hook: ~/.claude/hooks/agi-bash-router.sh"

  # 2. Skill
  mkdir -p "$HOME/.claude/skills/agibash"
  cp "$templates_dir/skills/agibash/SKILL.md" "$HOME/.claude/skills/agibash/SKILL.md"
  ok "Installed skill: ~/.claude/skills/agibash/SKILL.md"

  # 3. Patch settings.json. The jq pipeline is idempotent:
  #    - Removes any existing PreToolUse entry pointing at agi-bash-router
  #      (so re-runs replace, not duplicate).
  #    - Appends the canonical entry pointing at the installed hook.
  #    - Preserves all other settings + other hook entries unchanged.
  local settings="$HOME/.claude/settings.json"
  if [ ! -f "$settings" ]; then
    echo "{}" > "$settings"
  fi

  local tmp
  tmp=$(mktemp)
  if jq --arg cmd "bash $HOME/.claude/hooks/agi-bash-router.sh" '
    .hooks //= {}
    | .hooks.PreToolUse //= []
    | .hooks.PreToolUse |= map(select(
        ((.hooks // [])[0].command // "") | test("agi-bash-router") | not
      ))
    | .hooks.PreToolUse += [{
        matcher: "Bash",
        hooks: [{type: "command", command: $cmd}]
      }]
  ' "$settings" > "$tmp"; then
    mv "$tmp" "$settings"
    ok "Patched ~/.claude/settings.json (PreToolUse Bash hook)"
  else
    rm -f "$tmp"
    err "Failed to patch settings.json"
    return 1
  fi

  echo ""
  info "Routing activates on the next Claude Code session start."
  info "Test by running a plain 'ls' from the assistant — the hook"
  info "  transparently rewrites it to 'agi bash ls' (no friction)."
  info "Audit log: ~/.agi/logs/agi-bash-router.log"
  info "  Look for REWRITE entries; the JSONL log at"
  info "  ~/.agi/logs/agi-bash-YYYY-MM-DD.jsonl captures each routed exec."
}

cmd_help() {
  echo -e "${BOLD}agi${RESET} — Aionima Gateway CLI"
  echo ""
  echo "Usage: agi <command> [args]"
  echo ""
  echo "Commands:"
  echo "  status          Service + infrastructure status"
  echo "  logs [N]        Show last N log lines (default 50)"
  echo "  logs -f         Follow logs (tail -f)"
  echo "  upgrade         Pull, build, migrate, restart"
  echo "  restart         Restart the gateway service"
  echo "  start           Start the gateway service"
  echo "  stop            Stop the gateway service"
  echo "  doctor          Check infrastructure health"
  echo "  safemode        Show safemode status (or: safemode exit)"
  echo "  incidents       List incident reports (or: incidents view <id>)"
  echo "  config [key]    Read config (full or dot-path key)"
  echo "  projects [CMD]  List hosted projects (default) or:"
  echo "                    logs <slug> [--tail N] [-f]   Tail container logs"
  echo "                    restart <slug>                Restart project container"
  echo "  iw <CMD>        Iterative-work operator commands (s159 t692 kill switch):"
  echo "                    stop --project <path>         Stop iterative-work on one project"
  echo "                    stop --all                    Stop iterative-work on ALL projects"
  echo "  issue <CMD>     Per-project issue registry (Wish #21):"
  echo "                    list [--project <path>]       List all issues (or one project)"
  echo "                    search <q> --project <path>   Free-text search (tag:/status: filters)"
  echo "                    show <id> --project <path>    Read full issue body"
  echo "                    file --project <path> --title <t> --symptom <s>"
  echo "                       [--tool t] [--exit n] [--tags a,b,c]   Log issue (auto-dedup)"
  echo "                    fix <id> --project <path> [--resolution <text>]"
  echo "                                                  Mark fixed + append resolution"
  echo "                    from-bash-log --project <path> [--days N] [--dry-run]"
  echo "                                                  Promote ~/.agi/logs/agi-bash-*.jsonl entries"
  echo "                    raw <list|promote <id>|clear> --project <path>"
  echo "                                                  Manage raw-tier auto-capture sink"
  echo "  models CMD      HF model management — pulled/cached/installed models"
  echo "                  (list|running|status|install|start|stop|remove|search|hardware)."
  echo "                  For provider/router config (which Provider, cost-mode), use"
  echo "                  'agi providers' below."
  echo "  providers CMD   Manage LLM providers (list|status|set-default)"
  echo "  marketplace CMD Plugin Marketplace ops"
  echo "                  (list|installed|sources|sync|dedupe|install <n>|uninstall <n>)"
  echo "  lemonade CMD    Manage Lemonade local AI server"
  echo "                  (status|models|pull|load|unload|delete|backends)"
  echo "  ollama CMD      Manage Ollama (status|start|stop|pull|list)"
  echo "  test-vm CMD     Manage test VM (status|create|destroy|provision|setup|"
  echo "                  services-setup|services-start|services-stop|services-restart|"
  echo "                  services-status|services-version|services-align|test|test-ui|remount)"
  echo "  test [KIND] PAT Run the test suite (--unit|--e2e|--e2e-ui|--e2e-headed|--spot|--all|--list)"
  echo "                  agi test dashboard            — unit (default)"
  echo "                  agi test --e2e mapps-walk     — Playwright against VM (headless)"
  echo "                  agi test --e2e-ui chat-workflow — open Playwright UI runner"
  echo "                  agi test --e2e-headed mapps-walk — visible auto-run, no UI shell"
  echo "                  agi test --spot hardware      — spot feature test"
  echo "  bash CMD...     Run a shell command through Aion's secure entryway"
  echo "                  (logged to ~/.agi/logs/agi-bash-*.jsonl with caller"
  echo "                  attribution; policy gated by ~/.agi/gateway.json bash.policy)"
  echo "  scan PATH       Run a security scan on PATH (sast|sca|secrets|config),"
  echo "                  poll until done, render findings; CI-friendly exit codes."
  echo "                  Subcmds: list, view <id>, cancel <id>"
  echo "  project-migrate <id> [--dry-run|--execute]"
  echo "                  Run a project-folder migration script. Currently available:"
  echo "                  s140 — k/+repos/+chat/+sandbox/ layout + root project.json"
  echo "  setup           Interactive configuration wizard"
  echo "  setup-prompts   Configure persona and heartbeat prompts"
  echo "  setup-claude-hooks"
  echo "                  Install AgiBash routing hook + skill into ~/.claude/"
  echo "                  (idempotent — safe to re-run; activates next session)"
  echo "  channels        Manage channel adapters"
  echo "  help            Show this help"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

case "${1:-help}" in
  status)   cmd_status ;;
  logs)
    if [ "${2:-}" = "-f" ]; then
      cmd_logs_follow
    else
      cmd_logs "${2:-50}"
    fi
    ;;
  upgrade)  cmd_upgrade ;;
  restart)  cmd_restart ;;
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  doctor)
    case "${2:-}" in
      schema)
        # s144 t575 — schema validation diagnostic. Walks every on-disk
        # config file the gateway reads at boot and runs each through
        # its Zod schema. Catches the cycle-150 class of failures
        # (project.json shape drift, gateway.json schema regression)
        # BEFORE attempting upgrade or restart.
        shift; shift
        cd "$DEPLOY_DIR" && exec npx tsx cli/src/index.ts schema validate "$@"
        ;;
      *)
        cmd_doctor
        ;;
    esac
    ;;
  safemode) shift; cmd_safemode "$@" ;;
  incidents) shift; cmd_incidents "$@" ;;
  scan) shift; cmd_scan "$@" ;;
  config)   cmd_config "${2:-}" ;;
  projects) shift; cmd_projects "$@" ;;
  iw)       shift; cmd_iw "$@" ;;
  issue)    shift; cmd_issue "$@" ;;
  models)    shift; cmd_models "$@" ;;
  providers) shift; cmd_providers "$@" ;;
  marketplace) shift; cmd_marketplace "$@" ;;
  lemonade) shift; cmd_lemonade "$@" ;;
  ollama)   shift; cmd_ollama "$@" ;;
  test-vm)  shift; cmd_test_vm "$@" ;;
  test)     shift; bash "$DEPLOY_DIR/scripts/agi-test.sh" "$@" ;;
  project-migrate)
    shift
    storyId="${1:-}"
    shift 2>/dev/null || true
    if [ -z "$storyId" ]; then
      err "agi project-migrate: missing story id"
      echo "Usage: agi project-migrate <story-id> [--dry-run|--execute]" >&2
      echo "Available migrations:" >&2
      echo "  s140   Project folder restructure (k/ + repos/ + chat/ + sandbox/ + project.json)" >&2
      exit 1
    fi
    script="$DEPLOY_DIR/scripts/migrate-projects-${storyId}.sh"
    if [ ! -f "$script" ]; then
      err "no migration script for ${storyId} at $script"
      echo "Available migrations: ls -1 $DEPLOY_DIR/scripts/migrate-projects-*.sh 2>/dev/null" >&2
      exit 1
    fi
    bash "$script" "$@"
    ;;
  bash)     shift; cmd_bash "$@" ;;
  setup)    node "$DEPLOY_DIR/cli/dist/index.js" setup ;;
  setup-prompts) node "$DEPLOY_DIR/cli/dist/index.js" setup-prompts ;;
  setup-claude-hooks) cmd_setup_claude_hooks ;;
  channels) shift; node "$DEPLOY_DIR/cli/dist/index.js" channels "$@" ;;
  help|--help|-h) cmd_help ;;
  *)
    err "Unknown command: $1"
    cmd_help
    exit 1
    ;;
esac
