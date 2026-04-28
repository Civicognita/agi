#!/usr/bin/env bash
#
# hosting-teardown.sh — Reverse of hosting-setup.sh.
#
# Removes ai.on DNS config, stops dnsmasq/Caddy, cleans up config files.
# Does NOT uninstall the packages (they may be needed for other purposes).
#
# Usage: sudo bash scripts/hosting-teardown.sh
#
set -euo pipefail

echo "=== Aionima Hosting Infrastructure Teardown ==="

# ---------------------------------------------------------------------------
# 1. Stop and remove agi-managed containers
# ---------------------------------------------------------------------------

SUDO_USER="${SUDO_USER:-wishborn}"

echo "[...] Stopping agi-managed containers..."
CONTAINERS=$(su - "$SUDO_USER" -c "podman ps -a --filter label=agi.managed=true --format '{{.Names}}'" 2>/dev/null || true)
if [ -n "$CONTAINERS" ]; then
  for name in $CONTAINERS; do
    su - "$SUDO_USER" -c "podman rm -f $name" 2>/dev/null || true
    echo "  removed: $name"
  done
  echo "[OK] AGI containers removed"
else
  echo "[OK] No agi containers found"
fi

# ---------------------------------------------------------------------------
# 2. Stop and disable services
# ---------------------------------------------------------------------------

echo "[...] Stopping Caddy..."
systemctl stop caddy 2>/dev/null || true
systemctl disable caddy 2>/dev/null || true
echo "[OK] Caddy stopped"

echo "[...] Stopping dnsmasq..."
systemctl stop dnsmasq 2>/dev/null || true
systemctl disable dnsmasq 2>/dev/null || true
echo "[OK] dnsmasq stopped"

# ---------------------------------------------------------------------------
# 3. Remove dnsmasq config
# ---------------------------------------------------------------------------

DNSMASQ_CONF="/etc/dnsmasq.d/ai-on.conf"
if [ -f "$DNSMASQ_CONF" ]; then
  rm -f "$DNSMASQ_CONF"
  echo "[OK] Removed $DNSMASQ_CONF"
else
  echo "[OK] $DNSMASQ_CONF already absent"
fi

# ---------------------------------------------------------------------------
# 4. Remove systemd-resolved config
# ---------------------------------------------------------------------------

RESOLVED_CONF="/etc/systemd/resolved.conf.d/ai-on.conf"
if [ -f "$RESOLVED_CONF" ]; then
  rm -f "$RESOLVED_CONF"
  systemctl restart systemd-resolved 2>/dev/null || true
  echo "[OK] Removed $RESOLVED_CONF and restarted systemd-resolved"
else
  echo "[OK] $RESOLVED_CONF already absent"
fi

# ---------------------------------------------------------------------------
# 5. Reset Caddyfile to default
# ---------------------------------------------------------------------------

CADDYFILE="/etc/caddy/Caddyfile"
if [ -f "$CADDYFILE" ] && grep -q "aionima" "$CADDYFILE" 2>/dev/null; then
  cat > "$CADDYFILE" <<'EOF'
# Caddy default — aionima hosting removed.
:80 {
    respond "Hello, world!" 200
}
EOF
  echo "[OK] Caddyfile reset to default"
else
  echo "[OK] Caddyfile not managed by aionima"
fi

echo ""
echo "=== Teardown Complete ==="
echo "  Caddy and dnsmasq stopped. Packages not uninstalled."
echo "  To fully remove: sudo apt purge caddy dnsmasq"
