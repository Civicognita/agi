#!/usr/bin/env bash
# migrate-aionima-volumes.sh — rename Podman volumes for shared DB
# containers from `aionima-*-data` to `agi-*-data` without data loss.
#
# Unblocks task #292 (runtime resource rename) by clearing the
# data-critical bit. The container-internal root credentials
# (POSTGRES_PASSWORD / MARIADB_ROOT_PASSWORD) are NOT user-facing; they
# stay at `aionima-root` as legacy internal secrets. Per-project user
# credentials (created via the plugins' setupScript) are not touched.
#
# Affected plugins (agi-marketplace/plugins):
#   plugin-postgres — volumes: aionima-postgres-{17,16,15}-data
#   plugin-mysql    — volumes: aionima-mariadb-{11.4,10.11,10.6}-data
#   plugin-redis    — volumes: aionima-redis-{7.4,7.2,6.2}-data
#
# Strategy (two-phase, rollback-capable):
#   Phase A (--migrate):
#     For each aionima-*-data volume:
#       1. Identify any container using it; stop it.
#       2. Create agi-*-data volume.
#       3. rsync -aHAX from old → new via a helper Podman pod mount.
#       4. Update the plugin manifest reference is code-side (#292)
#          and shipped via upgrade.sh's plugin re-sync.
#       5. Restart the container (podman does this on plugin reload).
#   Phase B (--purge-old):
#     Only after the owner has verified services work on the new
#     volumes (at minimum one full day of normal usage), remove the
#     old aionima-*-data volumes. Irreversible.
#
# Usage:
#   ./migrate-aionima-volumes.sh --dry-run       # list planned work
#   ./migrate-aionima-volumes.sh --migrate       # do the rsync + swap
#   ./migrate-aionima-volumes.sh --rollback      # remove the new agi-*
#                                                # volumes (keep old)
#   ./migrate-aionima-volumes.sh --purge-old     # remove old aionima-*
#                                                # volumes (after verify)
#
# Exit codes: 0 success, 1 usage, 2 no podman, 3 migration failure,
# 4 rollback requested but agi-* volume in use.

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
OLD_PREFIX="aionima-"
NEW_PREFIX="agi-"
VOLUME_SUFFIX="-data"

# Expected suffixes (without prefix). Matches plugin VERSIONS at time of
# writing. Discovery falls back to `podman volume ls` so new versions
# added after this script lands still get picked up.
EXPECTED_SUFFIXES=(
  "postgres-17" "postgres-16" "postgres-15"
  "mariadb-11.4" "mariadb-10.11" "mariadb-10.6"
  "redis-7.4" "redis-7.2" "redis-6.2"
)

# Helper image for the rsync pod — any small image with rsync available.
# Falls back to alpine which is ~7MB and has apk-installable rsync.
RSYNC_IMAGE="${RSYNC_IMAGE:-docker.io/library/alpine:3.20}"

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
if ! command -v podman >/dev/null 2>&1; then
  echo "[migrate] podman not installed — nothing to migrate" >&2
  exit 2
fi

MODE="${1:-}"
case "$MODE" in
  --dry-run|--migrate|--rollback|--purge-old) ;;
  *)
    echo "Usage: $0 --dry-run | --migrate | --rollback | --purge-old" >&2
    exit 1
    ;;
esac

echo "[migrate] mode: $MODE"

# ---------------------------------------------------------------------------
# Discover aionima-*-data volumes present on this host
# ---------------------------------------------------------------------------
discover_old_volumes() {
  podman volume ls --format '{{.Name}}' 2>/dev/null \
    | grep -E "^${OLD_PREFIX}.*${VOLUME_SUFFIX}$" \
    || true
}

discover_new_volumes() {
  podman volume ls --format '{{.Name}}' 2>/dev/null \
    | grep -E "^${NEW_PREFIX}.*${VOLUME_SUFFIX}$" \
    || true
}

containers_using_volume() {
  local vol="$1"
  podman ps -a --filter "volume=${vol}" --format '{{.Names}}' 2>/dev/null || true
}

volume_old_to_new() {
  local old="$1"
  local suffix="${old#$OLD_PREFIX}"
  echo "${NEW_PREFIX}${suffix}"
}

# ---------------------------------------------------------------------------
# Core rsync step
# ---------------------------------------------------------------------------
rsync_volumes() {
  local src="$1"
  local dst="$2"
  local tmp_container="migrate-rsync-$$"

  echo "[migrate]   copy: ${src} → ${dst}"
  # Run rsync inside a short-lived container with both volumes mounted.
  # Alpine needs apk add rsync — cheaper than maintaining a custom image.
  podman run --rm --name "$tmp_container" \
    -v "${src}:/src:ro" \
    -v "${dst}:/dst" \
    "$RSYNC_IMAGE" \
    sh -c "apk add --no-cache rsync >/dev/null 2>&1 && rsync -aHAX /src/ /dst/" \
    || return 3
}

# ---------------------------------------------------------------------------
# Phase A — migrate
# ---------------------------------------------------------------------------
cmd_migrate() {
  local old_vols
  old_vols="$(discover_old_volumes)"

  if [ -z "$old_vols" ]; then
    echo "[migrate] no ${OLD_PREFIX}*${VOLUME_SUFFIX} volumes found — nothing to do"
    return 0
  fi

  local total=0 failed=0
  while IFS= read -r old; do
    [ -z "$old" ] && continue
    total=$((total+1))
    local new; new="$(volume_old_to_new "$old")"

    # If new volume already exists, skip — this is idempotency.
    if podman volume inspect "$new" >/dev/null 2>&1; then
      echo "[migrate] skip: $new already exists (idempotent re-run)"
      continue
    fi

    # Stop any container using the old volume so rsync sees a stable state.
    local users; users="$(containers_using_volume "$old")"
    local to_restart=""
    if [ -n "$users" ]; then
      for c in $users; do
        if [ "$(podman inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
          echo "[migrate]   stop container using $old: $c"
          podman stop "$c" >/dev/null 2>&1 || true
          to_restart="$to_restart $c"
        fi
      done
    fi

    # Create destination volume.
    podman volume create "$new" >/dev/null || { failed=$((failed+1)); continue; }

    # Rsync.
    if ! rsync_volumes "$old" "$new"; then
      echo "[migrate]   FAILED: rsync $old → $new" >&2
      podman volume rm "$new" >/dev/null 2>&1 || true
      failed=$((failed+1))
    else
      echo "[migrate]   OK: $new populated from $old"
    fi

    # Restart containers we stopped. Plugin manifest update lands via
    # upgrade.sh re-sync; owner is expected to run `agi upgrade` after
    # this script so the new volume name becomes the bind target.
    for c in $to_restart; do
      echo "[migrate]   restart: $c"
      podman start "$c" >/dev/null 2>&1 || echo "[migrate]   warn: could not restart $c (manifest re-sync pending)" >&2
    done
  done <<< "$old_vols"

  echo "[migrate] done — total=$total failed=$failed"
  if [ "$failed" -gt 0 ]; then
    return 3
  fi
}

# ---------------------------------------------------------------------------
# Phase B — purge old (after owner verification)
# ---------------------------------------------------------------------------
cmd_purge_old() {
  local old_vols
  old_vols="$(discover_old_volumes)"

  if [ -z "$old_vols" ]; then
    echo "[migrate] no ${OLD_PREFIX}*${VOLUME_SUFFIX} volumes left — nothing to purge"
    return 0
  fi

  local removed=0 skipped=0
  while IFS= read -r old; do
    [ -z "$old" ] && continue
    local users; users="$(containers_using_volume "$old")"
    if [ -n "$users" ]; then
      echo "[migrate] skip: $old still in use by: $users"
      skipped=$((skipped+1))
      continue
    fi
    local new; new="$(volume_old_to_new "$old")"
    if ! podman volume inspect "$new" >/dev/null 2>&1; then
      echo "[migrate] skip: $old has no corresponding $new — refusing to delete" >&2
      skipped=$((skipped+1))
      continue
    fi
    echo "[migrate] remove: $old"
    podman volume rm "$old" >/dev/null 2>&1 || { echo "[migrate]   warn: could not remove $old" >&2; skipped=$((skipped+1)); continue; }
    removed=$((removed+1))
  done <<< "$old_vols"

  echo "[migrate] purge done — removed=$removed skipped=$skipped"
}

# ---------------------------------------------------------------------------
# Rollback — remove agi-*-data volumes (not in use), leave aionima-* intact
# ---------------------------------------------------------------------------
cmd_rollback() {
  local new_vols
  new_vols="$(discover_new_volumes)"
  if [ -z "$new_vols" ]; then
    echo "[migrate] no ${NEW_PREFIX}*${VOLUME_SUFFIX} volumes found — nothing to roll back"
    return 0
  fi

  local any_in_use=0
  while IFS= read -r new; do
    [ -z "$new" ] && continue
    local users; users="$(containers_using_volume "$new")"
    if [ -n "$users" ]; then
      echo "[migrate] rollback blocked: $new is in use by: $users" >&2
      any_in_use=1
    fi
  done <<< "$new_vols"

  if [ "$any_in_use" -ne 0 ]; then
    echo "[migrate] rollback aborted — stop containers using agi-* volumes first" >&2
    return 4
  fi

  while IFS= read -r new; do
    [ -z "$new" ] && continue
    echo "[migrate] remove: $new"
    podman volume rm "$new" >/dev/null 2>&1 || echo "[migrate]   warn: could not remove $new" >&2
  done <<< "$new_vols"

  echo "[migrate] rollback done — aionima-* volumes untouched, agi-* volumes removed"
}

# ---------------------------------------------------------------------------
# Dry-run
# ---------------------------------------------------------------------------
cmd_dry_run() {
  echo "[migrate] discovering volumes matching ${OLD_PREFIX}*${VOLUME_SUFFIX}"
  local old_vols; old_vols="$(discover_old_volumes)"
  if [ -z "$old_vols" ]; then
    echo "[migrate] no matching volumes on this host"
  else
    echo "[migrate] would migrate:"
    while IFS= read -r old; do
      [ -z "$old" ] && continue
      local new; new="$(volume_old_to_new "$old")"
      local users; users="$(containers_using_volume "$old")"
      local status="new"
      if podman volume inspect "$new" >/dev/null 2>&1; then
        status="already exists (would skip)"
      fi
      echo "  ${old} → ${new}   [dest: ${status}]   [containers: ${users:-none}]"
    done <<< "$old_vols"
  fi

  echo ""
  echo "[migrate] discovering volumes matching ${NEW_PREFIX}*${VOLUME_SUFFIX}"
  local new_vols; new_vols="$(discover_new_volumes)"
  if [ -z "$new_vols" ]; then
    echo "[migrate] no ${NEW_PREFIX} volumes yet"
  else
    while IFS= read -r new; do
      [ -z "$new" ] && continue
      echo "  ${new}"
    done <<< "$new_vols"
  fi
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "$MODE" in
  --dry-run)    cmd_dry_run ;;
  --migrate)    cmd_migrate ;;
  --rollback)   cmd_rollback ;;
  --purge-old)  cmd_purge_old ;;
esac
