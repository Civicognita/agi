/**
 * LLM Provider Factory — Task #53
 *
 * Creates the appropriate LLMProvider based on AionimaConfig.
 * Supports single-provider and failover-provider configurations.
 */

import type { AionimaConfig } from "@aionima/config";

import type { LLMProvider, LLMProviderConfig } from "./provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { FailoverProvider } from "./failover-provider.js";

// ---------------------------------------------------------------------------
// ENV key map
// ---------------------------------------------------------------------------

const ENV_KEYS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  ollama: "", // Ollama doesn't need an API key
  "hf-local": "", // Local model, no API key needed
};

// ---------------------------------------------------------------------------
// Single-provider factory
// ---------------------------------------------------------------------------

function createSingleProvider(
  type: string,
  config: Partial<LLMProviderConfig>,
): LLMProvider {
  switch (type) {
    case "anthropic":
      return new AnthropicProvider({
        apiKey: config.apiKey ?? process.env[ENV_KEYS["anthropic"]!],
        defaultModel: config.defaultModel ?? "claude-sonnet-4-6",
        maxTokens: config.maxTokens ?? 8192,
        maxRetries: config.maxRetries ?? 3,
        baseUrl: config.baseUrl,
      });

    case "openai":
      return new OpenAIProvider({
        apiKey: config.apiKey ?? process.env[ENV_KEYS["openai"]!],
        defaultModel: config.defaultModel ?? "gpt-4o",
        maxTokens: config.maxTokens ?? 8192,
        maxRetries: config.maxRetries ?? 3,
        baseUrl: config.baseUrl,
      });

    case "ollama":
      return new OllamaProvider({
        defaultModel: config.defaultModel ?? "llama3.1",
        maxTokens: config.maxTokens ?? 8192,
        maxRetries: config.maxRetries ?? 3,
        baseUrl: config.baseUrl ?? "http://127.0.0.1:11434",
      });

    case "hf-local":
      return new OpenAIProvider({
        apiKey: "not-needed",
        defaultModel: config.defaultModel ?? "local",
        maxTokens: config.maxTokens ?? 4096,
        maxRetries: config.maxRetries ?? 2,
        baseUrl: config.baseUrl ?? "http://127.0.0.1:6000",
      });

    default:
      throw new Error(`Unknown LLM provider type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create an LLMProvider from AionimaConfig.
 *
 * - If `config.agent.providers` is set, creates a FailoverProvider that
 *   tries each provider in order on transient errors.
 * - Otherwise creates a single provider based on `config.agent.provider`.
 */
export function createLLMProvider(config: AionimaConfig): LLMProvider {
  const agent = config.agent as {
    provider?: string;
    model?: string;
    maxTokens?: number;
    maxRetries?: number;
    baseUrl?: string;
    providers?: Array<{ type: string; model: string; apiKey?: string; baseUrl?: string }>;
  } | undefined ?? {};
  const providerType = agent.provider ?? "anthropic";
  const model = agent.model ?? "claude-sonnet-4-6";
  const maxTokens = agent.maxTokens ?? 8192;
  const maxRetries = agent.maxRetries ?? 3;
  const baseUrl = agent.baseUrl;

  // Check for failover configuration
  const providers = agent.providers;

  if (providers !== undefined && providers.length > 0) {
    const failoverProviders = providers.map((p) => ({
      provider: createSingleProvider(p.type, {
        apiKey: p.apiKey,
        defaultModel: p.model,
        maxTokens,
        maxRetries,
        baseUrl: p.baseUrl,
      }),
      label: `${p.type}/${p.model}`,
    }));
    return new FailoverProvider(failoverProviders);
  }

  // Single provider — check top-level providers for key/baseUrl fallback
  const providersCred = config.providers as Record<string, { apiKey?: string; baseUrl?: string }> | undefined;
  const providerCred = providersCred?.[providerType];

  return createSingleProvider(providerType, {
    apiKey: providerCred?.apiKey,
    defaultModel: model,
    maxTokens,
    maxRetries,
    baseUrl: baseUrl ?? providerCred?.baseUrl,
  });
}
