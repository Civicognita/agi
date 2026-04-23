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
# ---------------------------------------------------------------------------
set -uo pipefail

DEPLOY_DIR="${AIONIMA_DIR:-/opt/agi}"
AGI_DIR="${HOME}/.agi"
CONFIG_FILE="${AGI_DIR}/gateway.json"
LOG_DIR="${AGI_DIR}/logs"
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

  # Lemonade local AI server — the AGI-native local LLM backplane.
  # Goes through /api/lemonade/status (the proxy we own) so the row
  # reflects what AGI sees, not what a direct Lemonade probe would say.
  local lemonade_resp
  lemonade_resp="$(curl -sS --max-time 5 http://127.0.0.1:3100/api/lemonade/status 2>/dev/null || true)"
  if [ -n "$lemonade_resp" ]; then
    label "Lemonade:"
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
      ok "v${lemonade_version} — backends:${lemonade_recipes} loaded:${lemonade_loaded}"
    else
      warn "reachable via /api/lemonade/status but reports running=false"
      issues=$((issues + 1))
    fi
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
  echo "  models CMD      Manage HF models (list|running|status|install|start|"
  echo "                  stop|remove|search|hardware)"
  echo "  providers CMD   Manage LLM providers (list|status|set-default)"
  echo "  marketplace CMD Plugin Marketplace ops"
  echo "                  (list|installed|sources|sync|dedupe|install <n>|uninstall <n>)"
  echo "  lemonade CMD    Manage Lemonade local AI server"
  echo "                  (status|models|pull|load|unload|delete|backends)"
  echo "  ollama CMD      Manage Ollama (status|start|stop|pull|list)"
  echo "  test-vm CMD     Manage test VM (status|create|destroy|provision|setup|"
  echo "                  services-setup|services-start|services-stop|services-status|"
  echo "                  test|test-ui|remount)"
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
  models)    shift; cmd_models "$@" ;;
  providers) shift; cmd_providers "$@" ;;
  marketplace) shift; cmd_marketplace "$@" ;;
  lemonade) shift; cmd_lemonade "$@" ;;
  ollama)   shift; cmd_ollama "$@" ;;
  test-vm)  shift; cmd_test_vm "$@" ;;
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
