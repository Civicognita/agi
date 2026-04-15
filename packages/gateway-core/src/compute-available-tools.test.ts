/**
 * computeAvailableTools — tier-only filter contract.
 *
 * Locks in the "state is audit metadata, NOT a permission gate" behavior
 * shipped in 7f018d4. Prevents the old state-as-gate shape from creeping
 * back in via a well-intentioned refactor.
 *
 * State (ONLINE / LIMBO / OFFLINE / UNKNOWN) is stamped onto COA<>COI log
 * entries for $imp-minting provenance; it does not decide tool
 * availability. `requiresState` arrays on tool manifests are metadata,
 * preserved for logging / UI dimming, but ignored by this function.
 *
 * Only `requiresTier` filters. The `canUseTool: false` case (unverified
 * tier) short-circuits to "only tier-exempt tools."
 */

import { describe, it, expect } from "vitest";
import { computeAvailableTools } from "./system-prompt.js";
import type { ToolManifestEntry } from "./system-prompt.js";
import type { GatewayState } from "./types.js";

function makeTool(name: string, overrides?: Partial<ToolManifestEntry>): ToolManifestEntry {
  return {
    name,
    description: `Tool ${name}`,
    requiresState: [],
    requiresTier: [],
    ...overrides,
  };
}

const ALL_STATES: GatewayState[] = ["ONLINE", "LIMBO", "OFFLINE", "UNKNOWN"];

describe("computeAvailableTools — tier-only filtering", () => {
  it("returns an empty array when no tools are registered", () => {
    expect(computeAvailableTools("ONLINE", "verified", [])).toHaveLength(0);
    expect(computeAvailableTools("LIMBO", "unverified", [])).toHaveLength(0);
  });

  it("returns all tools when neither state nor tier restrictions apply", () => {
    const tools = [makeTool("a"), makeTool("b"), makeTool("c")];
    const result = computeAvailableTools("LIMBO", "verified", tools);
    expect(result).toHaveLength(3);
  });

  describe("tier filter", () => {
    it("excludes tools whose requiresTier doesn't include the entity tier", () => {
      const tools = [
        makeTool("sealed-only", { requiresTier: ["sealed"] }),
        makeTool("verified-or-sealed", { requiresTier: ["verified", "sealed"] }),
        makeTool("any-tier"),
      ];
      const verified = computeAvailableTools("ONLINE", "verified", tools).map((t) => t.name);
      expect(verified).toContain("verified-or-sealed");
      expect(verified).toContain("any-tier");
      expect(verified).not.toContain("sealed-only");

      const sealed = computeAvailableTools("ONLINE", "sealed", tools).map((t) => t.name);
      expect(sealed).toContain("sealed-only");
      expect(sealed).toContain("verified-or-sealed");
      expect(sealed).toContain("any-tier");
    });

    it("unverified tier only sees tier-exempt tools (canUseTool=false branch)", () => {
      const tools = [
        makeTool("verify-id", { requiresTier: [] }),      // tier-exempt — used before verification
        makeTool("protected", { requiresTier: ["verified"] }),
      ];
      const result = computeAvailableTools("ONLINE", "unverified", tools).map((t) => t.name);
      expect(result).toEqual(["verify-id"]);
    });
  });

  describe("state is audit-only, not a gate", () => {
    // The critical contract: state never filters. A tool with
    // requiresState: ["ONLINE"] is returned in every state, because
    // requiresState is metadata only.

    it("returns a tool with requiresState: ['ONLINE'] in every state", () => {
      const tools = [makeTool("online-stamped", { requiresState: ["ONLINE"] })];
      for (const state of ALL_STATES) {
        const result = computeAvailableTools(state, "verified", tools);
        expect(result, `state=${state}`).toHaveLength(1);
        expect(result[0]!.name).toBe("online-stamped");
      }
    });

    it("returns a tool with requiresState: [] in every state", () => {
      const tools = [makeTool("no-state-constraint", { requiresState: [] })];
      for (const state of ALL_STATES) {
        expect(computeAvailableTools(state, "verified", tools), `state=${state}`).toHaveLength(1);
      }
    });

    it("state does not influence the unverified-tier short-circuit either", () => {
      const tools = [
        makeTool("verify-id", { requiresTier: [], requiresState: ["ONLINE"] }),
        makeTool("protected", { requiresTier: ["verified"], requiresState: [] }),
      ];
      for (const state of ALL_STATES) {
        const unverified = computeAvailableTools(state, "unverified", tools).map((t) => t.name);
        // Unverified gets tier-exempt only, state ignored.
        expect(unverified, `state=${state}`).toEqual(["verify-id"]);
      }
    });
  });

  it("combined filter: tier gates; state ignored", () => {
    const tools: ToolManifestEntry[] = [
      makeTool("a", { requiresTier: ["verified"], requiresState: ["ONLINE"] }),
      makeTool("b", { requiresTier: ["sealed"], requiresState: [] }),
      makeTool("c", { requiresTier: [], requiresState: ["OFFLINE"] }),
    ];
    const verifiedInLimbo = computeAvailableTools("LIMBO", "verified", tools).map((t) => t.name);
    // a passes (tier matches; state ignored), c passes (tier-exempt; state ignored), b excluded by tier
    expect(verifiedInLimbo.sort()).toEqual(["a", "c"]);
  });
});
