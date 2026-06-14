/**
 * dev-mode-pr-test — fetch an incoming PR's head and test it in the test VM.
 *
 * The custodian reviews PRs in the Incoming tab; this is the "test before
 * merge" mechanism behind the "Test in VM" action. The flow (driven by
 * `scripts/test-vm.sh pr <slug> <number>`):
 *
 *   1. git -C <fork> fetch upstream pull/<n>/head   (the PR head, detached)
 *   2. git -C <fork> worktree add --detach <wt> FETCH_HEAD
 *      (a throwaway worktree — the owner's working tree is never touched)
 *   3. pnpm install in the worktree (cheap: pnpm hard-links from the store)
 *   4. AGI_DEV_SOURCE=<wt> services-align  → remounts /mnt/agi to the worktree,
 *      rebuilds the dashboard, restarts services → test.ai.on serves the PR
 *   5. run the e2e suite against test.ai.on
 *   6. ALWAYS clean up (trap): worktree remove + remount the owner's dev tree
 *
 * This module owns the PURE, injection-safe argument construction; the bash
 * side owns the multipass/VM orchestration. Keeping the arg-building here makes
 * it unit-testable without a VM.
 */

import { CORE_REPOS } from "./dev-mode-forks.js";

/**
 * Throwaway worktree directory NAME for testing a PR. The bash side places it
 * as a sibling of the fork under `_aionima/repos/` (NOT inside the fork) so the
 * PRIME mount path still resolves when the VM remounts to the worktree.
 */
export function prWorktreeDirName(slug: string, prNumber: number): string {
  assertSafeSlug(slug);
  assertSafePrNumber(prNumber);
  return `${slug}-pr-${prNumber}`;
}

/** Args to spawn the test-VM PR flow: `test-vm.sh pr <slug> <number>`. */
export function prTestVmArgs(slug: string, prNumber: number): string[] {
  assertSafeSlug(slug);
  assertSafePrNumber(prNumber);
  return ["pr", slug, String(prNumber)];
}

/** `git fetch` args for the PR head ref (detached into FETCH_HEAD). */
export function prFetchArgs(prNumber: number): string[] {
  assertSafePrNumber(prNumber);
  return ["fetch", "--no-tags", "upstream", `pull/${prNumber}/head`];
}

/** `git worktree add` args — detached at FETCH_HEAD, into `worktreePath`. */
export function worktreeAddArgs(worktreePath: string): string[] {
  return ["worktree", "add", "--detach", worktreePath, "FETCH_HEAD"];
}

/** `git worktree remove --force` args (cleanup, tolerant of dirty worktree). */
export function worktreeRemoveArgs(worktreePath: string): string[] {
  return ["worktree", "remove", "--force", worktreePath];
}

/**
 * Validate (slug, prNumber) and resolve the on-disk fork dir for the slug.
 * Returns null when the slug is unknown — the caller 404s. prNumber must be a
 * positive integer; a non-integer / negative value throws (it would otherwise
 * land in a git refspec).
 */
export function resolvePrTestTarget(
  slug: string,
  prNumber: number,
): { slug: string; upstream: string; displayName: string } | null {
  assertSafePrNumber(prNumber);
  const spec = CORE_REPOS.find((s) => s.slug === slug);
  if (!spec) return null;
  return { slug: spec.slug, upstream: spec.upstream, displayName: spec.displayName };
}

/** The test.ai.on URL the PR build is served at once the VM is remounted. */
export const PR_TEST_SERVE_URL = "https://test.ai.on";

// ---------------------------------------------------------------------------
// Guards — these args become git refspecs / paths, so validate strictly.
// ---------------------------------------------------------------------------

function assertSafePrNumber(prNumber: number): void {
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`invalid PR number: ${String(prNumber)}`);
  }
}

function assertSafeSlug(slug: string): void {
  // Slugs are CORE_REPOS keys: lowercase, digits, dashes only.
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`invalid slug: ${slug}`);
  }
}
