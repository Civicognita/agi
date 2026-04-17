export type CostMode = "local" | "economy" | "balanced" | "max";

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-haiku-4-5": { input: 0.80, output: 4.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-20241022": { input: 0.80, output: 4.0 },
  "gpt-4o": { input: 2.50, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },
};

export { PRICING };

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(PRICING).find((k) => model.startsWith(k));
  if (!key) return 0;
  const p = PRICING[key]!;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

export interface ModelTier {
  provider: string;
  model: string;
  modes: CostMode[];
}

export const MODEL_TIERS: ModelTier[] = [
  { provider: "anthropic", model: "claude-haiku-4-5", modes: ["economy", "balanced"] },
  { provider: "anthropic", model: "claude-sonnet-4-6", modes: ["economy", "balanced", "max"] },
  { provider: "anthropic", model: "claude-opus-4-6", modes: ["max"] },
  { provider: "openai", model: "gpt-4o-mini", modes: ["economy", "balanced"] },
  { provider: "openai", model: "gpt-4o", modes: ["balanced", "max"] },
  { provider: "openai", model: "gpt-4-turbo", modes: ["max"] },
  { provider: "ollama", model: "llama3.1", modes: ["local", "economy"] },
];

export function getModelsForMode(mode: CostMode): ModelTier[] {
  if (mode === "local") {
    return MODEL_TIERS.filter((t) => t.provider === "ollama" || t.provider === "hf-local");
  }
  return MODEL_TIERS.filter((t) => t.modes.includes(mode));
}

export function getDefaultModelForMode(mode: CostMode, provider: string): string | undefined {
  const tier = MODEL_TIERS.find((t) => t.provider === provider && t.modes.includes(mode));
  return tier?.model;
}
