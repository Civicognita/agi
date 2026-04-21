/**
 * Static model capabilities registry.
 *
 * Surfaces two indicators per model for UI display (Phase 8 QoL B of the
 * dynamic-context plan):
 *   - `contextWindow`: max input tokens the model accepts
 *   - `toolSupport`: whether the model can reliably call tools
 *
 * Lookup is family-pattern based (glob-ish prefix match on model id) with
 * provider-level fallbacks. Unknown models return `null` — the caller decides
 * whether to show "Unknown" or omit the indicator.
 */

export interface ModelCapability {
  contextWindow: number;
  toolSupport: boolean;
  /** Which registry entry supplied the data — useful for UI tooltips. */
  source: "family" | "provider-default" | "unknown";
}

interface FamilyPattern {
  /** Case-insensitive substring test against the model id. */
  match: string;
  contextWindow: number;
  toolSupport: boolean;
}

const FAMILY_PATTERNS: FamilyPattern[] = [
  // Anthropic
  { match: "claude-opus-4", contextWindow: 200_000, toolSupport: true },
  { match: "claude-sonnet-4", contextWindow: 200_000, toolSupport: true },
  { match: "claude-haiku-4", contextWindow: 200_000, toolSupport: true },
  { match: "claude-3", contextWindow: 200_000, toolSupport: true },

  // OpenAI
  { match: "gpt-4o", contextWindow: 128_000, toolSupport: true },
  { match: "gpt-4-turbo", contextWindow: 128_000, toolSupport: true },
  { match: "gpt-4", contextWindow: 8_192, toolSupport: true },
  { match: "gpt-3.5", contextWindow: 16_385, toolSupport: true },
  { match: "o1-", contextWindow: 128_000, toolSupport: false },
  { match: "o3-", contextWindow: 200_000, toolSupport: true },

  // Qwen (current Ollama/HF default family — v0.4.25+)
  { match: "qwen3", contextWindow: 32_768, toolSupport: true },
  { match: "qwen2.5-coder", contextWindow: 32_768, toolSupport: true },
  { match: "qwen2.5", contextWindow: 32_768, toolSupport: true },
  { match: "qwen2", contextWindow: 32_768, toolSupport: true },

  // Llama
  { match: "llama-3.3", contextWindow: 128_000, toolSupport: true },
  { match: "llama-3.2", contextWindow: 128_000, toolSupport: true },
  { match: "llama-3.1", contextWindow: 128_000, toolSupport: true },
  { match: "llama-3", contextWindow: 8_192, toolSupport: true },

  // Mistral
  { match: "mistral-large", contextWindow: 128_000, toolSupport: true },
  { match: "mistral-nemo", contextWindow: 128_000, toolSupport: true },
  { match: "mistral", contextWindow: 32_768, toolSupport: true },
  { match: "mixtral", contextWindow: 32_768, toolSupport: true },

  // Phi
  { match: "phi-4", contextWindow: 16_384, toolSupport: true },
  { match: "phi-3.5", contextWindow: 128_000, toolSupport: true },
  { match: "phi-3", contextWindow: 128_000, toolSupport: true },

  // Gemma (no reliable tool calling)
  { match: "gemma-2", contextWindow: 8_192, toolSupport: false },
  { match: "gemma", contextWindow: 8_192, toolSupport: false },

  // DeepSeek
  { match: "deepseek-r1", contextWindow: 65_536, toolSupport: false },
  { match: "deepseek-coder", contextWindow: 16_384, toolSupport: true },
  { match: "deepseek", contextWindow: 32_768, toolSupport: true },

  // Embedding / non-generative families — conservative defaults, no tool support
  { match: "bge-", contextWindow: 512, toolSupport: false },
  { match: "e5-", contextWindow: 512, toolSupport: false },
  { match: "sentence-transformers", contextWindow: 512, toolSupport: false },
];

/**
 * Provider-level fallbacks when no family pattern matches.
 * Keys are lower-cased provider ids as used in AGI config.
 */
const PROVIDER_DEFAULTS: Record<string, { contextWindow: number; toolSupport: boolean }> = {
  anthropic: { contextWindow: 200_000, toolSupport: true },
  openai: { contextWindow: 128_000, toolSupport: true },
  ollama: { contextWindow: 32_768, toolSupport: true },
  huggingface: { contextWindow: 4_096, toolSupport: false },
};

/**
 * Resolve capability for a model id. Returns `null` when neither a family
 * pattern nor a provider default matches — callers may render "Unknown".
 */
export function resolveModelCapability(
  modelId: string,
  provider?: string,
): ModelCapability | null {
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
    const providerKey = provider.toLowerCase();
    const fallback = PROVIDER_DEFAULTS[providerKey];
    if (fallback !== undefined) {
      return { ...fallback, source: "provider-default" };
    }
  }
  return null;
}
