/**
 * project-config-shape-migration tests — verifies the s150 t632 sweep:
 *   1. Drops top-level `category`
 *   2. Drops `hosting.containerKind`
 *   3. Derives top-level `type` from `hosting.type` / `category`
 *   4. Removes `.agi/project.json` debris
 * and is idempotent on re-runs.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  migrateAllProjectConfigShapes,
  migrateProjectConfigShape,
} from "./project-config-shape-migration.js";

describe("migrateProjectConfigShape", () => {
  let tmpRoot: string;
  let projectPath: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `shape-mig-${String(Date.now())}-${String(Math.random()).slice(2)}`);
    projectPath = join(tmpRoot, "myproject");
    mkdirSync(projectPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeConfig(obj: unknown, dir: string = projectPath, name = "project.json"): string {
    const p = join(dir, name);
    writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, "utf-8");
    return p;
  }

  function readConfig(dir: string = projectPath, name = "project.json"): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, name), "utf-8")) as Record<string, unknown>;
  }

  it("strips top-level category and rewrites the file", () => {
    writeConfig({
      name: "demo",
      type: "web-app",
      category: "web",
      hosting: { enabled: true, type: "web-app", hostname: "demo" },
    });

    const r = migrateProjectConfigShape(projectPath);

    expect(r.configRewritten).toBe(true);
    expect(r.droppedCategory).toBe("web");
    expect(r.derivedType).toBeUndefined();
    const after = readConfig();
    expect(after.category).toBeUndefined();
    expect(after.type).toBe("web-app");
  });

  it("strips hosting.containerKind", () => {
    writeConfig({
      name: "demo",
      type: "ops",
      hosting: { enabled: true, type: "static-site", hostname: "demo", containerKind: "mapp" },
    });

    const r = migrateProjectConfigShape(projectPath);

    expect(r.configRewritten).toBe(true);
    expect(r.droppedContainerKind).toBe("mapp");
    const after = readConfig();
    const hosting = after.hosting as Record<string, unknown>;
    expect("containerKind" in hosting).toBe(false);
    expect(hosting.type).toBe("static-site");
  });

  it("derives top-level type from hosting.type when missing", () => {
    writeConfig({
      name: "demo",
      hosting: { enabled: true, type: "web-app", hostname: "demo" },
    });

    const r = migrateProjectConfigShape(projectPath);

    expect(r.configRewritten).toBe(true);
    expect(r.derivedType).toEqual({ value: "web-app", source: "hosting.type" });
    expect(readConfig().type).toBe("web-app");
  });

  it("derives top-level type from category when hosting.type is absent", () => {
    writeConfig({
      name: "demo",
      category: "literature",
    });

    const r = migrateProjectConfigShape(projectPath);

    expect(r.configRewritten).toBe(true);
    expect(r.derivedType).toEqual({ value: "writing", source: "category" });
    expect(r.droppedCategory).toBe("literature");
    const after = readConfig();
    expect(after.type).toBe("writing");
    expect(after.category).toBeUndefined();
  });

  it("falls back to static-site when neither hosting.type nor a known category is present", () => {
    writeConfig({ name: "demo" });

    const r = migrateProjectConfigShape(projectPath);

    expect(r.configRewritten).toBe(true);
    expect(r.derivedType).toEqual({ value: "static-site", source: "default" });
    expect(readConfig().type).toBe("static-site");
  });

  it("removes .agi/project.json debris and rmdirs the empty .agi/", () => {
    writeConfig({ name: "demo", type: "web-app", hosting: { enabled: false, type: "web-app", hostname: "demo" } });
    const agiDir = join(projectPath, ".agi");
    mkdirSync(agiDir, { recursive: true });
    writeConfig({ name: "demo-stale" }, agiDir);

    const r = migrateProjectConfigShape(projectPath);

    expect(r.agiDebrisRemoved).toBe(true);
    expect(existsSync(join(agiDir, "project.json"))).toBe(false);
    expect(existsSync(agiDir)).toBe(false); // empty dir was rmdir'd
  });

  it("leaves a non-empty .agi/ directory in place after removing the stale config", () => {
    writeConfig({ name: "demo", type: "web-app", hosting: { enabled: false, type: "web-app", hostname: "demo" } });
    const agiDir = join(projectPath, ".agi");
    mkdirSync(agiDir, { recursive: true });
    writeConfig({ name: "demo-stale" }, agiDir);
    writeFileSync(join(agiDir, "other.txt"), "keep me", "utf-8");

    const r = migrateProjectConfigShape(projectPath);

    expect(r.agiDebrisRemoved).toBe(true);
    expect(existsSync(agiDir)).toBe(true); // sibling file kept the dir alive
    expect(existsSync(join(agiDir, "other.txt"))).toBe(true);
    expect(existsSync(join(agiDir, "project.json"))).toBe(false);
  });

  it("is idempotent — running twice on a clean shape touches nothing the second time", () => {
    writeConfig({
      name: "demo",
      type: "web-app",
      category: "web",
      hosting: { enabled: true, type: "web-app", hostname: "demo", containerKind: "code" },
    });

    const first = migrateProjectConfigShape(projectPath);
    expect(first.configRewritten).toBe(true);

    const second = migrateProjectConfigShape(projectPath);
    expect(second.configRewritten).toBe(false);
    expect(second.agiDebrisRemoved).toBe(false);
    expect(second.droppedCategory).toBeUndefined();
    expect(second.droppedContainerKind).toBeUndefined();
    expect(second.derivedType).toBeUndefined();
  });

  it("preserves unrelated keys at the root and inside hosting", () => {
    writeConfig({
      name: "demo",
      type: "web-app",
      category: "web",
      tynnToken: "rpk_keep",
      magicApps: ["reader"],
      hosting: {
        enabled: true,
        type: "web-app",
        hostname: "demo",
        containerKind: "code",
        port: 4001,
        runtimeId: "node-24",
      },
    });

    migrateProjectConfigShape(projectPath);

    const after = readConfig();
    expect(after.tynnToken).toBe("rpk_keep");
    expect(after.magicApps).toEqual(["reader"]);
    const hosting = after.hosting as Record<string, unknown>;
    expect(hosting.port).toBe(4001);
    expect(hosting.runtimeId).toBe("node-24");
    expect("containerKind" in hosting).toBe(false);
  });

  it("reports an error and does not throw on unparseable project.json", () => {
    writeFileSync(join(projectPath, "project.json"), "{not valid json", "utf-8");
    const r = migrateProjectConfigShape(projectPath);
    expect(r.error).toBeDefined();
    expect(r.configRewritten).toBe(false);
  });

  it("returns a no-op when project.json is absent and there is no debris", () => {
    const r = migrateProjectConfigShape(projectPath);
    expect(r.configRewritten).toBe(false);
    expect(r.agiDebrisRemoved).toBe(false);
    expect(r.error).toBeUndefined();
  });

  it("skips sacred project paths (e.g. _aionima)", () => {
    const sacred = join(tmpRoot, "_aionima");
    mkdirSync(sacred, { recursive: true });
    writeConfig({ name: "AGI", type: "aionima", category: "monorepo" }, sacred);

    const r = migrateProjectConfigShape(sacred);

    expect(r.configRewritten).toBe(false);
    expect(readConfig(sacred).category).toBe("monorepo"); // untouched
  });

  // s150 t635 — stack-strip pass for Desktop-served projects
  describe("Desktop-served stack strip (s150 t635)", () => {
    it("strips hosting.stacks[] when isDesktopServedType returns true", () => {
      writeConfig({
        name: "demo",
        type: "ops",
        hosting: {
          enabled: true,
          type: "static-site",
          hostname: "demo",
          stacks: [
            { stackId: "stack-static-hosting", addedAt: "2026-04-01T00:00:00Z" },
            { stackId: "stack-foo", addedAt: "2026-04-02T00:00:00Z" },
          ],
        },
      });

      const r = migrateProjectConfigShape(projectPath, {
        isDesktopServedType: (t) => t === "ops",
      });

      expect(r.configRewritten).toBe(true);
      expect(r.strippedStacks).toEqual(["stack-static-hosting", "stack-foo"]);
      const after = readConfig();
      const hosting = after.hosting as Record<string, unknown>;
      expect(hosting.stacks).toEqual([]);
    });

    it("preserves hosting.stacks[] for code-served projects", () => {
      writeConfig({
        name: "demo",
        type: "web-app",
        hosting: {
          enabled: true,
          type: "web-app",
          hostname: "demo",
          stacks: [{ stackId: "stack-nextjs", addedAt: "2026-04-01T00:00:00Z" }],
        },
      });

      const r = migrateProjectConfigShape(projectPath, {
        isDesktopServedType: (t) => t === "ops", // not web-app
      });

      expect(r.strippedStacks).toBeUndefined();
      const after = readConfig();
      const hosting = after.hosting as Record<string, unknown>;
      expect(hosting.stacks).toEqual([{ stackId: "stack-nextjs", addedAt: "2026-04-01T00:00:00Z" }]);
    });

    it("is a no-op when isDesktopServedType is not provided", () => {
      writeConfig({
        name: "demo",
        type: "ops",
        hosting: {
          enabled: true,
          type: "static-site",
          hostname: "demo",
          stacks: [{ stackId: "stack-static-hosting", addedAt: "2026-04-01T00:00:00Z" }],
        },
      });

      const r = migrateProjectConfigShape(projectPath); // no opts
      expect(r.strippedStacks).toBeUndefined();
      const after = readConfig();
      const hosting = after.hosting as Record<string, unknown>;
      expect(hosting.stacks).toHaveLength(1);
    });

    it("remaps retired type='monorepo' to 'web-app' (s150 t640)", () => {
      writeConfig({
        name: "demo",
        type: "monorepo",
        hosting: {
          enabled: true,
          type: "monorepo",
          hostname: "demo",
        },
      });

      const r = migrateProjectConfigShape(projectPath);

      expect(r.configRewritten).toBe(true);
      expect(r.remappedType).toEqual({ from: "monorepo", to: "web-app" });
      const after = readConfig();
      expect(after.type).toBe("web-app");
      const hosting = after.hosting as Record<string, unknown>;
      expect(hosting.type).toBe("web-app");
    });

    it("preserves hosting.type when it differs from a retired top-level type", () => {
      // If hosting.type is already "web-app" but top-level is the retired
      // "monorepo", we still remap top-level. The hosting.type stays since
      // it doesn't match the retired value.
      writeConfig({
        name: "demo",
        type: "monorepo",
        hosting: {
          enabled: true,
          type: "web-app",
          hostname: "demo",
        },
      });

      const r = migrateProjectConfigShape(projectPath);

      expect(r.remappedType).toEqual({ from: "monorepo", to: "web-app" });
      const after = readConfig();
      expect(after.type).toBe("web-app");
      const hosting = after.hosting as Record<string, unknown>;
      expect(hosting.type).toBe("web-app"); // unchanged
    });

    it("handles hosting.stacks[] absent gracefully", () => {
      writeConfig({
        name: "demo",
        type: "ops",
        hosting: { enabled: true, type: "static-site", hostname: "demo" },
      });

      const r = migrateProjectConfigShape(projectPath, {
        isDesktopServedType: (t) => t === "ops",
      });

      expect(r.strippedStacks).toBeUndefined();
      // No stacks key was created.
      const after = readConfig();
      const hosting = after.hosting as Record<string, unknown>;
      expect(hosting.stacks).toBeUndefined();
    });
  });
});

describe("migrateAllProjectConfigShapes", () => {
  let tmpRoot: string;
  let workspace: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `shape-sweep-${String(Date.now())}-${String(Math.random()).slice(2)}`);
    workspace = join(tmpRoot, "_projects");
    mkdirSync(workspace, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeProject(name: string, config: unknown, withAgiDebris = false): string {
    const dir = join(workspace, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project.json"), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
    if (withAgiDebris) {
      const agiDir = join(dir, ".agi");
      mkdirSync(agiDir, { recursive: true });
      writeFileSync(join(agiDir, "project.json"), `${JSON.stringify({ name: `${name}-stale` })}\n`, "utf-8");
    }
    return dir;
  }

  it("aggregates per-project results across the workspace", () => {
    makeProject("alpha", {
      name: "alpha",
      category: "web",
      hosting: { enabled: true, type: "web-app", hostname: "alpha", containerKind: "code" },
    }, true);
    makeProject("beta", {
      name: "beta",
      type: "writing",
      hosting: { enabled: false, type: "writing", hostname: "beta" },
    });
    makeProject("gamma", {
      name: "gamma",
      hosting: { enabled: true, type: "static-site", hostname: "gamma" },
    });
    // Sacred-skip path inside the workspace.
    mkdirSync(join(workspace, "_aionima"), { recursive: true });
    writeFileSync(
      join(workspace, "_aionima", "project.json"),
      `${JSON.stringify({ name: "AGI", category: "monorepo" })}\n`,
      "utf-8",
    );

    const summary = migrateAllProjectConfigShapes([workspace]);

    // alpha + beta + gamma scanned; _aionima skipped before scan increment.
    expect(summary.scanned).toBe(3);
    expect(summary.rewrote).toBe(2); // alpha (cat+containerKind) + gamma (type derive)
    expect(summary.debrisRemoved).toBe(1); // alpha had .agi debris
    expect(summary.errors).toBe(0);

    const alpha = summary.projects.find((p) => p.projectPath.endsWith("alpha"));
    expect(alpha?.result.droppedCategory).toBe("web");
    expect(alpha?.result.droppedContainerKind).toBe("code");
    expect(alpha?.result.agiDebrisRemoved).toBe(true);

    const gamma = summary.projects.find((p) => p.projectPath.endsWith("gamma"));
    expect(gamma?.result.derivedType).toEqual({ value: "static-site", source: "hosting.type" });

    const beta = summary.projects.find((p) => p.projectPath.endsWith("beta"));
    expect(beta?.result.configRewritten).toBe(false);

    // Sacred dir untouched.
    const sacredCfg = JSON.parse(
      readFileSync(join(workspace, "_aionima", "project.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(sacredCfg.category).toBe("monorepo");
  });

  it("tolerates missing workspace directories", () => {
    const summary = migrateAllProjectConfigShapes([
      join(tmpRoot, "does-not-exist"),
      workspace,
    ]);
    expect(summary.scanned).toBe(0);
    expect(summary.errors).toBe(0);
  });

  it("aggregates stacks-stripped count across the workspace (s150 t635)", () => {
    makeProject("ops-project", {
      name: "ops-project",
      type: "ops",
      hosting: {
        enabled: true,
        type: "static-site",
        hostname: "ops",
        stacks: [{ stackId: "stack-static-hosting", addedAt: "2026-04-01T00:00:00Z" }],
      },
    });
    makeProject("web-project", {
      name: "web-project",
      type: "web-app",
      hosting: {
        enabled: true,
        type: "web-app",
        hostname: "web",
        stacks: [{ stackId: "stack-nextjs", addedAt: "2026-04-01T00:00:00Z" }],
      },
    });

    const summary = migrateAllProjectConfigShapes([workspace], {
      isDesktopServedType: (t) => t === "ops",
    });

    expect(summary.scanned).toBe(2);
    expect(summary.stacksStripped).toBe(1);
    const ops = summary.projects.find((p) => p.projectPath.endsWith("ops-project"));
    expect(ops?.result.strippedStacks).toEqual(["stack-static-hosting"]);
    const web = summary.projects.find((p) => p.projectPath.endsWith("web-project"));
    expect(web?.result.strippedStacks).toBeUndefined();
  });
});
