#!/usr/bin/env bash
#
# hosting-setup.sh — Idempotent Caddy + dnsmasq setup for ai.on hosting.
#
# Installs Caddy via official apt repo, configures dnsmasq for wildcard
# *.ai.on DNS, and writes a minimal initial Caddyfile.
#
# Usage: sudo bash scripts/hosting-setup.sh
#
set -euo pipefail

LAN_IP="${LAN_IP:?LAN_IP environment variable is required — pass it from install.sh or set it manually}"
BASE_DOMAIN="${BASE_DOMAIN:-ai.on}"
LISTEN_ADDR="127.0.0.2"

echo "=== Aionima Hosting Infrastructure Setup ==="
echo "  LAN IP:      $LAN_IP"
echo "  Base Domain:  $BASE_DOMAIN"
echo "  DNS Listen:   $LISTEN_ADDR"
echo ""

# ---------------------------------------------------------------------------
# 1. Install Caddy via official apt repo
# ---------------------------------------------------------------------------

if command -v caddy &>/dev/null; then
  echo "[OK] Caddy already installed: $(caddy version)"
else
  echo "[...] Installing Caddy..."
  apt-get update -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl

  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null

  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null

  apt-get update -qq
  apt-get install -y -qq caddy
  echo "[OK] Caddy installed: $(caddy version)"
fi

# ---------------------------------------------------------------------------
# 2. Install dnsmasq
# ---------------------------------------------------------------------------

if dpkg -l dnsmasq 2>/dev/null | grep -q "^ii"; then
  echo "[OK] dnsmasq already installed"
else
  echo "[...] Installing dnsmasq..."
  apt-get install -y -qq dnsmasq
  echo "[OK] dnsmasq installed"
fi

# ---------------------------------------------------------------------------
# 3. Configure dnsmasq for wildcard *.ai.on
# ---------------------------------------------------------------------------

DNSMASQ_CONF="/etc/dnsmasq.d/ai-on.conf"
DNSMASQ_CONTENT="# aionima hosting — wildcard DNS for ${BASE_DOMAIN}
listen-address=${LISTEN_ADDR},${LAN_IP}
bind-interfaces
no-resolv
server=8.8.8.8
server=1.1.1.1
address=/${BASE_DOMAIN}/${LAN_IP}"

mkdir -p /etc/dnsmasq.d

if [ -f "$DNSMASQ_CONF" ]; then
  echo "[OK] dnsmasq config already exists at $DNSMASQ_CONF"
else
  echo "[...] Writing dnsmasq config..."
  echo "$DNSMASQ_CONTENT" > "$DNSMASQ_CONF"
  echo "[OK] dnsmasq config written"
fi

# ---------------------------------------------------------------------------
# 4. Configure systemd-resolved to delegate ai.on to dnsmasq
# ---------------------------------------------------------------------------

RESOLVED_CONF_DIR="/etc/systemd/resolved.conf.d"
RESOLVED_CONF="${RESOLVED_CONF_DIR}/ai-on.conf"

mkdir -p "$RESOLVED_CONF_DIR"

if [ -f "$RESOLVED_CONF" ]; then
  echo "[OK] systemd-resolved config already exists"
else
  echo "[...] Writing systemd-resolved config..."
  cat > "$RESOLVED_CONF" <<EOF
[Resolve]
DNS=${LISTEN_ADDR}
Domains=~${BASE_DOMAIN}
EOF
  systemctl restart systemd-resolved 2>/dev/null || true
  echo "[OK] systemd-resolved configured"
fi

# ---------------------------------------------------------------------------
# 5. Install Podman (rootless container runtime)
# ---------------------------------------------------------------------------

if command -v podman &>/dev/null; then
  echo "[OK] Podman already installed: $(podman --version)"
else
  echo "[...] Installing Podman..."
  apt-get install -y -qq podman slirp4netns uidmap
  echo "[OK] Podman installed: $(podman --version)"
fi

# Enable linger so rootless containers survive logout
SUDO_USER="${SUDO_USER:-wishborn}"
echo "[...] Enabling linger for $SUDO_USER..."
loginctl enable-linger "$SUDO_USER" 2>/dev/null || true
echo "[OK] Linger enabled for $SUDO_USER"

# Verify subuid/subgid entries
if grep -q "^${SUDO_USER}:" /etc/subuid 2>/dev/null; then
  echo "[OK] /etc/subuid entry exists for $SUDO_USER"
else
  echo "[WARN] No /etc/subuid entry for $SUDO_USER — rootless containers may fail"
fi
if grep -q "^${SUDO_USER}:" /etc/subgid 2>/dev/null; then
  echo "[OK] /etc/subgid entry exists for $SUDO_USER"
else
  echo "[WARN] No /etc/subgid entry for $SUDO_USER — rootless containers may fail"
fi

# Pre-pull base images as the target user (rootless)
echo "[...] Pre-pulling container images (rootless, as $SUDO_USER)..."
su - "$SUDO_USER" -c "podman pull docker.io/library/nginx:alpine" 2>/dev/null || echo "[WARN] Failed to pull nginx:alpine"
su - "$SUDO_USER" -c "podman pull ghcr.io/civicognita/php-apache:8.4" 2>/dev/null || echo "[WARN] Failed to pull php-apache:8.4"
su - "$SUDO_USER" -c "podman pull ghcr.io/civicognita/node:22" 2>/dev/null || echo "[WARN] Failed to pull node:22"
su - "$SUDO_USER" -c "podman pull ghcr.io/civicognita/postgres:17" 2>/dev/null || echo "[WARN] Failed to pull postgres:17"
su - "$SUDO_USER" -c "podman pull ghcr.io/civicognita/python:3.12" 2>/dev/null || echo "[WARN] Failed to pull python:3.12"
su - "$SUDO_USER" -c "podman pull ghcr.io/civicognita/go:1.24" 2>/dev/null || echo "[WARN] Failed to pull go:1.24"
echo "[OK] Container images pulled"

# ---------------------------------------------------------------------------
# 6. Write minimal initial Caddyfile
# ---------------------------------------------------------------------------

CADDYFILE="/etc/caddy/Caddyfile"

if [ -f "$CADDYFILE" ] && grep -q "aionima" "$CADDYFILE" 2>/dev/null; then
  echo "[OK] Caddyfile already configured for aionima"
else
  echo "[...] Writing initial Caddyfile..."
  cat > "$CADDYFILE" <<EOF
# aionima hosting — managed by gateway HostingManager
# Do not edit manually; the gateway regenerates this file.
#
# Placeholder block — replaced when projects are hosted.
:80 {
    respond "Aionima hosting active. No projects hosted yet." 200
}
EOF
  echo "[OK] Initial Caddyfile written"
fi

# ---------------------------------------------------------------------------
# 7. Enable and start services
# ---------------------------------------------------------------------------

echo "[...] Enabling and starting dnsmasq..."
systemctl enable dnsmasq 2>/dev/null || true
systemctl restart dnsmasq
echo "[OK] dnsmasq running"

echo "[...] Enabling and starting Caddy..."
systemctl enable caddy 2>/dev/null || true
systemctl restart caddy
echo "[OK] Caddy running"

# Install the Caddy root CA into the system trust store so browsers and curl
# trust the internal TLS certs generated by `tls internal`.
echo "[...] Installing Caddy root CA to system trust store..."
if caddy trust 2>&1; then
  echo "[OK] Caddy root CA trusted"
else
  echo "[WARN] Failed to install Caddy CA — browsers will show cert warnings for *.${BASE_DOMAIN}"
fi

# ---------------------------------------------------------------------------
# 8. Verify DNS resolution
# ---------------------------------------------------------------------------

echo ""
echo "[...] Verifying DNS resolution..."
RESULT=$(dig +short "test.${BASE_DOMAIN}" "@${LISTEN_ADDR}" 2>/dev/null || echo "FAILED")

if [ "$RESULT" = "$LAN_IP" ]; then
  echo "[OK] DNS verification passed: test.${BASE_DOMAIN} -> ${LAN_IP}"
else
  echo "[WARN] DNS verification returned: ${RESULT} (expected ${LAN_IP})"
  echo "       dnsmasq may need a moment to start. Try: dig test.${BASE_DOMAIN} @${LISTEN_ADDR}"
fi

echo ""
echo "=== Setup Complete ==="
echo "  Caddy:   $(systemctl is-active caddy)"
echo "  dnsmasq: $(systemctl is-active dnsmasq)"
echo ""
echo "  Test: curl http://test.${BASE_DOMAIN}"
