/**
 * cage-gate tests — verifies the shared path-gating helper consumed
 * by file-read, file-write, dir-list, grep-search (and shell-exec
 * via inline equivalent logic).
 */

import { describe, it, expect } from "vitest";
import { gatePath } from "./cage-gate.js";

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
