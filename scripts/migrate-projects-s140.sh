#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# migrate-projects-s140.sh — Project folder restructure migration tool
#
# Owner directive 2026-04-30:
#   Each project gets a flat top-level layout:
#     <projectPath>/k/         (knowledge: plans, knowledge, pm, memory)
#     <projectPath>/repos/     (multi-repo working trees)
#     <projectPath>/chat/      (per-project chat sessions, was k/chat/)
#     <projectPath>/sandbox/   (NEW — agent scratch space scoped to project)
#     <projectPath>/project.json    (root config, NOT .agi/project.json;
#                                    holds project- AND per-repo-config)
#   Stacks attach to repos (per-repo {stackId, start, dev, actions}),
#   not to projects.
#
# Today's layout (s130 t514, cycles 88-91):
#   <projectPath>/.agi/project.json
#   <projectPath>/k/{plans,knowledge,pm,memory,chat}/
#   <projectPath>/repos/        (multi-repo, but single project-level stack)
#   <projectPath>/.trash/       (kept)
#
# Diffs to migrate:
#   1. .agi/project.json → project.json  (move config to root)
#   2. k/chat/           → chat/         (move chat out of k/)
#   3. (create)          → sandbox/      (new empty dir)
#   4. project-level attachedStacks → per-repo stack attachments
#
# Modes:
#   --dry-run   (default) — Read-only audit. Reports per-project state.
#   --execute             — Run the migration (commit/push dirty repos
#                           OR back up to ~/.agi/migrations/ first).
#                           NOT IMPLEMENTED in this initial slice.
#
# Sacred (skipped): agi, prime, id, marketplace, mapp-marketplace,
#                   react-fancy, fancy-code, fancy-sheets, fancy-echarts
# ---------------------------------------------------------------------------
set -uo pipefail

GATEWAY_CONFIG="${HOME}/.agi/gateway.json"
MODE="${1:-}"

if [ -z "$MODE" ] || [ "$MODE" = "--help" ] || [ "$MODE" = "-h" ]; then
  echo "Usage: agi project-migrate s140 [--dry-run|--execute]"
  echo ""
  echo "  --dry-run   Read-only audit (default). Per-project state report."
  echo "  --execute   Run the migration. NOT YET IMPLEMENTED."
  exit 0
fi

if [ "$MODE" = "--execute" ]; then
  echo "[s140] --execute mode is not yet implemented." >&2
  echo "[s140] Run --dry-run first; review the report; then owner sign-off unblocks --execute." >&2
  exit 1
fi

if [ "$MODE" != "--dry-run" ]; then
  echo "[s140] Unknown mode: $MODE" >&2
  echo "[s140] Use --dry-run or --execute" >&2
  exit 2
fi

# Sacred lists — kept in sync with packages/gateway-core/src/server-runtime-state.ts
# (SACRED_PROJECT_NAMES) and ui/dashboard/src/lib/sacred-projects.ts (PAX_SACRED_PROJECTS).
SACRED_NAMES=("agi" "prime" "id" "marketplace" "mapp-marketplace" \
              "react-fancy" "fancy-code" "fancy-sheets" "fancy-echarts")

is_sacred() {
  local name
  name=$(basename "$1" | tr '[:upper:]' '[:lower:]')
  for s in "${SACRED_NAMES[@]}"; do
    if [ "$name" = "$s" ]; then return 0; fi
  done
  return 1
}

# Read workspace.projects from gateway.json. If jq isn't available, fall back
# to a node one-liner (always present per package.json engines).
list_workspace_projects() {
  if [ ! -f "$GATEWAY_CONFIG" ]; then
    echo "[s140] gateway.json not found at $GATEWAY_CONFIG" >&2
    return 1
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -r '.workspace.projects[]?' "$GATEWAY_CONFIG"
  else
    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
      const dirs = cfg?.workspace?.projects ?? [];
      for (const d of dirs) console.log(d);
    " "$GATEWAY_CONFIG"
  fi
}

# Per-project stack attachment from current .agi/project.json (legacy shape).
# Returns the attachedStacks JSON array or "[]" when missing.
get_project_stacks() {
  local projectPath="$1"
  local cfg="${projectPath}/.agi/project.json"
  if [ ! -f "$cfg" ]; then echo "[]"; return; fi
  if command -v jq >/dev/null 2>&1; then
    jq -c '.attachedStacks // .hosting.stacks // []' "$cfg" 2>/dev/null || echo "[]"
  else
    node -e "
      const fs = require('fs');
      try {
        const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
        const stacks = cfg.attachedStacks || cfg.hosting?.stacks || [];
        process.stdout.write(JSON.stringify(stacks));
      } catch { process.stdout.write('[]'); }
    " "$cfg"
  fi
}

# Folder-shape diff — what would change at <projectPath>/ to reach the s140 layout.
report_folder_shape() {
  local projectPath="$1"
  local moves=()
  local creates=()

  # 1. .agi/project.json → project.json
  if [ -f "${projectPath}/.agi/project.json" ] && [ ! -f "${projectPath}/project.json" ]; then
    moves+=(".agi/project.json → project.json")
  elif [ ! -f "${projectPath}/project.json" ]; then
    creates+=("project.json (no current config — synthesize from defaults)")
  fi

  # 2. k/chat/ → chat/
  if [ -d "${projectPath}/k/chat" ] && [ ! -d "${projectPath}/chat" ]; then
    moves+=("k/chat/ → chat/")
  elif [ ! -d "${projectPath}/chat" ]; then
    creates+=("chat/ (empty)")
  fi

  # 3. sandbox/ create
  if [ ! -d "${projectPath}/sandbox" ]; then
    creates+=("sandbox/ (new empty)")
  fi

  # 4. repos/ — already exists in s130 layout; check
  if [ ! -d "${projectPath}/repos" ]; then
    creates+=("repos/ (no current multi-repo dir)")
  fi

  # 5. k/ — already exists in s130; verify
  if [ ! -d "${projectPath}/k" ]; then
    creates+=("k/ (no current knowledge dir)")
  fi

  if [ ${#moves[@]} -eq 0 ] && [ ${#creates[@]} -eq 0 ]; then
    echo "        ✓ already at target shape"
  else
    if [ ${#moves[@]} -gt 0 ]; then
      echo "        moves:"
      for m in "${moves[@]}"; do echo "          • $m"; done
    fi
    if [ ${#creates[@]} -gt 0 ]; then
      echo "        creates:"
      for c in "${creates[@]}"; do echo "          • $c"; done
    fi
  fi
}

# Per-repo git state — clean / dirty / unpushed.
report_repos_git_state() {
  local projectPath="$1"
  local reposRoot="${projectPath}/repos"

  # Two layouts to detect:
  #   (A) Multi-repo (s130 t515): <projectPath>/repos/<name>/.git/
  #   (B) Single-repo flat (legacy):  <projectPath>/.git/
  # Most projects today are (B) because s130 t515 phase B is still backlog.
  # The s140 migration needs to move (B) projects into repos/<name>/ before
  # applying the layout changes (chat/ split, sandbox/, project.json).

  local foundMulti=0
  if [ -d "$reposRoot" ]; then
    for repo in "$reposRoot"/*/; do
      [ -d "$repo" ] || continue
      [ -d "${repo}.git" ] || continue
      foundMulti=1
      local name
      name=$(basename "$repo")
      analyze_one_repo "$repo" "$name" "          "
    done
  fi

  if [ $foundMulti -eq 1 ]; then
    return
  fi

  # Fall through: check for single-repo flat layout
  if [ -d "${projectPath}/.git" ]; then
    echo "        layout: single-repo flat (project root IS the repo) — needs reshape into repos/<name>/"
    analyze_one_repo "$projectPath" "(root)" "          "
  elif [ -d "$reposRoot" ]; then
    echo "        repos/ exists but empty (no .git inside) — initial scaffold"
  else
    echo "        no .git found (project has no repo content)"
  fi
}

analyze_one_repo() {
  local repoPath="$1"
  local label="$2"
  local indent="$3"
  local dirty=0
  local unpushed=0

  if ! git -C "$repoPath" rev-parse --git-dir >/dev/null 2>&1; then
    echo "${indent}${label}: not a git repo"
    return
  fi

  if [ -n "$(git -C "$repoPath" status --porcelain 2>/dev/null)" ]; then
    dirty=$(git -C "$repoPath" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  fi

  # @{u} fails when no upstream. Treat as 0 unpushed in that case.
  if git -C "$repoPath" rev-parse '@{u}' >/dev/null 2>&1; then
    unpushed=$(git -C "$repoPath" log '@{u}..' --oneline 2>/dev/null | wc -l | tr -d ' ')
  else
    unpushed="no-upstream"
  fi

  local branch
  branch=$(git -C "$repoPath" symbolic-ref --short HEAD 2>/dev/null || echo "(detached)")

  local state="clean"
  if [ "$dirty" != "0" ]; then state="dirty($dirty)"; fi
  if [ "$unpushed" = "no-upstream" ]; then
    state="${state}, no-upstream"
  elif [ "$unpushed" != "0" ]; then
    state="${state}, unpushed($unpushed)"
  fi

  echo "${indent}${label}: ${branch} — ${state}"
}

# ---------------------------------------------------------------------------
# Main report
# ---------------------------------------------------------------------------
echo "==================================================================="
echo "  s140 — Project folder restructure dry-run report"
echo "==================================================================="
echo ""
echo "Target layout per project:"
echo "  <projectPath>/k/         (knowledge — plans, knowledge, pm, memory)"
echo "  <projectPath>/repos/     (multi-repo working trees)"
echo "  <projectPath>/chat/      (per-project chat sessions)"
echo "  <projectPath>/sandbox/   (NEW — agent scratch space)"
echo "  <projectPath>/project.json (root config, project + per-repo combined)"
echo ""
echo "Stacks: per-repo attachment (was project-level)."
echo ""

projects_total=0
projects_sacred=0
projects_to_migrate=0
projects_already_target=0

declare -a sacred_skipped=()
declare -a to_migrate=()

while IFS= read -r workspaceDir; do
  [ -z "$workspaceDir" ] && continue
  if [ ! -d "$workspaceDir" ]; then
    echo "  (skipping missing workspace dir: $workspaceDir)"
    continue
  fi
  for projectPath in "$workspaceDir"/*/; do
    [ -d "$projectPath" ] || continue
    projects_total=$((projects_total + 1))
    projectName=$(basename "$projectPath")

    if is_sacred "$projectPath"; then
      projects_sacred=$((projects_sacred + 1))
      sacred_skipped+=("$projectName")
      continue
    fi

    projects_to_migrate=$((projects_to_migrate + 1))
    to_migrate+=("$projectPath")
  done
done < <(list_workspace_projects)

echo "──────────────────────────────────────────────────────────────────"
echo "  Sacred projects skipped (${projects_sacred} total)"
echo "──────────────────────────────────────────────────────────────────"
for s in "${sacred_skipped[@]}"; do
  echo "    • $s"
done
echo ""

echo "──────────────────────────────────────────────────────────────────"
echo "  Projects to migrate (${projects_to_migrate} total)"
echo "──────────────────────────────────────────────────────────────────"

for projectPath in "${to_migrate[@]}"; do
  projectName=$(basename "$projectPath")
  echo ""
  echo "  ▸ ${projectName}"
  echo "    path: ${projectPath}"

  echo "    [folder shape]"
  report_folder_shape "$projectPath"

  echo "    [repos]"
  report_repos_git_state "$projectPath"

  echo "    [stacks (current — to be remapped per-repo)]"
  stacks=$(get_project_stacks "$projectPath")
  if [ "$stacks" = "[]" ] || [ -z "$stacks" ]; then
    echo "        (none attached)"
  else
    echo "        $stacks"
  fi
done

echo ""
echo "==================================================================="
echo "  Summary"
echo "==================================================================="
echo "  total:          ${projects_total}"
echo "  sacred-skipped: ${projects_sacred}"
echo "  to-migrate:     ${projects_to_migrate}"
echo ""
echo "  Next: review report. Owner sign-off unblocks 'agi project-migrate s140 --execute'."
echo "  --execute is NOT YET implemented; this dry-run is the safe first pass."
echo ""
