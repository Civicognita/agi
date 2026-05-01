import { describe, it, expect } from "vitest";
import { resolveLegacyMountBasePure } from "./hosting-manager.js";

const PROJECT_PATH = "/home/owner/projects/site";

describe("resolveLegacyMountBasePure (s141 t552)", () => {
  it("returns project root when projectConfig is null", () => {
    const r = resolveLegacyMountBasePure({ projectPath: PROJECT_PATH, projectConfig: null });
    expect(r.base).toBe(PROJECT_PATH);
    expect(r.repoName).toBeNull();
  });

  it("returns project root when repos[] is empty", () => {
    const r = resolveLegacyMountBasePure({ projectPath: PROJECT_PATH, projectConfig: { repos: [] } });
    expect(r.base).toBe(PROJECT_PATH);
    expect(r.repoName).toBeNull();
  });

  it("returns project root when repos field is missing", () => {
    const r = resolveLegacyMountBasePure({ projectPath: PROJECT_PATH, projectConfig: {} });
    expect(r.base).toBe(PROJECT_PATH);
    expect(r.repoName).toBeNull();
  });

  it("rebases onto first repo when only one repo is present", () => {
    const r = resolveLegacyMountBasePure({
      projectPath: PROJECT_PATH,
      projectConfig: { repos: [{ name: "site", url: "x" } as never] },
    });
    expect(r.base).toBe(`${PROJECT_PATH}/repos/site`);
    expect(r.repoName).toBe("site");
  });

  it("rebases onto isDefault repo when multiple repos exist", () => {
    const r = resolveLegacyMountBasePure({
      projectPath: PROJECT_PATH,
      projectConfig: {
        repos: [
          { name: "lib", url: "x" } as never,
          { name: "site", url: "x", isDefault: true } as never,
          { name: "docs", url: "x" } as never,
        ],
      },
    });
    expect(r.base).toBe(`${PROJECT_PATH}/repos/site`);
    expect(r.repoName).toBe("site");
  });

  it("falls back to first repo when no repo is marked isDefault", () => {
    const r = resolveLegacyMountBasePure({
      projectPath: PROJECT_PATH,
      projectConfig: {
        repos: [
          { name: "frontend", url: "x" } as never,
          { name: "backend", url: "x" } as never,
        ],
      },
    });
    expect(r.base).toBe(`${PROJECT_PATH}/repos/frontend`);
    expect(r.repoName).toBe("frontend");
  });

  it("respects an explicit repo.path override (e.g. monorepo subpath)", () => {
    const r = resolveLegacyMountBasePure({
      projectPath: PROJECT_PATH,
      projectConfig: {
        repos: [{ name: "site", url: "x", path: "/custom/checkout/path" } as never],
      },
    });
    expect(r.base).toBe("/custom/checkout/path");
    expect(r.repoName).toBe("site");
  });
});
