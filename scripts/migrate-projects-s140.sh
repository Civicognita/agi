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

if [ "$MODE" != "--dry-run" ] && [ "$MODE" != "--execute" ]; then
  echo "[s140] Unknown mode: $MODE" >&2
  echo "[s140] Use --dry-run or --execute" >&2
  exit 2
fi

BACKUP_ROOT="${HOME}/.agi/migrations/s140-pre"

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

declare -a not_a_project=()
projects_not_a_project=0

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

    # Skip directories that aren't actually projects (no .agi/project.json AND
    # no project.json). Catches workspace containers like _aionima which
    # holds the PAx sacred packages but isn't itself a project.
    if [ ! -f "${projectPath}/.agi/project.json" ] && [ ! -f "${projectPath}/project.json" ]; then
      projects_not_a_project=$((projects_not_a_project + 1))
      not_a_project+=("$projectName")
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

if [ ${projects_not_a_project} -gt 0 ]; then
  echo "──────────────────────────────────────────────────────────────────"
  echo "  Workspace dirs without project config — skipped (${projects_not_a_project} total)"
  echo "──────────────────────────────────────────────────────────────────"
  for n in "${not_a_project[@]}"; do
    echo "    • $n  (no .agi/project.json or project.json)"
  done
  echo ""
fi

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
echo "  not-a-project:  ${projects_not_a_project}"
echo "  to-migrate:     ${projects_to_migrate}"
echo ""

if [ "$MODE" = "--dry-run" ]; then
  echo "  Next: review report. Owner sign-off unblocks 'agi project-migrate s140 --execute'."
  echo ""
  exit 0
fi

# ---------------------------------------------------------------------------
# --execute — run the migration per-project.
#
# Per-project flow:
#   1. Pre-flight backup:
#        For each repo (multi-repo or single-repo flat):
#          - If dirty: git add -A && git commit -m "pre-s140 snapshot"
#          - If has upstream: git push <upstream>
#          - If no upstream OR push fails: tar -czf <backup> repo-content
#        Failures abort that project's migration; other projects still proceed.
#
#   2. Layout migration:
#        - Single-repo flat → repos/<projectName>/ (move contents)
#        - .agi/project.json → project.json (root)
#        - k/chat/ → chat/
#        - mkdir sandbox/
#
#   3. Config update:
#        Project-level attachedStacks → per-repo attachedStacks (in
#        the new project.json). Single-repo: stacks attach to the only
#        repo. Multi-repo: stacks attach to the first repo by default
#        (owner can re-distribute later via the dashboard hosting UI).
#
# Idempotent: each step checks "already done" and skips. Safe to re-run.
# ---------------------------------------------------------------------------

echo "==================================================================="
echo "  Executing migration..."
echo "==================================================================="
echo ""
echo "Backup root: ${BACKUP_ROOT}"
mkdir -p "$BACKUP_ROOT"
echo ""

migrated_ok=0
migrated_fail=0
declare -a fail_reasons=()

# ---- per-repo pre-flight backup ----
preflight_repo() {
  local repoPath="$1"  # path to repo (working tree + .git)
  local label="$2"     # display label
  local backupDir="$3" # where to put tarball if needed

  if ! git -C "$repoPath" rev-parse --git-dir >/dev/null 2>&1; then
    echo "      ${label}: not a git repo, skipping git ops"
    return 0
  fi

  # 1. Auto-commit if dirty
  if [ -n "$(git -C "$repoPath" status --porcelain 2>/dev/null)" ]; then
    echo "      ${label}: dirty — committing pre-s140 snapshot"
    git -C "$repoPath" add -A
    if ! git -C "$repoPath" commit -m "pre-s140 snapshot (auto-commit before folder restructure migration)" >/dev/null 2>&1; then
      echo "      ${label}: commit failed; aborting preflight" >&2
      return 1
    fi
  fi

  # 2. Push to upstream if it has one; tarball otherwise
  if git -C "$repoPath" rev-parse '@{u}' >/dev/null 2>&1; then
    if [ "$(git -C "$repoPath" log '@{u}..' --oneline 2>/dev/null | wc -l | tr -d ' ')" != "0" ]; then
      echo "      ${label}: pushing to upstream"
      if ! git -C "$repoPath" push 2>&1 | sed 's/^/        /' ; then
        echo "      ${label}: push failed — falling through to tarball" >&2
        # fall through to tarball
      else
        return 0
      fi
    else
      echo "      ${label}: clean + already pushed"
      return 0
    fi
  fi

  # No-upstream OR push failed → tarball the working tree + .git
  mkdir -p "$backupDir"
  local outTar="${backupDir}/$(basename "$repoPath").tar.gz"
  echo "      ${label}: tarballing → ${outTar}"
  if ! tar -czf "$outTar" -C "$(dirname "$repoPath")" "$(basename "$repoPath")" 2>&1 | sed 's/^/        /' ; then
    echo "      ${label}: tarball failed" >&2
    return 1
  fi
  return 0
}

# ---- layout migration for one project ----
migrate_one_project() {
  local projectPath="$1"
  local projectName
  projectName=$(basename "$projectPath")
  local backupDir="${BACKUP_ROOT}/${projectName}"

  echo ""
  echo "  ▸ ${projectName}"

  # Step 1 — preflight backups per repo
  echo "    [1/4] preflight (commit/push/tarball)"
  local preflightFailed=0
  if [ -d "${projectPath}/.git" ]; then
    # single-repo flat
    if ! preflight_repo "$projectPath" "(root)" "$backupDir"; then preflightFailed=1; fi
  fi
  if [ -d "${projectPath}/repos" ]; then
    for repo in "${projectPath}/repos"/*/; do
      [ -d "$repo" ] || continue
      [ -d "${repo}.git" ] || continue
      local rname
      rname=$(basename "$repo")
      if ! preflight_repo "$repo" "$rname" "$backupDir"; then preflightFailed=1; fi
    done
  fi

  if [ "$preflightFailed" = "1" ]; then
    fail_reasons+=("${projectName}: preflight failed")
    migrated_fail=$((migrated_fail + 1))
    echo "    ✗ preflight failed; skipping migration steps for ${projectName}"
    return
  fi

  # Step 2 — layout migration
  echo "    [2/4] layout migration"

  # 2a. Single-repo flat → repos/<projectName>/
  if [ -d "${projectPath}/.git" ] && [ ! -d "${projectPath}/repos/${projectName}" ]; then
    echo "      moving flat repo content into repos/${projectName}/"
    mkdir -p "${projectPath}/repos/${projectName}"
    # Move everything except the new top-level structure dirs.
    # Shopt for hidden files. nullglob avoids glob-expansion issues.
    shopt -s dotglob nullglob 2>/dev/null
    for entry in "${projectPath}"/*; do
      [ -e "$entry" ] || continue
      local b
      b=$(basename "$entry")
      case "$b" in
        repos|k|chat|sandbox|.agi|.trash|project.json) continue ;;
      esac
      mv "$entry" "${projectPath}/repos/${projectName}/" 2>&1 | sed 's/^/        /' || true
    done
    shopt -u dotglob nullglob 2>/dev/null
  fi

  # 2b. .agi/project.json → project.json (root)
  if [ -f "${projectPath}/.agi/project.json" ] && [ ! -f "${projectPath}/project.json" ]; then
    echo "      moving .agi/project.json → project.json"
    mv "${projectPath}/.agi/project.json" "${projectPath}/project.json"
  fi

  # 2c. k/chat/ → chat/
  if [ -d "${projectPath}/k/chat" ] && [ ! -d "${projectPath}/chat" ]; then
    echo "      moving k/chat/ → chat/"
    mv "${projectPath}/k/chat" "${projectPath}/chat"
  fi

  # 2d. mkdir sandbox/
  if [ ! -d "${projectPath}/sandbox" ]; then
    echo "      creating sandbox/"
    mkdir -p "${projectPath}/sandbox"
  fi

  # Step 3 — config update (project-level stacks → per-repo)
  echo "    [3/4] config update (stacks → per-repo)"
  if [ -f "${projectPath}/project.json" ]; then
    node -e "
      const fs = require('fs');
      const path = require('path');
      const cfgPath = process.argv[1];
      const projPath = process.argv[2];
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));

      // Discover repo names under <projectPath>/repos/
      const reposDir = path.join(projPath, 'repos');
      const repos = fs.existsSync(reposDir)
        ? fs.readdirSync(reposDir).filter(n => fs.statSync(path.join(reposDir, n)).isDirectory())
        : [];

      // Collect existing project-level stacks (legacy field)
      const projectStacks = cfg.attachedStacks || cfg.hosting?.stacks || [];

      // Initialize repos[] entries — each gets {name, attachedStacks: []}
      cfg.repos = cfg.repos || {};
      for (const r of repos) {
        if (!cfg.repos[r]) cfg.repos[r] = { attachedStacks: [] };
      }

      // Migrate stacks: single-repo → all on it; multi-repo → first repo
      // (owner re-distributes via hosting UI later).
      if (projectStacks.length > 0 && repos.length > 0) {
        const target = repos[0];
        const existing = cfg.repos[target].attachedStacks || [];
        const existingIds = new Set(existing.map(s => s.stackId));
        for (const s of projectStacks) {
          if (!existingIds.has(s.stackId)) {
            existing.push(s);
          }
        }
        cfg.repos[target].attachedStacks = existing;
        // Remove project-level field
        delete cfg.attachedStacks;
        if (cfg.hosting) delete cfg.hosting.stacks;
      }

      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    " "${projectPath}/project.json" "$projectPath"
  fi

  # Step 4 — verify
  echo "    [4/4] verify"
  local ok=1
  [ -f "${projectPath}/project.json" ] || { echo "      ✗ project.json missing"; ok=0; }
  [ -d "${projectPath}/k" ] || { echo "      ✗ k/ missing"; ok=0; }
  [ -d "${projectPath}/repos" ] || { echo "      ✗ repos/ missing"; ok=0; }
  [ -d "${projectPath}/chat" ] || { echo "      ✗ chat/ missing"; ok=0; }
  [ -d "${projectPath}/sandbox" ] || { echo "      ✗ sandbox/ missing"; ok=0; }

  if [ "$ok" = "1" ]; then
    migrated_ok=$((migrated_ok + 1))
    echo "    ✓ ${projectName} migrated"
  else
    migrated_fail=$((migrated_fail + 1))
    fail_reasons+=("${projectName}: verify failed")
    echo "    ✗ ${projectName} verify failed"
  fi
}

for projectPath in "${to_migrate[@]}"; do
  migrate_one_project "$projectPath"
done

echo ""
echo "==================================================================="
echo "  Execution summary"
echo "==================================================================="
echo "  migrated:  ${migrated_ok}"
echo "  failed:    ${migrated_fail}"
if [ ${#fail_reasons[@]} -gt 0 ]; then
  echo "  failures:"
  for r in "${fail_reasons[@]}"; do echo "    • $r"; done
fi
echo ""
echo "  Backup tarballs (if any) at: ${BACKUP_ROOT}/<project>/<repo>.tar.gz"
echo "  Re-run is idempotent — already-migrated projects are no-ops."
echo ""

if [ ${migrated_fail} -gt 0 ]; then
  exit 1
fi
exit 0
