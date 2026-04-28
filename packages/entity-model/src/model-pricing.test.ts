import { describe, it, expect } from "vitest";
import { estimateCost, PRICING, MODEL_TIERS, getModelsForMode, getDefaultModelForMode } from "./model-pricing.js";

describe("estimateCost", () => {
  it("calculates cost for claude-sonnet-4-6", () => {
    // 1M input tokens at $3.00 + 1M output at $15.00 = $18.00
    expect(estimateCost("claude-sonnet-4-6", 1_000_000, 1_000_000)).toBeCloseTo(18.0);
  });

  it("calculates cost for claude-opus-4-6", () => {
    expect(estimateCost("claude-opus-4-6", 1_000_000, 1_000_000)).toBeCloseTo(90.0);
  });

  it("calculates cost for gpt-4o-mini", () => {
    expect(estimateCost("gpt-4o-mini", 1_000_000, 1_000_000)).toBeCloseTo(0.75);
  });

  it("matches model by prefix", () => {
    // Model with suffix like context window info
    const cost = estimateCost("claude-sonnet-4-6[1m]", 100_000, 50_000);
    expect(cost).toBeGreaterThan(0);
  });

  it("returns 0 for unknown models", () => {
    expect(estimateCost("unknown-model", 1000, 500)).toBe(0);
  });

  it("handles zero tokens", () => {
    expect(estimateCost("claude-sonnet-4-6", 0, 0)).toBe(0);
  });

  it("handles realistic request sizes", () => {
    // 12k input, 800 output with sonnet: ~$0.048
    const cost = estimateCost("claude-sonnet-4-6", 12000, 800);
    expect(cost).toBeGreaterThan(0.04);
    expect(cost).toBeLessThan(0.06);
  });
});

describe("PRICING", () => {
  it("has entries for all major models", () => {
    expect(PRICING["claude-sonnet-4-6"]).toBeDefined();
    expect(PRICING["claude-opus-4-6"]).toBeDefined();
    expect(PRICING["claude-haiku-4-5"]).toBeDefined();
    expect(PRICING["gpt-4o"]).toBeDefined();
    expect(PRICING["gpt-4o-mini"]).toBeDefined();
    expect(PRICING["gpt-4-turbo"]).toBeDefined();
  });

  it("all entries have positive input and output prices", () => {
    for (const [model, price] of Object.entries(PRICING)) {
      expect(price.input, `${model} input`).toBeGreaterThan(0);
      expect(price.output, `${model} output`).toBeGreaterThan(0);
    }
  });
});

describe("MODEL_TIERS", () => {
  it("every tier has at least one cost mode", () => {
    for (const tier of MODEL_TIERS) {
      expect(tier.modes.length, `${tier.provider}/${tier.model}`).toBeGreaterThan(0);
    }
  });

  it("has entries for anthropic, openai, and ollama", () => {
    const providers = new Set(MODEL_TIERS.map((t) => t.provider));
    expect(providers.has("anthropic")).toBe(true);
    expect(providers.has("openai")).toBe(true);
    expect(providers.has("ollama")).toBe(true);
  });

  it("economy tier has cheap models", () => {
    const economy = MODEL_TIERS.filter((t) => t.modes.includes("economy"));
    const models = economy.map((t) => t.model);
    expect(models).toContain("claude-haiku-4-5");
    expect(models).toContain("gpt-4o-mini");
  });

  it("max tier has premium models", () => {
    const max = MODEL_TIERS.filter((t) => t.modes.includes("max"));
    const models = max.map((t) => t.model);
    expect(models).toContain("claude-opus-4-6");
  });
});

describe("getModelsForMode", () => {
  it("returns only local providers for local mode", () => {
    const models = getModelsForMode("local");
    for (const m of models) {
      expect(["ollama", "hf-local"]).toContain(m.provider);
    }
  });

  it("returns economy-tier models", () => {
    const models = getModelsForMode("economy");
    expect(models.length).toBeGreaterThan(0);
    const modelNames = models.map((m) => m.model);
    expect(modelNames).toContain("claude-haiku-4-5");
  });

  it("returns balanced-tier models", () => {
    const models = getModelsForMode("balanced");
    expect(models.length).toBeGreaterThan(0);
    const modelNames = models.map((m) => m.model);
    expect(modelNames).toContain("claude-sonnet-4-6");
  });

  it("returns max-tier models", () => {
    const models = getModelsForMode("max");
    expect(models.length).toBeGreaterThan(0);
    const modelNames = models.map((m) => m.model);
    expect(modelNames).toContain("claude-opus-4-6");
  });
});

describe("getDefaultModelForMode", () => {
  it("returns haiku for economy + anthropic", () => {
    expect(getDefaultModelForMode("economy", "anthropic")).toBe("claude-haiku-4-5");
  });

  it("returns gpt-4o-mini for economy + openai", () => {
    expect(getDefaultModelForMode("economy", "openai")).toBe("gpt-4o-mini");
  });

  it("returns a model for balanced + anthropic", () => {
    expect(getDefaultModelForMode("balanced", "anthropic")).toMatch(/haiku|sonnet/);
  });

  it("returns opus for max + anthropic", () => {
    expect(getDefaultModelForMode("max", "anthropic")).toMatch(/opus|sonnet/);
  });

  it("returns undefined for unknown provider", () => {
    expect(getDefaultModelForMode("balanced", "nonexistent")).toBeUndefined();
  });
});
