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
INSTALL_DIR="${AIONIMA_INSTALL_DIR:-/opt/aionima}"
PRIME_REPO="${AIONIMA_PRIME_REPO:-https://github.com/Civicognita/aionima.git}"
PRIME_DIR="${AIONIMA_PRIME_DIR:-/opt/aionima-prime}"
MARKETPLACE_REPO="${AIONIMA_MARKETPLACE_REPO:-https://github.com/Civicognita/aionima-marketplace.git}"
MARKETPLACE_DIR="${AIONIMA_MARKETPLACE_DIR:-/opt/aionima-marketplace}"
MAPP_MARKETPLACE_REPO="${AIONIMA_MAPP_MARKETPLACE_REPO:-https://github.com/Civicognita/aionima-mapp-marketplace.git}"
MAPP_MARKETPLACE_DIR="${AIONIMA_MAPP_MARKETPLACE_DIR:-/opt/aionima-mapp-marketplace}"
ID_REPO="${AIONIMA_ID_REPO:-https://github.com/Civicognita/aionima-local-id.git}"
ID_DIR="${AIONIMA_ID_DIR:-/opt/aionima-local-id}"
BRANCH="${AIONIMA_BRANCH:-main}"
SKIP_HARDENING="${AIONIMA_SKIP_HARDENING:-}"

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
clone_repo "Plugin Marketplace" "$MARKETPLACE_REPO"     "$MARKETPLACE_DIR"
clone_repo "MApp Marketplace"   "$MAPP_MARKETPLACE_REPO" "$MAPP_MARKETPLACE_DIR"
clone_repo "ID Service"         "$ID_REPO"              "$ID_DIR"

# ---------------------------------------------------------------------------
# 6. Install dependencies and build
# ---------------------------------------------------------------------------
echo "==> Installing pnpm dependencies..."
run_as "cd '$INSTALL_DIR' && pnpm install --frozen-lockfile"

echo "==> Building..."
run_as "cd '$INSTALL_DIR' && pnpm build"

# Record Node.js version so upgrade.sh knows when to rebuild native modules
node -v > "$INSTALL_DIR/.node-version-hash"
chown "$AIONIMA_USER:$AIONIMA_USER" "$INSTALL_DIR/.node-version-hash"

# ---------------------------------------------------------------------------
# 7. Create data directory
# ---------------------------------------------------------------------------
AGI_DATA="/home/$AIONIMA_USER/.agi"
mkdir -p "$AGI_DATA"
chown "$AIONIMA_USER:$AIONIMA_USER" "$AGI_DATA"

# Create minimal config if it doesn't exist (gateway requires it to boot)
AGI_CONFIG="$AGI_DATA/aionima.json"
if [ ! -f "$AGI_CONFIG" ]; then
  LAN_IP="$(hostname -I | awk '{print $1}')"
  cat > "$AGI_CONFIG" << CFGEOF
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 3100
  },
  "hosting": {
    "enabled": true,
    "baseDomain": "ai.on"
  },
  "workspace": {
    "selfRepo": "$INSTALL_DIR",
    "root": "/home/$AIONIMA_USER"
  }
}
CFGEOF
  chown "$AIONIMA_USER:$AIONIMA_USER" "$AGI_CONFIG"
  echo "  [OK] Config created at $AGI_CONFIG"
fi

# ---------------------------------------------------------------------------
# 8. Record installed commit
# ---------------------------------------------------------------------------
git -C "$INSTALL_DIR" rev-parse HEAD > "$INSTALL_DIR/.deployed-commit"
chown "$AIONIMA_USER:$AIONIMA_USER" "$INSTALL_DIR/.deployed-commit"

# ---------------------------------------------------------------------------
# 10. Install systemd service
# ---------------------------------------------------------------------------
echo "==> Installing systemd service..."
SERVICE_FILE="$INSTALL_DIR/scripts/aionima.service"
DEST_SERVICE="/etc/systemd/system/aionima.service"

sed "s/%AIONIMA_USER%/$AIONIMA_USER/g" "$SERVICE_FILE" > "$DEST_SERVICE"
systemctl daemon-reload
systemctl enable aionima
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
# 14. Start the service
# ---------------------------------------------------------------------------
echo "==> Starting Aionima..."
systemctl start aionima
sleep 3
if systemctl is-active --quiet aionima; then
  echo "  [OK] Aionima is running"
else
  echo "  [WARN] Aionima failed to start — run 'agi logs' to investigate"
fi

# ---------------------------------------------------------------------------
# 15. Run hardening (unless skipped)
# ---------------------------------------------------------------------------
if [ "${SKIP_HARDENING}" = "1" ]; then
  echo "==> Skipping hardening (AIONIMA_SKIP_HARDENING=1)"
else
  HARDENING="$INSTALL_DIR/scripts/hardening.sh"
  if [ -f "$HARDENING" ]; then
    echo "==> Running hardening..."
    AIONIMA_USER="$AIONIMA_USER" AIONIMA_DEPLOY_DIR="$INSTALL_DIR" \
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
