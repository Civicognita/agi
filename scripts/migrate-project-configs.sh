#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# migrate-project-configs.sh — Upgrade project.json files to current schema
#
# Called by upgrade.sh after build. Backfills required fields that may be
# missing from legacy project configs written before schema validation.
#
# Safe to run multiple times (idempotent).
# ---------------------------------------------------------------------------
set -uo pipefail

AGI_DIR="${HOME}/.agi"
MIGRATED=0
SKIPPED=0

if [ ! -d "$AGI_DIR" ]; then
  echo '{"phase":"migrate","status":"skip","details":"No ~/.agi directory"}'
  exit 0
fi

for config_dir in "$AGI_DIR"/*/; do
  config_file="${config_dir}project.json"
  [ -f "$config_file" ] || continue

  # Parse with node — backfill name + createdAt if missing
  node -e "
    const fs = require('fs');
    const path = require('path');
    const file = process.argv[1];
    const slug = path.basename(path.dirname(file));

    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf-8')); }
    catch { process.exit(0); } // skip corrupt files

    let changed = false;

    // Backfill required 'name' from slug
    if (!data.name) {
      // Slug format: home-user-_projects-myproject → derive last segment
      const parts = slug.split('-');
      data.name = parts[parts.length - 1] || slug;
      changed = true;
    }

    // Backfill 'createdAt'
    if (!data.createdAt) {
      const stat = fs.statSync(file);
      data.createdAt = stat.birthtime.toISOString();
      changed = true;
    }

    // Ensure hosting.stacks defaults to array
    if (data.hosting && !Array.isArray(data.hosting.stacks)) {
      data.hosting.stacks = [];
      changed = true;
    }

    // Ensure hosting.enabled is boolean
    if (data.hosting && typeof data.hosting.enabled !== 'boolean') {
      data.hosting.enabled = true;
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      console.log('migrated: ' + slug);
    }
  " "$config_file" && MIGRATED=$((MIGRATED + 1)) || SKIPPED=$((SKIPPED + 1))
done

# ---------------------------------------------------------------------------
# Clean up legacy in-project config files (should never exist inside project dirs)
# ---------------------------------------------------------------------------
CLEANED=0
WORKSPACE_DIRS=$(node -e "
  try {
    const c = JSON.parse(require('fs').readFileSync('${AGI_DIR}/gateway.json', 'utf-8'));
    (c.workspace?.projects ?? []).forEach(d => console.log(d));
  } catch {}
" 2>/dev/null)

for ws_dir in $WORKSPACE_DIRS; do
  [ -d "$ws_dir" ] || continue
  for legacy_file in "$ws_dir"/*/.aionima-project.json "$ws_dir"/*/.nexus-project.json; do
    [ -f "$legacy_file" ] || continue
    rm -f "$legacy_file"
    CLEANED=$((CLEANED + 1))
  done
done

if [ "$CLEANED" -gt 0 ]; then
  echo "cleaned $CLEANED legacy in-project config file(s)"
fi

echo "{\"phase\":\"migrate\",\"status\":\"done\",\"details\":\"${MIGRATED} config(s) checked, ${SKIPPED} skipped, ${CLEANED} legacy files cleaned\"}"
