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
ID_REPO="${AIONIMA_ID_REPO:-https://github.com/Civicognita/agi-local-id.git}"
ID_DIR="${AIONIMA_ID_DIR:-/opt/agi-local-id}"
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
clone_repo "ID Service"         "$ID_REPO"              "$ID_DIR"
# Plugin and MApp marketplaces are NOT cloned locally — the gateway
# fetches catalogs and installs plugins directly from GitHub on demand.

# ---------------------------------------------------------------------------
# 6. Install dependencies and build
# ---------------------------------------------------------------------------
echo "==> Installing pnpm dependencies..."
run_as "cd '$INSTALL_DIR' && pnpm install --frozen-lockfile"

echo "==> Installing Playwright browser (chromium)..."
run_as "cd '$INSTALL_DIR' && npx playwright install chromium --with-deps" || echo "WARNING: Playwright browser install failed (visual-inspect tool will be unavailable)"

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
# 8. Record installed commit
# ---------------------------------------------------------------------------
git -C "$INSTALL_DIR" rev-parse HEAD > "$INSTALL_DIR/.deployed-commit"
chown "$AIONIMA_USER:$AIONIMA_USER" "$INSTALL_DIR/.deployed-commit"

# ---------------------------------------------------------------------------
# 9. Set up local ID service (postgres + build + systemd unit)
#
# AGI owns the local-id lifecycle end-to-end: the local-id repo is pure
# source code. Everything below — .env creation, PostgreSQL via Podman,
# dependency install, drizzle migrations, systemd unit install — belongs
# here, not in the ID repo.
#
# Ongoing upgrades are handled by `scripts/upgrade.sh` which reads
# `~/.agi/gateway.json` → `idService.local.enabled` and restarts the
# `agi-id` service whenever the ID source changes.
# ---------------------------------------------------------------------------
if [ -d "$ID_DIR/.git" ]; then
  echo "==> Setting up local ID service..."

  # 9a. .env with encryption key + placeholder OAuth slots
  ID_ENV="$ID_DIR/.env"
  if [ ! -f "$ID_ENV" ]; then
    ID_ENCRYPTION_KEY=$(openssl rand -hex 32)
    cat > "$ID_ENV" <<IDENVEOF
# Aionima Local ID Service — managed by AGI's install.sh / upgrade.sh
ID_SERVICE_MODE=local
PORT=3200
ENCRYPTION_KEY=$ID_ENCRYPTION_KEY

# DATABASE_URL is written below by the Podman PostgreSQL setup

# OAuth credentials (optional — add as needed; hot-reloaded by the service)
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# DISCORD_CLIENT_ID=
# DISCORD_CLIENT_SECRET=
IDENVEOF
    chown "$AIONIMA_USER:$AIONIMA_USER" "$ID_ENV"
    chmod 600 "$ID_ENV"
    echo "  [OK] Generated $ID_ENV"
  fi

  # 9b. PostgreSQL — managed by the agi-postgres plugin.
  # The standalone Podman container previously created here has been removed.
  # PostgreSQL is now provisioned through the Services page (agi-postgres plugin),
  # which uses ghcr.io/civicognita/postgres:17 on port 5432.
  # After install, enable the agi-postgres service in the dashboard, then add
  # DATABASE_URL to $ID_ENV if it is not already present.
  if ! grep -q "^DATABASE_URL=" "$ID_ENV"; then
    echo "  [NOTE] DATABASE_URL not set in $ID_ENV."
    echo "         Enable the agi-postgres service in the dashboard (Services page)"
    echo "         and add the connection string to $ID_ENV, then restart agi-id."
  fi

  # 9c. Build the Local-ID container image. The Dockerfile there runs
  # npm ci + tsc + drizzle-kit generate entirely inside the build stage;
  # no host-side install is needed. Only AGI itself runs as a host process;
  # everything else runs in a rootless Podman container.
  echo "  Building Local-ID container image..."
  run_as "cd '$ID_DIR' && podman build -t localhost/agi-local-id:latest . 2>&1 | tail -3"

  # 9d. Ensure the `aionima` container network exists (shared with
  # agi-postgres-17 so the services can reach each other by name).
  run_as "podman network inspect aionima >/dev/null 2>&1 || podman network create aionima"

  # 9e. Enable linger so user-level systemd services survive logout.
  loginctl enable-linger "$AIONIMA_USER" 2>/dev/null || true

  # 9f. Install the persistent user-level systemd unit that manages the
  # ID container. Story #100 moved off the old `podman generate systemd`
  # scratch output (which pointed at /tmp/agi-id.container.env, a path
  # that wipes on reboot and left ID dead across reboots). Instead:
  #   - Write the DATABASE_URL-rewritten env to a persistent user path
  #     at ~/.config/agi-local-id/container.env
  #   - Install the committed unit template from scripts/agi-local-id.service
  #     that references %h/.config/agi-local-id/container.env
  #   - No host port binding — the container lives on the aionima network
  #     and is reached by Caddy-on-aionima via podman DNS (agi-local-id:3200)
  ID_USER_HOME="/home/$AIONIMA_USER"
  ID_USER_SYSTEMD_DIR="$ID_USER_HOME/.config/systemd/user"
  ID_USER_ENV_DIR="$ID_USER_HOME/.config/agi-local-id"
  ID_USER_ENV_FILE="$ID_USER_ENV_DIR/container.env"

  run_as "mkdir -p '$ID_USER_SYSTEMD_DIR' '$ID_USER_ENV_DIR'"

  # Patch DATABASE_URL for the container — localhost in .env refers to the
  # host, but a container on the aionima network reaches Postgres by
  # service name `agi-postgres-17`. Write directly to the persistent path;
  # no /tmp hop.
  sed 's|@localhost:5432/|@agi-postgres-17:5432/|' "$ID_ENV" > "$ID_USER_ENV_FILE"
  chmod 600 "$ID_USER_ENV_FILE"
  chown "$AIONIMA_USER:$AIONIMA_USER" "$ID_USER_ENV_FILE"

  # Install the committed unit template (no transient /tmp references)
  cp "$INSTALL_DIR/scripts/agi-local-id.service" "$ID_USER_SYSTEMD_DIR/agi-local-id.service"
  chown "$AIONIMA_USER:$AIONIMA_USER" "$ID_USER_SYSTEMD_DIR/agi-local-id.service"

  # Seed the container so it's running when the unit activates. Recreate
  # against the latest image if one already exists from a prior install.
  run_as "podman rm -f agi-local-id 2>/dev/null || true"

  run_as "systemctl --user daemon-reload" || true
  run_as "systemctl --user enable --now agi-local-id.service" || \
    echo "  [WARN] systemctl enable/start agi-local-id failed; retry via dashboard after agi-postgres-17 is up"
  echo "  [OK] agi-local-id container on aionima (no host port), persistent env at $ID_USER_ENV_FILE"
fi

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
systemctl start agi
sleep 3
if systemctl is-active --quiet agi; then
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
