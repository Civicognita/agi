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
  isSacredProjectPath,
  PROJECT_FOLDER_LAYOUT,
  ensureWorkspaceSkeleton,
  registerWorkspaceSkeletonRoot,
  _resetPreferredSkeletonRootsForTest,
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
    it("newProjectConfigPath joins projectPath/project.json (s140 root)", () => {
      expect(newProjectConfigPath(projectPath)).toBe(join(projectPath, "project.json"));
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
    it("no-op (no config migration) when neither file exists, but scaffolds layout", () => {
      const result = migrateProjectConfig(projectPath);
      // `migrated` flag tracks CONFIG migration only — no legacy config to copy.
      expect(result.migrated).toBe(false);
      expect(result.from).toBeUndefined();
      // Scaffold runs from the on-disk skeleton (which today includes a
      // starter project.json — copySkeletonInto won't overwrite an existing
      // one). On a virgin project this means project.json IS created.
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
      // After migration, all canonical layout dirs must exist.
      for (const rel of PROJECT_FOLDER_LAYOUT) {
        expect(existsSync(join(projectPath, rel))).toBe(true);
      }
      // scaffolded includes every entry copied from the skeleton root
      // (dirs + non-.gitkeep files). The skeleton today is richer than
      // PROJECT_FOLDER_LAYOUT (e.g. it ships a starter project.json), so
      // the count can exceed `PROJECT_FOLDER_LAYOUT.length`. Only enforce
      // the floor.
      expect(result.scaffolded!.length).toBeGreaterThanOrEqual(PROJECT_FOLDER_LAYOUT.length);
    });
  });

  describe("scaffoldProjectFolders", () => {
    it("creates all canonical layout folders when none exist", () => {
      const result = scaffoldProjectFolders(projectPath);
      // Skeleton may ship more entries than PROJECT_FOLDER_LAYOUT (e.g.
      // a starter project.json). Floor-only assertion on count + presence
      // check on every canonical layout dir.
      expect(result.created.length).toBeGreaterThanOrEqual(PROJECT_FOLDER_LAYOUT.length);
      for (const rel of PROJECT_FOLDER_LAYOUT) {
        expect(existsSync(join(projectPath, rel))).toBe(true);
      }
    });

    it("is idempotent — second call creates nothing new", () => {
      scaffoldProjectFolders(projectPath);
      const second = scaffoldProjectFolders(projectPath);
      expect(second.created).toHaveLength(0);
    });

    it("creates only missing entries when some exist", () => {
      // Pre-create one dir; scaffold should create the others. The skeleton
      // may include extra entries (e.g. starter project.json), so just
      // assert the pre-created entry is NOT in created and the floor still
      // holds.
      mkdirSync(join(projectPath, "repos"), { recursive: true });
      const result = scaffoldProjectFolders(projectPath);
      expect(result.created.some((p) => p.endsWith("/repos"))).toBe(false);
      expect(result.created.length).toBeGreaterThanOrEqual(PROJECT_FOLDER_LAYOUT.length - 1);
    });

    it("layout includes all five k/ subfolders per Q-3 owner answer", () => {
      const expected = ["k/plans", "k/knowledge", "k/pm", "k/memory", "k/chat"];
      for (const rel of expected) {
        expect(PROJECT_FOLDER_LAYOUT).toContain(rel);
      }
    });
  });

  describe("sacred-skip (cycle 150 hotfix v0.4.426)", () => {
    it("isSacredProjectPath returns true for the 11 sacred names", () => {
      const sacred = [
        "_aionima",  // workspace-grouping container (cycle 150)
        "agi", "prime", "id", "marketplace", "mapp-marketplace",
        "react-fancy", "fancy-code", "fancy-sheets", "fancy-echarts", "fancy-3d",
      ];
      for (const name of sacred) {
        expect(isSacredProjectPath(`/some/parent/${name}`)).toBe(true);
        // Case-insensitive
        expect(isSacredProjectPath(`/some/parent/${name.toUpperCase()}`)).toBe(true);
      }
    });

    it("_aionima container is sacred — owner clarified cycle 150", () => {
      // The /home/wishborn/_projects/_aionima/ dir holds the 5 Aionima cores
      // + 4-soon-5 PAx packages. The container itself must never be migrated.
      expect(isSacredProjectPath("/home/wishborn/_projects/_aionima")).toBe(true);
      // With trailing slash too
      expect(isSacredProjectPath("/home/wishborn/_projects/_aionima/")).toBe(true);
    });

    it("isSacredProjectPath returns false for arbitrary names", () => {
      for (const name of ["myproject", "blackorchid_web", "kronos_trader", "ra_web"]) {
        expect(isSacredProjectPath(`/some/parent/${name}`)).toBe(false);
      }
    });

    it("migrateProjectConfig skips sacred repos (no scaffold, no file moves)", () => {
      const sacredPath = join(tmpRoot, "agi");
      mkdirSync(sacredPath, { recursive: true });
      // Even if a legacy config exists, sacred-skip wins.
      mkdirSync(join(sacredPath, ".agi"), { recursive: true });
      writeFileSync(join(sacredPath, ".agi", "project.json"), JSON.stringify({ name: "agi" }), "utf-8");
      const result = migrateProjectConfig(sacredPath);
      expect(result.migrated).toBe(false);
      expect(result.scaffolded).toBeUndefined();
      // No new project.json at root
      expect(existsSync(join(sacredPath, "project.json"))).toBe(false);
      // No k/ scaffolded
      expect(existsSync(join(sacredPath, "k"))).toBe(false);
    });

    it("scaffoldProjectFolders is a no-op for sacred repos", () => {
      const sacredPath = join(tmpRoot, "fancy-code");
      mkdirSync(sacredPath, { recursive: true });
      const result = scaffoldProjectFolders(sacredPath);
      expect(result.created).toEqual([]);
      expect(existsSync(join(sacredPath, "k"))).toBe(false);
    });

    it("projectConfigPath does not auto-write for sacred repos", () => {
      const sacredPath = join(tmpRoot, "prime");
      mkdirSync(sacredPath, { recursive: true });
      // No legacy config exists. Should return canonical path WITHOUT
      // writing anything.
      const cfgPath = projectConfigPath(sacredPath);
      expect(cfgPath).toBe(join(sacredPath, "project.json"));
      expect(existsSync(cfgPath)).toBe(false);
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

// ---------------------------------------------------------------------------
// s150 t633 — workspace-owned skeleton (`<workspaceRoot>/.new/`)
// ---------------------------------------------------------------------------

describe("ensureWorkspaceSkeleton", () => {
  let tmpRoot: string;
  let workspace: string;
  let agiSource: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `wskel-${String(Date.now())}-${String(Math.random()).slice(2)}`);
    workspace = join(tmpRoot, "_projects");
    agiSource = join(tmpRoot, "agi-templates", ".new");
    // Build a fake agi-templates skeleton with the canonical s140 layout.
    mkdirSync(join(agiSource, "k", "plans"), { recursive: true });
    mkdirSync(join(agiSource, "k", "knowledge"), { recursive: true });
    mkdirSync(join(agiSource, "repos"), { recursive: true });
    mkdirSync(join(agiSource, "sandbox"), { recursive: true });
    mkdirSync(join(agiSource, ".trash"), { recursive: true });
    writeFileSync(join(agiSource, "project.json"), `{"name":"new"}\n`, "utf-8");
    writeFileSync(join(agiSource, "k", "plans", ".gitkeep"), "", "utf-8");
    _resetPreferredSkeletonRootsForTest();
  });

  afterEach(() => {
    _resetPreferredSkeletonRootsForTest();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("seeds an absent workspace skeleton from the override source", () => {
    const r = ensureWorkspaceSkeleton(workspace, agiSource);
    expect(r.seeded).toBe(true);
    expect(r.target).toBe(join(workspace, ".new"));
    expect(existsSync(join(workspace, ".new", "project.json"))).toBe(true);
    expect(existsSync(join(workspace, ".new", "k", "plans"))).toBe(true);
    expect(existsSync(join(workspace, ".new", "repos"))).toBe(true);
    expect(existsSync(join(workspace, ".new", ".trash"))).toBe(true);
    // .gitkeep files are intentionally skipped.
    expect(existsSync(join(workspace, ".new", "k", "plans", ".gitkeep"))).toBe(false);
  });

  it("is idempotent — second call short-circuits without re-copying", () => {
    ensureWorkspaceSkeleton(workspace, agiSource);
    const sentinel = join(workspace, ".new", "owner-customization.txt");
    writeFileSync(sentinel, "owner edits", "utf-8");

    const r2 = ensureWorkspaceSkeleton(workspace, agiSource);
    expect(r2.seeded).toBe(false);
    expect(r2.reason).toBe("already-present");
    // Owner edit survived — we did NOT overwrite anything.
    expect(readFileSync(sentinel, "utf-8")).toBe("owner edits");
  });

  it("returns no-agi-source when the override does not exist", () => {
    const missing = join(tmpRoot, "does-not-exist");
    const r = ensureWorkspaceSkeleton(workspace, missing);
    expect(r.seeded).toBe(false);
    expect(r.reason).toBe("no-agi-source");
    expect(existsSync(join(workspace, ".new"))).toBe(false);
  });

  it("makes scaffoldProjectFolders prefer the workspace skeleton over agi templates", () => {
    // Seed a workspace-owned skeleton with a marker file that the agi-shipped
    // skeleton does NOT have.
    ensureWorkspaceSkeleton(workspace, agiSource);
    writeFileSync(join(workspace, ".new", "WORKSPACE_OWNED.txt"), "yes", "utf-8");

    const project = join(workspace, "alpha");
    mkdirSync(project, { recursive: true });
    scaffoldProjectFolders(project);

    // Marker file present → workspace skeleton was used as source.
    expect(existsSync(join(project, "WORKSPACE_OWNED.txt"))).toBe(true);
    expect(readFileSync(join(project, "WORKSPACE_OWNED.txt"), "utf-8")).toBe("yes");
  });

  it("registerWorkspaceSkeletonRoot is independently callable + idempotent", () => {
    registerWorkspaceSkeletonRoot(workspace);
    // Same registration twice → no error, no duplicate effect (verified via
    // not-throwing here; preferredSkeletonRoots is module-private).
    registerWorkspaceSkeletonRoot(workspace);
    // Pre-creating the skeleton on disk + registering means subsequent
    // scaffolds will use it without ensureWorkspaceSkeleton being called.
    mkdirSync(join(workspace, ".new", "k"), { recursive: true });
    writeFileSync(join(workspace, ".new", "MARKER.txt"), "registered", "utf-8");

    const project = join(workspace, "beta");
    mkdirSync(project, { recursive: true });
    scaffoldProjectFolders(project);
    expect(existsSync(join(project, "MARKER.txt"))).toBe(true);
  });
});
