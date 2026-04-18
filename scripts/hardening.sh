#!/usr/bin/env bash
# Aionima system hardening — idempotent, run as root.
set -euo pipefail

# ---------------------------------------------------------------------------
# 0. Pre-flight
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  echo "Error: hardening.sh must be run as root" >&2
  exit 1
fi

SERVICE_USER="${AIONIMA_USER:-$(stat -c '%U' /opt/agi 2>/dev/null || echo aionima)}"
DEPLOY_DIR="${AIONIMA_DEPLOY_DIR:-${AGI_DEPLOY_DIR:-/opt/agi}}"

echo "==> Aionima hardening (user=$SERVICE_USER, dir=$DEPLOY_DIR)"

# ---------------------------------------------------------------------------
# 1. Systemd hardening drop-in
# ---------------------------------------------------------------------------
DROPIN_DIR="/etc/systemd/system/agi.service.d"
DROPIN_FILE="$DROPIN_DIR/hardening.conf"

mkdir -p "$DROPIN_DIR"

cat > "$DROPIN_FILE" << EOF
[Service]
Restart=always
RestartSec=5
StartLimitIntervalSec=300
StartLimitBurst=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$DEPLOY_DIR/data $DEPLOY_DIR/logs /home/$SERVICE_USER/data/agi
PrivateTmp=yes
EOF

echo "  [OK] Systemd hardening drop-in: $DROPIN_FILE"
systemctl daemon-reload

# ---------------------------------------------------------------------------
# 2. AIDE exclusion (if AIDE is installed)
# ---------------------------------------------------------------------------
if command -v aide &>/dev/null; then
  AIDE_CONF_DIR="/etc/aide/aide.conf.d"
  AIDE_FILE="$AIDE_CONF_DIR/31_aide_aionima"

  if [ -d "$AIDE_CONF_DIR" ]; then
    echo "!$DEPLOY_DIR" > "$AIDE_FILE"
    echo "  [OK] AIDE exclusion: $AIDE_FILE"
  else
    echo "  [SKIP] AIDE conf.d directory not found"
  fi
else
  echo "  [SKIP] AIDE not installed"
fi

# ---------------------------------------------------------------------------
# 3. Log rotation
# ---------------------------------------------------------------------------
LOGROTATE_FILE="/etc/logrotate.d/aionima"

cat > "$LOGROTATE_FILE" << EOF
$DEPLOY_DIR/logs/*.log {
    weekly
    rotate 4
    compress
    delaycompress
    missingok
    notifempty
    create 0640 $SERVICE_USER $SERVICE_USER
    copytruncate
}
EOF

echo "  [OK] Log rotation: $LOGROTATE_FILE"

# ---------------------------------------------------------------------------
# 4. Auditd rules (if auditd is installed)
# ---------------------------------------------------------------------------
if command -v auditctl &>/dev/null; then
  AUDIT_FILE="/etc/audit/rules.d/aionima.rules"
  mkdir -p "$(dirname "$AUDIT_FILE")"

  cat > "$AUDIT_FILE" << EOF
# Aionima — watch config and secrets for writes
-w $DEPLOY_DIR/gateway.json -p wa -k agi-config
-w $DEPLOY_DIR/.env -p wa -k agi-secrets
EOF

  echo "  [OK] Auditd rules: $AUDIT_FILE"

  # Reload rules if auditd is running
  if systemctl is-active --quiet auditd; then
    augenrules --load 2>/dev/null || true
    echo "  [OK] Auditd rules reloaded"
  fi
else
  echo "  [SKIP] auditd not installed"
fi

# ---------------------------------------------------------------------------
# 5. UFW rule (if UFW is active)
# ---------------------------------------------------------------------------
if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
  # Add rule idempotently — ufw skips duplicates
  ufw allow from 192.168.0.0/24 to any port 3100 proto tcp comment "Aionima gateway" 2>/dev/null || true
  echo "  [OK] UFW rule: allow 192.168.0.0/24 → tcp/3100"
else
  echo "  [SKIP] UFW not active"
fi

# ---------------------------------------------------------------------------
# 6. Ensure runtime directories exist with correct ownership
# ---------------------------------------------------------------------------
mkdir -p "$DEPLOY_DIR/data" "$DEPLOY_DIR/logs"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DEPLOY_DIR/data" "$DEPLOY_DIR/logs"
mkdir -p "/home/$SERVICE_USER/data/agi"
chown "$SERVICE_USER:$SERVICE_USER" "/home/$SERVICE_USER/data/agi"

echo "  [OK] Runtime directories verified"

echo ""
echo "==> Hardening complete."
