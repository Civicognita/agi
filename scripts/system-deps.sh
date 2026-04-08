#!/usr/bin/env bash
# System dependency management — called by upgrade.sh during upgrades.
# Each check is idempotent: skip if already installed, install if missing.
set -euo pipefail

CHANGED=0

# cloudflared (Cloudflare quick tunnels for project sharing)
if ! command -v cloudflared &>/dev/null; then
  echo "  Installing cloudflared..."
  ARCH=$(dpkg --print-architecture 2>/dev/null || echo amd64)
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH.deb" \
    -o /tmp/cloudflared.deb
  sudo dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
  CHANGED=1
fi

# --- Add future system dependencies above this line ---

if [ "$CHANGED" -eq 0 ]; then
  echo "  All system dependencies present"
fi
