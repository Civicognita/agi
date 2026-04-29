/**
 * repos-provisioner tests — verifies the t515 slice 2 clone-on-add
 * provisioner using a mock cloneFn (no actual git invocation).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  provisionProjectRepos,
  resolveRepoTargetDir,
  type CloneFn,
} from "./repos-provisioner.js";
import type { ProjectRepo } from "@agi/config";

describe("repos-provisioner (s130 t515 slice 2)", () => {
  let tmpRoot: string;
  let projectPath: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `repos-prov-${String(Date.now())}-${String(Math.random()).slice(2)}`);
    projectPath = join(tmpRoot, "myproject");
    mkdirSync(projectPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeRepo(name: string, overrides: Partial<ProjectRepo> = {}): ProjectRepo {
    return {
      name,
      url: `https://example.com/${name}.git`,
      writable: false,
      ...overrides,
    };
  }

  describe("resolveRepoTargetDir", () => {
    it("defaults to <projectPath>/repos/<name>/", () => {
      const repo = makeRepo("web");
      expect(resolveRepoTargetDir(projectPath, repo)).toBe(join(projectPath, "repos", "web"));
    });

    it("honors path override when set", () => {
      const repo = makeRepo("api", { path: "/custom/path" });
      expect(resolveRepoTargetDir(projectPath, repo)).toBe("/custom/path");
    });
  });

  describe("provisionProjectRepos", () => {
    it("returns zero counts when repos array is empty", () => {
      const result = provisionProjectRepos(projectPath, []);
      expect(result).toEqual({ repos: [], provisioned: 0, skipped: 0, errors: 0 });
    });

    it("clones each missing repo via cloneFn", () => {
      const calls: Array<{ url: string; targetDir: string; branch?: string }> = [];
      const cloneFn: CloneFn = (url, targetDir, branch) => {
        calls.push({ url, targetDir, branch });
        // Simulate successful clone by creating the dir
        mkdirSync(targetDir, { recursive: true });
        return { ok: true };
      };

      const repos: ProjectRepo[] = [
        makeRepo("web"),
        makeRepo("api", { branch: "dev" }),
      ];

      const result = provisionProjectRepos(projectPath, repos, { cloneFn });

      expect(calls).toHaveLength(2);
      expect(calls[0]?.url).toBe("https://example.com/web.git");
      expect(calls[0]?.branch).toBeUndefined();
      expect(calls[1]?.url).toBe("https://example.com/api.git");
      expect(calls[1]?.branch).toBe("dev");
      expect(result.provisioned).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
    });

    it("skips repos whose target dir already exists (idempotent)", () => {
      // Pre-create the web/ target dir
      mkdirSync(join(projectPath, "repos", "web"), { recursive: true });

      const cloneCalls: number = 0;
      let calls = cloneCalls;
      const cloneFn: CloneFn = () => {
        calls += 1;
        return { ok: true };
      };

      const repos: ProjectRepo[] = [
        makeRepo("web"),
        makeRepo("api"),
      ];

      const result = provisionProjectRepos(projectPath, repos, { cloneFn });

      // web was skipped, api was cloned (mock cloneFn returned ok but
      // doesn't create the dir, so api's clone result is recorded
      // even though there's no real dir).
      expect(result.skipped).toBe(1);
      expect(calls).toBe(1); // only api triggered the cloneFn
      expect(result.repos.find((r) => r.name === "web")?.outcome).toBe("skipped");
      expect(result.repos.find((r) => r.name === "api")?.outcome).toBe("provisioned");
    });

    it("captures clone failures per-repo without aborting the run", () => {
      const cloneFn: CloneFn = (url) => {
        if (url.includes("bad")) {
          return { ok: false, error: "fatal: repository 'bad' not found" };
        }
        return { ok: true };
      };

      const repos: ProjectRepo[] = [
        makeRepo("good-1"),
        makeRepo("bad-repo"),
        makeRepo("good-2"),
      ];

      const result = provisionProjectRepos(projectPath, repos, { cloneFn });

      expect(result.provisioned).toBe(2);
      expect(result.errors).toBe(1);
      expect(result.skipped).toBe(0);

      const errored = result.repos.find((r) => r.name === "bad-repo");
      expect(errored?.outcome).toBe("error");
      expect(errored?.error).toMatch(/not found/);
    });

    it("creates the parent repos/ dir if missing before cloning", () => {
      // Ensure parent doesn't exist initially
      const reposDir = join(projectPath, "repos");
      expect(existsSync(reposDir)).toBe(false);

      const cloneFn: CloneFn = (_url, targetDir) => {
        // Simulate clone creating the target dir
        mkdirSync(targetDir, { recursive: true });
        return { ok: true };
      };

      provisionProjectRepos(projectPath, [makeRepo("web")], { cloneFn });

      expect(existsSync(reposDir)).toBe(true);
      expect(existsSync(join(reposDir, "web"))).toBe(true);
    });

    it("honors path override (clones to custom path, not <projectPath>/repos/<name>/)", () => {
      const customPath = join(tmpRoot, "elsewhere", "checkout");

      let recordedTarget: string | undefined;
      const cloneFn: CloneFn = (_url, targetDir) => {
        recordedTarget = targetDir;
        mkdirSync(targetDir, { recursive: true });
        return { ok: true };
      };

      provisionProjectRepos(
        projectPath,
        [makeRepo("override", { path: customPath })],
        { cloneFn },
      );

      expect(recordedTarget).toBe(customPath);
      // Default location should NOT have been touched
      expect(existsSync(join(projectPath, "repos", "override"))).toBe(false);
    });

    it("aggregates outcomes correctly across mixed scenarios", () => {
      // Pre-create skip target
      mkdirSync(join(projectPath, "repos", "existing"), { recursive: true });

      const cloneFn: CloneFn = (url, targetDir) => {
        if (url.includes("fail")) return { ok: false, error: "boom" };
        mkdirSync(targetDir, { recursive: true });
        return { ok: true };
      };

      const repos: ProjectRepo[] = [
        makeRepo("existing"),         // skipped
        makeRepo("ok-1"),             // provisioned
        makeRepo("fail-this"),        // error
        makeRepo("ok-2"),             // provisioned
      ];

      const result = provisionProjectRepos(projectPath, repos, { cloneFn });
      expect(result.provisioned).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.errors).toBe(1);
      expect(result.repos).toHaveLength(4);
    });
  });
});
