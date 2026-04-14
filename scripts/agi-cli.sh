#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# agi-cli — standalone management CLI for the Aionima gateway
#
# Works independently of the Node.js service (bash-only, no dependencies).
# Install: sudo ln -sf /opt/aionima/scripts/agi-cli.sh /usr/local/bin/agi
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
# ---------------------------------------------------------------------------
set -uo pipefail

DEPLOY_DIR="${AIONIMA_DIR:-/opt/aionima}"
AGI_DIR="${HOME}/.agi"
CONFIG_FILE="${AGI_DIR}/gateway.json"
LOG_DIR="${AGI_DIR}/logs"
SERVICE="aionima"

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
err()   { echo -e "${RED}[error]${RESET} $*"; }
label() { printf "${BOLD}%-18s${RESET}" "$1"; }

is_running() {
  systemctl is-active --quiet "$SERVICE" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_status() {
  echo -e "${BOLD}Aionima Gateway Status${RESET}"
  echo ""

  # Service
  label "Service:"
  if is_running; then
    echo -e "${GREEN}running${RESET}"
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
  local log_file="${LOG_DIR}/aionima.log"

  if [ -f "$log_file" ]; then
    tail -n "$lines" "$log_file"
  else
    # Fallback to journalctl
    sudo journalctl -u "$SERVICE" --no-pager -n "$lines" --output cat
  fi
}

cmd_logs_follow() {
  local log_file="${LOG_DIR}/aionima.log"

  if [ -f "$log_file" ]; then
    tail -f "$log_file"
  else
    sudo journalctl -u "$SERVICE" --no-pager -f --output cat
  fi
}

cmd_upgrade() {
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

  # Caddy
  label "Caddy:"
  if systemctl is-active --quiet caddy 2>/dev/null; then
    ok "running"
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

cmd_projects() {
  echo -e "${BOLD}Hosted Projects${RESET}"
  echo ""

  local found=0
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
      console.log(name + '|' + type + '|' + status + '|' + host + '|' + port);
    " 2>/dev/null | while IFS='|' read -r name type status host port; do
      printf "  ${BOLD}%-25s${RESET} %-15s " "$name" "$type"
      if [ "$status" = "enabled" ]; then
        printf "${GREEN}%-10s${RESET}" "$status"
      else
        printf "${MUTED}%-10s${RESET}" "$status"
      fi
      printf "%-25s %s\n" "$host" "$port"
      found=1
    done
  done

  if [ "$found" -eq 0 ]; then
    echo "  No projects configured"
  fi
}

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------

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
  echo "  projects        List hosted projects"
  echo "  setup           Interactive configuration wizard"
  echo "  setup-prompts   Configure persona and heartbeat prompts"
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
  doctor)   cmd_doctor ;;
  safemode) shift; cmd_safemode "$@" ;;
  incidents) shift; cmd_incidents "$@" ;;
  config)   cmd_config "${2:-}" ;;
  projects) cmd_projects ;;
  setup)    node "$DEPLOY_DIR/cli/dist/index.js" setup ;;
  setup-prompts) node "$DEPLOY_DIR/cli/dist/index.js" setup-prompts ;;
  channels) shift; node "$DEPLOY_DIR/cli/dist/index.js" channels "$@" ;;
  help|--help|-h) cmd_help ;;
  *)
    err "Unknown command: $1"
    cmd_help
    exit 1
    ;;
esac
