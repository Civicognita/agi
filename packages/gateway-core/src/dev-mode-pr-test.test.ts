import { describe, expect, it } from "vitest";

import {
  prWorktreeDirName,
  prTestVmArgs,
  prFetchArgs,
  worktreeAddArgs,
  worktreeRemoveArgs,
  resolvePrTestTarget,
} from "./dev-mode-pr-test.js";

/**
 * dev-mode-pr-test — the PURE arg construction behind "Test in VM". These args
 * become git refspecs/paths, so the guards (injection-safe pr number + slug)
 * are the substance worth pinning; the multipass/VM orchestration is bash.
 */
describe("dev-mode-pr-test", () => {
  it("builds the PR fetch refspec for the upstream remote", () => {
    expect(prFetchArgs(178)).toEqual(["fetch", "--no-tags", "upstream", "pull/178/head"]);
  });

  it("builds a slug+number-scoped worktree dir name", () => {
    expect(prWorktreeDirName("agi", 178)).toBe("agi-pr-178");
    expect(prWorktreeDirName("react-fancy", 9)).toBe("react-fancy-pr-9");
  });

  it("builds the test-vm.sh spawn args", () => {
    expect(prTestVmArgs("agi", 178)).toEqual(["pr", "agi", "178"]);
  });

  it("builds detached worktree add + force-remove args", () => {
    expect(worktreeAddArgs(".pr-test/agi-pr-178")).toEqual([
      "worktree", "add", "--detach", ".pr-test/agi-pr-178", "FETCH_HEAD",
    ]);
    expect(worktreeRemoveArgs(".pr-test/agi-pr-178")).toEqual([
      "worktree", "remove", "--force", ".pr-test/agi-pr-178",
    ]);
  });

  it("resolves a known slug to its upstream + display name", () => {
    const t = resolvePrTestTarget("agi", 178);
    expect(t).not.toBeNull();
    expect(t!.upstream).toBe("agi");
    expect(t!.slug).toBe("agi");
  });

  it("returns null for an unknown slug (caller 404s)", () => {
    expect(resolvePrTestTarget("not-a-repo", 1)).toBeNull();
  });

  it("rejects a non-integer / non-positive PR number (no refspec injection)", () => {
    expect(() => prFetchArgs(0)).toThrow(/invalid PR number/);
    expect(() => prFetchArgs(-3)).toThrow(/invalid PR number/);
    expect(() => prFetchArgs(1.5)).toThrow(/invalid PR number/);
    expect(() => prWorktreeDirName("agi", Number.NaN)).toThrow(/invalid PR number/);
    expect(() => resolvePrTestTarget("agi", 0)).toThrow(/invalid PR number/);
  });

  it("rejects a slug with shell/path metacharacters", () => {
    expect(() => prWorktreeDirName("../etc", 1)).toThrow(/invalid slug/);
    expect(() => prWorktreeDirName("a;b", 1)).toThrow(/invalid slug/);
  });
});
