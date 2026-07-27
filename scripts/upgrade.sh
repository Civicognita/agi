#!/usr/bin/env bash
set -uo pipefail
# NOTE: no `set -e` — we handle errors explicitly per step so upgrade.sh
# always emits a structured error before exiting, making failures visible
# in the dashboard upgrade log.

DEPLOY_DIR="${AIONIMA_DEPLOY_DIR:-/opt/agi}"
PRIME_DIR="${AIONIMA_PRIME_DIR:-/opt/agi-prime}"
SERVICE_USER="${AIONIMA_USER:-$(stat -c '%U' "$DEPLOY_DIR" 2>/dev/null || echo wishborn)}"

# Dev Mode resolution. When `dev.enabled` is true in ~/.agi/gateway.json,
# upgrade pulls AGI from the owner's fork instead of Civicognita. Same
# priority order as the gateway's marketplace manager (tynn #249):
# env override → dev.agiRepo fork → canonical Civicognita.
#
# PRIME is deliberately NOT part of this resolution (owner directive
# 2026-07-19) — the corpus isn't something individual owners fork and PR
# into like a code repo, so PRIME_REPO always resolves to the canonical
# Civicognita/aionima.git below, dev-mode-enabled or not.
_DEV_CFG="$(node -e "
  try {
    const c = JSON.parse(require('fs').readFileSync(
      require('path').join(require('os').homedir(), '.agi/gateway.json'), 'utf-8'));
    const dev = c.dev ?? {};
    console.log(JSON.stringify({
      enabled: dev.enabled === true,
      agi: dev.agiRepo ?? '',
    }));
  } catch { console.log('{\"enabled\":false,\"agi\":\"\"}'); }
" 2>/dev/null || echo '{"enabled":false,"agi":""}')"

_dev_enabled="$(echo "$_DEV_CFG" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).enabled))")"
_dev_agi="$(echo "$_DEV_CFG" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).agi))")"

# AGI self-repo: Dev Mode needs this too. Without it, /opt/agi's origin
# stays pinned to Civicognita, so owner commits pushed to wishborn/agi
# never reach the production gateway until they land upstream. This
# defeats the entire Dev Mode "work in fork → see it live" promise.
if [ "$_dev_enabled" = "true" ] && [ -n "$_dev_agi" ]; then
  AGI_REPO="${AIONIMA_AGI_REPO:-$_dev_agi}"
else
  AGI_REPO="${AIONIMA_AGI_REPO:-https://github.com/Civicognita/agi.git}"
fi
PRIME_REPO="${AIONIMA_PRIME_REPO:-https://github.com/Civicognita/aionima.git}"
# Marketplace repos are NOT pulled locally by this script — plugins are
# fetched from GitHub on demand by the gateway's plugin marketplace
# manager, which has its own Dev Mode fork handling.

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
  for pair in "aionima:agi" "aionima-prime:agi-prime" "aionima-marketplace:agi-marketplace" "aionima-mapp-marketplace:agi-mapp-marketplace"; do
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

# ---------------------------------------------------------------------------
# 0b. Plugin import namespace migration (@aionima/* → @agi/*)
# ---------------------------------------------------------------------------
# One-time migration: update any installed plugin source files that still
# import from the old @aionima/* namespace to the renamed @agi/* namespace.
PLUGIN_IMPORT_SENTINEL="$HOME/.agi/.plugin-import-migrated"
if [ ! -f "$PLUGIN_IMPORT_SENTINEL" ]; then
  emit "migrate" "start" "Migrating plugin imports to @agi/* namespace"
  _migrated=0
  for plugin_dir in ~/.agi/plugins/cache/*/src; do
    if [ -d "$plugin_dir" ]; then
      while IFS= read -r f; do
        sed -i 's/@aionima\/sdk/@agi\/sdk/g; s/@aionima\/plugins/@agi\/plugins/g; s/@aionima\/channel-sdk/@agi\/channel-sdk/g; s/@aionima\/config/@agi\/config/g; s/@aionima\/gateway-core/@agi\/gateway-core/g' "$f"
        _migrated=$((_migrated + 1))
      done < <(find "$plugin_dir" -name "*.ts" -exec grep -l "@aionima/" {} \; 2>/dev/null)
    fi
  done
  touch "$PLUGIN_IMPORT_SENTINEL"
  emit "migrate" "done" "Plugin imports migrated ($_migrated files updated)"
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

# Repoint `origin` to the right upstream when Dev Mode toggles. Idempotent:
# if the existing origin matches, this is a no-op. If it doesn't (Dev Mode
# just flipped, or the env override changed), we rewrite it so the next
# `git fetch origin` pulls from the intended source. Mirrors what
# `/api/dev/switch` already does for the `_aionima/<slug>/` core-fork
# workspace clones — the same treatment was missing here for /opt/agi.
ensure_origin_remote() {
  local dir="$1" expected="$2" label="$3"
  # Phase H.3 — always emit a verify line after the check, whether the
  # rewrite was needed or not. Dashboard upgrade log shows the final
  # origin alignment so owners can see at a glance that Dev Mode is
  # wired correctly end-to-end.
  if [ ! -d "$dir/.git" ]; then
    emit "$label" "skip" "dir missing: $dir"
    return
  fi
  if [ -z "$expected" ]; then
    emit "$label" "skip" "no expected URL configured"
    return
  fi
  local current
  current="$(git -C "$dir" remote get-url origin 2>/dev/null)" || {
    emit "$label" "error" "could not read origin URL for $dir"
    return
  }
  if [ "$current" = "$expected" ]; then
    emit "$label" "verify" "origin aligned: $expected"
    return
  fi
  if git -C "$dir" remote set-url origin "$expected" 2>/dev/null; then
    emit "$label" "info" "origin repointed: $current -> $expected"
    emit "$label" "verify" "origin aligned: $expected"
  else
    emit "$label" "error" "failed to rewrite origin (still: $current)"
  fi
}
ensure_origin_remote "$DEPLOY_DIR" "$AGI_REPO"   "origin-agi"
ensure_origin_remote "$PRIME_DIR"  "$PRIME_REPO" "origin-prime"

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

# MApps are fetched from GitHub on demand via the dashboard.
# (Local-ID absorbed into AGI core via s180 — no separate ID clone/build step.)

# ---------------------------------------------------------------------------
# 4. Protocol compatibility check
# ---------------------------------------------------------------------------
emit "protocol-check" "start"
COMPAT_OK=true
for repo_label_dir in "agi:$DEPLOY_DIR" "prime:$PRIME_DIR"; do
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

# 7b. Rebuild channel plugins whose source changed since last dist build.
# Each channel package with a "build" script in package.json is rebuilt
# when its src/ hash has changed. Dist files are gitignored and must be
# rebuilt after any source-level additions or dynamic→static import changes.
# ---------------------------------------------------------------------------
CHANNEL_DIR="$DEPLOY_DIR/channels"
if [ -d "$CHANNEL_DIR" ]; then
  for ch_dir in "$CHANNEL_DIR"/*/; do
    ch_name="$(basename "$ch_dir")"
    ch_pkg="$ch_dir/package.json"
    # Only rebuild if package.json has a "build" script
    if [ -f "$ch_pkg" ] && grep -q '"build"' "$ch_pkg"; then
      ch_hash_file="$ch_dir/.src-hash"
      ch_src_hash="$(find "$ch_dir/src" -type f -name '*.ts' ! -name '*.test.ts' \
        -exec md5sum {} + 2>/dev/null | sort | md5sum | cut -d' ' -f1)"
      ch_prev_hash=""
      [ -f "$ch_hash_file" ] && ch_prev_hash="$(cat "$ch_hash_file")"
      if [ "$ch_src_hash" != "$ch_prev_hash" ] || [ ! -f "$ch_dir/dist/index.js" ]; then
        emit "build-channel-${ch_name}" "start" "Building channel plugin: $ch_name"
        if (cd "$ch_dir" && PATH="$DEPLOY_DIR/node_modules/.bin:$PATH" NO_COLOR=1 pnpm build 2>&1 | sed 's/\x1b\[[0-9;]*m//g'); then
          echo "$ch_src_hash" > "$ch_hash_file"
          emit "build-channel-${ch_name}" "done" "Channel $ch_name built"
        else
          emit "build-channel-${ch_name}" "error" "Channel $ch_name build failed — skipping"
        fi
      else
        emit "build-channel-${ch_name}" "skip" "Channel $ch_name dist up to date"
      fi
    fi
  done
fi

# Apply DB schema changes via the targeted psql migration script.
# drizzle-kit push doesn't work (CJS/NodeNext mismatch in schema files);
# migrate-db.sh runs idempotent ALTER TABLE … IF NOT EXISTS statements
# instead. Additive only — destructive changes need explicit migration
# work that doesn't ship through this path.
DB_MIGRATE_SCRIPT="$DEPLOY_DIR/scripts/migrate-db.sh"
if [ -x "$DB_MIGRATE_SCRIPT" ]; then
  emit "db-push" "start" "Applying DB schema migrations"
  if bash "$DB_MIGRATE_SCRIPT" 2>&1 | sed 's/\x1b\[[0-9;]*m//g'; then
    emit "db-push" "done" "DB schema in sync"
  else
    emit "db-push" "warn" "DB migration script reported issues — see above"
  fi
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
# 7b. SDK version tracking — mark plugins for rebuild when SDK version changes
# ---------------------------------------------------------------------------
SDK_VERSION_FILE="$DEPLOY_DIR/.sdk-version"
CURRENT_SDK_VERSION="$(cd "$DEPLOY_DIR" && node -p "require('./packages/aion-sdk/package.json').version" 2>/dev/null || echo "0.0.0")"
PREVIOUS_SDK_VERSION=""
[ -f "$SDK_VERSION_FILE" ] && PREVIOUS_SDK_VERSION="$(cat "$SDK_VERSION_FILE")"

if [ "$CURRENT_SDK_VERSION" != "$PREVIOUS_SDK_VERSION" ]; then
  emit "plugins-rebuild" "start" "SDK version changed ($PREVIOUS_SDK_VERSION → $CURRENT_SDK_VERSION)"
  # Mark that plugins need rebuilding — the gateway will do it on next boot.
  # The sentinel is removed by the gateway after it completes the rebuild pass.
  echo "$CURRENT_SDK_VERSION" > "$SDK_VERSION_FILE"
  touch "$DEPLOY_DIR/.plugins-need-rebuild"
  emit "plugins-rebuild" "done" "Plugins marked for rebuild on next boot"
else
  emit "plugins-rebuild" "skip" "SDK version unchanged ($CURRENT_SDK_VERSION)"
fi

# ---------------------------------------------------------------------------
# 7d. PAx upstream sync — merge upstream changes into owner forks
#
# Each Particle-Academy package fork lives at $HOME/_projects/_aionima/repos/<slug>/.
# This step fetches upstream/main for every cloned PAx repo, attempts a
# fast-forward merge, and pushes to origin. Conflicts are noted as optional
# UpgradeNextSteps (never blocks restart). Uncloned repos are silently skipped.
# ---------------------------------------------------------------------------
PAX_BASE="$HOME/_projects/_aionima/repos"
PAX_SLUGS=(
  react-fancy fancy-code fancy-sheets fancy-echarts fancy-3d fancy-screens
  fancy-whiteboard agent-integrations fancy-artboard fancy-slides fancy-flow
)
PAX_ANY_SYNCED=0
emit "pax-sync" "start" "Syncing PAx forks from Particle-Academy upstream"
for pax_slug in "${PAX_SLUGS[@]}"; do
  pax_path="$PAX_BASE/$pax_slug"
  if [ ! -d "$pax_path/.git" ]; then
    emit "pax-sync" "skip" "$pax_slug not cloned — skipping"
    continue
  fi
  (
    cd "$pax_path" || exit 0
    # Ensure upstream remote points to Particle-Academy
    if ! git remote get-url upstream &>/dev/null; then
      git remote add upstream "https://github.com/Particle-Academy/$pax_slug.git" 2>/dev/null || true
    fi
    git fetch upstream main --quiet 2>&1 || { emit "pax-sync" "warn" "$pax_slug: fetch failed"; exit 0; }
    behind=$(git rev-list HEAD..upstream/main 2>/dev/null | wc -l | tr -d ' ')
    if [ "$behind" = "0" ]; then
      emit "pax-sync" "skip" "$pax_slug already up to date"
      exit 0
    fi
    current_branch=$(git branch --show-current 2>/dev/null || echo "dev")
    merge_output=$(git merge upstream/main --no-edit 2>&1)
    merge_exit=$?
    if [ "$merge_exit" -eq 0 ]; then
      git push origin "$current_branch" --quiet 2>/dev/null || true
      emit "pax-sync" "done" "$pax_slug: merged $behind commits from upstream, pushed to origin/$current_branch"
      PAX_ANY_SYNCED=$((PAX_ANY_SYNCED + 1))
    else
      git merge --abort 2>/dev/null || true
      # Stack an optional UpgradeNextStep so the owner knows about the conflict
      node -e "
        const { appendPendingStep } = require('$DEPLOY_DIR/packages/gateway-core/src/upgrade-next-steps.js');
        const version = require('$DEPLOY_DIR/package.json').version;
        appendPendingStep({
          id: 'pax-conflict-$pax_slug-' + version,
          title: 'Merge conflict in $pax_slug',
          description: 'upstream/main had conflicts with your local changes in $pax_path. Merge manually: cd $pax_path && git merge upstream/main',
          required: false,
          fromVersion: version,
          action: { label: 'Open terminal', kind: 'navigate', target: '/projects/_aionima' }
        });
      " 2>/dev/null || true
      emit "pax-sync" "warn" "$pax_slug: merge conflict — manual merge required (see post-upgrade steps)"
    fi
  )
done
emit "pax-sync" "done" "PAx sync complete"

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
for unit in /etc/systemd/system/agi.service; do
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

# Write deployed version so the gateway can detect a new boot and emit system:upgraded.
echo "$version_after" > "$HOME/.agi/deployed-version.txt"

# Restart decision compares the RUNNING PROCESS version (from /health) against the
# freshly-deployed source version — NOT source-before vs source-after. The old
# source-vs-source check missed the failure mode where a PRIOR pull already
# advanced the on-disk source but the process never actually bounced: every
# subsequent upgrade then saw "no version change" and skipped the restart, so a
# stale process served old code indefinitely (observed in the wild: a 0.4.937
# process ran for 9.5 days while the source + dist were 0.4.968). Comparing
# against the live process is self-correcting — if they ever drift, we bounce.
version_running="$(curl -s --max-time 3 http://localhost:3100/health 2>/dev/null | grep -oE '"version":"[^"]*"' | head -1 | sed 's/.*:"//;s/"$//')"

if [ "$version_running" != "$version_after" ]; then
  emit "restart" "start" "Running v${version_running:-unknown/down} != deployed v$version_after — restarting"
  # Sentinel file tells the new server it booted after an upgrade.
  # The new server removes it on startup and appends "restart complete" to the upgrade log.
  touch "$DEPLOY_DIR/.upgrade-pending"

  # Emit completion BEFORE dispatching the restart: the restart kills the gateway
  # that relays this stream, so anything emitted after won't reach the dashboard.
  emit "restart" "done" "Restart dispatched"
  emit "complete" "done" "Deploy complete — restarting to v$version_after"

  # CRITICAL (s221): when the dashboard triggers an upgrade, the gateway spawns
  # this script as a child — so it runs INSIDE the agi.service cgroup. A direct
  # `systemctl restart agi` makes systemd stop the service and kill the whole
  # cgroup, including THIS script and the `systemctl` client, mid-restart — so the
  # process never actually bounces (the stale-process bug: a 3-day-old process
  # kept serving pre-route code across upgrades). Dispatch the restart as a
  # DETACHED transient unit (systemd-run), which runs outside the agi cgroup and
  # survives the service stop. Fall back to a direct restart only where systemd-run
  # is unavailable (non-systemd hosts / test VM nohup gateway).
  if command -v systemd-run >/dev/null 2>&1; then
    sudo systemd-run --no-block --collect --unit="agi-restart-$$" systemctl restart agi
  else
    sudo systemctl restart agi
  fi
  # Do NOT remove .upgrade-pending here — the newly-booted server consumes it.
else
  emit "complete" "done" "Deploy complete — running process already on v$version_after"
fi
