#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-staged-tree — typecheck the STAGED tree before commit (s101 t409)
# ---------------------------------------------------------------------------
# Born from two hotfix cycles in the same loop session:
#   v0.4.187 → v0.4.188 — providers-api duplicate route declaration. Local
#       tsc passed because the file existed on disk; production crashed at
#       boot because route registration collided.
#   v0.4.193 → v0.4.194 — NoopAnchor file was gitignored by the un-anchored
#       `memory/` rule. Local tsc passed (file on disk); published commit
#       had a broken import (file not in the repo).
#
# Both bugs share a root cause: tsc reads from disk, not git. The working
# tree can typecheck cleanly while the staged commit is broken.
#
# This guard runs typecheck against EXACTLY what's staged:
#   1. Stash all unstaged changes + untracked files (--keep-index keeps the
#      staged content in place).
#   2. Run pnpm typecheck against the now-clean working tree (which equals
#      the staged content).
#   3. Capture exit code. Restore the stash via trap so the working tree
#      ends up exactly as it started, regardless of typecheck success/fail.
#
# Usage:
#   bash scripts/check-staged-tree.sh         # warn-only (exit 0 with findings)
#   bash scripts/check-staged-tree.sh --strict  # exit 2 on typecheck failure
#
# When to skip:
#   - Empty commits (no staged changes) — nothing to verify; exits 0.
#   - The script itself errors before stashing (graceful exit, no working
#     tree mutation).
#
# Same-commit guard family alongside:
#   - pnpm route-check (v0.4.189) — static route-collision lint
#   - pnpm docs-check (v0.4.179) — agi help vs cli.md drift lint
# ---------------------------------------------------------------------------
set -uo pipefail

STRICT=0
if [ "${1:-}" = "--strict" ]; then STRICT=1; fi

REPO_DIR="$(cd -P "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# Verify we're in a git repo with a staged tree to check.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: not a git repository" >&2
  exit 1
fi

# Are there any staged changes? If not, nothing to verify.
if git diff --cached --quiet 2>/dev/null; then
  echo "check-staged-tree: no staged changes — nothing to verify"
  exit 0
fi

# Are there any unstaged changes or untracked files we'd need to stash?
HAS_DIRTY=0
if ! git diff --quiet 2>/dev/null \
   || [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
  HAS_DIRTY=1
fi

STASH_REF=""
restore_stash() {
  if [ -n "$STASH_REF" ]; then
    # Restore the stash. --quiet to avoid noise on success; redirect stderr
    # so a "no stash" race doesn't trip the trap on a clean exit.
    git stash pop "$STASH_REF" --quiet 2>/dev/null || \
      git stash pop --quiet 2>/dev/null || true
  fi
}
trap restore_stash EXIT

if [ "$HAS_DIRTY" -eq 1 ]; then
  # Stash unstaged + untracked, keep the staged index in place. The unique
  # message lets us reference this exact stash on restore even if other
  # stash ops happen mid-flight (rare but possible if user runs concurrent
  # git ops; the trap fallback will pop the latest stash).
  STASH_MSG="check-staged-tree: temporary stash $$"
  if ! git stash push --keep-index --include-untracked --quiet -m "$STASH_MSG" 2>/dev/null; then
    echo "error: failed to stash unstaged changes — aborting before typecheck" >&2
    exit 1
  fi
  STASH_REF="stash@{0}"
fi

# Run typecheck against the now-clean staged tree. Capture exit code so the
# trap restoration runs whether or not typecheck passed.
echo "check-staged-tree: typechecking staged tree..."
TYPECHECK_OUTPUT=$(pnpm typecheck 2>&1)
TYPECHECK_EXIT=$?

if [ "$TYPECHECK_EXIT" -ne 0 ]; then
  echo ""
  echo "check-staged-tree: STAGED TREE TYPECHECK FAILED"
  echo ""
  echo "$TYPECHECK_OUTPUT" | tail -30
  echo ""
  echo "The staged content has typecheck errors that the working tree"
  echo "doesn't show. Common causes:"
  echo "  - Forgot to 'git add' a new file (check 'git status' for untracked)"
  echo "  - .gitignore is shadowing a path you're trying to import"
  echo "  - Renamed/deleted a file but the import still references the old path"
  echo ""
  echo "Reference: v0.4.188 + v0.4.194 hotfixes that motivated this guard."
  if [ "$STRICT" -eq 1 ]; then
    exit 2
  fi
  exit 0
fi

echo "check-staged-tree: clean (staged tree typechecks)"
exit 0
