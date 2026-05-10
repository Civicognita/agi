/**
 * project-mode-narrowing pure-logic tests (s134 t517 item 8 follow-up).
 */

import { describe, it, expect } from "vitest";
import {
  ALL_PROJECT_MODES,
  computeVisibleModes,
  fallbackModeForCategory,
  isModeHiddenForCategory,
} from "./project-mode-narrowing.js";

describe("isModeHiddenForCategory (s134 t517)", () => {
  it("hides develop for literature/media/administration", () => {
    expect(isModeHiddenForCategory("develop", "literature")).toBe(true);
    expect(isModeHiddenForCategory("develop", "media")).toBe(true);
    expect(isModeHiddenForCategory("develop", "administration")).toBe(true);
  });

  it("hides operate for literature/media but NOT administration", () => {
    expect(isModeHiddenForCategory("operate", "literature")).toBe(true);
    expect(isModeHiddenForCategory("operate", "media")).toBe(true);
    expect(isModeHiddenForCategory("operate", "administration")).toBe(false);
  });

  it("never hides coordinate or insight", () => {
    for (const cat of ["literature", "media", "administration", "app", "web", "ops"]) {
      expect(isModeHiddenForCategory("coordinate", cat)).toBe(false);
      expect(isModeHiddenForCategory("insight", cat)).toBe(false);
    }
  });

  it("treats null/undefined/unknown category as no narrowing", () => {
    for (const mode of ALL_PROJECT_MODES) {
      expect(isModeHiddenForCategory(mode, null)).toBe(false);
      expect(isModeHiddenForCategory(mode, undefined)).toBe(false);
      expect(isModeHiddenForCategory(mode, "anything-else")).toBe(false);
    }
  });
});

describe("computeVisibleModes (s134 t517)", () => {
  it("returns all 4 modes for app/web/ops/unknown", () => {
    for (const cat of ["app", "web", "ops", null, undefined, "made-up"]) {
      expect(computeVisibleModes(cat)).toEqual(["develop", "operate", "coordinate", "insight"]);
    }
  });

  it("returns coordinate+insight for literature/media", () => {
    expect(computeVisibleModes("literature")).toEqual(["coordinate", "insight"]);
    expect(computeVisibleModes("media")).toEqual(["coordinate", "insight"]);
  });

  it("returns operate+coordinate+insight for administration", () => {
    expect(computeVisibleModes("administration")).toEqual(["operate", "coordinate", "insight"]);
  });

  it("always preserves ALL_PROJECT_MODES order", () => {
    const modes = computeVisibleModes("administration");
    expect(modes.indexOf("operate")).toBeLessThan(modes.indexOf("coordinate"));
    expect(modes.indexOf("coordinate")).toBeLessThan(modes.indexOf("insight"));
  });
});

describe("fallbackModeForCategory (s134 t517)", () => {
  it("returns null when current mode is still visible", () => {
    expect(fallbackModeForCategory("coordinate", "literature")).toBeNull();
    expect(fallbackModeForCategory("develop", "app")).toBeNull();
  });

  it("redirects develop to operate when only develop is hidden", () => {
    expect(fallbackModeForCategory("develop", "administration")).toBe("operate");
  });

  it("redirects develop to coordinate for literature/media", () => {
    expect(fallbackModeForCategory("develop", "literature")).toBe("coordinate");
    expect(fallbackModeForCategory("develop", "media")).toBe("coordinate");
  });

  it("redirects operate to coordinate for literature/media", () => {
    expect(fallbackModeForCategory("operate", "literature")).toBe("coordinate");
    expect(fallbackModeForCategory("operate", "media")).toBe("coordinate");
  });
});
