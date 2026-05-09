/**
 * aionima-system-migration tests (s119 t703). Pure-logic; runs on host.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  AIONIMA_SYSTEM_FORK_NAMES,
  migrateAionimaSystemForks,
} from "./aionima-system-migration.js";

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `aionima-mig-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  // Pre-scaffold the post-t701 layout: _aionima/ + _aionima/repos/
  mkdirSync(join(tmp, "_aionima", "repos"), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeFakeFork(forkName: string): string {
  const path = join(tmp, "_aionima", forkName);
  mkdirSync(path, { recursive: true });
  // Sanity-check requires a .git/ dir
  mkdirSync(join(path, ".git"), { recursive: true });
  // Add a marker file so we can verify the move preserved contents
  writeFileSync(join(path, "marker.txt"), `${forkName}-marker`, "utf-8");
  return path;
}

describe("AIONIMA_SYSTEM_FORK_NAMES (s119 t703)", () => {
  it("contains the 5 Civicognita cores + 6 PAx packages", () => {
    expect(AIONIMA_SYSTEM_FORK_NAMES).toContain("agi");
    expect(AIONIMA_SYSTEM_FORK_NAMES).toContain("prime");
    expect(AIONIMA_SYSTEM_FORK_NAMES).toContain("id");
    expect(AIONIMA_SYSTEM_FORK_NAMES).toContain("marketplace");
    expect(AIONIMA_SYSTEM_FORK_NAMES).toContain("mapp-marketplace");
    expect(AIONIMA_SYSTEM_FORK_NAMES).toContain("react-fancy");
    expect(AIONIMA_SYSTEM_FORK_NAMES).toContain("fancy-code");
    expect(AIONIMA_SYSTEM_FORK_NAMES).toContain("fancy-sheets");
    expect(AIONIMA_SYSTEM_FORK_NAMES).toContain("fancy-echarts");
    expect(AIONIMA_SYSTEM_FORK_NAMES).toContain("fancy-3d");
    expect(AIONIMA_SYSTEM_FORK_NAMES).toContain("fancy-screens");
    expect(AIONIMA_SYSTEM_FORK_NAMES).toHaveLength(11);
  });
});

describe("migrateAionimaSystemForks (s119 t703)", () => {
  it("moves a single fork from _aionima/<name> to _aionima/repos/<name>", () => {
    const oldPath = makeFakeFork("agi");
    const newPath = join(tmp, "_aionima", "repos", "agi");

    expect(existsSync(oldPath)).toBe(true);
    expect(existsSync(newPath)).toBe(false);

    const r = migrateAionimaSystemForks(tmp);
    expect(r.moved).toBe(1);
    expect(r.errors).toEqual([]);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(newPath)).toBe(true);
    expect(existsSync(join(newPath, ".git"))).toBe(true);
    expect(existsSync(join(newPath, "marker.txt"))).toBe(true);
  });

  it("moves all 5 Civicognita cores in one pass", () => {
    for (const name of ["agi", "prime", "id", "marketplace", "mapp-marketplace"]) {
      makeFakeFork(name);
    }
    const r = migrateAionimaSystemForks(tmp);
    expect(r.moved).toBe(5);
    expect(r.errors).toEqual([]);
    for (const name of ["agi", "prime", "id", "marketplace", "mapp-marketplace"]) {
      expect(existsSync(join(tmp, "_aionima", "repos", name))).toBe(true);
      expect(existsSync(join(tmp, "_aionima", name))).toBe(false);
    }
  });

  it("is idempotent — second pass leaves migrated forks alone", () => {
    makeFakeFork("agi");
    const first = migrateAionimaSystemForks(tmp);
    expect(first.moved).toBe(1);

    const second = migrateAionimaSystemForks(tmp);
    expect(second.moved).toBe(0);
    expect(second.alreadyMigrated).toBe(1);
  });

  it("skips forks not present in this install without erroring", () => {
    makeFakeFork("agi"); // only one fork
    const r = migrateAionimaSystemForks(tmp);
    expect(r.moved).toBe(1);
    expect(r.notPresent).toBe(AIONIMA_SYSTEM_FORK_NAMES.length - 1);
    expect(r.errors).toEqual([]);
  });

  it("refuses to move a directory that has no .git — captures an error per fork", () => {
    // Create _aionima/agi without a .git/ dir
    mkdirSync(join(tmp, "_aionima", "agi"), { recursive: true });
    writeFileSync(join(tmp, "_aionima", "agi", "marker.txt"), "no-git", "utf-8");

    const r = migrateAionimaSystemForks(tmp);
    expect(r.moved).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.name).toBe("agi");
    expect(r.errors[0]?.reason).toContain("no .git/");
    // Old path untouched
    expect(existsSync(join(tmp, "_aionima", "agi"))).toBe(true);
  });

  it("returns a precondition error when _aionima/repos/ doesn't exist", () => {
    rmSync(join(tmp, "_aionima"), { recursive: true, force: true });
    const r = migrateAionimaSystemForks(tmp);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.reason).toContain("missing");
    expect(r.moved).toBe(0);
  });

  it("captures errors per-fork rather than throwing on first failure", () => {
    // Two forks: one valid, one without .git/ to trigger an error.
    makeFakeFork("agi"); // OK
    mkdirSync(join(tmp, "_aionima", "prime"), { recursive: true });
    writeFileSync(join(tmp, "_aionima", "prime", "f.txt"), "x", "utf-8");

    const r = migrateAionimaSystemForks(tmp);
    expect(r.moved).toBe(1); // agi succeeds
    expect(r.errors).toHaveLength(1); // prime fails
    expect(r.errors[0]?.name).toBe("prime");
  });
});
