import { describe, it, expect } from "vitest";
import { ProjectHostingSchema } from "@agi/config";
import { existsSync, statSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

/**
 * MApp container kind — foundation slice (s145 t584).
 *
 * This spec proves the contract pieces are in place:
 *   1. ProjectHostingSchema accepts containerKind ∈ {static, code, mapp}
 *      and accepts an optional mapps[] string array.
 *   2. The skeleton at templates/.new-mapp-container/ exists and has the
 *      expected shape (no repos/, k/ subset present, project.json valid).
 *   3. The skeleton's project.json sets containerKind=mapp + an empty
 *      mapps[] array, so a project copied from this skeleton boots into
 *      the MApp dispatch branch automatically.
 *
 * The dispatch branch itself in HostingManager.startContainer is wired in
 * the same commit but tested via integration paths (the production e2e
 * suite + the buildMApp follow-up task's test). Mocking the full
 * HostingManager dependency surface for a unit test of one branch isn't
 * worth the maintenance cost when the integration coverage exists.
 */

describe("MApp container kind — schema (s145 t584)", () => {
  it("accepts containerKind=mapp on hosting", () => {
    const result = ProjectHostingSchema.safeParse({
      enabled: false,
      type: "mapp-container",
      hostname: "ops",
      containerKind: "mapp",
      mapps: ["budget", "whitepaper"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.containerKind).toBe("mapp");
      expect(result.data.mapps).toEqual(["budget", "whitepaper"]);
    }
  });

  it("accepts containerKind=static / code as alternatives", () => {
    for (const kind of ["static", "code"] as const) {
      const result = ProjectHostingSchema.safeParse({
        enabled: false,
        type: "static-site",
        hostname: "site",
        containerKind: kind,
      });
      expect(result.success, `containerKind=${kind} should parse`).toBe(true);
    }
  });

  it("rejects containerKind values outside the enum", () => {
    const result = ProjectHostingSchema.safeParse({
      enabled: false,
      type: "static-site",
      hostname: "site",
      containerKind: "invalid-kind" as unknown as "static",
    });
    expect(result.success).toBe(false);
  });

  it("treats containerKind + mapps as fully optional (back-compat)", () => {
    const result = ProjectHostingSchema.safeParse({
      enabled: false,
      type: "static-site",
      hostname: "site",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.containerKind).toBeUndefined();
      expect(result.data.mapps).toBeUndefined();
    }
  });
});

describe("MApp container kind — skeleton (s145 t584)", () => {
  // The skeleton lives at <repo-root>/templates/.new-mapp-container/.
  // Resolve from this test file's location so the path works whether the
  // test runs from the repo root or from a packages/* working dir.
  const skeletonRoot = resolvePath(__dirname, "../../../templates/.new-mapp-container");

  it("skeleton dir exists at templates/.new-mapp-container/", () => {
    expect(existsSync(skeletonRoot)).toBe(true);
    expect(statSync(skeletonRoot).isDirectory()).toBe(true);
  });

  it("skeleton has k/{plans,knowledge,memory}/ subdirs", () => {
    for (const sub of ["plans", "knowledge", "memory"]) {
      const path = join(skeletonRoot, "k", sub);
      expect(existsSync(path), `${path} should exist`).toBe(true);
    }
  });

  it("skeleton has sandbox/ + .trash/ subdirs", () => {
    expect(existsSync(join(skeletonRoot, "sandbox"))).toBe(true);
    expect(existsSync(join(skeletonRoot, ".trash"))).toBe(true);
  });

  it("skeleton does NOT have repos/ — MApp projects don't carry code", () => {
    expect(existsSync(join(skeletonRoot, "repos"))).toBe(false);
  });

  it("skeleton's project.json has containerKind=mapp + empty mapps[]", () => {
    const projectJsonPath = join(skeletonRoot, "project.json");
    expect(existsSync(projectJsonPath)).toBe(true);
    const raw = JSON.parse(require("node:fs").readFileSync(projectJsonPath, "utf-8")) as {
      hosting: { containerKind: string; mapps: string[]; type: string };
    };
    expect(raw.hosting.containerKind).toBe("mapp");
    expect(raw.hosting.mapps).toEqual([]);
    expect(raw.hosting.type).toBe("mapp-container");
  });

  it("skeleton project.json passes ProjectHostingSchema validation", () => {
    const projectJsonPath = join(skeletonRoot, "project.json");
    const raw = JSON.parse(require("node:fs").readFileSync(projectJsonPath, "utf-8")) as {
      hosting: unknown;
    };
    const result = ProjectHostingSchema.safeParse(raw.hosting);
    expect(result.success).toBe(true);
  });
});
