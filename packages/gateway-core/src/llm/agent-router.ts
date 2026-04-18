/**
 * AgentRouter — Intelligent per-request model selection — Phase 3
 *
 * Implements LLMProvider as a drop-in replacement. On every invoke() it:
 *   1. Classifies the request's complexity (simple / moderate / complex)
 *   2. Selects a provider + model from the routing table based on cost mode
 *   3. Optionally escalates to a more capable model when confidence is low
 *   4. Attaches routing metadata to every LLMResponse
 */

import type { LLMProvider, LLMProviderConfig } from "./provider.js";
import type {
  LLMInvokeParams,
  LLMResponse,
  LLMToolContinuationParams,
} from "./types.js";
import { classifyRequest } from "./request-classifier.js";
import type { RequestComplexity } from "./request-classifier.js";
import { createComponentLogger } from "../logger.js";
import type { Logger, ComponentLogger } from "../logger.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CostMode = "local" | "economy" | "balanced" | "max";

export interface RouterConfig {
  costMode: CostMode;
  escalation: boolean;
  maxEscalationsPerTurn: number;
  simpleThresholdTokens: number;
  complexThresholdTokens: number;
}

export interface RoutingDecision {
  provider: string;
  model: string;
  reason: string;
  complexity: RequestComplexity;
  costMode: CostMode;
  escalated: boolean;
}

interface ProviderCredentials {
  [name: string]: { apiKey?: string; baseUrl?: string; model?: string } | undefined;
}

export interface AgentRouterConfig {
  router: RouterConfig;
  defaultProvider: string;
  defaultModel: string;
  providers: ProviderCredentials;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RouteTarget {
  provider: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Routing table — cost mode × complexity → provider/model
// ---------------------------------------------------------------------------

const ROUTING_TABLE: Record<CostMode, Record<RequestComplexity, RouteTarget>> = {
  local: {
    simple:   { provider: "ollama", model: "llama3.1" },
    moderate: { provider: "ollama", model: "llama3.1" },
    complex:  { provider: "ollama", model: "llama3.1" },
  },
  economy: {
    simple:   { provider: "anthropic", model: "claude-haiku-4-5" },
    moderate: { provider: "anthropic", model: "claude-haiku-4-5" },
    complex:  { provider: "anthropic", model: "claude-sonnet-4-6" },
  },
  balanced: {
    simple:   { provider: "anthropic", model: "claude-haiku-4-5" },
    moderate: { provider: "anthropic", model: "claude-sonnet-4-6" },
    complex:  { provider: "anthropic", model: "claude-sonnet-4-6" },
  },
  max: {
    simple:   { provider: "anthropic", model: "claude-opus-4-6" },
    moderate: { provider: "anthropic", model: "claude-opus-4-6" },
    complex:  { provider: "anthropic", model: "claude-opus-4-6" },
  },
};

// ---------------------------------------------------------------------------
// Escalation targets — what to upgrade to from a given model
// ---------------------------------------------------------------------------

const ESCALATION_TARGETS: Record<string, RouteTarget> = {
  "claude-haiku-4-5":  { provider: "anthropic", model: "claude-sonnet-4-6" },
  "claude-sonnet-4-6": { provider: "anthropic", model: "claude-opus-4-6" },
  "gpt-4o-mini":       { provider: "openai",    model: "gpt-4o" },
  "gpt-4o":            { provider: "openai",    model: "gpt-4-turbo" },
};

// ---------------------------------------------------------------------------
// Low-confidence detection
// ---------------------------------------------------------------------------

const HEDGING_PATTERNS = [
  "i'm not sure",
  "i don't know",
  "i cannot",
  "i'm unable",
  "i don't have enough",
  "i'm not certain",
  "it's unclear",
];

function isLowConfidence(response: LLMResponse, complexity: RequestComplexity): boolean {
  // Never escalate simple requests — they intentionally use cheap models.
  if (complexity === "simple") return false;

  const text = response.text.toLowerCase();

  // Very short answer to a complex question is suspicious.
  if (response.text.length < 50 && complexity === "complex") return true;

  return HEDGING_PATTERNS.some((p) => text.includes(p));
}

// ---------------------------------------------------------------------------
// AgentRouter
// ---------------------------------------------------------------------------

export class AgentRouter implements LLMProvider {
  private readonly log: ComponentLogger;

  /**
   * Provider instance cache — keyed by `"type:model:baseUrl"`.
   * Cleared whenever the config object reference changes (hot-reload).
   */
  private readonly providerCache = new Map<string, LLMProvider>();

  /**
   * Maps entityId → provider cache key so that tool continuations go back
   * to the same provider that handled the original turn.
   */
  private readonly entityProviderMap = new Map<string, string>();

  private lastDecision: RoutingDecision | null = null;

  /** Tracks the last config reference for cache invalidation on hot-reload. */
  private lastConfigRef: AgentRouterConfig | null = null;

  /**
   * Optional callback invoked when a provider returns a billing or auth error.
   * Server.ts wires this to the dashboard broadcaster for real-time alerts.
   */
  onProviderError?: (error: {
    provider: string;
    model: string;
    type: "billing" | "auth" | "error";
    message: string;
  }) => void;

  constructor(
    private readonly getConfig: () => AgentRouterConfig,
    private readonly providerFactory: (type: string, config: Partial<LLMProviderConfig>) => LLMProvider,
    logger?: Logger,
  ) {
    this.log = createComponentLogger(logger, "router");
  }

  // -------------------------------------------------------------------------
  // LLMProvider — invoke
  // -------------------------------------------------------------------------

  async invoke(params: LLMInvokeParams): Promise<LLMResponse> {
    const config = this.getConfig();
    this.invalidateCacheIfConfigChanged(config);

    const { costMode, escalation, maxEscalationsPerTurn, simpleThresholdTokens, complexThresholdTokens } =
      config.router;

    const classification = classifyRequest(params, {
      simple: simpleThresholdTokens,
      complex: complexThresholdTokens,
    });

    const route = this.resolveRoute(config, costMode, classification.complexity);
    const provider = this.getOrCreateProvider(route.provider, route.model, config);

    const overriddenParams: LLMInvokeParams = { ...params, model: route.model };

    // Enable extended thinking for complex requests in high-quality modes.
    if (
      classification.complexity === "complex" &&
      (costMode === "balanced" || costMode === "max") &&
      !params.thinking
    ) {
      overriddenParams.thinking = { type: "enabled" as const, budget_tokens: 10000 };
    }

    this.lastDecision = {
      provider: route.provider,
      model: route.model,
      reason: `${costMode}/${classification.complexity}`,
      complexity: classification.complexity,
      costMode,
      escalated: false,
    };

    // Remember which provider is serving this entity for tool continuations.
    // Must use the same key format as getOrCreateProvider's providerCache.
    const cred = config.providers[route.provider];
    const baseUrl = cred?.baseUrl ?? (route.provider === config.defaultProvider ? config.baseUrl : undefined);
    const entityCacheKey = `${route.provider}:${route.model}:${baseUrl ?? ""}`;
    this.entityProviderMap.set(params.entityId, entityCacheKey);

    this.log.info(
      `route: ${costMode}/${classification.complexity} → ${route.provider}/${route.model}`,
    );

    let response: LLMResponse;
    try {
      response = await provider.invoke(overriddenParams);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isBillingError =
        msg.includes("credit balance") ||
        msg.includes("insufficient_quota") ||
        msg.includes("billing") ||
        msg.includes("exceeded your current quota");
      const isAuthError =
        msg.includes("401") ||
        msg.includes("invalid_x_api_key") ||
        msg.toLowerCase().includes("invalid api key") ||
        msg.toLowerCase().includes("authentication");

      if (isBillingError || isAuthError) {
        this.onProviderError?.({
          provider: route.provider,
          model: route.model,
          type: isBillingError ? "billing" : "auth",
          message: msg,
        });

        // Auto-fallback on billing error — try another configured provider
        if (isBillingError) {
          const fallbackRoute = this.findFallbackRoute(config, route.provider);
          if (fallbackRoute) {
            this.log.warn(
              `billing error on ${route.provider}/${route.model} — falling back to ${fallbackRoute.provider}/${fallbackRoute.model}`,
            );
            const fallbackProvider = this.getOrCreateProvider(
              fallbackRoute.provider,
              fallbackRoute.model,
              config,
            );
            const fallbackParams: LLMInvokeParams = { ...overriddenParams, model: fallbackRoute.model };
            const fallbackResponse = await fallbackProvider.invoke(fallbackParams);

            this.lastDecision = {
              provider: fallbackRoute.provider,
              model: fallbackRoute.model,
              reason: `fallback from ${route.provider} (billing error)`,
              complexity: classification.complexity,
              costMode,
              escalated: false,
            };

            fallbackResponse.routingMeta = {
              costMode,
              complexity: classification.complexity,
              selectedModel: fallbackRoute.model,
              selectedProvider: fallbackRoute.provider,
              escalated: false,
              reason: `fallback from ${route.provider} (billing error)`,
            };

            return fallbackResponse;
          }
        }
      }
      throw err;
    }

    // Escalation: if the response looks low-confidence, try a stronger model.
    if (
      escalation &&
      maxEscalationsPerTurn > 0 &&
      isLowConfidence(response, classification.complexity)
    ) {
      const escalationTarget = ESCALATION_TARGETS[route.model];
      if (escalationTarget) {
        this.log.info(`escalating from ${route.model} → ${escalationTarget.model}`);

        const escalatedProvider = this.getOrCreateProvider(
          escalationTarget.provider,
          escalationTarget.model,
          config,
        );
        const escalatedParams: LLMInvokeParams = { ...overriddenParams, model: escalationTarget.model };
        response = await escalatedProvider.invoke(escalatedParams);

        const escCred = config.providers[escalationTarget.provider];
        const escBaseUrl = escCred?.baseUrl ?? (escalationTarget.provider === config.defaultProvider ? config.baseUrl : undefined);
        const escalatedCacheKey = `${escalationTarget.provider}:${escalationTarget.model}:${escBaseUrl ?? ""}`;
        this.entityProviderMap.set(params.entityId, escalatedCacheKey);

        this.lastDecision = {
          ...this.lastDecision,
          provider: escalationTarget.provider,
          model: escalationTarget.model,
          reason: `escalated from ${route.model}`,
          escalated: true,
        };
      }
    }

    // Attach routing metadata to the response.
    response.routingMeta = {
      costMode,
      complexity: classification.complexity,
      selectedModel: this.lastDecision.model,
      selectedProvider: this.lastDecision.provider,
      escalated: this.lastDecision.escalated,
      reason: this.lastDecision.reason,
    };

    return response;
  }

  // -------------------------------------------------------------------------
  // LLMProvider — continueWithToolResults
  // -------------------------------------------------------------------------

  async continueWithToolResults(params: LLMToolContinuationParams): Promise<LLMResponse> {
    const entityId = params.original.entityId;
    const cacheKey = this.entityProviderMap.get(entityId);

    if (!cacheKey) {
      // No prior turn recorded — re-classify and route as a fresh request.
      const config = this.getConfig();
      const classification = classifyRequest(params.original, {
        simple: config.router.simpleThresholdTokens,
        complex: config.router.complexThresholdTokens,
      });
      const route = this.resolveRoute(config, config.router.costMode, classification.complexity);
      const provider = this.getOrCreateProvider(route.provider, route.model, config);
      return provider.continueWithToolResults(params);
    }

    const provider = this.providerCache.get(cacheKey);
    if (!provider) {
      throw new Error(
        `Provider ${cacheKey} was evicted from cache during tool continuation`,
      );
    }

    return provider.continueWithToolResults(params);
  }

  // -------------------------------------------------------------------------
  // LLMProvider — summarize
  // -------------------------------------------------------------------------

  async summarize(text: string, prompt: string): Promise<string> {
    const config = this.getConfig();

    // Summarization always uses the cheapest model regardless of cost mode.
    const route = this.resolveRoute(config, "economy", "simple");
    const provider = this.getOrCreateProvider(route.provider, route.model, config);

    this.lastDecision = {
      provider: route.provider,
      model: route.model,
      reason: "summarization (always economy)",
      complexity: "simple",
      costMode: "economy",
      escalated: false,
    };

    return provider.summarize(text, prompt);
  }

  // -------------------------------------------------------------------------
  // Diagnostic helpers
  // -------------------------------------------------------------------------

  getLastDecision(): RoutingDecision | null {
    return this.lastDecision;
  }

  getProviderHealth(): Array<{ provider: string; healthy: boolean }> {
    const config = this.getConfig();
    const providers = ["anthropic", "openai", "ollama"];
    return providers.map((p) => ({
      provider: p,
      healthy: config.providers[p]?.apiKey !== undefined || p === "ollama",
    }));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve the target provider/model for a given cost mode and complexity.
   *
   * Priority:
   *   1. Local mode: use the user's configured local provider or ollama.
   *   2. Routing table match when the user's default provider aligns.
   *   3. Routing table when the target provider has credentials.
   *   4. Fall back to the user's default provider/model.
   */
  private resolveRoute(
    config: AgentRouterConfig,
    costMode: CostMode,
    complexity: RequestComplexity,
  ): RouteTarget {
    const defaultRoute = ROUTING_TABLE[costMode][complexity];

    if (costMode === "local") {
      if (
        config.defaultProvider === "ollama" ||
        config.defaultProvider === "hf-local"
      ) {
        return { provider: config.defaultProvider, model: config.defaultModel };
      }
      if (config.providers["ollama"]) {
        return defaultRoute;
      }
      throw new Error(
        "Cost mode is 'local' but no local provider is configured. " +
          "Set your provider to 'ollama' or start a HuggingFace local model.",
      );
    }

    // If the routing table already targets the user's default provider, use it.
    if (defaultRoute.provider === config.defaultProvider) {
      return defaultRoute;
    }

    // If the routing table's provider has credentials, trust the table.
    const cred = config.providers[defaultRoute.provider];
    if (cred?.apiKey || defaultRoute.provider === "ollama") {
      return defaultRoute;
    }

    // Fall back to whatever the user has configured.
    return { provider: config.defaultProvider, model: config.defaultModel };
  }

  /**
   * Find a fallback provider/model when the primary provider hits a billing error.
   * Returns the first configured provider (with an API key) that is not the failed one.
   * Falls back to ollama as a last resort if configured.
   */
  private findFallbackRoute(
    config: AgentRouterConfig,
    failedProvider: string,
  ): RouteTarget | null {
    // Try other API-key-based providers first
    for (const [name, cred] of Object.entries(config.providers)) {
      if (name === failedProvider || !cred?.apiKey) continue;
      if (name === "ollama") continue; // handle ollama separately below
      // Pick the cheapest model for the fallback provider
      const economyRoutes = Object.values(ROUTING_TABLE.economy);
      const match = economyRoutes.find((r) => r.provider === name);
      if (match) return match;
    }
    // Try ollama as last resort (no key needed)
    if (failedProvider !== "ollama") {
      return { provider: "ollama", model: "llama3.1" };
    }
    return null;
  }

  private getOrCreateProvider(
    type: string,
    model: string,
    config: AgentRouterConfig,
  ): LLMProvider {
    const cred = config.providers[type];
    const baseUrl =
      cred?.baseUrl ?? (type === config.defaultProvider ? config.baseUrl : undefined);
    const cacheKey = `${type}:${model}:${baseUrl ?? ""}`;

    const cached = this.providerCache.get(cacheKey);
    if (cached) return cached;

    const provider = this.providerFactory(type, {
      apiKey: cred?.apiKey,
      defaultModel: model,
      maxTokens: 8192,
      maxRetries: 3,
      baseUrl,
    });

    this.providerCache.set(cacheKey, provider);
    return provider;
  }

  private invalidateCacheIfConfigChanged(config: AgentRouterConfig): void {
    if (this.lastConfigRef !== config) {
      this.providerCache.clear();
      this.entityProviderMap.clear();
      this.lastConfigRef = config;
    }
  }
}
