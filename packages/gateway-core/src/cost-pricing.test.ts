import { describe, it, expect } from "vitest";
import { computeDollarCost, DEFAULT_PRICING, LOCAL_PROVIDER_IDS } from "./cost-pricing.js";

/**
 * s111 t422 — pricing helper tests. The helper is pure; tests cover
 * cloud rate math, local-Provider zeroing, unknown-Provider null path,
 * unknown-model null path, and customPricing override semantics.
 */

describe("computeDollarCost (s111 t422)", () => {
  it("computes Anthropic Sonnet input + output rates correctly", () => {
    // claude-sonnet-4-6: $3/1M in, $15/1M out. 1000 in + 500 out =
    // 1000 * 3/1_000_000 + 500 * 15/1_000_000 = 0.003 + 0.0075 = 0.0105
    expect(computeDollarCost("anthropic", "claude-sonnet-4-6", 1000, 500)).toBe(0.0105);
  });

  it("computes Anthropic Haiku at the cheap-tier rate", () => {
    // Haiku: $1 in / $5 out. 10000 in + 2000 out = 0.01 + 0.01 = 0.02
    expect(computeDollarCost("anthropic", "claude-haiku-4-5", 10000, 2000)).toBe(0.02);
  });

  it("computes OpenAI gpt-4o-mini at sub-cent precision", () => {
    // gpt-4o-mini: $0.15 in / $0.60 out. 100 in + 50 out =
    // 100 * 0.15/1_000_000 + 50 * 0.60/1_000_000 = 0.000015 + 0.00003 = 0.000045
    expect(computeDollarCost("openai", "gpt-4o-mini", 100, 50)).toBe(0.000045);
  });

  it("returns 0 for every local Provider regardless of token count", () => {
    // Local Providers run on owner hardware — dollar cost always 0.
    // Power (watts × duration) is tracked separately as the energy cost.
    for (const id of LOCAL_PROVIDER_IDS) {
      expect(computeDollarCost(id, "any-model", 999_999, 999_999)).toBe(0);
    }
  });

  it("returns null for unknown Provider id", () => {
    // Plugin Providers that aren't in DEFAULT_PRICING and aren't in the
    // LOCAL_PROVIDER_IDS set surface as "unknown cost" — the ticker shows
    // "—" rather than fabricating a $0.
    expect(computeDollarCost("plugin-mystery", "some-model", 100, 50)).toBeNull();
  });

  it("returns null for unknown model on a known Provider", () => {
    // New Anthropic model that hasn't been added to the pricing table yet.
    // Better to surface "—" than to silently use the wrong rate.
    expect(computeDollarCost("anthropic", "claude-opus-5-future", 100, 50)).toBeNull();
  });

  it("respects customPricing override (gateway.json hot-reload semantic)", () => {
    // Owner adds a new model via gateway.json `costPricing` block without
    // waiting for a release. The override merges with DEFAULT_PRICING for
    // the lookup — but the override TABLE replaces, not merges, so callers
    // must include the existing models if they want both. (This is the
    // pure-function side; the gateway.json deep-merge happens upstream.)
    const overridden = computeDollarCost(
      "anthropic",
      "claude-opus-5-experimental",
      1000,
      500,
      { anthropic: { "claude-opus-5-experimental": { inputPer1M: 20, outputPer1M: 100 } } },
    );
    // 1000 * 20/1_000_000 + 500 * 100/1_000_000 = 0.02 + 0.05 = 0.07
    expect(overridden).toBe(0.07);
  });

  it("DEFAULT_PRICING covers the canonical Anthropic + OpenAI models", () => {
    // Sanity check that the snapshot table has the expected shape so the
    // ticker doesn't surface "—" for everyday models.
    expect(DEFAULT_PRICING["anthropic"]?.["claude-sonnet-4-6"]).toBeDefined();
    expect(DEFAULT_PRICING["anthropic"]?.["claude-haiku-4-5"]).toBeDefined();
    expect(DEFAULT_PRICING["openai"]?.["gpt-4o"]).toBeDefined();
    expect(DEFAULT_PRICING["openai"]?.["gpt-4o-mini"]).toBeDefined();
  });
});
