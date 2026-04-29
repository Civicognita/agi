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
import { computeDollarCost } from "../cost-pricing.js";

/** Minimal CostLedgerWriter contract that AgentRouter calls. Lives here as
 *  a structural type (not an import) so test fixtures can pass a stub
 *  without pulling in @agi/db-schema. The real CostLedgerWriter from
 *  cost-ledger-writer.ts implements this shape. */
export interface CostLedgerRecorder {
  record(entry: {
    entityId: string | null;
    provider: string;
    model: string;
    costMode: string;
    complexity: string;
    inputTokens: number;
    outputTokens: number;
    cpuWattsObserved: number | null;
    gpuWattsObserved: number | null;
    dollarCost: number | null;
    escalated: boolean;
    turnDurationMs: number;
    routingReason: string;
  }): void;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CostMode = "local" | "economy" | "balanced" | "max";

export interface RouterConfig {
  costMode: CostMode;
  escalation: boolean;
  /** s129 — starting tier for every turn. When undefined, falls back to
   *  costMode mapping. Persistent floor means the router never picks a
   *  provider below this tier even when costMode legacy logic would. */
  floor?: CostMode;
  /** s129 — maximum tier the router can escalate to. When undefined,
   *  falls back to legacy ESCALATION_TARGETS chain. Floor === ceiling
   *  means no escalation. */
  ceiling?: CostMode;
  /** s129 — explicit replacement for legacy `escalation` flag. When true,
   *  isLowConfidence() triggers an escalation step. Defaults to true via
   *  schema; legacy `escalation` flag is honored when this is undefined. */
  escalateOnLowConfidence?: boolean;
  /** s129 — escalate when the floor-tier provider doesn't respond within
   *  N seconds. Critical for off-grid where local inference is slow. */
  escalateOnTimeoutSec?: number | null;
  /** s129 — race floor + ceiling in parallel; take first acceptable
   *  response. Doubles cost; cuts latency. */
  parallelRace?: boolean;
  maxEscalationsPerTurn: number;
  simpleThresholdTokens: number;
  complexThresholdTokens: number;
  /** Phase K.1 — "local wins when present" mode. When true AND a
   *  Lemonade (or ollama) local provider is configured, route every
   *  turn through local except when `costMode === "max"` (the explicit
   *  "escalate me to the paid API" hint). Default: true. Set to false
   *  to preserve pre-K behavior where API providers handle non-local
   *  cost-modes even if Lemonade is available. */
  localFirst?: boolean;
  /** s111 t415 (F1 slice 2) — off-grid mode. When true, the router
   *  filters cloud Providers (anthropic, openai) entirely from the
   *  routing decision and routes through local Providers only. The
   *  preference chain in off-grid mode is: lemonade → ollama →
   *  hf-local → aion-micro (the floor). aion-micro is the last-resort
   *  fallback because it's intentionally a small fine-tuned model;
   *  bigger local models win when present.
   *
   *  This is the routing-side enforcement of the "off-grid acceptance"
   *  contract from s111 t380: a fresh box with no internet must answer
   *  chat through aion-micro within 5 minutes. Without this, even with
   *  off-grid mode toggled on in Settings → Providers, the router would
   *  still try Anthropic first and surface a network error.
   *
   *  Mirrors `agent.router.offGrid` in gateway.json (set by providers-api
   *  PUT /api/providers/router with body field `offGridMode`). */
  offGrid?: boolean;
}

export interface RoutingDecision {
  provider: string;
  model: string;
  reason: string;
  complexity: RequestComplexity;
  costMode: CostMode;
  escalated: boolean;
  /** s111 t419 — ISO timestamp of when this decision was finalized (after
   *  fallbacks + escalations). Older callers that constructed RoutingDecision
   *  literals without ts continue to typecheck; recordDecision stamps the ts
   *  before pushing into the recent-decisions ring buffer. */
  ts?: string;
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
  /** Per-provider context window sizes for session budget calculation. */
  contextWindowByProvider?: Record<string, number>;
  /** Per-worker model overrides from config. */
  workerOverrides?: Record<string, { provider?: string; model?: string }>;
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
    // Phase K.1 — prefer Lemonade (NPU/GPU/CPU auto-routing OpenAI-compatible
    // server) over ollama when both are configured. resolveRoute()
    // substitutes the actual primary local provider based on what's
    // registered; `ollama` stays as the fallback sentinel.
    simple:   { provider: "lemonade", model: "default" },
    moderate: { provider: "lemonade", model: "default" },
    complex:  { provider: "lemonade", model: "default" },
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

// ---------------------------------------------------------------------------
// Tier helpers (s129 floor/ceiling support)
// ---------------------------------------------------------------------------

const TIER_ORDER: readonly CostMode[] = ["local", "economy", "balanced", "max"] as const;

/** Position of a tier on the local→economy→balanced→max scale. Used for
 *  ceiling-clamp comparisons. */
function tierIndex(tier: CostMode): number {
  return TIER_ORDER.indexOf(tier);
}

/** Map a concrete model id back to its CostMode tier. Used when checking
 *  whether an escalation target would exceed the configured ceiling. Returns
 *  null when the model is unknown to the routing table (e.g. local models
 *  not in ESCALATION_TARGETS). */
function tierFromModelName(model: string): CostMode | null {
  for (const tier of TIER_ORDER) {
    for (const complexity of ["simple", "moderate", "complex"] as const) {
      if (ROUTING_TABLE[tier][complexity].model === model) return tier;
    }
  }
  return null;
}

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

  /**
   * s111 t419 — ring buffer of recent finalized routing decisions for the
   * Mission Control hero (UI cycle 21) and any future agent-debug surface.
   * Capped at RECENT_DECISIONS_MAX entries; oldest entries fall off when
   * capacity is reached. Each invoke() and summarize() pushes ONE entry
   * (the post-fallback / post-escalation final decision), not one per
   * intermediate state.
   */
  private static readonly RECENT_DECISIONS_MAX = 50;
  private readonly recentDecisions: RoutingDecision[] = [];

  /**
   * Push the current lastDecision into the ring buffer with a timestamp.
   * Called at the END of invoke() and summarize() so each turn produces
   * exactly one entry — fallbacks/escalations within an invoke do NOT
   * double-record. Returns silently when lastDecision is null (defensive —
   * shouldn't happen in practice but a no-op is safer than throwing).
   */
  private recordDecision(): void {
    if (this.lastDecision === null) return;
    const stamped: RoutingDecision = {
      ...this.lastDecision,
      ts: new Date().toISOString(),
    };
    this.recentDecisions.push(stamped);
    if (this.recentDecisions.length > AgentRouter.RECENT_DECISIONS_MAX) {
      this.recentDecisions.splice(0, this.recentDecisions.length - AgentRouter.RECENT_DECISIONS_MAX);
    }
  }

  /**
   * s111 t424 — push a cost-ledger row after a successful invoke()/summarize().
   * Skipped silently when costLedgerWriter isn't set (test fixtures, early-
   * boot stub Provider, plugin Provider that lives outside the router) or
   * when lastDecision is null (defensive — shouldn't happen in practice).
   *
   * dollarCost is computed via cost-pricing.computeDollarCost: 0 for local
   * Providers, real $$$ for cloud, null for unknown Provider/model. Power
   * fields (cpuWattsObserved, gpuWattsObserved) are null in this slice —
   * sampler integration ships in a follow-up cycle.
   */
  private recordCostLedger(
    response: LLMResponse,
    entityId: string,
    turnStartMs: number,
  ): void {
    if (this.costLedgerWriter === undefined || this.lastDecision === null) return;
    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;
    const dollarCost = computeDollarCost(
      this.lastDecision.provider,
      this.lastDecision.model,
      inputTokens,
      outputTokens,
    );
    // s111 t424 final sub-slice — sample power at turn end (when thunks
    // are wired). Each thunk returns null on hosts where its sampler is
    // unavailable, matching the schema's nullable contract.
    const cpuWattsObserved = this.sampleCpuWatts?.() ?? null;
    const gpuWattsObserved = this.sampleGpuWatts?.() ?? null;
    this.costLedgerWriter.record({
      entityId: entityId.length > 0 ? entityId : null,
      provider: this.lastDecision.provider,
      model: this.lastDecision.model,
      costMode: this.lastDecision.costMode,
      complexity: this.lastDecision.complexity,
      inputTokens,
      outputTokens,
      cpuWattsObserved,
      gpuWattsObserved,
      dollarCost,
      escalated: this.lastDecision.escalated,
      turnDurationMs: Date.now() - turnStartMs,
      routingReason: this.lastDecision.reason,
    });
  }

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

  /**
   * s111 t422/t424 — optional cost ledger writer. When set, every invoke()
   * pushes a row with the final routing decision, token counts from
   * LLMResponse.usage, computed dollar cost, and (when sampler thunks below
   * are also wired) power consumption. Server.ts assigns after construction
   * (mirrors onProviderError pattern), so test fixtures that don't care
   * about ledger writes keep working without modification.
   */
  costLedgerWriter?: CostLedgerRecorder;

  /**
   * s111 t424 final sub-slice — optional power-sampler thunks. Server.ts
   * owns the CpuPowerSampler + GpuPowerSampler instances (in server-runtime-
   * state.ts). To avoid coupling AgentRouter to the sampler classes (and
   * breaking the lightweight test stub story), server.ts assigns thunks
   * that capture the samplers in closures: `router.sampleCpuWatts = () =>
   * cpuPowerSampler.sample()`. recordCostLedger calls them at turn end.
   * Each thunk returns null on hosts where its sampler is unavailable
   * (non-Linux RAPL → cpuWatts null; non-NVIDIA → gpuWatts null).
   */
  sampleCpuWatts?: () => number | null;
  sampleGpuWatts?: () => number | null;

  /**
   * Providers that have been auto-paused due to zero/negative balance or a
   * billing error. The router skips these and falls back to alternatives.
   * Cleared by enableProvider() (e.g. when the user re-enables in Settings).
   */
  private readonly disabledProviders = new Set<string>();

  /** Mark a provider as unavailable (zero balance or billing error). */
  disableProvider(providerId: string): void {
    this.disabledProviders.add(providerId);
    this.log.warn(`provider ${providerId} auto-paused (zero balance or billing error)`);
  }

  /** Re-enable a previously disabled provider. */
  enableProvider(providerId: string): void {
    this.disabledProviders.delete(providerId);
    this.log.info(`provider ${providerId} re-enabled`);
  }

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
    // s111 t424 — capture turn start for cost-ledger turnDurationMs. Outside
    // the try block so we know the wall-clock duration even on error paths
    // (though we only record on success — failures don't pollute the ledger).
    const turnStartMs = Date.now();

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
    // s129 — `escalateOnLowConfidence` is the modern explicit flag; falls back
    // to legacy `escalation` when the new field isn't set yet (pre-migration
    // configs still in flight). Ceiling clamp (s129) prevents escalation above
    // the configured ceiling tier — when ceiling = floor, no escalation
    // happens regardless of confidence.
    const lowConfEnabled = config.router.escalateOnLowConfidence ?? escalation;
    if (
      lowConfEnabled &&
      maxEscalationsPerTurn > 0 &&
      isLowConfidence(response, classification.complexity)
    ) {
      const ceiling = config.router.ceiling;
      const escalationTarget = ESCALATION_TARGETS[route.model];
      // Ceiling clamp: drop the escalation when target tier exceeds ceiling.
      // `tierFromModelName()` maps a concrete model id back to its CostMode
      // tier so we can compare against ceiling consistently.
      const targetTier = escalationTarget ? tierFromModelName(escalationTarget.model) : null;
      const ceilingExceeded = ceiling !== undefined && targetTier !== null
        && tierIndex(targetTier) > tierIndex(ceiling);
      if (ceilingExceeded) {
        this.log.info(
          `escalation suppressed: target tier ${targetTier ?? "?"} > ceiling ${ceiling}`,
        );
      }
      if (escalationTarget && !ceilingExceeded) {
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

    // s111 t419 — push to ring buffer AFTER fallbacks + escalations so each
    // turn produces exactly one entry reflecting the final decision.
    this.recordDecision();

    // s111 t424 — also push to cost ledger (when wired). Same single-record-
    // per-turn semantic as the ring buffer; same final-decision-state input.
    this.recordCostLedger(response, params.entityId, turnStartMs);

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
    this.recordDecision();

    return provider.summarize(text, prompt);
  }

  // -------------------------------------------------------------------------
  // Diagnostic helpers
  // -------------------------------------------------------------------------

  getLastDecision(): RoutingDecision | null {
    return this.lastDecision;
  }

  /**
   * s111 t419 — recent routing decisions, newest last. Returns at most
   * `limit` entries (default 20, hard-capped to RECENT_DECISIONS_MAX = 50).
   * Each entry includes `ts` (ISO timestamp). Callers: providers-api
   * GET /api/providers/recent-decisions endpoint, future Mission Control
   * hero, Taskmaster history view, agent debug inspector.
   */
  getRecentDecisions(limit = 20): RoutingDecision[] {
    const cap = Math.min(Math.max(0, limit), AgentRouter.RECENT_DECISIONS_MAX);
    return this.recentDecisions.slice(-cap);
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
   *   0. **Local wins when present (Phase K.1)**: if `router.localFirst`
   *      is true AND a Lemonade provider is configured AND costMode is
   *      not "max" (the explicit escalation hint), route through
   *      Lemonade regardless of cost-mode. API providers only fire on
   *      max-mode turns. See RouterConfig.localFirst docs.
   *   1. Local mode: use the user's configured local provider or ollama
   *      (now prefers lemonade if configured).
   *   2. Routing table match when the user's default provider aligns.
   *   3. Routing table when the target provider has credentials.
   *   4. Fall back to the user's default provider/model.
   */
  private resolveRoute(
    config: AgentRouterConfig,
    costMode: CostMode,
    complexity: RequestComplexity,
  ): RouteTarget {
    // s111 t415 — off-grid gate. Fires BEFORE the localFirst gate so cloud
    // Providers are filtered entirely. Off-grid is the alpha-stable-1 floor
    // contract: when the owner has toggled off-grid mode in Settings, the
    // router MUST NOT attempt cloud Providers, even when costMode="max"
    // (which normally forces cloud escalation). The preference chain is
    // lemonade → ollama → hf-local → aion-micro. aion-micro is the
    // last-resort floor: a small fine-tuned model that ships baked into
    // the install (s111 t380), guaranteed available even on a fresh box
    // with nothing else local installed. Bigger local Providers win when
    // present because aion-micro is intentionally compact.
    if (config.router.offGrid === true) {
      if (config.providers["lemonade"]) {
        return { provider: "lemonade", model: "default" };
      }
      if (config.providers["ollama"]) {
        return { provider: "ollama", model: "default" };
      }
      if (config.providers["hf-local"]) {
        return { provider: "hf-local", model: config.defaultModel };
      }
      // aion-micro is the floor — always reachable as long as Lemonade is
      // running (which the catalog dependsOn correctly declares per t416).
      // Returns the addressable Provider id; factory.ts createSingleProvider
      // resolves it to OpenAIProvider against Lemonade port :13305.
      return { provider: "aion-micro", model: "wishborn/aion-micro-v1" };
    }

    // Phase K.1 — local-first gate. Fires when the owner has a
    // Lemonade runtime installed + enabled and hasn't explicitly
    // escalated this turn via costMode="max". Effect: simple/moderate/
    // complex turns all route to Lemonade, which internally auto-picks
    // NPU > GPU > CPU backend. Default localFirst is true; flip to
    // false in gateway.json `router.localFirst` to revert to pre-K
    // behavior if a regression surfaces.
    const localFirst = config.router.localFirst !== false; // default true
    const hasLemonade = Boolean(config.providers["lemonade"]);
    if (localFirst && hasLemonade && costMode !== "max") {
      return { provider: "lemonade", model: "default" };
    }

    const defaultRoute = ROUTING_TABLE[costMode][complexity];

    if (costMode === "local") {
      // Prefer lemonade when configured — the ROUTING_TABLE entry is
      // already "lemonade" but an older config without lemonade
      // configured needs the fallback chain below.
      if (config.providers["lemonade"]) {
        return { provider: "lemonade", model: "default" };
      }
      // Explicit owner choice via Settings → Provider takes priority
      // over the config.providers["<id>"] check. Local runtimes
      // (lemonade/ollama/hf-local/aion-micro) don't require API keys
      // and may not have a `providers.<id>` block. Honor the owner's
      // explicit defaultProvider regardless.
      if (
        config.defaultProvider === "lemonade" ||
        config.defaultProvider === "ollama" ||
        config.defaultProvider === "hf-local" ||
        config.defaultProvider === "aion-micro"
      ) {
        return { provider: config.defaultProvider, model: config.defaultModel || "default" };
      }
      if (config.providers["ollama"]) {
        return { provider: "ollama", model: "default" };
      }
      throw new Error(
        "Cost mode is 'local' but no local provider is configured. " +
          "Install the agi-lemonade-runtime plugin, set your provider " +
          "to 'ollama', or start a HuggingFace local model.",
      );
    }

    // If the routing table already targets the user's default provider, use it
    // — unless that provider has been auto-paused (zero balance).
    if (defaultRoute.provider === config.defaultProvider && !this.disabledProviders.has(defaultRoute.provider)) {
      return defaultRoute;
    }

    // If the routing table's provider has credentials and is not disabled, trust the table.
    const cred = config.providers[defaultRoute.provider];
    if ((cred?.apiKey || defaultRoute.provider === "ollama") && !this.disabledProviders.has(defaultRoute.provider)) {
      return defaultRoute;
    }

    // Default provider is disabled — find a fallback.
    const fallback = this.findFallbackRoute(config, config.defaultProvider);
    if (fallback) return fallback;

    // Fall back to whatever the user has configured (even if disabled — last resort).
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
    // Try other API-key-based providers first (skip disabled ones)
    for (const [name, cred] of Object.entries(config.providers)) {
      if (name === failedProvider || !cred?.apiKey) continue;
      if (name === "ollama") continue; // handle ollama separately below
      if (this.disabledProviders.has(name)) continue;
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
