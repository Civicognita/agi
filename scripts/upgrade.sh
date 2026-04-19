#!/usr/bin/env bash
set -uo pipefail
# NOTE: no `set -e` — we handle errors explicitly per step so upgrade.sh
# always emits a structured error before exiting, making failures visible
# in the dashboard upgrade log.

DEPLOY_DIR="${AIONIMA_DEPLOY_DIR:-/opt/agi}"
PRIME_DIR="${AIONIMA_PRIME_DIR:-/opt/agi-prime}"
PRIME_REPO="${AIONIMA_PRIME_REPO:-https://github.com/Civicognita/aionima.git}"
# Marketplace repos are NOT pulled locally — plugins are fetched from GitHub
# on demand by the gateway's plugin marketplace manager.
ID_DIR="${AIONIMA_ID_DIR:-/opt/agi-local-id}"
ID_REPO="${AIONIMA_ID_REPO:-https://github.com/Civicognita/aionima-local-id.git}"
SERVICE_USER="${AIONIMA_USER:-$(stat -c '%U' "$DEPLOY_DIR" 2>/dev/null || echo wishborn)}"

# Release channel — controls which branch all repos pull from.
# Priority: env var > config file > "main"
BRANCH="${AIONIMA_UPDATE_CHANNEL:-$(node -e "
  try {
    const c = JSON.parse(require('fs').readFileSync(
      require('path').join(require('os').homedir(), '.agi/gateway.json'), 'utf-8'));
    console.log((c.gateway && c.gateway.updateChannel) || 'main');
  } catch { console.log('main'); }
" 2>/dev/null || echo "main")}"

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

# ---------------------------------------------------------------------------
# 0. Platform rename migration (aionima → agi)
# ---------------------------------------------------------------------------
# One-time migration: move /opt/aionima* to /opt/agi*, rename containers,
# migrate systemd services, update config paths.

if [ -d "/opt/aionima" ] && [ ! -d "/opt/agi" ]; then
  emit "migrate" "start" "Platform rename: aionima → agi"

  # Move production directories
  for pair in "aionima:agi" "aionima-prime:agi-prime" "aionima-local-id:agi-local-id" "aionima-marketplace:agi-marketplace" "aionima-mapp-marketplace:agi-mapp-marketplace"; do
    old="/opt/${pair%%:*}"
    new="/opt/${pair##*:}"
    if [ -d "$old" ] && [ ! -d "$new" ] && [ ! -L "$old" ]; then
      sudo mv "$old" "$new"
      sudo ln -sf "$new" "$old"
      emit "migrate" "start" "Moved $old → $new (symlink created)"
    fi
  done

  # Rename containers from aionima-* to agi-*
  podman ps -a --format '{{.Names}}' 2>/dev/null | grep '^aionima-' | while IFS= read -r name; do
    new_name="agi-${name#aionima-}"
    podman rename "$name" "$new_name" 2>/dev/null && \
      emit "migrate" "start" "Renamed container: $name → $new_name" || true
  done

  # Rename legacy agi-id-postgres to agi-postgres-17 (shared, not ID-specific)
  if podman container exists agi-id-postgres 2>/dev/null; then
    podman rename agi-id-postgres agi-postgres-17 2>/dev/null && \
      emit "migrate" "start" "Renamed container: agi-id-postgres → agi-postgres-17" || true
  fi

  # Database rename: aionima_id → agi
  if podman exec agi-postgres-17 psql -U postgres -lqt 2>/dev/null | grep -q aionima_id; then
    emit "migrate" "start" "Migrating database: aionima_id → agi"
    podman exec agi-postgres-17 psql -U postgres -c "CREATE USER agi WITH PASSWORD 'aionima';" 2>/dev/null || true
    podman exec agi-postgres-17 psql -U postgres -c "CREATE DATABASE agi OWNER agi;" 2>/dev/null || true
    podman exec agi-postgres-17 bash -c "pg_dump -U aionima_id aionima_id | psql -U agi -d agi" 2>/dev/null || true
    # Update Local-ID env
    if [ -f /opt/agi-local-id/.env ]; then
      sudo sed -i 's|aionima_id[^@]*@|agi:aionima@|g; s|/aionima_id|/agi|g' /opt/agi-local-id/.env
    fi
    emit "migrate" "done" "Database migrated: aionima_id → agi"
  fi

  # Clean up orphaned volumes from the old naming convention
  podman volume rm aionima-id-pgdata 2>/dev/null && \
    emit "migrate" "start" "Removed orphaned volume: aionima-id-pgdata" || true

  # Migrate systemd services
  if [ -f /etc/systemd/system/aionima.service ]; then
    sudo systemctl stop aionima 2>/dev/null || true
    sudo systemctl disable aionima 2>/dev/null || true
    sudo rm -f /etc/systemd/system/aionima.service
  fi
  if [ -f /etc/systemd/system/aionima-local-id.service ]; then
    sudo systemctl stop aionima-local-id 2>/dev/null || true
    sudo systemctl disable aionima-local-id 2>/dev/null || true
    sudo rm -f /etc/systemd/system/aionima-local-id.service
  fi
  if [ -f /etc/systemd/system/aionima-id.service ]; then
    sudo systemctl stop aionima-id 2>/dev/null || true
    sudo systemctl disable aionima-id 2>/dev/null || true
    sudo rm -f /etc/systemd/system/aionima-id.service
  fi
  sudo systemctl daemon-reload

  # Update config file paths
  if [ -f ~/.agi/gateway.json ]; then
    sed -i 's|/opt/aionima-|/opt/agi-|g; s|"/opt/aionima"|"/opt/agi"|g' ~/.agi/gateway.json
    emit "migrate" "start" "Updated gateway.json paths"
  fi

  emit "migrate" "done" "Platform rename complete"
fi

# Update DEPLOY_DIR after potential migration
DEPLOY_DIR="${AIONIMA_DEPLOY_DIR:-/opt/agi}"

cd "$DEPLOY_DIR"

# ---------------------------------------------------------------------------
# 1a. Abort if production tree is dirty (nothing should be modified here)
# ---------------------------------------------------------------------------
if [ -n "$(git diff --name-only 2>/dev/null)" ]; then
  DIRTY_FILES="$(git diff --name-only | tr '\n' ', ')"
  emit "preflight" "error" "Production tree is dirty: ${DIRTY_FILES}— stashing"
  git stash --quiet
fi

# ---------------------------------------------------------------------------
# 1b. Ensure all repos use HTTPS remotes (public repos don't need SSH keys)
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
ensure_https_remote "$ID_DIR"

# ---------------------------------------------------------------------------
# Snapshot versions BEFORE pull (must happen before git checkout changes package.json)
# ---------------------------------------------------------------------------
version_before="$(cd "$DEPLOY_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"

# ---------------------------------------------------------------------------
# 1. Pull AGI repo
# ---------------------------------------------------------------------------
emit "pull-agi" "start" "channel: $BRANCH"
# fetch + checkout -B handles both fast-forwards and branch switches safely
if git fetch origin 2>&1 && git checkout -B "$BRANCH" "origin/$BRANCH" 2>&1; then
  emit "pull-agi" "done" "AGI repo updated ($BRANCH)"
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
  if (cd "$PRIME_DIR" && git fetch origin 2>&1 && git checkout -B "$BRANCH" "origin/$BRANCH" 2>&1); then
    emit "pull-prime" "done" "PRIME repo updated ($BRANCH)"
  else
    emit "pull-prime" "error" "PRIME pull failed"
    # Non-fatal — continue in degraded mode
  fi
else
  emit "clone-prime" "start" "PRIME not found at $PRIME_DIR — cloning"
  if sudo git clone --branch "$BRANCH" "$PRIME_REPO" "$PRIME_DIR" 2>&1 && sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$PRIME_DIR"; then
    emit "clone-prime" "done" "PRIME repo cloned to $PRIME_DIR ($BRANCH)"
  else
    sudo rm -rf "$PRIME_DIR"
    emit "clone-prime" "error" "PRIME clone failed from $PRIME_REPO"
    # Non-fatal — continue in degraded mode
  fi
fi

# Marketplace plugins are managed by the gateway — fetched from GitHub on demand.
# No local plugin marketplace repo needed.

# ---------------------------------------------------------------------------
# 3c. Pull ID service repo (auto-clone if missing)
# ---------------------------------------------------------------------------
id_version_before="$(cd "$ID_DIR" 2>/dev/null && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
if [ -d "$ID_DIR/.git" ]; then
  emit "pull-id" "start"
  if (cd "$ID_DIR" && git fetch origin 2>&1 && git checkout -B "$BRANCH" "origin/$BRANCH" 2>&1); then
    emit "pull-id" "done" "ID service repo updated ($BRANCH)"
  else
    emit "pull-id" "error" "ID pull failed"
    # Non-fatal — continue in degraded mode
  fi
else
  emit "clone-id" "start" "ID service not found at $ID_DIR — cloning"
  if sudo git clone --branch "$BRANCH" "$ID_REPO" "$ID_DIR" 2>&1 && sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$ID_DIR"; then
    emit "clone-id" "done" "ID service repo cloned to $ID_DIR ($BRANCH)"
  else
    emit "clone-id" "error" "ID clone failed from $ID_REPO"
    # Non-fatal — continue in degraded mode
  fi
fi

# MApps are fetched from GitHub on demand via the dashboard.

# ---------------------------------------------------------------------------
# 3d. Build local ID service (if enabled in config)
# ---------------------------------------------------------------------------
# Check if local ID service is enabled by reading the AGI config.
# The config lives at ~/.agi/gateway.json and we check idService.local.enabled.
ID_LOCAL_ENABLED=$(node -e "
  try {
    const c = JSON.parse(require('fs').readFileSync(
      require('path').join(require('os').homedir(), '.agi/gateway.json'), 'utf-8'));
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

      # Restart ID service only if version changed
      id_version_after="$(cd "$ID_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
      if [ "$id_version_before" != "$id_version_after" ]; then
        if systemctl is-active --quiet agi-id 2>/dev/null; then
          emit "restart-id" "start" "ID version changed: $id_version_before → $id_version_after"
          sudo systemctl restart agi-id
          emit "restart-id" "done" "Local ID service restarted"
        fi
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
# 5. Install dependencies (only when lockfile changes)
# ---------------------------------------------------------------------------
NODE_VERSION_FILE="$DEPLOY_DIR/.node-version-hash"
LOCKFILE_HASH_FILE="$DEPLOY_DIR/.lockfile-hash"
CURRENT_NODE_VERSION="$(node -v)"
PREVIOUS_NODE_VERSION=""
[ -f "$NODE_VERSION_FILE" ] && PREVIOUS_NODE_VERSION="$(cat "$NODE_VERSION_FILE")"

CURRENT_LOCKFILE_HASH="$(md5sum "$DEPLOY_DIR/pnpm-lock.yaml" 2>/dev/null | cut -d' ' -f1)"
PREVIOUS_LOCKFILE_HASH=""
[ -f "$LOCKFILE_HASH_FILE" ] && PREVIOUS_LOCKFILE_HASH="$(cat "$LOCKFILE_HASH_FILE")"

if [ "$CURRENT_LOCKFILE_HASH" != "$PREVIOUS_LOCKFILE_HASH" ]; then
  emit "install" "start" "Lockfile changed — installing dependencies"
  if NO_COLOR=1 FORCE_COLOR=0 pnpm install --frozen-lockfile 2>&1 | sed 's/\x1b\[[0-9;]*m//g'; then
    emit "install" "done" "Dependencies installed"
  else
    die "install" "pnpm install failed"
  fi
  echo "$CURRENT_LOCKFILE_HASH" > "$LOCKFILE_HASH_FILE"
else
  emit "install" "skip" "Dependencies up to date (lockfile unchanged)"
fi

# Ensure Playwright browser is installed (required for visual-inspect tool)
npx playwright install chromium --with-deps 2>/dev/null || true

# Only rebuild native modules when the Node.js version changes. Rebuilding
# better-sqlite3 on every upgrade adds 10-20s for no reason when the Node
# binary hasn't changed. The version hash file tracks the last-rebuilt version.
SYSTEM_NODE="/usr/bin/node"
if [ "$CURRENT_NODE_VERSION" != "$PREVIOUS_NODE_VERSION" ]; then
  emit "rebuild" "start" "Node.js version changed ($PREVIOUS_NODE_VERSION → $CURRENT_NODE_VERSION) — rebuilding native modules"
  if PATH="/usr/bin:$PATH" NO_COLOR=1 pnpm rebuild 2>&1 | sed 's/\x1b\[[0-9;]*m//g'; then
    emit "rebuild" "done" "Native modules rebuilt for $CURRENT_NODE_VERSION"
  else
    emit "rebuild" "error" "pnpm rebuild failed"
  fi
else
  emit "rebuild" "skip" "Native modules up to date (Node $CURRENT_NODE_VERSION unchanged)"
fi
echo "$CURRENT_NODE_VERSION" > "$NODE_VERSION_FILE"

# ---------------------------------------------------------------------------
# 7. Build (only when source files changed since last build)
# ---------------------------------------------------------------------------
SOURCE_HASH_FILE="$DEPLOY_DIR/.source-hash"
# Hash all TypeScript/config source that feeds the build. Excludes node_modules,
# dist, .git, and test files so test-only changes don't trigger a rebuild.
CURRENT_SOURCE_HASH="$(find "$DEPLOY_DIR/packages" "$DEPLOY_DIR/cli" "$DEPLOY_DIR/ui" "$DEPLOY_DIR/config" \
  -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.json' \) \
  ! -path '*/node_modules/*' ! -path '*/dist/*' ! -path '*/.git/*' ! -path '*.test.*' \
  -exec md5sum {} + 2>/dev/null | sort | md5sum | cut -d' ' -f1)"
PREVIOUS_SOURCE_HASH=""
[ -f "$SOURCE_HASH_FILE" ] && PREVIOUS_SOURCE_HASH="$(cat "$SOURCE_HASH_FILE")"

if [ "$CURRENT_SOURCE_HASH" != "$PREVIOUS_SOURCE_HASH" ]; then
  emit "build" "start" "Source changed — building"
  if NO_COLOR=1 FORCE_COLOR=0 pnpm build 2>&1 | sed 's/\x1b\[[0-9;]*m//g'; then
    emit "build" "done" "Build complete"
  else
    die "build" "pnpm build failed"
  fi
  echo "$CURRENT_SOURCE_HASH" > "$SOURCE_HASH_FILE"
else
  emit "build" "skip" "Build up to date (source unchanged)"
fi

# Build HF model runtime container images (if containers/ dir exists)
MODEL_CONTAINERS_SCRIPT="$DEPLOY_DIR/scripts/build-model-containers.sh"
if [ -x "$MODEL_CONTAINERS_SCRIPT" ]; then
  emit "build" "start" "Building model runtime containers..."
  bash "$MODEL_CONTAINERS_SCRIPT" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' || true
  emit "build" "done" "Model containers ready"
fi

# Plugin builds happen in ~/.agi/plugins/cache/ at install time.
# Required plugins are verified by the gateway on boot via the plugin marketplace catalog.

# Plugin and MApp updates are handled by the gateway via GitHub — not during upgrade.
# The gateway syncs catalogs and updates on boot and via dashboard API calls.

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

# Clean up stale SQLite model index (superseded by PostgreSQL-backed ModelStore)
rm -f ~/.agi/models/index.db ~/.agi/models/index.db-shm ~/.agi/models/index.db-wal

# ---------------------------------------------------------------------------
# 8. Ensure data/logs dirs exist
# ---------------------------------------------------------------------------
mkdir -p "$DEPLOY_DIR/data"
mkdir -p "$DEPLOY_DIR/logs"

# ---------------------------------------------------------------------------
# 9. Install systemd unit (if changed) — preserve TPM2 credential lines
# ---------------------------------------------------------------------------
RENDERED_SERVICE="$(sed "s/%AIONIMA_USER%/$SERVICE_USER/g" "$DEPLOY_DIR/scripts/agi.service")"

# Preserve existing LoadCredentialEncrypted lines from the live service unit.
# SecretsManager inserts these between the BEGIN/END markers; deploy must not
# wipe them or the API keys won't be available after restart.
LIVE_UNIT="/etc/systemd/system/agi.service"
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
sudo systemctl enable agi &>/dev/null

# Ensure Caddy CA cert is trusted by Node.js for internal HTTPS calls
for unit in /etc/systemd/system/agi.service /etc/systemd/system/agi-id.service; do
  if [ -f "$unit" ] && ! grep -q NODE_EXTRA_CA_CERTS "$unit"; then
    sudo sed -i '/\[Service\]/a Environment=NODE_EXTRA_CA_CERTS=/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt' "$unit"
    emit "systemd" "start" "Added Caddy CA trust to $(basename "$unit")"
  fi
done
sudo systemctl daemon-reload

# ---------------------------------------------------------------------------
# 9b. Install agi CLI (idempotent symlink)
# ---------------------------------------------------------------------------
AGI_CLI="$DEPLOY_DIR/scripts/agi-cli.sh"
if [ -x "$AGI_CLI" ]; then
  sudo ln -sf "$AGI_CLI" /usr/local/bin/agi 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# 11. Record deployed commit
# ---------------------------------------------------------------------------
git rev-parse HEAD > "$DEPLOY_DIR/.deployed-commit"

# ---------------------------------------------------------------------------
# 12. Restart if version changed
# ---------------------------------------------------------------------------
version_after="$(cd "$DEPLOY_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"

if [ "$version_before" != "$version_after" ]; then
  emit "restart" "start" "Version changed: $version_before → $version_after"
  # Sentinel file tells the new server it booted after an upgrade.
  # The new server removes it on startup and appends "restart complete" to the upgrade log.
  touch "$DEPLOY_DIR/.upgrade-pending"
  sudo systemctl restart agi
  # upgrade.sh typically dies here (SIGPIPE when parent Node process exits).
  # If it survives (e.g. stdout redirected), clean up:
  rm -f "$DEPLOY_DIR/.upgrade-pending"
  emit "restart" "done"
  emit "complete" "done" "Deploy complete — service restarted (v$version_after)"
else
  emit "complete" "done" "Deploy complete — no version change (v$version_after)"
fi
