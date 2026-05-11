/**
 * dir_create tests (s134 cycle 198).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createDirCreateHandler } from "./dir-create.js";

let workspace: string;
let project: string;
let handler: (input: Record<string, unknown>) => Promise<string> | string;

beforeEach(() => {
  workspace = join(tmpdir(), `dir-create-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(workspace, { recursive: true });
  project = join(workspace, "myproj");
  mkdirSync(project, { recursive: true });
  handler = createDirCreateHandler({
    workspaceRoot: workspace,
    cageProvider: () => ({
      allowedPrefixes: [project, join(project, ".agi"), join(project, "k"), join(project, "repos"), join(project, ".trash")],
      opsModeWidened: false,
      askUserQuestionEscape: true,
    }),
  });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function call(input: Record<string, unknown>): Promise<{ path?: string; error?: string; recursive?: boolean }> {
  return JSON.parse(await Promise.resolve(handler(input)));
}

describe("dir_create (s134 cycle 198)", () => {
  it("creates a new directory at a relative path in k/", async () => {
    const r = await call({ path: "k/plans" });
    expect(r.error).toBeUndefined();
    expect(existsSync(join(project, "k", "plans"))).toBe(true);
    expect(statSync(join(project, "k", "plans")).isDirectory()).toBe(true);
  });

  it("creates nested directories with recursive=true (default)", async () => {
    const r = await call({ path: "k/plans/2026-05-11" });
    expect(r.error).toBeUndefined();
    expect(existsSync(join(project, "k", "plans", "2026-05-11"))).toBe(true);
  });

  it("succeeds at the project root (mkdir of new top-level folder)", async () => {
    const r = await call({ path: "sandbox" });
    expect(r.error).toBeUndefined();
    expect(existsSync(join(project, "sandbox"))).toBe(true);
  });

  it("rejects path outside the cage", async () => {
    const r = await call({ path: "/tmp/escape-attempt" });
    expect(r.error).toMatch(/outside the project cage/);
    expect(existsSync("/tmp/escape-attempt")).toBe(false);
  });

  it("rejects empty path", async () => {
    const r = await call({ path: "" });
    expect(r.error).toMatch(/path is required/);
  });

  it("is idempotent on existing directory", async () => {
    await call({ path: "k/plans" });
    const r = await call({ path: "k/plans" });
    expect(r.error).toBeUndefined();
    expect(r.path).toBe(join(project, "k", "plans"));
  });
});
