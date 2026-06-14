import { describe, it, expect } from "vitest";

import { compareSemver, isVersionNewer, parseSemver } from "./version-compare.js";

/**
 * version-compare — the semver gate behind "is this source a real upgrade?".
 *
 * The bug these guard: the Upgrade Wizard counted raw commit topology, so
 * `Civicognita/agi — main` (v0.4.906) looked like "4 commits available" to a
 * fork on v0.4.911 — those 4 commits are merge bubbles from PRs that flowed
 * dev → main. The VERSION is the reliable discriminator (every commit bumps it),
 * so a source is only an upgrade when its version is STRICTLY newer.
 */
describe("version-compare", () => {
  it("parseSemver extracts major/minor/patch and tolerates a v-prefix", () => {
    expect(parseSemver("0.4.911")).toEqual([0, 4, 911]);
    expect(parseSemver("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver("0.4.911-rc.1")).toEqual([0, 4, 911]); // suffix ignored
    expect(parseSemver("garbage")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });

  it("compareSemver orders by major, then minor, then patch", () => {
    expect(compareSemver("0.4.911", "0.4.906")).toBeGreaterThan(0);
    expect(compareSemver("0.4.906", "0.4.911")).toBeLessThan(0);
    expect(compareSemver("0.4.911", "0.4.911")).toBe(0);
    expect(compareSemver("1.0.0", "0.9.99")).toBeGreaterThan(0);
    expect(compareSemver("0.5.0", "0.4.999")).toBeGreaterThan(0);
  });

  it("isVersionNewer is a STRICT greater-than", () => {
    expect(isVersionNewer("0.4.912", "0.4.911")).toBe(true);
    expect(isVersionNewer("0.4.911", "0.4.911")).toBe(false);
    // The exact merge-bubble case from the owner's wizard screenshot:
    expect(isVersionNewer("0.4.906", "0.4.911")).toBe(false);
  });

  it("is conservative on unparseable input (never a false upgrade)", () => {
    expect(compareSemver("garbage", "0.4.911")).toBe(0);
    expect(isVersionNewer("garbage", "0.4.911")).toBe(false);
    expect(isVersionNewer("0.4.912", "garbage")).toBe(false);
  });
});
