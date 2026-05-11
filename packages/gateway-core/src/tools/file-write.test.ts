/**
 * file_write tests — root-write protection (s134 cycle 198).
 *
 * Owner directive 2026-05-11: "Aion should not be able to create files
 * directly in the project root, we want to keep that clean with only
 * the folders and project.json file in the root."
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createFileWriteHandler } from "./file-write.js";

let workspace: string;
let project: string;
let handler: (input: Record<string, unknown>) => Promise<string> | string;

beforeEach(() => {
  workspace = join(tmpdir(), `file-write-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(workspace, { recursive: true });
  project = join(workspace, "myproj");
  mkdirSync(project, { recursive: true });
  mkdirSync(join(project, "k"), { recursive: true });
  handler = createFileWriteHandler({
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

async function call(input: Record<string, unknown>): Promise<{ path?: string; bytesWritten?: number; error?: string }> {
  return JSON.parse(await Promise.resolve(handler(input)));
}

describe("file_write root-write protection (s134 cycle 198)", () => {
  it("allows project.json at the project root", async () => {
    const r = await call({ path: "project.json", content: "{\"name\":\"x\"}" });
    expect(r.error).toBeUndefined();
    expect(existsSync(join(project, "project.json"))).toBe(true);
  });

  it("rejects arbitrary file at the project root", async () => {
    const r = await call({ path: "stray.md", content: "hello" });
    expect(r.error).toMatch(/project root.*not allowed/i);
    expect(existsSync(join(project, "stray.md"))).toBe(false);
  });

  it("rejects rogue .env at project root", async () => {
    const r = await call({ path: ".env", content: "SECRET=1" });
    expect(r.error).toMatch(/project root.*not allowed/i);
  });

  it("allows files inside k/ subfolder", async () => {
    const r = await call({ path: "k/note.md", content: "# note" });
    expect(r.error).toBeUndefined();
    expect(readFileSync(join(project, "k", "note.md"), "utf-8")).toBe("# note");
  });

  it("allows files inside nested subfolders with create_dirs", async () => {
    const r = await call({ path: "k/plans/2026-05-11/index.md", content: "plan", create_dirs: true });
    expect(r.error).toBeUndefined();
    expect(existsSync(join(project, "k", "plans", "2026-05-11", "index.md"))).toBe(true);
  });

  it("still gates paths outside the cage", async () => {
    const r = await call({ path: "/tmp/escape", content: "no" });
    expect(r.error).toMatch(/outside the project cage/);
  });
});
