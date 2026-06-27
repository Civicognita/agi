#!/usr/bin/env bash
#
# orphan-check.sh — find unreferenced React components in ui/dashboard.
#
# Motivation: cycle 226-247 hit the SAME bug twice. A component-swap
# commit (Chat.tsx → PromptInput, ChannelSettings → Discord status card)
# landed in dead code because the targeted component was unreferenced
# anywhere else. typecheck + lint + build all passed; the swap simply
# never rendered. Owner only noticed during testing.
#
# This script greps every component file's basename across the dashboard
# source tree. Files with zero importers (excluding self + tests) are
# flagged. An allowlist of intentionally-archived components keeps the
# baseline clean.
#
# Exit status: 0 = no new orphans; 1 = new orphans found.

set -uo pipefail

# Resolve repo paths whether invoked from /opt/agi, dev source, or via
# agi-cli's bash bridge.
REPO_DIR="${AGI_DEV_SOURCE:-$(cd -P "$(dirname "$0")/.." && pwd)}"
DASHBOARD_DIR="$REPO_DIR/ui/dashboard/src"

if [ ! -d "$DASHBOARD_DIR" ]; then
  echo "orphan-check: dashboard src not found at $DASHBOARD_DIR" >&2
  exit 2
fi

# Intentionally-archived orphans. Add a comment when extending; remove
# when the file is consumed again (or deleted).
ALLOWLIST=(
  # 2026-06-15 cleanup (owner directive): 11 genuinely-dead archived components
  # were DELETED, not allowlisted — IterativeWorkToastStack + IterativeWorkToast,
  # settings/{AgentSettings,AiProviderSettings,PrimeSettings,ChannelSettings},
  # ActivityIndicator, PluginManager, ui/{dropdown-menu,panel-trigger},
  # HearthChatPane.
  #
  # FALSE POSITIVE — ui/table.tsx is LIVE (COAExplorer.tsx renders <Table>,
  # <TableHeader>, etc.), but orphan-check's heuristic doesn't detect that
  # named-export usage, so it must stay allowlisted or the check fails.
  "components/ui/table.tsx"
  #
  # s197 Hearth Home — overview components parked for the planned /usage and
  # /impactinomics routes (v0.4.0). Re-wire (or delete) when those routes ship.
  "components/ActivityFeed.tsx"
  "components/TimelineChart.tsx"
  "components/OverviewCards.tsx"
  "components/UsageSection.tsx"
  "components/ComingSoonOverlay.tsx"
  "components/BreakdownChart.tsx"
)

is_allowlisted() {
  local target="$1"
  for entry in "${ALLOWLIST[@]}"; do
    if [ "$entry" = "$target" ]; then
      return 0
    fi
  done
  return 1
}

cd "$DASHBOARD_DIR" || exit 2

new_orphans=()
all_orphans=()
allowlist_unused=()

while IFS= read -r f; do
  rel="${f#./}"
  base="$(basename "$f" .tsx)"
  # Skip route entry files (default-exported, mounted by router)
  case "$rel" in
    routes/*) continue ;;
  esac
  # Count references to the component name across .tsx + .ts (excluding
  # self + test files).
  refs=$(grep -rln "import.*\\b${base}\\b" . --include="*.tsx" --include="*.ts" 2>/dev/null \
        | grep -v "^./${rel}$" | grep -v "\.test\." | wc -l)
  if [ "$refs" -eq 0 ]; then
    all_orphans+=("$rel")
    if ! is_allowlisted "$rel"; then
      new_orphans+=("$rel")
    fi
  fi
done < <(find components -type f -name "*.tsx" 2>/dev/null)

# Also surface allowlist entries that are NO LONGER orphan (consumed
# again or deleted) so the list stays accurate.
for entry in "${ALLOWLIST[@]}"; do
  is_in_list=false
  for o in "${all_orphans[@]}"; do
    if [ "$o" = "$entry" ]; then
      is_in_list=true
      break
    fi
  done
  if [ "$is_in_list" = "false" ]; then
    allowlist_unused+=("$entry")
  fi
done

if [ ${#new_orphans[@]} -gt 0 ]; then
  echo "orphan-check: ${#new_orphans[@]} unreferenced component(s) found:" >&2
  for o in "${new_orphans[@]}"; do
    echo "  ❌ $o" >&2
  done
  echo "" >&2
  echo "If this is intentional, add to ALLOWLIST in scripts/orphan-check.sh." >&2
  echo "Otherwise wire the component into a parent that renders it." >&2
  echo "See: _discovery/learnings/6965cea.md for the bug-iceberg pattern." >&2
  exit 1
fi

if [ ${#allowlist_unused[@]} -gt 0 ]; then
  echo "orphan-check: stale ALLOWLIST entries (file consumed or deleted):"
  for e in "${allowlist_unused[@]}"; do
    echo "  ⚠️  $e — remove from ALLOWLIST"
  done
  echo "(non-fatal warning; please clean up)"
fi

echo "orphan-check: ✓ no new orphan components (${#all_orphans[@]} archived, allowlist current)"
exit 0
