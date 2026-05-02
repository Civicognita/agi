/**
 * cage-gate tests — verifies the shared path-gating helper consumed
 * by file-read, file-write, dir-list, grep-search (and shell-exec
 * via inline equivalent logic).
 */

import { describe, it, expect } from "vitest";
import { gatePath, resolveCagedPath, type PathGateConfig } from "./cage-gate.js";
import type { Cage } from "../agent-cage.js";

describe("gatePath (s130 t515 slice 6c)", () => {
  describe("legacy behavior (no cageProvider)", () => {
    it("returns null when path is inside workspaceRoot", () => {
      expect(gatePath({ workspaceRoot: "/workspace" }, "/workspace/file.ts")).toBeNull();
      expect(gatePath({ workspaceRoot: "/workspace" }, "/workspace/sub/file.ts")).toBeNull();
    });

    it("returns error when path escapes workspaceRoot", () => {
      const err = gatePath({ workspaceRoot: "/workspace" }, "/etc/passwd");
      expect(err).toContain("escapes workspace boundary");
    });
  });

  describe("cageProvider returning null (no projectContext)", () => {
    it("falls back to workspaceRoot check (allowed)", () => {
      expect(gatePath(
        { workspaceRoot: "/workspace", cageProvider: () => null },
        "/workspace/file.ts",
      )).toBeNull();
    });

    it("falls back to workspaceRoot check (rejected)", () => {
      const err = gatePath(
        { workspaceRoot: "/workspace", cageProvider: () => null },
        "/etc/passwd",
      );
      expect(err).toContain("escapes workspace boundary");
    });
  });

  describe("cageProvider returning a Cage", () => {
    const cage = {
      allowedPrefixes: ["/home/user/myproject"],
      opsModeWidened: false,
      askUserQuestionEscape: true,
    };

    it("returns null when path is in cage", () => {
      expect(gatePath(
        { workspaceRoot: "/workspace", cageProvider: () => cage },
        "/home/user/myproject/src/foo.ts",
      )).toBeNull();
    });

    it("returns error when path is outside cage", () => {
      const err = gatePath(
        { workspaceRoot: "/workspace", cageProvider: () => cage },
        "/etc/passwd",
      );
      expect(err).toContain("outside the project cage");
    });

    it("cage takes precedence over workspaceRoot (rejects in-workspace but out-of-cage)", () => {
      // /workspace is the workspaceRoot but cage = /home/user/myproject
      const err = gatePath(
        { workspaceRoot: "/workspace", cageProvider: () => cage },
        "/workspace/some-file.ts",
      );
      expect(err).toContain("outside the project cage");
    });

    it("cage takes precedence over workspaceRoot (allows in-cage but out-of-workspace)", () => {
      // /home/user/myproject is in cage but NOT in workspaceRoot=/var/empty
      expect(gatePath(
        { workspaceRoot: "/var/empty", cageProvider: () => cage },
        "/home/user/myproject/src/file.ts",
      )).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// resolveCagedPath (s140 t590 cycle-170)
// ---------------------------------------------------------------------------
//
// Locks in the path-resolution fix for the autonomous-ship blocker.
// Pre-fix: relative paths resolved against the gateway workspaceRoot
// ("/" by default), so `dir_list path="repos/foo/bar"` tried to read
// `/repos/foo/bar` and returned "not found" even though the project's
// `<projectPath>/repos/foo/bar` existed. The cage check ran AFTER the
// wrong-base resolution, so it didn't catch this.
//
// Post-fix: when a cage is active, relative paths resolve against the
// cage's first allowedPrefix (the project root, per agent-cage.ts
// PROJECT_CAGE_DIRS — empty-string entry resolves to projectPath
// itself). Absolute paths bypass the resolution base.

describe("resolveCagedPath (s140 t590)", () => {
  const projectRoot = "/home/owner/_projects/sample";

  const cagedConfig: PathGateConfig = {
    workspaceRoot: "/",
    cageProvider: (): Cage | null => ({
      allowedPrefixes: [
        projectRoot,
        `${projectRoot}/.agi`,
        `${projectRoot}/k`,
        `${projectRoot}/repos`,
        `${projectRoot}/.trash`,
      ],
      opsModeWidened: false,
      askUserQuestionEscape: true,
    }),
  };

  const uncagedConfig: PathGateConfig = {
    workspaceRoot: "/home/owner",
    cageProvider: (): Cage | null => null,
  };

  describe("caged context", () => {
    it("resolves relative paths against the project root, not gateway workspaceRoot", () => {
      expect(resolveCagedPath(cagedConfig, "repos/foo/bar")).toBe(
        `${projectRoot}/repos/foo/bar`,
      );
    });

    it("resolves '.' to the project root itself", () => {
      expect(resolveCagedPath(cagedConfig, ".")).toBe(projectRoot);
    });

    it("resolves multi-segment relative paths", () => {
      expect(resolveCagedPath(cagedConfig, "k/plans/active.md")).toBe(
        `${projectRoot}/k/plans/active.md`,
      );
    });

    it("honors absolute paths as-is (path.resolve drops the base)", () => {
      expect(resolveCagedPath(cagedConfig, "/etc/hosts")).toBe("/etc/hosts");
      expect(resolveCagedPath(cagedConfig, `${projectRoot}/x`)).toBe(`${projectRoot}/x`);
    });

    it("normalizes '..' traversal — caller's gate then catches escape", () => {
      // resolveCagedPath does NOT enforce the cage — gatePath does.
      // Verify only that the resolver normalizes correctly so gatePath
      // can reject the result downstream.
      expect(resolveCagedPath(cagedConfig, "../sibling")).toBe(
        "/home/owner/_projects/sibling",
      );
    });
  });

  describe("uncaged context (cageProvider returns null or undefined)", () => {
    it("falls back to workspaceRoot when cageProvider returns null", () => {
      expect(resolveCagedPath(uncagedConfig, "repos/foo/bar")).toBe(
        "/home/owner/repos/foo/bar",
      );
    });

    it("falls back to workspaceRoot when cageProvider is undefined", () => {
      const noProviderConfig: PathGateConfig = { workspaceRoot: "/home/owner" };
      expect(resolveCagedPath(noProviderConfig, "k/foo")).toBe("/home/owner/k/foo");
    });

    it("honors absolute paths as-is in uncaged mode too", () => {
      expect(resolveCagedPath(uncagedConfig, "/tmp/x")).toBe("/tmp/x");
    });
  });

  describe("empty allowedPrefixes guard", () => {
    it("falls back to workspaceRoot when cage exists but has empty allowedPrefixes", () => {
      const emptyConfig: PathGateConfig = {
        workspaceRoot: "/home/owner",
        cageProvider: (): Cage | null => ({
          allowedPrefixes: [],
          opsModeWidened: false,
          askUserQuestionEscape: true,
        }),
      };
      expect(resolveCagedPath(emptyConfig, "k/foo")).toBe("/home/owner/k/foo");
    });
  });
});
