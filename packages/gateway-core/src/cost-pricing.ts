/**
 * Cost pricing — per-Provider per-model $/1M tokens (s111 t422).
 *
 * Cloud Providers charge for input + output tokens separately. The numbers
 * change quarterly as Providers ship new models — this table is a SNAPSHOT,
 * intended to be hot-reloaded via gateway.json `costPricing` overrides.
 * Numbers below reflect April 2026 published rates; verify before relying on
 * exact dollar accuracy. The Providers UX cost ticker is the consumer.
 *
 * Per the s111 framing: dollar cost is one input to TRUECOST. Power (watts
 * × duration → Wh) is the other input, sampled at the same turn-end moment
 * via the t377/t417 power samplers. Together they feed the cost ticker
 * (today/week/by-Provider rollups) and eventually $IMP minting (v0.6.0+).
 *
 * This file exports both the table and the computeDollarCost helper. The
 * helper is the unit-test surface; the table can be overridden via the
 * `customPricing` parameter when the gateway hot-reloads pricing config.
 *
 * Local Providers (aion-micro, ollama, lemonade, hf-local) cost $0 — they
 * run on owner hardware. The "cost" they incur is power (already tracked
 * separately) and the opportunity cost of slower latency. Returning 0
 * (not null) for local Providers is meaningful: aggregations should sum
 * to "$0.00 today" when only local Providers ran.
 */

/** $/1M tokens for a single Provider+model. */
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

/** Provider id → (model id → pricing). Local Providers absent here = $0. */
export type PricingTable = Record<string, Record<string, ModelPricing>>;

/** Default pricing snapshot — April 2026 published rates from
 *  anthropic.com/pricing and openai.com/api/pricing. Cloud Providers only;
 *  local Providers fall through to $0 in computeDollarCost. */
export const DEFAULT_PRICING: PricingTable = {
  anthropic: {
    "claude-haiku-4-5": { inputPer1M: 1.0, outputPer1M: 5.0 },
    "claude-sonnet-4-6": { inputPer1M: 3.0, outputPer1M: 15.0 },
    "claude-opus-4-6": { inputPer1M: 15.0, outputPer1M: 75.0 },
  },
  openai: {
    "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
    "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
    "o1-mini": { inputPer1M: 3.0, outputPer1M: 12.0 },
    "o1": { inputPer1M: 15.0, outputPer1M: 60.0 },
  },
};

/** Provider ids that always cost $0 — local Providers running on owner
 *  hardware. The list mirrors providers-api catalog tiers (floor + local +
 *  core except cloud). When a future plugin Provider is local-by-nature
 *  but not in this list, computeDollarCost returns null (unknown) which
 *  the cost ticker can surface as "—" rather than fabricating a $0. */
export const LOCAL_PROVIDER_IDS = new Set([
  "aion-micro",
  "ollama",
  "lemonade",
  "hf-local",
  "huggingface",
]);

/**
 * Compute USD cost for a single turn given Provider, model, and token
 * counts. Returns:
 *   - 0 for local Providers (always free at the dollar level)
 *   - computed cost for cloud Providers when the model is in the table
 *   - null when the Provider is unknown OR the model isn't in the
 *     Provider's pricing table (treated as "unknown cost" — the ticker
 *     shows "—", aggregations skip the row via NULL semantics)
 *
 * The customPricing parameter lets gateway.json override a single Provider
 * or model without requiring a code change — supports adding new models
 * (e.g. "claude-opus-5") without waiting for a release.
 *
 * Pure function — tests cover all branches independently of any DB.
 */
export function computeDollarCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  customPricing?: PricingTable,
): number | null {
  if (LOCAL_PROVIDER_IDS.has(provider)) return 0;

  const table = customPricing ?? DEFAULT_PRICING;
  const providerTable = table[provider];
  if (providerTable === undefined) return null;
  const modelPricing = providerTable[model];
  if (modelPricing === undefined) return null;

  // $/1M tokens × (tokens / 1_000_000) = USD cost.
  // Round to 6 decimals — sub-cent precision matters for high-volume
  // aggregations where individual turns are < $0.001.
  const cost =
    (inputTokens * modelPricing.inputPer1M + outputTokens * modelPricing.outputPer1M) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
