/**
 * project-types — tests for iterativeWorkEligible inference + cadence
 * options helper (s118 redesign 2026-04-27, t445 D4).
 */

import { describe, expect, it } from "vitest";
import {
  cadenceOptionsFor,
  createProjectTypeRegistry,
  DEV_CADENCE_OPTIONS,
  ITERATIVE_WORK_ELIGIBLE_CATEGORIES,
  OPS_CADENCE_OPTIONS,
  ProjectTypeRegistry,
  type ProjectCategory,
} from "./project-types.js";

describe("ITERATIVE_WORK_ELIGIBLE_CATEGORIES", () => {
  it("includes web, app, ops, administration", () => {
    expect(ITERATIVE_WORK_ELIGIBLE_CATEGORIES.has("web")).toBe(true);
    expect(ITERATIVE_WORK_ELIGIBLE_CATEGORIES.has("app")).toBe(true);
    expect(ITERATIVE_WORK_ELIGIBLE_CATEGORIES.has("ops")).toBe(true);
    expect(ITERATIVE_WORK_ELIGIBLE_CATEGORIES.has("administration")).toBe(true);
  });

  it("excludes literature, media, monorepo", () => {
    expect(ITERATIVE_WORK_ELIGIBLE_CATEGORIES.has("literature")).toBe(false);
    expect(ITERATIVE_WORK_ELIGIBLE_CATEGORIES.has("media")).toBe(false);
    expect(ITERATIVE_WORK_ELIGIBLE_CATEGORIES.has("monorepo")).toBe(false);
  });
});

describe("cadenceOptionsFor", () => {
  it("returns dev options (30m, 1h) for web + app categories", () => {
    expect(cadenceOptionsFor("web")).toEqual(DEV_CADENCE_OPTIONS);
    expect(cadenceOptionsFor("app")).toEqual(DEV_CADENCE_OPTIONS);
    expect(DEV_CADENCE_OPTIONS).toEqual(["30m", "1h"]);
  });

  it("returns ops options (30m through 1w) for ops + administration categories", () => {
    expect(cadenceOptionsFor("ops")).toEqual(OPS_CADENCE_OPTIONS);
    expect(cadenceOptionsFor("administration")).toEqual(OPS_CADENCE_OPTIONS);
    expect(OPS_CADENCE_OPTIONS).toEqual(["30m", "1h", "5h", "12h", "1d", "5d", "1w"]);
  });

  it("returns empty array for ineligible categories", () => {
    const ineligible: ProjectCategory[] = ["literature", "media", "monorepo"];
    for (const cat of ineligible) {
      expect(cadenceOptionsFor(cat)).toEqual([]);
    }
  });
});

describe("ProjectTypeRegistry.register iterativeWorkEligible inference", () => {
  it("infers true for app/web/ops/administration when not explicit", () => {
    const reg = new ProjectTypeRegistry();
    reg.register({
      id: "test-app",
      label: "Test App",
      category: "app",
      hostable: true,
      hasCode: true,
      defaultMeta: {},
      tools: [],
    });
    reg.register({
      id: "test-ops",
      label: "Test Ops",
      category: "ops",
      hostable: false,
      hasCode: true,
      defaultMeta: {},
      tools: [],
    });
    expect(reg.get("test-app")?.iterativeWorkEligible).toBe(true);
    expect(reg.get("test-ops")?.iterativeWorkEligible).toBe(true);
  });

  it("infers false for literature/media/monorepo when not explicit", () => {
    const reg = new ProjectTypeRegistry();
    reg.register({
      id: "test-lit",
      label: "Test Lit",
      category: "literature",
      hostable: false,
      hasCode: false,
      defaultMeta: {},
      tools: [],
    });
    reg.register({
      id: "test-mono",
      label: "Test Monorepo",
      category: "monorepo",
      hostable: false,
      hasCode: true,
      defaultMeta: {},
      tools: [],
    });
    expect(reg.get("test-lit")?.iterativeWorkEligible).toBe(false);
    expect(reg.get("test-mono")?.iterativeWorkEligible).toBe(false);
  });

  it("respects explicit override (e.g. plugin force-disables for an app type)", () => {
    const reg = new ProjectTypeRegistry();
    reg.register({
      id: "test-app-disabled",
      label: "App without iterative work",
      category: "app",
      hostable: true,
      hasCode: true,
      iterativeWorkEligible: false,
      defaultMeta: {},
      tools: [],
    });
    expect(reg.get("test-app-disabled")?.iterativeWorkEligible).toBe(false);
  });
});

describe("createProjectTypeRegistry built-ins", () => {
  it("production (administration) is iterative-work eligible", () => {
    const reg = createProjectTypeRegistry();
    expect(reg.get("production")?.iterativeWorkEligible).toBe(true);
  });

  it("aionima (monorepo) is NOT iterative-work eligible", () => {
    const reg = createProjectTypeRegistry();
    expect(reg.get("aionima")?.iterativeWorkEligible).toBe(false);
  });

  it("getIterativeWorkEligible returns only eligible types", () => {
    const reg = createProjectTypeRegistry();
    const eligible = reg.getIterativeWorkEligible();
    const ids = eligible.map((t) => t.id).sort();
    expect(ids).toEqual(["production"]);
  });

  it("toJSON includes iterativeWorkEligible flag", () => {
    const reg = createProjectTypeRegistry();
    const json = reg.toJSON();
    const production = json.find((t) => t.id === "production");
    const aionima = json.find((t) => t.id === "aionima");
    expect(production?.iterativeWorkEligible).toBe(true);
    expect(aionima?.iterativeWorkEligible).toBe(false);
  });
});
