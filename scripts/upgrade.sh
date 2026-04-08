#!/usr/bin/env bash
set -uo pipefail
# NOTE: no `set -e` — we handle errors explicitly per step so upgrade.sh
# always emits a structured error before exiting, making failures visible
# in the dashboard upgrade log.

DEPLOY_DIR="/opt/aionima"
PRIME_DIR="${AIONIMA_PRIME_DIR:-/opt/aionima-prime}"
PRIME_REPO="${AIONIMA_PRIME_REPO:-https://github.com/Civicognita/aionima.git}"
MARKETPLACE_DIR="${AIONIMA_MARKETPLACE_DIR:-/opt/aionima-marketplace}"
MARKETPLACE_REPO="${AIONIMA_MARKETPLACE_REPO:-https://github.com/Civicognita/aionima-marketplace.git}"
MAPP_MARKETPLACE_DIR="${AIONIMA_MAPP_MARKETPLACE_DIR:-/opt/aionima-mapp-marketplace}"
MAPP_MARKETPLACE_REPO="${AIONIMA_MAPP_MARKETPLACE_REPO:-https://github.com/Civicognita/aionima-mapp-marketplace.git}"
ID_DIR="${AIONIMA_ID_DIR:-/opt/aionima-local-id}"
ID_REPO="${AIONIMA_ID_REPO:-https://github.com/Civicognita/aionima-local-id.git}"
SERVICE_USER="${AIONIMA_USER:-$(stat -c '%U' "$DEPLOY_DIR" 2>/dev/null || echo wishborn)}"

# Backend dist dirs — changes here require a service restart.
# Channel adapters are marketplace plugins (not bundled in core).
BACKEND_DIRS=(
  "cli/dist"
  "packages/gateway-core/dist"
)

# Structured JSON log emitter
emit() {
  local phase="$1" status="$2" details="${3:-}"
  printf '{"phase":"%s","status":"%s","details":"%s"}\n' "$phase" "$status" "$details"
}

# Fatal error — emit and exit
die() {
  local phase="$1" details="${2:-}"
  emit "$phase" "error" "$details"
  exit 1
}

cd "$DEPLOY_DIR"

# ---------------------------------------------------------------------------
# 0. Abort if production tree is dirty (nothing should be modified here)
# ---------------------------------------------------------------------------
if [ -n "$(git diff --name-only 2>/dev/null)" ]; then
  DIRTY_FILES="$(git diff --name-only | tr '\n' ', ')"
  emit "preflight" "error" "Production tree is dirty: ${DIRTY_FILES}— stashing"
  git stash --quiet
fi

# ---------------------------------------------------------------------------
# 0b. Ensure all repos use HTTPS remotes (public repos don't need SSH keys)
# ---------------------------------------------------------------------------
ensure_https_remote() {
  local dir="$1"
  [ -d "$dir/.git" ] || return
  local url
  url="$(git -C "$dir" remote get-url origin 2>/dev/null)" || return
  case "$url" in
    git@github.com:*)
      local https_url="https://github.com/${url#git@github.com:}"
      git -C "$dir" remote set-url origin "$https_url" 2>/dev/null
      ;;
  esac
}

ensure_https_remote "$DEPLOY_DIR"
ensure_https_remote "$PRIME_DIR"
ensure_https_remote "$MARKETPLACE_DIR"
ensure_https_remote "$MAPP_MARKETPLACE_DIR"
ensure_https_remote "$ID_DIR"

# ---------------------------------------------------------------------------
# 1. Pull AGI repo
# ---------------------------------------------------------------------------
emit "pull-agi" "start"
if git pull --ff-only origin main 2>&1; then
  emit "pull-agi" "done" "AGI repo updated"
else
  emit "pull-agi" "error" "AGI pull failed"
  exit 1
fi

# Initialize/update git submodules (e.g. vendor libraries)
if [ -f "$DEPLOY_DIR/.gitmodules" ]; then
  emit "submodules" "start"
  if git submodule update --init --depth 1 2>&1; then
    emit "submodules" "done" "Submodules initialized"
  else
    die "submodules" "git submodule update failed"
  fi
fi

# ---------------------------------------------------------------------------
# 2. Pull PRIME repo (auto-clone if missing)
# ---------------------------------------------------------------------------
if [ -d "$PRIME_DIR/.git" ]; then
  emit "pull-prime" "start"
  if (cd "$PRIME_DIR" && git pull --ff-only origin main 2>&1); then
    emit "pull-prime" "done" "PRIME repo updated"
  else
    emit "pull-prime" "error" "PRIME pull failed"
    # Non-fatal — continue in degraded mode
  fi
else
  emit "clone-prime" "start" "PRIME not found at $PRIME_DIR — cloning"
  if sudo git clone --branch main "$PRIME_REPO" "$PRIME_DIR" 2>&1 && sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$PRIME_DIR"; then
    emit "clone-prime" "done" "PRIME repo cloned to $PRIME_DIR"
  else
    sudo rm -rf "$PRIME_DIR"
    emit "clone-prime" "error" "PRIME clone failed from $PRIME_REPO"
    # Non-fatal — continue in degraded mode
  fi
fi

# ---------------------------------------------------------------------------
# 3. Pull MARKETPLACE repo (auto-clone if missing)
# ---------------------------------------------------------------------------
if [ -d "$MARKETPLACE_DIR/.git" ]; then
  emit "pull-marketplace" "start"
  if (cd "$MARKETPLACE_DIR" && git pull --ff-only origin main 2>&1); then
    emit "pull-marketplace" "done" "Marketplace repo updated"
  else
    emit "pull-marketplace" "error" "Marketplace pull failed"
    # Non-fatal — plugins still work from cache
  fi
else
  emit "clone-marketplace" "start" "Marketplace not found at $MARKETPLACE_DIR — cloning"
  if sudo git clone --branch main "$MARKETPLACE_REPO" "$MARKETPLACE_DIR" 2>&1 && sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$MARKETPLACE_DIR"; then
    emit "clone-marketplace" "done" "Marketplace repo cloned to $MARKETPLACE_DIR"
  else
    sudo rm -rf "$MARKETPLACE_DIR"
    emit "clone-marketplace" "error" "Marketplace clone failed from $MARKETPLACE_REPO"
    # Non-fatal — plugins still work from cache
  fi
fi

# ---------------------------------------------------------------------------
# 3c. Pull ID service repo (auto-clone if missing)
# ---------------------------------------------------------------------------
if [ -d "$ID_DIR/.git" ]; then
  emit "pull-id" "start"
  if (cd "$ID_DIR" && git pull --ff-only origin main 2>&1); then
    emit "pull-id" "done" "ID service repo updated"
  else
    emit "pull-id" "error" "ID pull failed"
    # Non-fatal — continue in degraded mode
  fi
else
  emit "clone-id" "start" "ID service not found at $ID_DIR — cloning"
  if sudo git clone --branch main "$ID_REPO" "$ID_DIR" 2>&1 && sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$ID_DIR"; then
    emit "clone-id" "done" "ID service repo cloned to $ID_DIR"
  else
    emit "clone-id" "error" "ID clone failed from $ID_REPO"
    # Non-fatal — continue in degraded mode
  fi
fi

# ---------------------------------------------------------------------------
# 3d. Pull MApp marketplace repo (auto-clone if missing)
# ---------------------------------------------------------------------------
if [ -d "$MAPP_MARKETPLACE_DIR/.git" ]; then
  emit "pull-mapp-marketplace" "start"
  if (cd "$MAPP_MARKETPLACE_DIR" && git pull --ff-only origin main 2>&1); then
    emit "pull-mapp-marketplace" "done" "MApp marketplace repo updated"
  else
    emit "pull-mapp-marketplace" "error" "MApp marketplace pull failed"
    # Non-fatal — MApps still work from installed cache
  fi
else
  emit "clone-mapp-marketplace" "start" "MApp marketplace not found at $MAPP_MARKETPLACE_DIR — cloning"
  if sudo git clone --branch main "$MAPP_MARKETPLACE_REPO" "$MAPP_MARKETPLACE_DIR" 2>&1 && sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$MAPP_MARKETPLACE_DIR"; then
    emit "clone-mapp-marketplace" "done" "MApp marketplace repo cloned to $MAPP_MARKETPLACE_DIR"
  else
    emit "clone-mapp-marketplace" "error" "MApp marketplace clone failed from $MAPP_MARKETPLACE_REPO"
    # Non-fatal — MApps still work from installed cache
  fi
fi
# MApps are installed on demand from GitHub via the dashboard.

# ---------------------------------------------------------------------------
# 3d. Build local ID service (if enabled in config)
# ---------------------------------------------------------------------------
# Check if local ID service is enabled by reading the AGI config.
# The config lives at ~/.agi/aionima.json and we check idService.local.enabled.
ID_LOCAL_ENABLED=$(node -e "
  try {
    const c = JSON.parse(require('fs').readFileSync(
      require('path').join(require('os').homedir(), '.agi/aionima.json'), 'utf-8'));
    console.log(c.idService?.local?.enabled ? '1' : '0');
  } catch { console.log('0'); }
" 2>/dev/null || echo "0")

if [ "$ID_LOCAL_ENABLED" = "1" ] && [ -d "$ID_DIR" ]; then
  emit "build-id" "start"

  # Install dependencies
  if (cd "$ID_DIR" && npm install 2>&1); then
    # Build TypeScript
    if (cd "$ID_DIR" && npm run build 2>&1); then
      # Run migrations (requires .env to be sourced)
      if [ -f "$ID_DIR/.env" ]; then
        (cd "$ID_DIR" && set -a && source .env && set +a && npx drizzle-kit migrate 2>&1) || \
          emit "build-id" "warn" "ID migration failed (non-fatal)"
      fi
      emit "build-id" "done" "Local ID service built and migrated"

      # Restart ID service if running
      if systemctl is-active --quiet aionima-local-id 2>/dev/null; then
        emit "restart-id" "start"
        sudo systemctl restart aionima-local-id
        emit "restart-id" "done" "Local ID service restarted"
      fi
    else
      emit "build-id" "error" "ID service build failed"
    fi
  else
    emit "build-id" "error" "ID service npm install failed"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Protocol compatibility check
# ---------------------------------------------------------------------------
emit "protocol-check" "start"
COMPAT_OK=true
for repo_label_dir in "agi:$DEPLOY_DIR" "prime:$PRIME_DIR" "id:$ID_DIR"; do
  label="${repo_label_dir%%:*}"
  dir="${repo_label_dir#*:}"
  if [ ! -f "$dir/protocol.json" ]; then
    emit "protocol-check" "warn" "Missing protocol.json in $label ($dir)"
    COMPAT_OK=false
  fi
done
if [ "$COMPAT_OK" = true ]; then
  emit "protocol-check" "done" "All protocol.json files present"
else
  emit "protocol-check" "done" "Protocol check completed with warnings"
fi

# ---------------------------------------------------------------------------
# 5. Install dependencies (rebuild native modules if Node.js version changed)
# ---------------------------------------------------------------------------
NODE_VERSION_FILE="$DEPLOY_DIR/.node-version-hash"
CURRENT_NODE_VERSION="$(node -v)"
PREVIOUS_NODE_VERSION=""
[ -f "$NODE_VERSION_FILE" ] && PREVIOUS_NODE_VERSION="$(cat "$NODE_VERSION_FILE")"

emit "install" "start"
if NO_COLOR=1 FORCE_COLOR=0 pnpm install --frozen-lockfile 2>&1 | sed 's/\x1b\[[0-9;]*m//g'; then
  emit "install" "done" "Dependencies installed"
else
  die "install" "pnpm install failed"
fi

# Always rebuild native modules using the system Node (/usr/bin/node) —
# the same binary systemd uses. Shell shims (fnm, nvm) may point to a
# different version, causing NODE_MODULE_VERSION mismatches at runtime.
SYSTEM_NODE="/usr/bin/node"
emit "rebuild" "start" "Rebuilding native modules for $($SYSTEM_NODE -v)"
if PATH="/usr/bin:$PATH" NO_COLOR=1 pnpm rebuild 2>&1 | sed 's/\x1b\[[0-9;]*m//g'; then
  emit "rebuild" "done" "Native modules rebuilt"
else
  emit "rebuild" "error" "pnpm rebuild failed"
fi
echo "$CURRENT_NODE_VERSION" > "$NODE_VERSION_FILE"

# ---------------------------------------------------------------------------
# 6. Snapshot backend checksums before build
# ---------------------------------------------------------------------------
backend_hash_before=""
for dir in "${BACKEND_DIRS[@]}"; do
  if [ -d "$DEPLOY_DIR/$dir" ]; then
    backend_hash_before+="$(find "$DEPLOY_DIR/$dir" -type f -exec md5sum {} + 2>/dev/null | sort | md5sum)"
  fi
done
# ---------------------------------------------------------------------------
# 7. Build
# ---------------------------------------------------------------------------
emit "build" "start"
if NO_COLOR=1 FORCE_COLOR=0 pnpm build 2>&1 | sed 's/\x1b\[[0-9;]*m//g'; then
  emit "build" "done" "Build complete"
else
  die "build" "pnpm build failed"
fi

# Marketplace plugins are built at install time (not deploy time).
# The marketplace repo is a catalog source — plugins are pulled from it
# on demand and installed into ~/.agi/plugins/cache/.

# ---------------------------------------------------------------------------
# 7c. Reconcile required plugins against marketplace
# ---------------------------------------------------------------------------
REQUIRED_PLUGINS_FILE="$DEPLOY_DIR/config/required-plugins.json"
if [ -f "$REQUIRED_PLUGINS_FILE" ] && [ -d "$MARKETPLACE_DIR/plugins" ]; then
  emit "required-check" "start"
  MISSING=""
  for pid in $(node -e "
    const r = JSON.parse(require('fs').readFileSync('$REQUIRED_PLUGINS_FILE','utf-8'));
    r.plugins.forEach(p => console.log(p.id));
  " 2>/dev/null); do
    # Check if any plugin directory contains this ID in its package.json
    FOUND=false
    for pdir in "$MARKETPLACE_DIR"/plugins/plugin-*/; do
      if [ -f "$pdir/package.json" ]; then
        MANIFEST_ID=$(node -e "
          const p = JSON.parse(require('fs').readFileSync('${pdir}package.json','utf-8'));
          console.log((p.aionima||p.nexus||{}).id||'');
        " 2>/dev/null)
        if [ "$MANIFEST_ID" = "$pid" ]; then
          FOUND=true
          break
        fi
      fi
    done
    if [ "$FOUND" = false ]; then
      MISSING="$MISSING $pid"
    fi
  done
  if [ -n "$MISSING" ]; then
    emit "required-check" "error" "Missing required plugins:$MISSING"
  else
    emit "required-check" "done" "All required plugins present"
  fi
fi

# ---------------------------------------------------------------------------
# 7d. Update installed MApps to latest marketplace versions
# ---------------------------------------------------------------------------
emit "mapp-sync" "start"
GATEWAY_PORT=$(node -e "
  try {
    const c = JSON.parse(require('fs').readFileSync(require('os').homedir() + '/.agi/aionima.json', 'utf-8'));
    console.log((c.gateway && c.gateway.port) || 3100);
  } catch { console.log(3100); }
" 2>/dev/null)
SYNC_RESULT=$(curl -s -X POST "http://127.0.0.1:${GATEWAY_PORT}/api/mapp-marketplace/sync" \
  -H "Content-Type: application/json" 2>/dev/null || echo '{"ok":false,"error":"service not running"}')
SYNC_OK=$(echo "$SYNC_RESULT" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.ok?'true':'false')}catch{console.log('false')}" 2>/dev/null)
if [ "$SYNC_OK" = "true" ]; then
  SYNC_INSTALLED=$(echo "$SYNC_RESULT" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log((d.installed||[]).length + ' installed, ' + (d.updated||[]).length + ' updated')}catch{console.log('unknown')}" 2>/dev/null)
  emit "mapp-sync" "done" "$SYNC_INSTALLED"
else
  emit "mapp-sync" "skip" "MApp sync skipped (service not running or fetch failed)"
fi

# ---------------------------------------------------------------------------
# 7e. Migrate project configs to current schema
# ---------------------------------------------------------------------------
emit "migrate" "start"
MIGRATE_SCRIPT="$DEPLOY_DIR/scripts/migrate-project-configs.sh"
if [ -x "$MIGRATE_SCRIPT" ]; then
  bash "$MIGRATE_SCRIPT" 2>&1 | sed 's/\x1b\[[0-9;]*m//g'
  emit "migrate" "done" "Project configs migrated"
else
  emit "migrate" "done" "No migration script"
fi

# ---------------------------------------------------------------------------
# 8. Ensure data/logs dirs exist
# ---------------------------------------------------------------------------
mkdir -p "$DEPLOY_DIR/data"
mkdir -p "$DEPLOY_DIR/logs"

# ---------------------------------------------------------------------------
# 9. Install systemd unit (if changed) — preserve TPM2 credential lines
# ---------------------------------------------------------------------------
RENDERED_SERVICE="$(sed "s/%AIONIMA_USER%/$SERVICE_USER/g" "$DEPLOY_DIR/scripts/aionima.service")"

# Preserve existing LoadCredentialEncrypted lines from the live service unit.
# SecretsManager inserts these between the BEGIN/END markers; deploy must not
# wipe them or the API keys won't be available after restart.
LIVE_UNIT="/etc/systemd/system/aionima.service"
if [ -f "$LIVE_UNIT" ]; then
  LIVE_CREDS="$(sed -n '/^# --- BEGIN CREDENTIALS ---$/,/^# --- END CREDENTIALS ---$/{ //!p }' "$LIVE_UNIT")"
  if [ -n "$LIVE_CREDS" ]; then
    # Inject live credential lines into the rendered template
    RENDERED_SERVICE="$(echo "$RENDERED_SERVICE" | sed "/^# --- BEGIN CREDENTIALS ---$/a\\
$LIVE_CREDS")"
  fi
fi

if ! echo "$RENDERED_SERVICE" | diff - "$LIVE_UNIT" &>/dev/null; then
  emit "systemd" "start" "Updating systemd service"
  echo "$RENDERED_SERVICE" | sudo tee "$LIVE_UNIT" >/dev/null
  sudo systemctl daemon-reload
  emit "systemd" "done"
fi
sudo systemctl enable aionima &>/dev/null

# ---------------------------------------------------------------------------
# 9b. Install agi CLI (idempotent symlink)
# ---------------------------------------------------------------------------
AGI_CLI="$DEPLOY_DIR/scripts/agi-cli.sh"
if [ -x "$AGI_CLI" ]; then
  sudo ln -sf "$AGI_CLI" /usr/local/bin/agi 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# 10. Check if backend changed
# ---------------------------------------------------------------------------
backend_hash_after=""
for dir in "${BACKEND_DIRS[@]}"; do
  if [ -d "$DEPLOY_DIR/$dir" ]; then
    backend_hash_after+="$(find "$DEPLOY_DIR/$dir" -type f -exec md5sum {} + 2>/dev/null | sort | md5sum)"
  fi
done
# ---------------------------------------------------------------------------
# 11. Record deployed commit
# ---------------------------------------------------------------------------
git rev-parse HEAD > "$DEPLOY_DIR/.deployed-commit"

# ---------------------------------------------------------------------------
# 12. Restart if backend changed
# ---------------------------------------------------------------------------
if [ "$backend_hash_before" != "$backend_hash_after" ]; then
  emit "restart" "start" "Backend changed"
  # Sentinel file tells the new server it booted after an upgrade.
  # The new server removes it on startup and appends "restart complete" to the upgrade log.
  touch "$DEPLOY_DIR/.upgrade-pending"
  sudo systemctl restart aionima
  # upgrade.sh typically dies here (SIGPIPE when parent Node process exits).
  # If it survives (e.g. stdout redirected), clean up:
  rm -f "$DEPLOY_DIR/.upgrade-pending"
  emit "restart" "done"
  emit "complete" "done" "Deploy complete — service restarted"
else
  emit "complete" "done" "Deploy complete — frontend only (no restart)"
fi
