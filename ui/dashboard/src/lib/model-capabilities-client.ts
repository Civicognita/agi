/**
 * Frontend mirror of @agi/model-runtime's model-capabilities registry.
 *
 * Used where backend-enriched payloads aren't available (Providers UI dropdown,
 * which uses hardcoded MODELS_BY_PROVIDER). The backend file is the authoritative
 * source — keep this mirror in rough sync when adding new families.
 *
 * Source: packages/model-runtime/src/model-capabilities.ts
 */

import type { ModelCapabilityInfo } from "@/types.js";

interface FamilyPattern {
  match: string;
  contextWindow: number;
  toolSupport: boolean;
}

const FAMILY_PATTERNS: FamilyPattern[] = [
  { match: "claude-opus-4", contextWindow: 200_000, toolSupport: true },
  { match: "claude-sonnet-4", contextWindow: 200_000, toolSupport: true },
  { match: "claude-haiku-4", contextWindow: 200_000, toolSupport: true },
  { match: "claude-3", contextWindow: 200_000, toolSupport: true },
  { match: "gpt-4o", contextWindow: 128_000, toolSupport: true },
  { match: "gpt-4-turbo", contextWindow: 128_000, toolSupport: true },
  { match: "gpt-4", contextWindow: 8_192, toolSupport: true },
  { match: "gpt-3.5", contextWindow: 16_385, toolSupport: true },
  { match: "o1-", contextWindow: 128_000, toolSupport: false },
  { match: "o3-", contextWindow: 200_000, toolSupport: true },
  { match: "qwen3", contextWindow: 32_768, toolSupport: true },
  { match: "qwen2.5-coder", contextWindow: 32_768, toolSupport: true },
  { match: "qwen2.5", contextWindow: 32_768, toolSupport: true },
  { match: "qwen2", contextWindow: 32_768, toolSupport: true },
  { match: "llama-3.3", contextWindow: 128_000, toolSupport: true },
  { match: "llama-3.2", contextWindow: 128_000, toolSupport: true },
  { match: "llama-3.1", contextWindow: 128_000, toolSupport: true },
  { match: "llama-3", contextWindow: 8_192, toolSupport: true },
  { match: "mistral-large", contextWindow: 128_000, toolSupport: true },
  { match: "mistral-nemo", contextWindow: 128_000, toolSupport: true },
  { match: "mistral", contextWindow: 32_768, toolSupport: true },
  { match: "mixtral", contextWindow: 32_768, toolSupport: true },
  { match: "phi-4", contextWindow: 16_384, toolSupport: true },
  { match: "phi-3.5", contextWindow: 128_000, toolSupport: true },
  { match: "phi-3", contextWindow: 128_000, toolSupport: true },
  { match: "gemma-2", contextWindow: 8_192, toolSupport: false },
  { match: "gemma", contextWindow: 8_192, toolSupport: false },
  { match: "deepseek-r1", contextWindow: 65_536, toolSupport: false },
  { match: "deepseek-coder", contextWindow: 16_384, toolSupport: true },
  { match: "deepseek", contextWindow: 32_768, toolSupport: true },
];

const PROVIDER_DEFAULTS: Record<string, { contextWindow: number; toolSupport: boolean }> = {
  anthropic: { contextWindow: 200_000, toolSupport: true },
  openai: { contextWindow: 128_000, toolSupport: true },
  ollama: { contextWindow: 32_768, toolSupport: true },
};

export function resolveModelCapabilityClient(
  modelId: string,
  provider?: string,
): ModelCapabilityInfo | null {
  if (modelId === "") return null;
  const lower = modelId.toLowerCase();
  for (const pattern of FAMILY_PATTERNS) {
    if (lower.includes(pattern.match)) {
      return {
        contextWindow: pattern.contextWindow,
        toolSupport: pattern.toolSupport,
        source: "family",
      };
    }
  }
  if (provider !== undefined) {
    const fallback = PROVIDER_DEFAULTS[provider.toLowerCase()];
    if (fallback !== undefined) {
      return { ...fallback, source: "provider-default" };
    }
  }
  return null;
}
