import { describe, it, expect } from "vitest";
import { ProjectHostingSchema } from "@agi/config";
import { existsSync, statSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import {
  CODE_SERVED_TYPES,
  DESKTOP_SERVED_TYPES,
  servesDesktopFor,
} from "./project-types.js";

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

  it("tolerates legacy containerKind values via .passthrough() (s150 t630)", () => {
    // After s150 t630, the schema no longer enforces a containerKind enum —
    // it tolerates legacy values via .passthrough(). The s150 t632 boot
    // sweep is the cleaner. s150 t634 then routes dispatch via `type` so
    // the field has no semantic meaning regardless of value.
    const result = ProjectHostingSchema.safeParse({
      enabled: false,
      type: "static-site",
      hostname: "site",
      containerKind: "anything-now",
    });
    expect(result.success).toBe(true);
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

// ---------------------------------------------------------------------------
// s150 t634 — type-driven Desktop-served dispatch (replaces containerKind)
// ---------------------------------------------------------------------------

describe("s150 t634 — type drives container shape", () => {
  it("DESKTOP_SERVED_TYPES routes through servesDesktopFor() to true", () => {
    for (const t of DESKTOP_SERVED_TYPES) {
      expect(servesDesktopFor(t)).toBe(true);
    }
  });

  it("CODE_SERVED_TYPES routes through servesDesktopFor() to false", () => {
    for (const t of CODE_SERVED_TYPES) {
      expect(servesDesktopFor(t)).toBe(false);
    }
  });

  it("ops + media + literature + documentation + backup-aggregator are Desktop-served", () => {
    expect(servesDesktopFor("ops")).toBe(true);
    expect(servesDesktopFor("media")).toBe(true);
    expect(servesDesktopFor("literature")).toBe(true);
    expect(servesDesktopFor("documentation")).toBe(true);
    expect(servesDesktopFor("backup-aggregator")).toBe(true);
  });

  it("web-app + static-site + api-service + php-app + monorepo are code-served", () => {
    expect(servesDesktopFor("web-app")).toBe(false);
    expect(servesDesktopFor("static-site")).toBe(false);
    expect(servesDesktopFor("api-service")).toBe(false);
    expect(servesDesktopFor("php-app")).toBe(false);
    expect(servesDesktopFor("monorepo")).toBe(false);
  });

  it("undefined / null / empty / unknown types return false (safe default)", () => {
    expect(servesDesktopFor(undefined)).toBe(false);
    expect(servesDesktopFor(null)).toBe(false);
    expect(servesDesktopFor("")).toBe(false);
    expect(servesDesktopFor("never-registered-type")).toBe(false);
  });

  it("legacy containerKind value on hosting is ignored — type wins", () => {
    // Schema parses cleanly with a legacy containerKind value (passthrough).
    // Dispatch reads `type`, not `containerKind`. A `web-app` project with
    // a legacy `containerKind: "mapp"` still routes code-served.
    const result = ProjectHostingSchema.safeParse({
      enabled: true,
      type: "web-app",
      hostname: "site",
      containerKind: "mapp",
    });
    expect(result.success).toBe(true);
    expect(servesDesktopFor("web-app")).toBe(false);
  });
});
