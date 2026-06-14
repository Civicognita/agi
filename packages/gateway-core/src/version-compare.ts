/**
 * version-compare — minimal semver comparison for upgrade-source gating.
 *
 * Why this exists: the Upgrade Wizard must tell a REAL upgrade apart from a
 * source that merely has merge-commit topology ahead of the current HEAD. For
 * the First Custodian, content flows `fork/dev → upstream/dev → upstream/main`,
 * so `upstream/main` ALWAYS trails the owner's dev by the merge bubbles that
 * carried their own PRs. Counting `commitsBehind` therefore structurally
 * mislabels upstream/main as pullable. The package.json VERSION is the reliable
 * signal — every commit bumps it (CLAUDE.md § version-bump rule) — so a source
 * is an upgrade only when its version is STRICTLY newer than the current one.
 *
 * `parseSemver` reads a leading `major.minor.patch`, ignoring a `v` prefix and
 * any pre-release / build suffix. Unparseable input compares as equal (0) so the
 * caller never infers a false upgrade.
 */

export function parseSemver(version: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 if a < b, 1 if a > b, 0 if equal or either side is unparseable. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  const [a0, a1, a2] = pa;
  const [b0, b1, b2] = pb;
  if (a0 !== b0) return a0 > b0 ? 1 : -1;
  if (a1 !== b1) return a1 > b1 ? 1 : -1;
  if (a2 !== b2) return a2 > b2 ? 1 : -1;
  return 0;
}

/** True only when `candidate` is a strictly newer version than `current`. */
export function isVersionNewer(candidate: string, current: string): boolean {
  return compareSemver(candidate, current) > 0;
}
