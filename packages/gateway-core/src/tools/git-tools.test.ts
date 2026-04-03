/**
 * Git Tools Tests
 *
 * Covers:
 * - git_status (createGitStatusHandler)
 * - git_diff (createGitDiffHandler)
 * - git_add (createGitAddHandler)
 * - git_commit (createGitCommitHandler)
 * - git_branch (createGitBranchHandler)
 *
 * Each test creates a temp directory with `git init` for isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createGitStatusHandler,
  createGitDiffHandler,
  createGitAddHandler,
  createGitCommitHandler,
  createGitBranchHandler,
} from "./git-tools.js";

// ---------------------------------------------------------------------------
// Shared temp git repo setup
// ---------------------------------------------------------------------------

let tmpDir: string;

function gitInit(dir: string): void {
  execFileSync("git", ["init"], { cwd: dir, encoding: "utf-8" });
  execFileSync("git", ["config", "user.email", "test@aionima.dev"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
}

function gitAdd(dir: string, path: string): void {
  execFileSync("git", ["add", path], { cwd: dir, encoding: "utf-8" });
}

function gitCommit(dir: string, message: string): void {
  execFileSync("git", ["commit", "-m", message], { cwd: dir, encoding: "utf-8" });
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "aionima-git-tools-"));
  gitInit(tmpDir);
  // Create an initial commit so HEAD exists
  writeFileSync(join(tmpDir, ".gitkeep"), "");
  gitAdd(tmpDir, ".gitkeep");
  gitCommit(tmpDir, "initial commit");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// git_status
// ---------------------------------------------------------------------------

describe("git_status — happy path", () => {
  it("returns clean status when no changes exist", async () => {
    const handler = createGitStatusHandler({ workspaceRoot: tmpDir });
    const raw = await handler({});
    const result = JSON.parse(raw) as { exitCode: number; stdout: string };
    expect(result.exitCode).toBe(0);
    // porcelain output has branch line but no file changes
    expect(result.stdout).toContain("## ");
  });

  it("shows untracked files", async () => {
    writeFileSync(join(tmpDir, "new-file.ts"), "const x = 1;");
    const handler = createGitStatusHandler({ workspaceRoot: tmpDir });
    const raw = await handler({});
    const result = JSON.parse(raw) as { exitCode: number; stdout: string };
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("?? new-file.ts");
  });

  it("shows staged files", async () => {
    writeFileSync(join(tmpDir, "staged.ts"), "export {};");
    gitAdd(tmpDir, "staged.ts");
    const handler = createGitStatusHandler({ workspaceRoot: tmpDir });
    const raw = await handler({});
    const result = JSON.parse(raw) as { exitCode: number; stdout: string };
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("A  staged.ts");
  });
});

// ---------------------------------------------------------------------------
// git_diff
// ---------------------------------------------------------------------------

describe("git_diff — happy path", () => {
  it("shows unstaged changes", async () => {
    writeFileSync(join(tmpDir, "file.txt"), "original");
    gitAdd(tmpDir, "file.txt");
    gitCommit(tmpDir, "add file");
    writeFileSync(join(tmpDir, "file.txt"), "modified");

    const handler = createGitDiffHandler({ workspaceRoot: tmpDir });
    const raw = await handler({});
    const result = JSON.parse(raw) as { exitCode: number; stdout: string };
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("modified");
  });

  it("shows staged changes with staged=true", async () => {
    writeFileSync(join(tmpDir, "staged-diff.txt"), "content");
    gitAdd(tmpDir, "staged-diff.txt");

    const handler = createGitDiffHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ staged: true });
    const result = JSON.parse(raw) as { exitCode: number; stdout: string };
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("staged-diff.txt");
  });

  it("scopes diff to a specific file path", async () => {
    writeFileSync(join(tmpDir, "a.txt"), "a");
    writeFileSync(join(tmpDir, "b.txt"), "b");
    gitAdd(tmpDir, "a.txt");
    gitAdd(tmpDir, "b.txt");
    gitCommit(tmpDir, "add both");
    writeFileSync(join(tmpDir, "a.txt"), "a-changed");
    writeFileSync(join(tmpDir, "b.txt"), "b-changed");

    const handler = createGitDiffHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: "a.txt" });
    const result = JSON.parse(raw) as { exitCode: number; stdout: string };
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("a-changed");
    expect(result.stdout).not.toContain("b-changed");
  });
});

describe("git_diff — workspace boundary", () => {
  it("rejects paths outside the workspace", async () => {
    const handler = createGitDiffHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: "../../etc/passwd" });
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("workspace boundary");
  });
});

// ---------------------------------------------------------------------------
// git_add
// ---------------------------------------------------------------------------

describe("git_add — happy path", () => {
  it("stages a single file", async () => {
    writeFileSync(join(tmpDir, "to-add.ts"), "export const y = 2;");
    const handler = createGitAddHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ paths: ["to-add.ts"] });
    const result = JSON.parse(raw) as { exitCode: number; added: string[] };
    expect(result.exitCode).toBe(0);
    expect(result.added).toContain("to-add.ts");
  });

  it("stages multiple files", async () => {
    writeFileSync(join(tmpDir, "x.ts"), "x");
    writeFileSync(join(tmpDir, "y.ts"), "y");
    const handler = createGitAddHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ paths: ["x.ts", "y.ts"] });
    const result = JSON.parse(raw) as { exitCode: number; added: string[] };
    expect(result.exitCode).toBe(0);
    expect(result.added).toHaveLength(2);
  });
});

describe("git_add — validation", () => {
  it("rejects empty paths array", async () => {
    const handler = createGitAddHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ paths: [] });
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("non-empty array");
  });

  it("rejects missing paths parameter", async () => {
    const handler = createGitAddHandler({ workspaceRoot: tmpDir });
    const raw = await handler({});
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("non-empty array");
  });
});

describe("git_add — workspace boundary", () => {
  it("rejects paths that escape the workspace", async () => {
    const handler = createGitAddHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ paths: ["../../etc/shadow"] });
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("workspace boundary");
  });
});

// ---------------------------------------------------------------------------
// git_commit
// ---------------------------------------------------------------------------

describe("git_commit — happy path", () => {
  it("creates a commit with the given message", async () => {
    writeFileSync(join(tmpDir, "commit-me.ts"), "export {};");
    gitAdd(tmpDir, "commit-me.ts");

    const handler = createGitCommitHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ message: "test commit message" });
    const result = JSON.parse(raw) as { exitCode: number; stdout: string };
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("test commit message");
  });
});

describe("git_commit — validation", () => {
  it("rejects empty commit message", async () => {
    const handler = createGitCommitHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ message: "" });
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("required");
  });

  it("rejects whitespace-only commit message", async () => {
    const handler = createGitCommitHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ message: "   " });
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("required");
  });

  it("sanitizes commit messages by stripping backticks and dollar signs", async () => {
    writeFileSync(join(tmpDir, "sanitize-test.ts"), "x");
    gitAdd(tmpDir, "sanitize-test.ts");

    const handler = createGitCommitHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ message: "safe `no backtick` $no_var" });
    const result = JSON.parse(raw) as { exitCode: number; stdout: string };
    // Should succeed — dangerous chars are stripped
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// git_branch
// ---------------------------------------------------------------------------

describe("git_branch — list", () => {
  it("lists branches including main/master", async () => {
    const handler = createGitBranchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ action: "list" });
    const result = JSON.parse(raw) as { exitCode: number; stdout: string };
    expect(result.exitCode).toBe(0);
    // Should show at least the current branch
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("defaults to list when action is not provided", async () => {
    const handler = createGitBranchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({});
    const result = JSON.parse(raw) as { exitCode: number; stdout: string };
    expect(result.exitCode).toBe(0);
  });
});

describe("git_branch — create", () => {
  it("creates a new branch", async () => {
    const handler = createGitBranchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ action: "create", name: "feature/test-branch" });
    const result = JSON.parse(raw) as { exitCode: number; branch: string };
    expect(result.exitCode).toBe(0);
    expect(result.branch).toBe("feature/test-branch");
  });

  it("rejects branch names with invalid characters", async () => {
    const handler = createGitBranchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ action: "create", name: "bad branch name!" });
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("disallowed characters");
  });

  it("rejects create without a branch name", async () => {
    const handler = createGitBranchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ action: "create" });
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("required");
  });
});

describe("git_branch — checkout", () => {
  it("checks out an existing branch", async () => {
    execFileSync("git", ["branch", "test-checkout"], { cwd: tmpDir });
    const handler = createGitBranchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ action: "checkout", name: "test-checkout" });
    const result = JSON.parse(raw) as { exitCode: number; branch: string };
    expect(result.exitCode).toBe(0);
    expect(result.branch).toBe("test-checkout");
  });

  it("rejects checkout without a branch name", async () => {
    const handler = createGitBranchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ action: "checkout" });
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("required");
  });
});

describe("git_branch — unknown action", () => {
  it("returns an error for unknown actions", async () => {
    const handler = createGitBranchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ action: "delete" });
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("Unknown action");
  });
});

// ---------------------------------------------------------------------------
// Blocked commands — cross-tool
// ---------------------------------------------------------------------------

describe("git tools — blocked operations", () => {
  it("git_branch rejects names with shell metacharacters", async () => {
    const handler = createGitBranchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ action: "create", name: "$(whoami)" });
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("disallowed characters");
  });
});
