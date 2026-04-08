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
AIONIMA_REPO_DIR="${AIONIMA_REPO_DIR:-/home/$AIONIMA_USER/_projects/agi}"
AIONIMA_DEPLOY_DIR="${AIONIMA_DEPLOY_DIR:-/opt/aionima}"
AIONIMA_PRIME_REPO="${AIONIMA_PRIME_REPO:-https://github.com/Civicognita/aionima.git}"
AIONIMA_PRIME_DIR="${AIONIMA_PRIME_DIR:-/opt/aionima-prime}"
AIONIMA_MARKETPLACE_REPO="${AIONIMA_MARKETPLACE_REPO:-https://github.com/Civicognita/aionima-marketplace.git}"
AIONIMA_MARKETPLACE_DIR="${AIONIMA_MARKETPLACE_DIR:-/opt/aionima-marketplace}"
AIONIMA_MAPP_MARKETPLACE_REPO="${AIONIMA_MAPP_MARKETPLACE_REPO:-https://github.com/Civicognita/aionima-mapp-marketplace.git}"
AIONIMA_MAPP_MARKETPLACE_DIR="${AIONIMA_MAPP_MARKETPLACE_DIR:-/opt/aionima-mapp-marketplace}"
AIONIMA_ID_REPO="${AIONIMA_ID_REPO:-https://github.com/Civicognita/aionima-local-id.git}"
AIONIMA_ID_DIR="${AIONIMA_ID_DIR:-/opt/aionima-local-id}"
AIONIMA_BRANCH="${AIONIMA_BRANCH:-main}"
AIONIMA_SKIP_HARDENING="${AIONIMA_SKIP_HARDENING:-}"

# Helper: run a command as the service user without consuming stdin
# (critical when this script is piped from curl)
run_as() {
  su - "$AIONIMA_USER" -c "$1" < /dev/null
}

# ---------------------------------------------------------------------------
# 0. Pre-flight checks
# ---------------------------------------------------------------------------
echo "==> Aionima installer"
echo "    User:   $AIONIMA_USER"
echo "    Repo:   $AIONIMA_REPO"
echo "    Dir:    $AIONIMA_REPO_DIR"
echo "    Deploy: $AIONIMA_DEPLOY_DIR"
echo "    Branch: $AIONIMA_BRANCH"
echo ""

if [[ $EUID -ne 0 ]]; then
  echo "Error: install.sh must be run as root (use sudo)" >&2
  exit 1
fi

if ! command -v systemctl &>/dev/null; then
  echo "Error: systemd is required" >&2
  exit 1
fi

# Detect OS
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

# Add to adm group for log access
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
# 5. Clone or update repository
# ---------------------------------------------------------------------------
if [ -d "$AIONIMA_REPO_DIR/.git" ]; then
  echo "==> Updating existing repo at $AIONIMA_REPO_DIR..."
  run_as "cd '$AIONIMA_REPO_DIR' && git fetch origin && git checkout '$AIONIMA_BRANCH' && git pull --ff-only"
else
  echo "==> Cloning repo to $AIONIMA_REPO_DIR..."
  REPO_PARENT="$(dirname "$AIONIMA_REPO_DIR")"
  mkdir -p "$REPO_PARENT"
  chown "$AIONIMA_USER:$AIONIMA_USER" "$REPO_PARENT"
  run_as "git clone --branch '$AIONIMA_BRANCH' '$AIONIMA_REPO' '$AIONIMA_REPO_DIR'"
fi

# ---------------------------------------------------------------------------
# 5b. Clone companion repos (PRIME, Marketplace, ID)
# ---------------------------------------------------------------------------
for COMP_LABEL_REPO_DIR in \
  "PRIME|$AIONIMA_PRIME_REPO|$AIONIMA_PRIME_DIR" \
  "Marketplace|$AIONIMA_MARKETPLACE_REPO|$AIONIMA_MARKETPLACE_DIR" \
  "MApp Marketplace|$AIONIMA_MAPP_MARKETPLACE_REPO|$AIONIMA_MAPP_MARKETPLACE_DIR" \
  "ID|$AIONIMA_ID_REPO|$AIONIMA_ID_DIR"; do
  COMP_LABEL="${COMP_LABEL_REPO_DIR%%|*}"
  COMP_REST="${COMP_LABEL_REPO_DIR#*|}"
  COMP_REPO="${COMP_REST%%|*}"
  COMP_DIR="${COMP_REST#*|}"

  if [ -d "$COMP_DIR/.git" ]; then
    echo "==> $COMP_LABEL repo already exists at $COMP_DIR"
  else
    echo "==> Cloning $COMP_LABEL repo to $COMP_DIR..."
    mkdir -p "$COMP_DIR"
    chown "$AIONIMA_USER:$AIONIMA_USER" "$COMP_DIR"
    run_as "git clone --branch '$AIONIMA_BRANCH' '$COMP_REPO' '$COMP_DIR'"
  fi
done

# ---------------------------------------------------------------------------
# 6. Install dependencies and build
# ---------------------------------------------------------------------------
echo "==> Installing pnpm dependencies..."
run_as "cd '$AIONIMA_REPO_DIR' && pnpm install --frozen-lockfile"

echo "==> Building..."
run_as "cd '$AIONIMA_REPO_DIR' && pnpm build"

# ---------------------------------------------------------------------------
# 7. Create deploy directory and run initial deploy
# ---------------------------------------------------------------------------
echo "==> Setting up deploy directory..."
mkdir -p "$AIONIMA_DEPLOY_DIR"
chown "$AIONIMA_USER:$AIONIMA_USER" "$AIONIMA_DEPLOY_DIR"

echo "==> Running initial deploy..."
export AIONIMA_USER
export AIONIMA_REPO_DIR
run_as "cd '$AIONIMA_REPO_DIR' && AIONIMA_USER='$AIONIMA_USER' AIONIMA_REPO_DIR='$AIONIMA_REPO_DIR' bash scripts/deploy.sh"

# ---------------------------------------------------------------------------
# 8. Create .env skeleton (if not exists)
# ---------------------------------------------------------------------------
ENV_FILE="$AIONIMA_DEPLOY_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "==> Creating .env skeleton..."
  cat > "$ENV_FILE" << 'ENVEOF'
# Aionima environment — secrets go here (mode 0600)
# Run `aionima setup` to configure interactively.

# LLM Provider (required — at least one)
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-proj-...

# Gateway auth token (auto-generated by `aionima setup`)
# AUTH_TOKEN=

# Channel tokens (enable the channels you use)
# TELEGRAM_BOT_TOKEN=
# DISCORD_BOT_TOKEN=
# SIGNAL_API_URL=http://localhost:8080
# WHATSAPP_ACCESS_TOKEN=
# GMAIL_CLIENT_ID=
# GMAIL_CLIENT_SECRET=
# GMAIL_REFRESH_TOKEN=

# Dashboard auth (optional)
# JWT_SECRET=

# Webhook signature verification (optional)
# WEBHOOK_SECRET=
ENVEOF
  chown "$AIONIMA_USER:$AIONIMA_USER" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
else
  echo "==> .env already exists, preserving"
  # Ensure permissions are correct
  chmod 0600 "$ENV_FILE"
  chown "$AIONIMA_USER:$AIONIMA_USER" "$ENV_FILE"
fi

# ---------------------------------------------------------------------------
# 9. Install and enable systemd unit
# ---------------------------------------------------------------------------
echo "==> Installing systemd service..."
SERVICE_FILE="$AIONIMA_REPO_DIR/scripts/aionima.service"
DEST_SERVICE="/etc/systemd/system/aionima.service"

# Template the user into the service file
sed "s/%AIONIMA_USER%/$AIONIMA_USER/g" "$SERVICE_FILE" > "$DEST_SERVICE"
systemctl daemon-reload
systemctl enable aionima
echo "  [OK] Service installed and enabled"

# ---------------------------------------------------------------------------
# 10. Run hardening (unless skipped)
# ---------------------------------------------------------------------------
if [ "${AIONIMA_SKIP_HARDENING:-}" = "1" ]; then
  echo "==> Skipping hardening (AIONIMA_SKIP_HARDENING=1)"
else
  echo "==> Running hardening..."
  AIONIMA_USER="$AIONIMA_USER" AIONIMA_DEPLOY_DIR="$AIONIMA_DEPLOY_DIR" \
    bash "$AIONIMA_REPO_DIR/scripts/hardening.sh"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "============================================"
echo "  Aionima installed successfully!"
echo "============================================"
echo ""
echo "  Next steps:"
echo "    1. Configure:  su - $AIONIMA_USER -c 'cd $AIONIMA_DEPLOY_DIR && npx aionima setup'"
echo "    2. Start:      sudo systemctl start aionima"
echo "    3. Check:      sudo systemctl status aionima"
echo "    4. Diagnose:   su - $AIONIMA_USER -c 'cd $AIONIMA_DEPLOY_DIR && npx aionima doctor'"
echo ""
echo "  Config:  $AIONIMA_DEPLOY_DIR/aionima.json"
echo "  Secrets: $AIONIMA_DEPLOY_DIR/.env"
echo "  Logs:    journalctl -u aionima -f"
echo ""
