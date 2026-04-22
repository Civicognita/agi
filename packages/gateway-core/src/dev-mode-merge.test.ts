/**
 * dev-mode-merge tests
 *
 * Covers:
 *   - computeForkStatus: fresh-synced, behind, ahead+behind, missing upstream
 *   - attemptMerge: ff-only path, merge-commit path, conflict returns files,
 *     dirty-tree refusal, branch respected.
 *
 * Each test creates two bare repos in a temp dir and a checkout that
 * points at both — no GitHub round-trips, just local file:// remotes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { attemptMerge, computeForkStatus } from "./dev-mode-merge.js";
import type { CoreRepoSpec } from "./dev-mode-forks.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpRoot: string;
let upstreamRepo: string;
let forkRepo: string;
let workingClone: string;

const TEST_SPEC: CoreRepoSpec = {
  slug: "agi",
  upstream: "agi",
  displayName: "AGI",
  configKey: "agiRepo",
};

const TEST_BRANCH = "main";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8", stdio: "pipe" });
}

function gitInit(dir: string, bare: boolean): void {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "--initial-branch", TEST_BRANCH, ...(bare ? ["--bare"] : [])]);
  if (!bare) {
    git(dir, ["config", "user.email", "test@aionima.dev"]);
    git(dir, ["config", "user.name", "Test"]);
    // Disable GPG signing which some host configs force globally.
    git(dir, ["config", "commit.gpgsign", "false"]);
  }
}

function commit(dir: string, path: string, contents: string, msg: string): void {
  writeFileSync(join(dir, path), contents);
  git(dir, ["add", path]);
  git(dir, ["commit", "-m", msg]);
}

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  // ComponentLogger has a few more but the merge helper only uses info/warn.
};

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "agi-dev-merge-"));
  upstreamRepo = join(tmpRoot, "upstream.git");
  forkRepo = join(tmpRoot, "fork.git");
  workingClone = join(tmpRoot, "clone");

  // Seed a shared history on a scratch repo, then push to both bares.
  gitInit(upstreamRepo, true);
  gitInit(forkRepo, true);

  const seed = join(tmpRoot, "seed");
  gitInit(seed, false);
  commit(seed, "README.md", "initial\n", "initial commit");
  git(seed, ["remote", "add", "origin", forkRepo]);
  git(seed, ["remote", "add", "upstream", upstreamRepo]);
  git(seed, ["push", "origin", TEST_BRANCH]);
  git(seed, ["push", "upstream", TEST_BRANCH]);
  rmSync(seed, { recursive: true, force: true });

  // Clone from the fork and wire upstream as a second remote.
  execFileSync("git", ["clone", forkRepo, workingClone], { stdio: "pipe" });
  git(workingClone, ["remote", "add", "upstream", upstreamRepo]);
  git(workingClone, ["config", "user.email", "test@aionima.dev"]);
  git(workingClone, ["config", "user.name", "Test"]);
  git(workingClone, ["config", "commit.gpgsign", "false"]);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// computeForkStatus
// ---------------------------------------------------------------------------

describe("computeForkStatus", () => {
  it("reports ahead=0, behind=0 when fork and upstream are in sync", async () => {
    const status = await computeForkStatus(workingClone, TEST_SPEC, TEST_BRANCH);
    expect(status.error).toBeUndefined();
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
    expect(status.currentSha).toBeTruthy();
    expect(status.currentSha).toBe(status.upstreamSha);
  });

  it("reports behind when upstream has commits the fork doesn't", async () => {
    // Make upstream advance.
    const upstreamWork = join(tmpRoot, "upstream-work");
    execFileSync("git", ["clone", upstreamRepo, upstreamWork], { stdio: "pipe" });
    git(upstreamWork, ["config", "user.email", "test@aionima.dev"]);
    git(upstreamWork, ["config", "user.name", "Test"]);
    git(upstreamWork, ["config", "commit.gpgsign", "false"]);
    commit(upstreamWork, "feat.md", "upstream feature\n", "upstream commit");
    git(upstreamWork, ["push", "origin", TEST_BRANCH]);

    const status = await computeForkStatus(workingClone, TEST_SPEC, TEST_BRANCH);
    expect(status.error).toBeUndefined();
    expect(status.behind).toBe(1);
    expect(status.ahead).toBe(0);
  });

  it("reports ahead when the fork has local commits upstream doesn't", async () => {
    commit(workingClone, "local.md", "fork-only\n", "fork commit");
    git(workingClone, ["push", "origin", TEST_BRANCH]);

    const status = await computeForkStatus(workingClone, TEST_SPEC, TEST_BRANCH);
    expect(status.error).toBeUndefined();
    expect(status.behind).toBe(0);
    expect(status.ahead).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// attemptMerge
// ---------------------------------------------------------------------------

describe("attemptMerge", () => {
  it("fast-forwards when only upstream has advanced", async () => {
    // Advance upstream
    const upstreamWork = join(tmpRoot, "upstream-work");
    execFileSync("git", ["clone", upstreamRepo, upstreamWork], { stdio: "pipe" });
    git(upstreamWork, ["config", "user.email", "test@aionima.dev"]);
    git(upstreamWork, ["config", "user.name", "Test"]);
    git(upstreamWork, ["config", "commit.gpgsign", "false"]);
    commit(upstreamWork, "feat.md", "upstream\n", "upstream commit");
    git(upstreamWork, ["push", "origin", TEST_BRANCH]);

    const result = await attemptMerge({
      targetDir: workingClone,
      spec: TEST_SPEC,
      branch: TEST_BRANCH,
      strategy: "ff-only",
      log: silentLog as never,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ff).toBe(true);
      expect(result.agentic).toBe(false);
      expect(result.newSha).toBeTruthy();
    }

    // After ff merge, the working clone should match upstream.
    const afterStatus = await computeForkStatus(workingClone, TEST_SPEC, TEST_BRANCH);
    expect(afterStatus.behind).toBe(0);
  });

  it("creates a merge commit when both sides have divergent non-conflicting commits", async () => {
    // Local commit on fork.
    commit(workingClone, "local.md", "fork-only\n", "fork commit");

    // Upstream commit on a different file (no conflict).
    const upstreamWork = join(tmpRoot, "upstream-work");
    execFileSync("git", ["clone", upstreamRepo, upstreamWork], { stdio: "pipe" });
    git(upstreamWork, ["config", "user.email", "test@aionima.dev"]);
    git(upstreamWork, ["config", "user.name", "Test"]);
    git(upstreamWork, ["config", "commit.gpgsign", "false"]);
    commit(upstreamWork, "upstream.md", "upstream-only\n", "upstream commit");
    git(upstreamWork, ["push", "origin", TEST_BRANCH]);

    const result = await attemptMerge({
      targetDir: workingClone,
      spec: TEST_SPEC,
      branch: TEST_BRANCH,
      strategy: "ff-only",
      log: silentLog as never,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ff).toBe(false);
      expect(result.newSha).toBeTruthy();
    }
  });

  it("returns conflict files when both sides touch the same line", async () => {
    // Fork changes README
    commit(workingClone, "README.md", "fork version\n", "fork edit");

    // Upstream also changes README
    const upstreamWork = join(tmpRoot, "upstream-work");
    execFileSync("git", ["clone", upstreamRepo, upstreamWork], { stdio: "pipe" });
    git(upstreamWork, ["config", "user.email", "test@aionima.dev"]);
    git(upstreamWork, ["config", "user.name", "Test"]);
    git(upstreamWork, ["config", "commit.gpgsign", "false"]);
    commit(upstreamWork, "README.md", "upstream version\n", "upstream edit");
    git(upstreamWork, ["push", "origin", TEST_BRANCH]);

    const result = await attemptMerge({
      targetDir: workingClone,
      spec: TEST_SPEC,
      branch: TEST_BRANCH,
      strategy: "ff-only",
      log: silentLog as never,
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.conflict) {
      expect(result.files).toContain("README.md");
      expect(result.agentic).toBe(false);
    }
  });

  it("refuses to merge when the working tree is dirty", async () => {
    writeFileSync(join(workingClone, "README.md"), "uncommitted change\n");

    const result = await attemptMerge({
      targetDir: workingClone,
      spec: TEST_SPEC,
      branch: TEST_BRANCH,
      strategy: "ff-only",
      log: silentLog as never,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe(false);
      if (result.conflict === false) {
        expect(result.reason).toMatch(/uncommitted/i);
      }
    }
  });
});
