/**
 * LLM Provider Factory — Task #53
 *
 * Creates the appropriate LLMProvider based on AionimaConfig.
 * Supports single-provider and failover-provider configurations.
 */

import type { AionimaConfig } from "@agi/config";

import type { LLMProvider, LLMProviderConfig } from "./provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { FailoverProvider } from "./failover-provider.js";
import { AgentRouter } from "./agent-router.js";
import type { AgentRouterConfig, CostMode } from "./agent-router.js";
import type { Logger } from "../logger.js";

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

export function createSingleProvider(
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

    case "lemonade":
      // Phase K.2 — Lemonade serves OpenAI-compatible /v1/chat/completions
      // with auto-routing between NPU / GPU / CPU internally. No API key
      // required; default port 8000 matches the upstream SDK default.
      // The matching settings page + install lifecycle are in the
      // `agi-lemonade-runtime` marketplace plugin.
      return new OpenAIProvider({
        apiKey: "not-needed",
        defaultModel: config.defaultModel ?? "default",
        maxTokens: config.maxTokens ?? 8192,
        maxRetries: config.maxRetries ?? 2,
        baseUrl: config.baseUrl ?? "http://127.0.0.1:8000",
      });

    case "hf-local": {
      // Resolve the actual port from ModelAgentBridge if available.
      // The bridge registers running text-generation models with their
      // container port — hardcoding 6000 breaks when models start on
      // other ports from the allocation pool.
      let baseUrl = config.baseUrl;
      if (!baseUrl && _modelAgentBridge) {
        const modelId = config.defaultModel ?? "local";
        const bridgeProvider = _modelAgentBridge.getProviderForModel(modelId);
        if (bridgeProvider) {
          baseUrl = bridgeProvider.baseUrl;
        }
      }
      return new OpenAIProvider({
        apiKey: "not-needed",
        defaultModel: config.defaultModel ?? "local",
        maxTokens: config.maxTokens ?? 4096,
        maxRetries: config.maxRetries ?? 2,
        baseUrl: baseUrl ?? "http://127.0.0.1:6000",
      });
    }

    default: {
      // Check plugin-registered providers before giving up. Plugins call
      // api.registerProvider(def) during boot; we look them up here so
      // setting `agent.provider: "claude-max"` (or any plugin-contributed
      // type) just works without hardcoding every provider.
      const pluginDef = _pluginProviderRegistry?.getProvider(type);
      if (pluginDef) {
        return pluginDef.factory(config as Record<string, unknown>) as LLMProvider;
      }
      throw new Error(`Unknown LLM provider type: ${type}. No built-in or plugin-registered provider matches.`);
    }
  }
}

/** Late-bound plugin registry ref — set by server.ts after plugins boot. */
interface PluginProviderLookup {
  getProvider(id: string): { factory: (config: Record<string, unknown>) => unknown } | undefined;
}
let _pluginProviderRegistry: PluginProviderLookup | null = null;

export function setPluginProviderRegistry(registry: PluginProviderLookup): void {
  _pluginProviderRegistry = registry;
}

/** Late-bound ModelAgentBridge ref for resolving HF local model ports. */
interface ModelBridgeLookup {
  getProviderForModel(modelId: string): { baseUrl: string; model: string } | undefined;
}
let _modelAgentBridge: ModelBridgeLookup | null = null;

export function setModelAgentBridge(bridge: ModelBridgeLookup): void {
  _modelAgentBridge = bridge;
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

// ---------------------------------------------------------------------------
// AgentRouter factory
// ---------------------------------------------------------------------------

/**
 * Create an AgentRouter from AionimaConfig.
 *
 * The router is always active and performs per-request model selection
 * based on cost mode and request complexity.
 *
 * Note: the config snapshot is captured at construction time. For true
 * hot-reload the caller (server.ts) should pass a getConfig closure that
 * reads live config — that is Phase 4's concern.
 */
export function createAgentRouter(config: AionimaConfig, logger?: Logger): LLMProvider {
  const agent = config.agent as {
    provider?: string;
    model?: string;
    maxTokens?: number;
    maxRetries?: number;
    baseUrl?: string;
    providers?: Array<{ type: string; model: string; apiKey?: string; baseUrl?: string }>;
    router?: {
      costMode?: string;
      escalation?: boolean;
      maxEscalationsPerTurn?: number;
      simpleThresholdTokens?: number;
      complexThresholdTokens?: number;
      localFirst?: boolean;
    };
  } | undefined ?? {};

  const providersCred =
    (config.providers as Record<string, { apiKey?: string; baseUrl?: string; model?: string }> | undefined) ?? {};

  const routerConfig: AgentRouterConfig = {
    router: {
      costMode: (agent.router?.costMode as CostMode) ?? "balanced",
      escalation: agent.router?.escalation ?? false,
      maxEscalationsPerTurn: agent.router?.maxEscalationsPerTurn ?? 1,
      simpleThresholdTokens: agent.router?.simpleThresholdTokens ?? 500,
      complexThresholdTokens: agent.router?.complexThresholdTokens ?? 2000,
      // Phase K.1 — default "local wins when present" mode. When a
      // Lemonade provider is configured, every non-max turn routes
      // through it. Owners revert to pre-K behavior by setting
      // `agent.router.localFirst: false` in gateway.json.
      localFirst: agent.router?.localFirst ?? true,
    },
    defaultProvider: agent.provider ?? "anthropic",
    defaultModel: agent.model ?? "claude-sonnet-4-6",
    providers: providersCred,
    baseUrl: agent.baseUrl,
  };

  return new AgentRouter(
    () => routerConfig,
    (type, provConfig) => createSingleProvider(type, provConfig),
    logger,
  );
}
