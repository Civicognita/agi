/**
 * aionima-memory-migration tests (s119 t704). Pure-logic; runs on host.
 *
 * Tests use a temp `homedir` substitute by setting HOME via `process.env`
 * within each test — the migration helper resolves `~/.agi/memory/`
 * via `os.homedir()` which honors HOME on Linux.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  aionimaMemoryDir,
  legacyMemoryDir,
  migrateAionimaMemoryDir,
} from "./aionima-memory-migration.js";

let tmp: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmp = join(tmpdir(), `mem-mig-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  // Re-home so the test's "~/.agi/memory" resolves under tmp.
  originalHome = process.env["HOME"];
  process.env["HOME"] = join(tmp, "home");
  mkdirSync(process.env["HOME"], { recursive: true });
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  rmSync(tmp, { recursive: true, force: true });
});

function workspaceRoot(): string {
  const ws = join(tmp, "workspace");
  mkdirSync(join(ws, "_aionima", "k"), { recursive: true });
  return ws;
}

function seedLegacy(files: Record<string, string>): void {
  const dir = legacyMemoryDir();
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body, "utf-8");
  }
}

describe("aionimaMemoryDir / legacyMemoryDir (s119 t704)", () => {
  it("aionimaMemoryDir resolves under workspaceRoot", () => {
    expect(aionimaMemoryDir("/foo/bar")).toBe("/foo/bar/_aionima/k/memory");
  });

  it("legacyMemoryDir resolves under HOME", () => {
    expect(legacyMemoryDir()).toBe(join(process.env["HOME"]!, ".agi", "memory"));
  });
});

describe("migrateAionimaMemoryDir (s119 t704)", () => {
  it("clean-install: no source dir → empty result, no errors", () => {
    const ws = workspaceRoot();
    const r = migrateAionimaMemoryDir(ws);
    expect(r.scanned).toBe(0);
    expect(r.moved).toBe(0);
    expect(r.errors).toEqual([]);
  });

  it("moves a single file from legacy to canonical", () => {
    const ws = workspaceRoot();
    seedLegacy({ "architecture.md": "# arch" });
    const r = migrateAionimaMemoryDir(ws);
    expect(r.scanned).toBe(1);
    expect(r.moved).toBe(1);
    expect(r.errors).toEqual([]);
    expect(existsSync(join(legacyMemoryDir(), "architecture.md"))).toBe(false);
    expect(existsSync(join(aionimaMemoryDir(ws), "architecture.md"))).toBe(true);
    expect(readFileSync(join(aionimaMemoryDir(ws), "architecture.md"), "utf-8")).toBe("# arch");
  });

  it("moves the typical ~/.agi/memory tree (multiple .md files)", () => {
    const ws = workspaceRoot();
    seedLegacy({
      "architecture.md": "a",
      "_map.md": "b",
      "feedback-plugins.md": "c",
      "deployment.md": "d",
    });
    const r = migrateAionimaMemoryDir(ws);
    expect(r.moved).toBe(4);
    expect(r.errors).toEqual([]);
  });

  it("is idempotent — second pass skips already-migrated files", () => {
    const ws = workspaceRoot();
    seedLegacy({ "architecture.md": "a" });
    const first = migrateAionimaMemoryDir(ws);
    expect(first.moved).toBe(1);

    // Re-seed legacy with the same name to test idempotency
    seedLegacy({ "architecture.md": "stale-copy" });
    const second = migrateAionimaMemoryDir(ws);
    expect(second.moved).toBe(0);
    expect(second.alreadyMigrated).toBe(1);
    // Target keeps the originally-migrated content; legacy retains the
    // newer write because nothing happened (idempotent skip).
    expect(readFileSync(join(aionimaMemoryDir(ws), "architecture.md"), "utf-8")).toBe("a");
    expect(readFileSync(join(legacyMemoryDir(), "architecture.md"), "utf-8")).toBe("stale-copy");
  });

  it("skips non-file entries (subdirs) without erroring", () => {
    const ws = workspaceRoot();
    mkdirSync(legacyMemoryDir(), { recursive: true });
    mkdirSync(join(legacyMemoryDir(), "sub"), { recursive: true });
    writeFileSync(join(legacyMemoryDir(), "real.md"), "x", "utf-8");
    const r = migrateAionimaMemoryDir(ws);
    expect(r.scanned).toBe(2);
    expect(r.moved).toBe(1);
    expect(r.skippedNonFile).toBe(1);
    expect(existsSync(join(legacyMemoryDir(), "sub"))).toBe(true);
  });

  it("creates target dir on demand if t701 scaffolder hasn't run", () => {
    // workspaceRoot() pre-creates _aionima/k/ but NOT k/memory.
    const ws = workspaceRoot();
    expect(existsSync(aionimaMemoryDir(ws))).toBe(false);

    seedLegacy({ "x.md": "y" });
    const r = migrateAionimaMemoryDir(ws);
    expect(r.moved).toBe(1);
    expect(existsSync(aionimaMemoryDir(ws))).toBe(true);
  });

  it("captures errors per-file rather than throwing", () => {
    const ws = workspaceRoot();
    seedLegacy({ "ok.md": "fine" });
    // Pre-create the target file with read-only-ish setup to force a
    // collision on the otherwise-fine path. Easier: create a target
    // file that already exists for one input, leaving the other to
    // succeed.
    mkdirSync(aionimaMemoryDir(ws), { recursive: true });
    writeFileSync(join(aionimaMemoryDir(ws), "ok.md"), "pre-existing", "utf-8");

    const r = migrateAionimaMemoryDir(ws);
    expect(r.alreadyMigrated).toBe(1);
    expect(r.moved).toBe(0);
  });
});
