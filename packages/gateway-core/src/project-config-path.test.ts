/**
 * project-config-path tests — verifies the s130 t514 transparent
 * auto-migration from `~/.agi/{slug}/project.json` to
 * `<projectPath>/.agi/project.json`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  projectSlug,
  newProjectConfigPath,
  legacyProjectConfigPath,
  migrateProjectConfig,
  projectConfigPath,
  scaffoldProjectFolders,
  PROJECT_FOLDER_LAYOUT,
} from "./project-config-path.js";

describe("project-config-path", () => {
  let tmpRoot: string;
  let projectPath: string;
  let homeOverride: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `pcp-test-${String(Date.now())}-${String(Math.random()).slice(2)}`);
    projectPath = join(tmpRoot, "myproject");
    homeOverride = join(tmpRoot, "home");
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(homeOverride, { recursive: true });
    // Override homedir() so legacyProjectConfigPath resolves into our
    // temp directory instead of the actual home.
    vi.stubEnv("HOME", homeOverride);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("projectSlug", () => {
    it("converts an absolute path to a slug", () => {
      expect(projectSlug("/home/user/myproject")).toBe("home-user-myproject");
    });

    it("substitutes special characters", () => {
      expect(projectSlug("/srv/projects/my app")).toBe("srv-projects-my_app");
    });

    it("returns 'general' for empty input", () => {
      expect(projectSlug("/")).toBe("general");
    });
  });

  describe("newProjectConfigPath / legacyProjectConfigPath", () => {
    it("newProjectConfigPath joins projectPath/.agi/project.json", () => {
      expect(newProjectConfigPath(projectPath)).toBe(join(projectPath, ".agi", "project.json"));
    });

    it("legacyProjectConfigPath uses ~/.agi/{slug}/project.json", () => {
      const slug = projectSlug(projectPath);
      const legacy = legacyProjectConfigPath(projectPath);
      // homedir() reads from process.env.HOME at call time on POSIX.
      // The path includes the slug + project.json regardless of what
      // homedir resolves to.
      expect(legacy.endsWith(join(slug, "project.json"))).toBe(true);
    });
  });

  describe("migrateProjectConfig", () => {
    it("no-op when neither file exists", () => {
      const result = migrateProjectConfig(projectPath);
      expect(result.migrated).toBe(false);
      expect(result.from).toBeUndefined();
      expect(existsSync(newProjectConfigPath(projectPath))).toBe(false);
    });

    it("no-op when new file already exists", () => {
      const newPath = newProjectConfigPath(projectPath);
      mkdirSync(dirname(newPath), { recursive: true });
      writeFileSync(newPath, JSON.stringify({ name: "new" }), "utf-8");
      const result = migrateProjectConfig(projectPath);
      expect(result.migrated).toBe(false);
      expect(JSON.parse(readFileSync(newPath, "utf-8"))).toEqual({ name: "new" });
    });

    it("migrates when legacy exists and new doesn't", () => {
      const legacyPath = legacyProjectConfigPath(projectPath);
      mkdirSync(dirname(legacyPath), { recursive: true });
      writeFileSync(legacyPath, JSON.stringify({ name: "legacy" }), "utf-8");

      const result = migrateProjectConfig(projectPath);
      expect(result.migrated).toBe(true);
      expect(result.from).toBe(legacyPath);
      expect(result.to).toBe(newProjectConfigPath(projectPath));

      // New file now exists with the same content.
      expect(JSON.parse(readFileSync(result.to, "utf-8"))).toEqual({ name: "legacy" });
      // Legacy is preserved as backup.
      expect(existsSync(legacyPath)).toBe(true);
    });

    it("is idempotent — calling twice is safe", () => {
      const legacyPath = legacyProjectConfigPath(projectPath);
      mkdirSync(dirname(legacyPath), { recursive: true });
      writeFileSync(legacyPath, JSON.stringify({ name: "legacy" }), "utf-8");

      const r1 = migrateProjectConfig(projectPath);
      const r2 = migrateProjectConfig(projectPath);
      expect(r1.migrated).toBe(true);
      expect(r2.migrated).toBe(false); // new exists now, no-op
    });

    it("scaffolds the s130 folder layout on successful migration", () => {
      const legacyPath = legacyProjectConfigPath(projectPath);
      mkdirSync(dirname(legacyPath), { recursive: true });
      writeFileSync(legacyPath, JSON.stringify({ name: "legacy" }), "utf-8");

      const result = migrateProjectConfig(projectPath);
      expect(result.migrated).toBe(true);
      expect(result.scaffolded).toBeDefined();
      // All eight s130 dirs should be created.
      expect(result.scaffolded).toHaveLength(PROJECT_FOLDER_LAYOUT.length);
      for (const rel of PROJECT_FOLDER_LAYOUT) {
        expect(existsSync(join(projectPath, rel))).toBe(true);
      }
    });
  });

  describe("scaffoldProjectFolders", () => {
    it("creates all s130 layout folders when none exist", () => {
      const result = scaffoldProjectFolders(projectPath);
      expect(result.created).toHaveLength(PROJECT_FOLDER_LAYOUT.length);
      for (const rel of PROJECT_FOLDER_LAYOUT) {
        expect(existsSync(join(projectPath, rel))).toBe(true);
      }
    });

    it("is idempotent — second call creates nothing new", () => {
      scaffoldProjectFolders(projectPath);
      const second = scaffoldProjectFolders(projectPath);
      expect(second.created).toHaveLength(0);
    });

    it("creates only missing dirs when some exist", () => {
      // Pre-create one dir; scaffold should create the remaining N-1.
      mkdirSync(join(projectPath, ".agi"), { recursive: true });
      const result = scaffoldProjectFolders(projectPath);
      expect(result.created).toHaveLength(PROJECT_FOLDER_LAYOUT.length - 1);
      // .agi was pre-existing, so it shouldn't be in the created list
      expect(result.created.some((p) => p.endsWith(".agi"))).toBe(false);
    });

    it("layout includes all five k/ subfolders per Q-3 owner answer", () => {
      const expected = ["k/plans", "k/knowledge", "k/pm", "k/memory", "k/chat"];
      for (const rel of expected) {
        expect(PROJECT_FOLDER_LAYOUT).toContain(rel);
      }
    });
  });

  describe("projectConfigPath (auto-migrating)", () => {
    it("returns new path when neither file exists (writers can create it)", () => {
      const result = projectConfigPath(projectPath);
      expect(result).toBe(newProjectConfigPath(projectPath));
    });

    it("returns new path when only new exists", () => {
      const newPath = newProjectConfigPath(projectPath);
      mkdirSync(dirname(newPath), { recursive: true });
      writeFileSync(newPath, JSON.stringify({ name: "new" }), "utf-8");
      expect(projectConfigPath(projectPath)).toBe(newPath);
    });

    it("auto-migrates and returns new path when only legacy exists", () => {
      const legacyPath = legacyProjectConfigPath(projectPath);
      mkdirSync(dirname(legacyPath), { recursive: true });
      writeFileSync(legacyPath, JSON.stringify({ name: "legacy" }), "utf-8");

      const result = projectConfigPath(projectPath);
      expect(result).toBe(newProjectConfigPath(projectPath));
      expect(existsSync(result)).toBe(true);
      expect(JSON.parse(readFileSync(result, "utf-8"))).toEqual({ name: "legacy" });
    });

    it("repeat calls are cheap — migration happens once", () => {
      const legacyPath = legacyProjectConfigPath(projectPath);
      mkdirSync(dirname(legacyPath), { recursive: true });
      writeFileSync(legacyPath, JSON.stringify({ name: "legacy" }), "utf-8");

      const r1 = projectConfigPath(projectPath);
      const r2 = projectConfigPath(projectPath);
      const r3 = projectConfigPath(projectPath);
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
      // After first call, new exists and second/third calls don't try
      // to migrate again.
      expect(existsSync(newProjectConfigPath(projectPath))).toBe(true);
    });
  });
});
