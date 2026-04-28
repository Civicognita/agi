import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { listProjectsWithConfig } from "./list-projects.js";
import { projectConfigPath } from "../project-config-path.js";

let workspaceDir: string;
let createdConfigDirs: string[];

beforeEach(() => {
  workspaceDir = join(tmpdir(), `iter-work-list-${String(Date.now())}-${String(Math.random()).slice(2)}`);
  mkdirSync(workspaceDir, { recursive: true });
  createdConfigDirs = [];
});

afterEach(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
  for (const dir of createdConfigDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProjectDir(name: string, withConfig: boolean): string {
  const projectPath = join(workspaceDir, name);
  mkdirSync(projectPath, { recursive: true });
  if (withConfig) {
    const configPath = projectConfigPath(projectPath);
    const configDir = configPath.replace(/\/project\.json$/, "");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({ name }), "utf-8");
    createdConfigDirs.push(configDir);
  }
  return projectPath;
}

describe("listProjectsWithConfig", () => {
  it("returns absolute paths of subdirs with a project.json under ~/.agi", () => {
    const a = createProjectDir("alpha", true);
    const b = createProjectDir("beta", true);

    const out = listProjectsWithConfig([workspaceDir]);

    expect(out.sort()).toEqual([a, b].sort());
  });

  it("ignores subdirs without a project.json", () => {
    const a = createProjectDir("alpha", true);
    createProjectDir("no-config", false);

    const out = listProjectsWithConfig([workspaceDir]);

    expect(out).toEqual([a]);
  });

  it("ignores files at the workspace root (only directories count)", () => {
    writeFileSync(join(workspaceDir, "stray-file.txt"), "x", "utf-8");
    const a = createProjectDir("alpha", true);

    const out = listProjectsWithConfig([workspaceDir]);

    expect(out).toEqual([a]);
  });

  it("returns empty when workspace dir does not exist", () => {
    const out = listProjectsWithConfig([join(workspaceDir, "does-not-exist")]);
    expect(out).toEqual([]);
  });

  it("returns empty when no workspace dirs supplied", () => {
    expect(listProjectsWithConfig([])).toEqual([]);
  });

  it("walks multiple workspace dirs", () => {
    const second = join(tmpdir(), `iter-work-list-second-${String(Date.now())}`);
    mkdirSync(second, { recursive: true });
    try {
      const a = createProjectDir("alpha", true);
      const secondProject = join(second, "gamma");
      mkdirSync(secondProject, { recursive: true });
      const configPath = projectConfigPath(secondProject);
      const configDir = configPath.replace(/\/project\.json$/, "");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(configPath, JSON.stringify({ name: "gamma" }), "utf-8");
      createdConfigDirs.push(configDir);

      const out = listProjectsWithConfig([workspaceDir, second]);
      expect(out.sort()).toEqual([a, secondProject].sort());
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  it("sanity-check: all returned paths resolve under one of the workspace dirs", () => {
    createProjectDir("alpha", true);
    createProjectDir("beta", true);

    const out = listProjectsWithConfig([workspaceDir]);

    for (const path of out) {
      expect(path.startsWith(workspaceDir)).toBe(true);
    }
    // Paranoia: never let a stray ~/ path slip through.
    for (const path of out) {
      expect(path.startsWith(homedir() + "/.agi/")).toBe(false);
    }
  });
});
