/**
 * filterStackActionsForRepo — per-repo predicate filtering for stack
 * install actions (s141 t553). Pure-logic; runs on host.
 */

import { describe, it, expect } from "vitest";
import { filterStackActionsForRepo, type StackInstallAction } from "./stack-types.js";

const PROJ = "/home/u/.agi/x/proj";

describe("filterStackActionsForRepo (s141 t553)", () => {
  it("returns [] for undefined or empty input", () => {
    expect(filterStackActionsForRepo(undefined, { projectPath: PROJ, repoName: "", repoCount: 0 })).toEqual([]);
    expect(filterStackActionsForRepo([], { projectPath: PROJ, repoName: "", repoCount: 0 })).toEqual([]);
  });

  it("includes actions with no whenRepo predicate (backward-compat default)", () => {
    const actions: StackInstallAction[] = [
      { id: "a", label: "A", command: "echo A" },
      { id: "b", label: "B", command: "echo B" },
    ];
    const out = filterStackActionsForRepo(actions, { projectPath: PROJ, repoName: "web", repoCount: 2 });
    expect(out).toHaveLength(2);
  });

  it("excludes actions whose whenRepo returns false", () => {
    const actions: StackInstallAction[] = [
      { id: "always", label: "Always", command: "echo" },
      { id: "web-only", label: "Web only", command: "vite", whenRepo: ({ repoName }) => repoName === "web" },
      { id: "api-only", label: "API only", command: "node", whenRepo: ({ repoName }) => repoName === "api" },
    ];
    const onWeb = filterStackActionsForRepo(actions, { projectPath: PROJ, repoName: "web", repoCount: 2 });
    expect(onWeb.map((a) => a.id)).toEqual(["always", "web-only"]);
    const onApi = filterStackActionsForRepo(actions, { projectPath: PROJ, repoName: "api", repoCount: 2 });
    expect(onApi.map((a) => a.id)).toEqual(["always", "api-only"]);
  });

  it("supports the project-level surface (repoName='') predicate", () => {
    const actions: StackInstallAction[] = [
      { id: "project-level", label: "PL", command: "x", whenRepo: ({ repoName }) => repoName === "" },
      { id: "repo-level", label: "RL", command: "y", whenRepo: ({ repoName }) => Boolean(repoName) },
    ];
    const projectSurface = filterStackActionsForRepo(actions, { projectPath: PROJ, repoName: "", repoCount: 3 });
    expect(projectSurface.map((a) => a.id)).toEqual(["project-level"]);
    const repoSurface = filterStackActionsForRepo(actions, { projectPath: PROJ, repoName: "web", repoCount: 3 });
    expect(repoSurface.map((a) => a.id)).toEqual(["repo-level"]);
  });

  it("passes repoCount so single-repo projects can short-circuit", () => {
    const actions: StackInstallAction[] = [
      { id: "multi-only", label: "MultiOnly", command: "z", whenRepo: ({ repoCount }) => repoCount > 1 },
    ];
    expect(filterStackActionsForRepo(actions, { projectPath: PROJ, repoName: "web", repoCount: 1 })).toEqual([]);
    expect(filterStackActionsForRepo(actions, { projectPath: PROJ, repoName: "web", repoCount: 2 })).toHaveLength(1);
  });

  it("preserves action order", () => {
    const actions: StackInstallAction[] = [
      { id: "a", label: "A", command: "x", whenRepo: () => true },
      { id: "b", label: "B", command: "y" },
      { id: "c", label: "C", command: "z", whenRepo: () => true },
    ];
    const out = filterStackActionsForRepo(actions, { projectPath: PROJ, repoName: "r", repoCount: 1 });
    expect(out.map((a) => a.id)).toEqual(["a", "b", "c"]);
  });
});
