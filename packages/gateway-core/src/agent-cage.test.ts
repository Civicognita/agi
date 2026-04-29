/**
 * agent-cage tests — verifies the cage primitive's path resolution +
 * ops-mode widening + escape-prompt logic.
 */

import { describe, it, expect } from "vitest";
import { deriveCage, isPathInCage, requiresEscapePrompt } from "./agent-cage.js";

describe("agent-cage (s130 t515 slice 5)", () => {
  describe("deriveCage", () => {
    it("returns null when no projectContext is set", () => {
      expect(deriveCage({})).toBeNull();
      expect(deriveCage({ projectContext: undefined })).toBeNull();
    });

    it("returns the s130 layout subtrees for a single-repo project", () => {
      const cage = deriveCage({ projectContext: "/home/user/myproject" });
      expect(cage).not.toBeNull();
      expect(cage?.allowedPrefixes).toEqual([
        "/home/user/myproject",
        "/home/user/myproject/.agi",
        "/home/user/myproject/k",
        "/home/user/myproject/repos",
        "/home/user/myproject/.trash",
      ]);
      expect(cage?.opsModeWidened).toBe(false);
      expect(cage?.askUserQuestionEscape).toBe(true);
    });

    it("widens cage to sibling project subtrees when category is ops", () => {
      const cage = deriveCage({
        projectContext: "/home/user/ops-project",
        projectCategory: "ops",
        siblingProjectPaths: [
          "/home/user/ops-project", // self — should be skipped
          "/home/user/sibling-a",
          "/home/user/sibling-b",
        ],
      });
      expect(cage?.opsModeWidened).toBe(true);
      // 5 dirs for ops-project + 5 dirs for each of 2 siblings = 15
      expect(cage?.allowedPrefixes).toHaveLength(15);
      expect(cage?.allowedPrefixes).toContain("/home/user/sibling-a");
      expect(cage?.allowedPrefixes).toContain("/home/user/sibling-b/k");
    });

    it("doesn't widen when category is not ops, even with siblings provided", () => {
      const cage = deriveCage({
        projectContext: "/home/user/web-project",
        projectCategory: "web",
        siblingProjectPaths: ["/home/user/sibling-a"],
      });
      expect(cage?.opsModeWidened).toBe(false);
      expect(cage?.allowedPrefixes).toHaveLength(5); // single-repo cage
    });

    it("normalizes the project path (resolves ./, ../)", () => {
      const cage = deriveCage({ projectContext: "/home/user/foo/../myproject" });
      expect(cage?.allowedPrefixes[0]).toBe("/home/user/myproject");
    });
  });

  describe("isPathInCage", () => {
    const cage = deriveCage({ projectContext: "/home/user/myproject" });

    it("returns true for exact match on the project root", () => {
      expect(isPathInCage("/home/user/myproject", cage)).toBe(true);
    });

    it("returns true for paths under the project root", () => {
      expect(isPathInCage("/home/user/myproject/src/foo.ts", cage)).toBe(true);
      expect(isPathInCage("/home/user/myproject/.agi/project.json", cage)).toBe(true);
      expect(isPathInCage("/home/user/myproject/k/plans/plan-1.md", cage)).toBe(true);
      expect(isPathInCage("/home/user/myproject/repos/web/src/index.ts", cage)).toBe(true);
      expect(isPathInCage("/home/user/myproject/.trash/old-file.txt", cage)).toBe(true);
    });

    it("returns false for sibling projects (no ops-mode widening)", () => {
      expect(isPathInCage("/home/user/different-project", cage)).toBe(false);
      expect(isPathInCage("/home/user/different-project/src/x.ts", cage)).toBe(false);
    });

    it("returns false for prefix-collision paths", () => {
      // /home/user/myproject-other should NOT match /home/user/myproject
      expect(isPathInCage("/home/user/myproject-other", cage)).toBe(false);
      expect(isPathInCage("/home/user/myproject-other/file.ts", cage)).toBe(false);
    });

    it("returns false for paths outside the cage", () => {
      expect(isPathInCage("/etc/passwd", cage)).toBe(false);
      expect(isPathInCage("/home/user", cage)).toBe(false);
      expect(isPathInCage("/", cage)).toBe(false);
    });

    it("resolves path traversals (../) correctly", () => {
      // /home/user/myproject/../etc/passwd resolves to /home/user/etc/passwd
      expect(isPathInCage("/home/user/myproject/../etc/passwd", cage)).toBe(false);
    });

    it("returns true for everything when cage is null (no projectContext)", () => {
      expect(isPathInCage("/etc/passwd", null)).toBe(true);
      expect(isPathInCage("/anywhere", null)).toBe(true);
    });

    it("ops-mode cage allows sibling project paths", () => {
      const opsCage = deriveCage({
        projectContext: "/home/user/ops",
        projectCategory: "ops",
        siblingProjectPaths: ["/home/user/sibling"],
      });
      expect(isPathInCage("/home/user/sibling/src/foo.ts", opsCage)).toBe(true);
      expect(isPathInCage("/home/user/sibling/.agi/project.json", opsCage)).toBe(true);
      // Still doesn't allow random paths
      expect(isPathInCage("/etc/passwd", opsCage)).toBe(false);
    });
  });

  describe("requiresEscapePrompt", () => {
    const cage = deriveCage({ projectContext: "/home/user/myproject" });

    it("returns false when path IS in cage (no prompt needed)", () => {
      expect(requiresEscapePrompt("/home/user/myproject/src/foo.ts", cage)).toBe(false);
    });

    it("returns true when path is OUTSIDE cage and AskUserQuestion escape is enabled", () => {
      expect(requiresEscapePrompt("/etc/passwd", cage)).toBe(true);
    });

    it("returns false when no cage applies (null)", () => {
      expect(requiresEscapePrompt("/etc/passwd", null)).toBe(false);
    });

    it("returns false when cage doesn't allow AskUserQuestion escape", () => {
      const sealed = { ...cage!, askUserQuestionEscape: false };
      expect(requiresEscapePrompt("/etc/passwd", sealed)).toBe(false);
    });
  });
});
