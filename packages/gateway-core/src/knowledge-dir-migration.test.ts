/**
 * knowledge-dir-migration tests — owner directive 2026-06-09 (k/ → .ai/).
 * Pure-logic; runs on host. Uses real temp dirs under os.tmpdir().
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { KNOWLEDGE_DIR } from "./project-config-path.js";
import {
  migrateKnowledgeDirName,
  migrateAllKnowledgeDirs,
} from "./knowledge-dir-migration.js";

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `kdir-mig-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Build a project dir containing a legacy `k/` with one nested file. */
function projectWithLegacyK(name: string): string {
  const proj = join(tmp, name);
  mkdirSync(join(proj, "k", "plans"), { recursive: true });
  writeFileSync(join(proj, "k", "plans", "p1.mdc"), "hello", "utf-8");
  return proj;
}

describe("migrateKnowledgeDirName", () => {
  it("renames k/ → .ai/ and preserves nested content", () => {
    const proj = projectWithLegacyK("proj-a");
    const r = migrateKnowledgeDirName(proj);

    expect(r.status).toBe("renamed");
    expect(existsSync(join(proj, "k"))).toBe(false);
    expect(existsSync(join(proj, KNOWLEDGE_DIR))).toBe(true);
    expect(readFileSync(join(proj, KNOWLEDGE_DIR, "plans", "p1.mdc"), "utf-8")).toBe("hello");
  });

  it("is a no-op when k/ is absent (clean install / already on .ai)", () => {
    const proj = join(tmp, "proj-clean");
    mkdirSync(join(proj, KNOWLEDGE_DIR), { recursive: true });
    const r = migrateKnowledgeDirName(proj);
    expect(r.status).toBe("absent");
    expect(existsSync(join(proj, KNOWLEDGE_DIR))).toBe(true);
  });

  it("never clobbers: when BOTH k/ and .ai/ exist, leaves k/ and reports conflict", () => {
    const proj = projectWithLegacyK("proj-both");
    mkdirSync(join(proj, KNOWLEDGE_DIR, "memory"), { recursive: true });
    writeFileSync(join(proj, KNOWLEDGE_DIR, "memory", "m.md"), "new-side", "utf-8");

    const r = migrateKnowledgeDirName(proj);

    expect(r.status).toBe("conflict");
    // Both dirs survive untouched — owner inspects manually.
    expect(existsSync(join(proj, "k", "plans", "p1.mdc"))).toBe(true);
    expect(readFileSync(join(proj, KNOWLEDGE_DIR, "memory", "m.md"), "utf-8")).toBe("new-side");
  });

  it("is idempotent — second call after a rename is a clean no-op", () => {
    const proj = projectWithLegacyK("proj-idem");
    expect(migrateKnowledgeDirName(proj).status).toBe("renamed");
    expect(migrateKnowledgeDirName(proj).status).toBe("absent");
  });
});

describe("migrateAllKnowledgeDirs", () => {
  it("renames k/ across hosted projects, the meta-project, and dotted skeleton dirs", () => {
    // A collection dir with two regular projects, a `_aionima` meta-project,
    // and a `.new` skeleton seed — all carrying a legacy k/.
    const collection = join(tmp, "workspace");
    mkdirSync(collection, { recursive: true });
    for (const name of ["alpha", "beta", "_aionima", ".new"]) {
      mkdirSync(join(collection, name, "k"), { recursive: true });
      writeFileSync(join(collection, name, "k", ".gitkeep"), "", "utf-8");
    }

    const result = migrateAllKnowledgeDirs([collection]);

    expect(result.renamed).toBe(4);
    for (const name of ["alpha", "beta", "_aionima", ".new"]) {
      expect(existsSync(join(collection, name, "k"))).toBe(false);
      expect(existsSync(join(collection, name, KNOWLEDGE_DIR))).toBe(true);
    }
  });

  it("aggregates conflicts without throwing", () => {
    const collection = join(tmp, "ws2");
    const proj = join(collection, "p");
    mkdirSync(join(proj, "k"), { recursive: true });
    mkdirSync(join(proj, KNOWLEDGE_DIR), { recursive: true });

    const result = migrateAllKnowledgeDirs([collection]);
    expect(result.conflicts).toBe(1);
    expect(result.renamed).toBe(0);
  });
});
