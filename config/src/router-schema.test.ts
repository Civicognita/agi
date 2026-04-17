/**
 * RouterConfigSchema Tests — Phase 8f
 *
 * Validates that RouterConfigSchema (nested under AionimaConfigSchema)
 * applies correct defaults, accepts all valid cost modes, and rejects
 * out-of-range values.
 */

import { describe, it, expect } from "vitest";
import { AionimaConfigSchema } from "./schema.js";

describe("RouterConfigSchema", () => {
  it("provides defaults when no router config specified", () => {
    const parsed = AionimaConfigSchema.parse({});
    expect(parsed.agent?.router?.costMode).toBe("balanced");
    expect(parsed.agent?.router?.escalation).toBe(false);
    expect(parsed.agent?.router?.maxEscalationsPerTurn).toBe(1);
  });

  it("parses empty router object with all defaults", () => {
    const parsed = AionimaConfigSchema.parse({
      agent: { router: {} },
    });
    expect(parsed.agent?.router?.costMode).toBe("balanced");
    expect(parsed.agent?.router?.escalation).toBe(false);
    expect(parsed.agent?.router?.simpleThresholdTokens).toBe(500);
    expect(parsed.agent?.router?.complexThresholdTokens).toBe(2000);
  });

  it("validates cost mode enum", () => {
    expect(() => AionimaConfigSchema.parse({
      agent: { router: { costMode: "invalid" } },
    })).toThrow();
  });

  it("accepts all valid cost modes", () => {
    for (const mode of ["local", "economy", "balanced", "max"]) {
      const parsed = AionimaConfigSchema.parse({ agent: { router: { costMode: mode } } });
      expect(parsed.agent?.router?.costMode).toBe(mode);
    }
  });

  it("rejects negative escalation count", () => {
    expect(() => AionimaConfigSchema.parse({
      agent: { router: { maxEscalationsPerTurn: -1 } },
    })).toThrow();
  });

  it("accepts zero escalation count", () => {
    const parsed = AionimaConfigSchema.parse({
      agent: { router: { maxEscalationsPerTurn: 0 } },
    });
    expect(parsed.agent?.router?.maxEscalationsPerTurn).toBe(0);
  });

  it("rejects zero for threshold tokens (must be positive)", () => {
    expect(() => AionimaConfigSchema.parse({
      agent: { router: { simpleThresholdTokens: 0 } },
    })).toThrow();
  });
});
