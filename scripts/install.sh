#!/usr/bin/env bash
# Aionima — single-command bootstrap for Ubuntu.
# Usage: curl -fsSL https://raw.githubusercontent.com/Civicognita/agi/main/scripts/install.sh | sudo bash
#    or: sudo AIONIMA_USER=myuser bash install.sh
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via env vars)
# ---------------------------------------------------------------------------
AIONIMA_USER="${AIONIMA_USER:-aionima}"
AIONIMA_REPO="${AIONIMA_REPO:-https://github.com/Civicognita/agi.git}"
INSTALL_DIR="${AIONIMA_INSTALL_DIR:-/opt/agi}"
PRIME_REPO="${AIONIMA_PRIME_REPO:-https://github.com/Civicognita/aionima.git}"
PRIME_DIR="${AIONIMA_PRIME_DIR:-/opt/agi-prime}"
# Plugin and MApp marketplaces are fetched from GitHub on demand by the gateway.
# No local clones needed.
BRANCH="${AIONIMA_BRANCH:-main}"
SKIP_HARDENING="${AIONIMA_SKIP_HARDENING:-}"

# aion-micro GGUF pre-staging (step 7b).
# AIONIMA_PREFETCH_MODELS=1   (default) — download GGUF from HF Hub at install time
#                                         so the box can run offline indefinitely.
# AIONIMA_PREFETCH_MODELS=0   — skip; Lemonade will pull on first use (requires internet).
# AIONIMA_GGUF_PATH=/path/to/aion-micro-v1.gguf
#                             — offline mode: copy pre-staged GGUF instead of downloading.
# AIONIMA_HF_TOKEN=hf_xxx     — HuggingFace token for private model repos.
AIONIMA_PREFETCH_MODELS="${AIONIMA_PREFETCH_MODELS:-1}"
AIONIMA_GGUF_PATH="${AIONIMA_GGUF_PATH:-}"
AIONIMA_HF_TOKEN="${AIONIMA_HF_TOKEN:-}"
AIONIMA_AION_MICRO_HF_REPO="${AIONIMA_AION_MICRO_HF_REPO:-wishborn/aion-micro-v1}"
AIONIMA_AION_MICRO_GGUF_FILE="${AIONIMA_AION_MICRO_GGUF_FILE:-aion-micro-v1.gguf}"

# Helper: run a command as the service user without consuming stdin
# (critical when this script is piped from curl)
run_as() {
  su - "$AIONIMA_USER" -c "$1" < /dev/null
}

# ---------------------------------------------------------------------------
# 0. Pre-flight checks
# ---------------------------------------------------------------------------
echo ""
echo "  ============================================"
echo "    Aionima Installer"
echo "  ============================================"
echo ""
echo "    User:    $AIONIMA_USER"
echo "    Install: $INSTALL_DIR"
echo "    Branch:  $BRANCH"
echo ""

if [[ $EUID -ne 0 ]]; then
  echo "Error: install.sh must be run as root (use sudo)" >&2
  exit 1
fi

if ! command -v systemctl &>/dev/null; then
  echo "Error: systemd is required" >&2
  exit 1
fi

if [ -f /etc/os-release ]; then
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" && "${ID_LIKE:-}" != *"ubuntu"* && "${ID_LIKE:-}" != *"debian"* ]]; then
    echo "Warning: This script is designed for Ubuntu/Debian. Proceeding anyway..."
  fi
else
  echo "Warning: Cannot detect OS. Proceeding anyway..."
fi

# ---------------------------------------------------------------------------
# 1. Service user
# ---------------------------------------------------------------------------
if id "$AIONIMA_USER" &>/dev/null; then
  echo "==> User '$AIONIMA_USER' already exists"
else
  echo "==> Creating user '$AIONIMA_USER'..."
  useradd -m -s /bin/bash "$AIONIMA_USER"
fi

usermod -aG adm "$AIONIMA_USER" 2>/dev/null || true

# Grant passwordless sudo — needed for hosting-setup.sh, Playwright browser deps,
# and container runtime management
if [ ! -f "/etc/sudoers.d/$AIONIMA_USER" ]; then
  echo "$AIONIMA_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$AIONIMA_USER"
  chmod 0440 "/etc/sudoers.d/$AIONIMA_USER"
  echo "==> Granted passwordless sudo to '$AIONIMA_USER'"
fi

# ---------------------------------------------------------------------------
# 2. System dependencies
# ---------------------------------------------------------------------------
echo "==> Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
  build-essential \
  python3 \
  git \
  curl \
  ca-certificates \
  gnupg \
  rsync

# ---------------------------------------------------------------------------
# 3. Node.js 22 LTS (via NodeSource)
# ---------------------------------------------------------------------------
NODE_MAJOR=22
if command -v node &>/dev/null; then
  CURRENT_NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [ "$CURRENT_NODE_MAJOR" -ge "$NODE_MAJOR" ]; then
    echo "==> Node.js $(node -v) already installed (>= $NODE_MAJOR)"
  else
    echo "==> Upgrading Node.js to v$NODE_MAJOR..."
    INSTALL_NODE=1
  fi
else
  echo "==> Installing Node.js v$NODE_MAJOR..."
  INSTALL_NODE=1
fi

if [ "${INSTALL_NODE:-}" = "1" ]; then
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi

# ---------------------------------------------------------------------------
# 3b. cloudflared (optional — for public tunnel sharing)
# ---------------------------------------------------------------------------
if ! command -v cloudflared &>/dev/null; then
  echo "==> Installing cloudflared..."
  ARCH=$(dpkg --print-architecture 2>/dev/null || echo amd64)
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH.deb" \
    -o /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
else
  echo "==> cloudflared already installed"
fi

# ---------------------------------------------------------------------------
# 4. Enable pnpm via corepack
# ---------------------------------------------------------------------------
echo "==> Enabling pnpm via corepack..."
corepack enable pnpm 2>/dev/null || npm install -g corepack && corepack enable pnpm

# ---------------------------------------------------------------------------
# 5. Clone all repos
# ---------------------------------------------------------------------------
clone_repo() {
  local label="$1" repo="$2" dir="$3"
  if [ -d "$dir/.git" ]; then
    echo "==> $label already exists at $dir"
  else
    echo "==> Cloning $label to $dir..."
    git clone --branch "$BRANCH" "$repo" "$dir"
    chown -R "$AIONIMA_USER:$AIONIMA_USER" "$dir"
  fi
}

clone_repo "AGI"                "$AIONIMA_REPO"        "$INSTALL_DIR"
clone_repo "PRIME"              "$PRIME_REPO"           "$PRIME_DIR"
# Plugin and MApp marketplaces are NOT cloned locally — the gateway
# fetches catalogs and installs plugins directly from GitHub on demand.
# Local-ID is absorbed into AGI (s180) — no separate ID repo clone needed.

# ---------------------------------------------------------------------------
# 6. Dependencies and build — delegated to upgrade.sh
#
# pnpm install, pnpm build, Playwright browser install, native module
# rebuild, and Local-ID container build are all handled by upgrade.sh which
# is invoked at the end of install.sh. This avoids duplicating logic and
# ensures the same code path runs for every subsequent agi upgrade.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 7. Create data directory
# ---------------------------------------------------------------------------
AGI_DATA="/home/$AIONIMA_USER/.agi"
mkdir -p "$AGI_DATA"
chown "$AIONIMA_USER:$AIONIMA_USER" "$AGI_DATA"

# Create minimal config if it doesn't exist (gateway requires it to boot)
AGI_CONFIG="$AGI_DATA/gateway.json"
if [ ! -f "$AGI_CONFIG" ]; then
  DETECTED_IP="$(hostname -I | awk '{print $1}')"

  # Allow non-interactive installs by pre-setting LAN_IP
  if [ -n "${LAN_IP:-}" ]; then
    echo "  Using pre-set LAN_IP: $LAN_IP"
  else
    echo ""
    echo "  Detected IP: $DETECTED_IP"
    echo ""
    echo "  Your machine needs a fixed IP if other devices will connect to it."
    echo "  Otherwise, it can use whatever IP your router assigns (DHCP)."
    echo ""
    echo "  1) Use detected IP ($DETECTED_IP)"
    echo "  2) Use Aionima standard IP (192.168.0.144)"
    echo "  3) Enter a custom IP"
    echo "  4) Use DHCP (auto-assigned, may change on reboot)"
    echo ""
    read -p "  Choose [1]: " IP_CHOICE

    case "${IP_CHOICE:-1}" in
    2)
      LAN_IP="192.168.0.144"
      # Attempt to set static IP via nmcli if available
      if command -v nmcli &>/dev/null; then
        ACTIVE_CON="$(nmcli -t -f NAME con show --active | head -1)"
        if [ -n "$ACTIVE_CON" ]; then
          CURRENT_PREFIX="$(ip -o -4 addr show | awk '{print $4}' | head -1 | cut -d/ -f2)"
          CURRENT_GW="$(ip route show default | awk '{print $3}' | head -1)"
          echo "  Setting static IP $LAN_IP via nmcli..."
          nmcli con mod "$ACTIVE_CON" ipv4.addresses "$LAN_IP/${CURRENT_PREFIX:-24}" ipv4.gateway "${CURRENT_GW:-}" ipv4.method manual 2>/dev/null || true
          nmcli con up "$ACTIVE_CON" 2>/dev/null || true
        fi
      else
        echo "  [NOTE] nmcli not found — please configure $LAN_IP as a static IP manually."
      fi
      ;;
    3)
      read -p "  Enter IP address: " LAN_IP
      if [ -z "$LAN_IP" ]; then
        LAN_IP="$DETECTED_IP"
        echo "  Using detected IP: $LAN_IP"
      fi
      ;;
    4)
      LAN_IP="$DETECTED_IP"
      echo "  Using DHCP — current IP is $LAN_IP (may change on reboot)"
      ;;
    *)
      LAN_IP="$DETECTED_IP"
      ;;
    esac
  fi

  cat > "$AGI_CONFIG" << CFGEOF
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 3100
  },
  "entities": {
    "path": "$AGI_DATA/entities.db"
  },
  "hosting": {
    "enabled": true,
    "lanIp": "$LAN_IP",
    "baseDomain": "ai.on"
  },
  "workspace": {
    "selfRepo": "$INSTALL_DIR",
    "root": "/home/$AIONIMA_USER"
  }
}
CFGEOF
  chown "$AIONIMA_USER:$AIONIMA_USER" "$AGI_CONFIG"
  echo "  [OK] Config created at $AGI_CONFIG (LAN IP: $LAN_IP)"
fi

# ---------------------------------------------------------------------------
# 7b. Pre-stage aion-micro GGUF for offline operation
#
# Downloads (or copies) the fine-tuned aion-micro GGUF to
# ~/.agi/models/aion-micro/ at install time so subsequent runs work without
# any internet connection. If the model repo isn't published yet, the step
# logs a note and continues — aion-micro will use its fallback model until
# the GGUF is staged manually or via `agi lemonade pull <model>`.
# ---------------------------------------------------------------------------
AION_MICRO_MODEL_DIR="$AGI_DATA/models/aion-micro"
AION_MICRO_GGUF_DEST="$AION_MICRO_MODEL_DIR/$AIONIMA_AION_MICRO_GGUF_FILE"

if [ "$AIONIMA_PREFETCH_MODELS" = "1" ] && [ ! -f "$AION_MICRO_GGUF_DEST" ]; then
  mkdir -p "$AION_MICRO_MODEL_DIR"
  chown "$AIONIMA_USER:$AIONIMA_USER" "$AION_MICRO_MODEL_DIR"

  if [ -n "$AIONIMA_GGUF_PATH" ]; then
    # Offline mode — user supplied the GGUF alongside the installer
    if [ -f "$AIONIMA_GGUF_PATH" ]; then
      echo "==> Staging pre-provided aion-micro GGUF..."
      cp "$AIONIMA_GGUF_PATH" "$AION_MICRO_GGUF_DEST"
      chown "$AIONIMA_USER:$AIONIMA_USER" "$AION_MICRO_GGUF_DEST"
      echo "  [OK] aion-micro GGUF staged at $AION_MICRO_GGUF_DEST"
    else
      echo "  [WARN] AIONIMA_GGUF_PATH=$AIONIMA_GGUF_PATH not found — aion-micro will use its fallback model"
    fi
  else
    # Online mode — download from HuggingFace Hub
    echo "==> Downloading aion-micro GGUF from HuggingFace ($AIONIMA_AION_MICRO_HF_REPO)..."
    HF_URL="https://huggingface.co/${AIONIMA_AION_MICRO_HF_REPO}/resolve/main/${AIONIMA_AION_MICRO_GGUF_FILE}"
    CURL_OPTS="-fsSL --connect-timeout 15"
    if [ -n "$AIONIMA_HF_TOKEN" ]; then
      CURL_OPTS="$CURL_OPTS -H \"Authorization: Bearer $AIONIMA_HF_TOKEN\""
    fi

    # Download to a temp file; rename on success so a partial download isn't mistaken for the real file
    AION_MICRO_GGUF_TMP="${AION_MICRO_GGUF_DEST}.tmp"
    # shellcheck disable=SC2086
    if eval "curl $CURL_OPTS -o '$AION_MICRO_GGUF_TMP' '$HF_URL'" 2>/dev/null; then
      mv "$AION_MICRO_GGUF_TMP" "$AION_MICRO_GGUF_DEST"
      chown "$AIONIMA_USER:$AIONIMA_USER" "$AION_MICRO_GGUF_DEST"
      echo "  [OK] aion-micro GGUF downloaded to $AION_MICRO_GGUF_DEST"
    else
      rm -f "$AION_MICRO_GGUF_TMP"
      echo "  [NOTE] aion-micro GGUF not yet available at $HF_URL (model may not be published yet)"
      echo "         Once published, run: agi lemonade pull $AIONIMA_AION_MICRO_HF_REPO"
      echo "         Or re-run install with: AIONIMA_HF_TOKEN=<token> sudo bash install.sh"
    fi
  fi
fi

# Patch gateway.json to wire localGgufPath when the GGUF is present
if [ -f "$AION_MICRO_GGUF_DEST" ] && [ -f "$AGI_CONFIG" ]; then
  python3 - << PYEOF
import json, sys
try:
    with open('$AGI_CONFIG') as f:
        cfg = json.load(f)
    ops = cfg.setdefault('ops', {})
    aion_micro = ops.setdefault('aionMicro', {})
    aion_micro['localGgufPath'] = '$AION_MICRO_GGUF_DEST'
    with open('$AGI_CONFIG', 'w') as f:
        json.dump(cfg, f, indent=2)
    print('  [OK] gateway.json: ops.aionMicro.localGgufPath = $AION_MICRO_GGUF_DEST')
except Exception as e:
    print(f'  [WARN] Could not patch gateway.json: {e}', file=sys.stderr)
PYEOF
  chown "$AIONIMA_USER:$AIONIMA_USER" "$AGI_CONFIG"
fi

# ---------------------------------------------------------------------------
# 8. Record installed commit
# ---------------------------------------------------------------------------
git -C "$INSTALL_DIR" rev-parse HEAD > "$INSTALL_DIR/.deployed-commit"
chown "$AIONIMA_USER:$AIONIMA_USER" "$INSTALL_DIR/.deployed-commit"

# ---------------------------------------------------------------------------
# 9. (Removed — Local-ID service absorbed into AGI core via s180)
# Identity, OAuth, and entity registration are now built into the AGI gateway.
# There is no separate agi-local-id process or container to install.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 10. Install systemd service
# ---------------------------------------------------------------------------
echo "==> Installing systemd service..."
SERVICE_FILE="$INSTALL_DIR/scripts/agi.service"
DEST_SERVICE="/etc/systemd/system/agi.service"

sed "s/%AIONIMA_USER%/$AIONIMA_USER/g" "$SERVICE_FILE" > "$DEST_SERVICE"
systemctl daemon-reload
systemctl enable agi
echo "  [OK] Service installed and enabled"

# ---------------------------------------------------------------------------
# 11. Set up hosting infrastructure (Caddy, dnsmasq, Podman)
# ---------------------------------------------------------------------------
HOSTING_SETUP="$INSTALL_DIR/scripts/hosting-setup.sh"
if [ -f "$HOSTING_SETUP" ]; then
  echo "==> Setting up hosting infrastructure (Caddy, dnsmasq, Podman)..."
  LAN_IP="$(hostname -I | awk '{print $1}')" \
    SUDO_USER="$AIONIMA_USER" \
    bash "$HOSTING_SETUP"
fi

# ---------------------------------------------------------------------------
# 11b. Install + enable agi-caddy (rootless containerized Caddy)
# ---------------------------------------------------------------------------
# Story #100 cutover: production proxy is the rootless container, not the
# host-mode caddy.service (apt package). The container lives on the
# `aionima` podman network so it can reach project containers (bliss-
# chronicles, kronos-trader, civicognita-website, ra-web, etc) by podman
# DNS name — `host.containers.internal` doesn't work for that. The host
# caddy.service was disabled in hosting-setup.sh; here we install + enable
# the user-mode unit so it auto-starts on every reboot.
#
# 2026-04-29 cycle-after-reboot bug: this block was missing, so a reboot
# left agi-caddy.service "loaded but disabled" and ai.on:443 had no
# listener → ERR_CONNECTION_REFUSED until manually started.
CADDY_USER_HOME="/home/$AIONIMA_USER"
CADDY_USER_SYSTEMD_DIR="$CADDY_USER_HOME/.config/systemd/user"
run_as "mkdir -p '$CADDY_USER_SYSTEMD_DIR'"
cp "$INSTALL_DIR/scripts/agi-caddy.service" "$CADDY_USER_SYSTEMD_DIR/agi-caddy.service"
chown "$AIONIMA_USER:$AIONIMA_USER" "$CADDY_USER_SYSTEMD_DIR/agi-caddy.service"

# Linger keeps user-mode units alive without a login session — required so
# agi-caddy starts on boot before the user logs in. Idempotent.
loginctl enable-linger "$AIONIMA_USER" 2>/dev/null || true

run_as "systemctl --user daemon-reload" || true
run_as "systemctl --user enable --now agi-caddy.service" || \
  echo "  [WARN] systemctl enable/start agi-caddy failed; run 'agi doctor' to investigate"
echo "  [OK] agi-caddy (rootless containerized) enabled — survives reboots"

# Configure the host machine to use itself for DNS so *.ai.on resolves locally
RESOLV_OVERRIDE="/etc/systemd/resolved.conf.d/aionima-self-dns.conf"
if [ ! -f "$RESOLV_OVERRIDE" ]; then
  LAN_IP="$(hostname -I | awk '{print $1}')"
  echo "==> Configuring this machine to use local DNS ($LAN_IP)..."
  mkdir -p /etc/systemd/resolved.conf.d
  cat > "$RESOLV_OVERRIDE" <<EOF
[Resolve]
DNS=$LAN_IP
Domains=~ai.on
EOF
  systemctl restart systemd-resolved 2>/dev/null || true
  echo "  [OK] Local DNS configured"
fi

# ---------------------------------------------------------------------------
# 13. Install agi CLI (symlink)
# ---------------------------------------------------------------------------
AGI_CLI="$INSTALL_DIR/scripts/agi-cli.sh"
if [ -x "$AGI_CLI" ]; then
  ln -sf "$AGI_CLI" /usr/local/bin/agi 2>/dev/null || true
  echo "  [OK] agi CLI linked to /usr/local/bin/agi"
fi

# ---------------------------------------------------------------------------
# 14. First build + start — delegated to upgrade.sh
#
# upgrade.sh handles: pnpm install, Playwright, pnpm build, channel builds,
# Local-ID container build, DB migrations, plugin sync, and service restart.
# Running it here on first install is identical to every subsequent
# `agi upgrade` — one code path for all boots.
# ---------------------------------------------------------------------------
echo "==> Running first build + start via upgrade.sh..."
AIONIMA_DEPLOY_DIR="$INSTALL_DIR" AIONIMA_USER="$AIONIMA_USER" \
  bash "$INSTALL_DIR/scripts/upgrade.sh" || \
  echo "  [WARN] upgrade.sh reported errors — run 'agi logs' to investigate"

# ---------------------------------------------------------------------------
# 15. Run hardening (unless skipped)
# ---------------------------------------------------------------------------
if [ "${SKIP_HARDENING}" = "1" ]; then
  echo "==> Skipping hardening (AIONIMA_SKIP_HARDENING=1)"
else
  HARDENING="$INSTALL_DIR/scripts/hardening.sh"
  if [ -f "$HARDENING" ]; then
    echo "==> Running hardening..."
    AIONIMA_USER="$AIONIMA_USER" AIONIMA_DEPLOY_DIR="$INSTALL_DIR" AGI_DEPLOY_DIR="$INSTALL_DIR" \
      bash "$HARDENING"
  fi
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
LAN_IP="$(hostname -I | awk '{print $1}')"

echo ""
echo "  ============================================"
echo "    Aionima installed successfully!"
echo "  ============================================"
echo ""
echo "  Dashboard:  http://${LAN_IP}:3100"
echo "              https://aionima.ai.on (after DNS setup below)"
echo ""
echo "  Next steps:"
echo ""
echo "    1. Open the dashboard and complete onboarding"
echo "       http://${LAN_IP}:3100"
echo ""
echo "    2. Set up DNS on your network"
echo "       Point other devices to use ${LAN_IP} as their DNS server"
echo "       so *.ai.on domains resolve to this machine."
echo ""
echo "       macOS:    System Settings > Network > DNS > add ${LAN_IP}"
echo "       Windows:  Settings > Network > DNS > ${LAN_IP}"
echo "       Linux:    Set DNS=${LAN_IP} in /etc/systemd/resolved.conf"
echo "       Router:   Set primary DNS to ${LAN_IP} (affects all devices)"
echo ""
echo "       This machine is already configured to use local DNS."
echo ""
echo "  Useful commands:"
echo "    agi status     Check service health"
echo "    agi upgrade    Pull updates and rebuild"
echo "    agi logs       View gateway logs"
echo "    agi doctor     Run diagnostics"
echo ""

# Ask user to star the project on GitHub (skip in non-interactive mode)
if [ -t 0 ]; then
  read -p "  Would you like to show some love by starring the project on GitHub? [Y/n] " STAR_CHOICE
  if [[ "${STAR_CHOICE:-Y}" =~ ^[Yy] ]]; then
    xdg-open "https://github.com/Civicognita/agi" 2>/dev/null \
      || open "https://github.com/Civicognita/agi" 2>/dev/null \
      || echo "  Visit: https://github.com/Civicognita/agi"
  fi
fi
echo ""
