/**
 * Git-diagnostic parser tests (s144 t577).
 *
 * Validates parseGitPorcelainV2 against representative `git status
 * --porcelain=v2 --branch` outputs. Pure-logic; runs on host.
 */

import { describe, it, expect } from "vitest";
import { parseGitPorcelainV2 } from "./doctor.js";

describe("parseGitPorcelainV2 (s144 t577)", () => {
  it("parses a clean, in-sync repo (upstream + 0/0)", () => {
    const out = [
      "# branch.oid abc123",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0",
      "",
    ].join("\n");
    expect(parseGitPorcelainV2(out)).toEqual({
      staged: 0,
      unstaged: 0,
      untracked: 0,
      upstreamSet: true,
      ahead: 0,
      behind: 0,
    });
  });

  it("parses no-upstream (detached or never-pushed branch)", () => {
    const out = [
      "# branch.oid abc123",
      "# branch.head feature/x",
      "",
    ].join("\n");
    const r = parseGitPorcelainV2(out);
    expect(r.upstreamSet).toBe(false);
    expect(r.ahead).toBe(0);
    expect(r.behind).toBe(0);
  });

  it("parses ahead/behind counts", () => {
    const out = [
      "# branch.oid abc",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +3 -2",
      "",
    ].join("\n");
    const r = parseGitPorcelainV2(out);
    expect(r.ahead).toBe(3);
    expect(r.behind).toBe(2);
  });

  it("counts staged-only entries (M.)", () => {
    const out = [
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0",
      "1 M. N... 100644 100644 100644 abc def src/foo.ts",
      "1 A. N... 100644 100644 100644 abc def src/new.ts",
      "",
    ].join("\n");
    const r = parseGitPorcelainV2(out);
    expect(r.staged).toBe(2);
    expect(r.unstaged).toBe(0);
  });

  it("counts unstaged-only entries (.M)", () => {
    const out = [
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0",
      "1 .M N... 100644 100644 100644 abc def src/foo.ts",
      "1 .D N... 100644 100644 100644 abc def src/bar.ts",
      "",
    ].join("\n");
    const r = parseGitPorcelainV2(out);
    expect(r.staged).toBe(0);
    expect(r.unstaged).toBe(2);
  });

  it("counts mix as both staged and unstaged (MM)", () => {
    // A file with staged AND unstaged changes — half-finished commit.
    const out = [
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0",
      "1 MM N... 100644 100644 100644 abc def src/foo.ts",
      "",
    ].join("\n");
    const r = parseGitPorcelainV2(out);
    expect(r.staged).toBe(1);
    expect(r.unstaged).toBe(1);
  });

  it("counts untracked entries (?)", () => {
    const out = [
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0",
      "? new-file.ts",
      "? another.ts",
      "? src/something.tsx",
      "",
    ].join("\n");
    const r = parseGitPorcelainV2(out);
    expect(r.untracked).toBe(3);
    expect(r.staged).toBe(0);
    expect(r.unstaged).toBe(0);
  });

  it("handles renamed entries (line type '2 ')", () => {
    const out = [
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0",
      "2 R. N... 100644 100644 100644 abc def R100 src/new.ts\tsrc/old.ts",
      "",
    ].join("\n");
    const r = parseGitPorcelainV2(out);
    expect(r.staged).toBe(1);
    expect(r.unstaged).toBe(0);
  });

  it("ignores lines that don't match any expected prefix (forward-compat)", () => {
    const out = [
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0",
      "# some-future-header value",
      "u UU N... unmerged",  // unmerged entries — neither staged nor unstaged in our taxonomy
      "",
    ].join("\n");
    const r = parseGitPorcelainV2(out);
    expect(r).toEqual({
      staged: 0, unstaged: 0, untracked: 0,
      upstreamSet: true, ahead: 0, behind: 0,
    });
  });
});
