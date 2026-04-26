/**
 * Providers API — Settings → Providers REST surface (s111 t372 / A1).
 *
 * The Providers page in the dashboard is the owner-facing control surface for
 * the Agent Router. It needs to:
 *   - List every Provider known to this install (catalog).
 *   - Show which Provider is currently active + which model it serves.
 *   - Surface the Agent Router config (costMode + escalation + thresholds).
 *   - Eventually let the owner change active Provider + tune router (PUT
 *     endpoints — not in this initial slice).
 *
 * This file is the GET-only first slice. PUT endpoints (active-provider switch,
 * router config update) ship in a follow-up under the same task. The shape of
 * what's returned matches the catalog + active-state contract the dashboard
 * route in t373 consumes.
 *
 * Provider definition (per memory feedback_provider_definition):
 *   "A Provider is any system that provides an AI model to other interfaces
 *    for whatever the request." — Ollama + Lemonade + HF + Anthropic + OpenAI
 *    + aion-micro all qualify. Runtime is a Provider attribute, not a sibling
 *    plugin kind.
 *
 * Off-grid framing (per memory feedback_off_grid_means_any_local_model):
 *   Off-grid = cloud disabled; ALL local Providers remain available;
 *   aion-micro is the guaranteed floor.
 */

import type { FastifyInstance } from "fastify";
import type { AionimaConfig } from "@agi/config";

/** What a Provider looks like to the dashboard. */
export interface ProviderCatalogEntry {
  /** Stable id used in routing decisions and config (e.g. "ollama", "anthropic", "aion-micro"). */
  id: string;
  /** Human-readable name shown in the catalog. */
  name: string;
  /** Tier shapes the Provider's badge + sort order in the catalog UI:
   *    - "core"  : ships with every install (HF, aion-micro)
   *    - "local" : runs locally via a daemon Provider (Ollama, Lemonade)
   *    - "cloud" : remote API Provider (Anthropic, OpenAI)
   *    - "floor" : the off-grid floor (aion-micro specifically) */
  tier: "core" | "local" | "cloud" | "floor";
  /** Whether this Provider works without internet. Used by off-grid mode + the catalog UI. */
  offGridCapable: boolean;
  /** Whether the Provider is reachable + has at least one model available right now. */
  health: "healthy" | "degraded" | "unreachable" | "no-key";
  /** Number of models the Provider currently exposes for invocation. Best-effort; cloud
   *  Providers may return undefined if their catalog isn't enumerated upfront. */
  modelCount?: number;
  /** baseUrl for local Providers; absent for cloud Providers. */
  baseUrl?: string;
  /** Default model the Provider serves when no model is specified by the
   *  caller. Drives the catalog UI's "Default model" line per Provider card.
   *  Mirrors the `config.defaultModel ?? <hardcoded>` used in factory.ts:
   *  aion-micro = wishborn/aion-micro-v1, ollama = llama3.1, etc.
   *  Absent for cloud Providers where the agent.model config drives selection
   *  on a per-call basis. */
  defaultModel?: string;
  /** Other Provider ids this Provider depends on at runtime. aion-micro
   *  depends on lemonade because the model is served by the Lemonade backplane
   *  (Phase K.4 — see AionMicroManager docstring). The catalog UI uses this
   *  to show "Requires: Lemonade" on the aion-micro card and to grey out the
   *  Provider when its dependency is unhealthy. Absent or empty when the
   *  Provider has no inter-Provider dependencies. */
  dependsOn?: string[];
  /** Deadline multiplier applied wherever a per-Provider timeout is computed.
   *  Cloud Providers respond in 2–5s end-to-end; CPU-bound local Providers can
   *  take 30–60s+ for first token alone (empirical: t326 close measured 60.9s
   *  on qwen2.5:3b CPU-only). Cloud-tuned timeouts kill local inference and
   *  surface as "Aion didn't respond" UX bugs.
   *
   *  Owner directive 2026-04-26: "When using local models, we need to be more
   *  relaxed with our timeout guards." Default is 1.0 for cloud, 6.0 for every
   *  non-cloud tier. Behavioral wiring at SDK construction lives in t413
   *  (factory.ts) — this field is the declarative source of truth that the
   *  dashboard, factory, and any future deadline-computing code read from. */
  timeoutMultiplier: number;
}

/** Compute the timeout multiplier for a Provider tier. Cloud Providers stay
 *  at 1.0 (cloud-tuned baseline); every non-cloud tier — including aion-micro
 *  ("floor"), HF ("core"), Ollama/Lemonade ("local") — uses 6.0. The factor is
 *  intentionally generous: the cost of an over-long deadline on a fast box is
 *  negligible (the response arrives early), but the cost of a too-short
 *  deadline on a slow box is a phantom failure mid-inference. */
export function timeoutMultiplierForTier(tier: ProviderCatalogEntry["tier"]): number {
  return tier === "cloud" ? 1.0 : 6.0;
}

/** Active Provider + Agent Router config — drives the Mission Control hero. */
export interface ActiveProviderState {
  activeProviderId: string;
  activeModel: string;
  router: {
    costMode: string;
    escalation: boolean;
    simpleThresholdTokens?: number;
    complexThresholdTokens?: number;
    maxEscalationsPerTurn?: number;
  };
  /** True when off-grid mode is enabled. When ON, cloud Providers are filtered
   *  from the router's option set; aion-micro remains the guaranteed floor. */
  offGridMode: boolean;
}

/** Mirrors RoutingDecision in agent-router.ts. Wire-only shape so the
 *  dashboard can render the Mission Control hero (s111 t419) without
 *  importing the full LLM stack. */
export interface RoutingDecisionRecord {
  provider: string;
  model: string;
  reason: string;
  complexity: string;
  costMode: string;
  escalated: boolean;
  ts?: string;
}

export interface ProvidersApiDeps {
  /** Read live config — same pattern as getMaxToolLoops in agent-invoker. Hot-reload
   *  means each request sees the latest gateway.json. */
  readConfig: () => AionimaConfig;
  /** Patch a single config key by dot-notation path. PUT endpoints route changes
   *  through here so they hot-reload + persist via systemConfigService. Optional
   *  so test fixtures can pass a no-op or omit it; PUT endpoints return 503
   *  ("read-only mode") when not provided. */
  patchConfig?: (dotPath: string, value: unknown) => void;
  /** Optional: returns per-Provider health + model count. Implemented as a thunk so
   *  the dashboard can refresh without restarting the gateway. Falls back to a
   *  config-only inference when the thunk is omitted. */
  inspectProviders?: () => Promise<Array<Pick<ProviderCatalogEntry, "id" | "health" | "modelCount">>>;
  /** s111 t419 — recent routing decisions for the Mission Control hero.
   *  Returns newest-last array of decisions (provider, model, reason, ts).
   *  Optional so test fixtures can omit; the endpoint returns an empty list
   *  when not provided. Server.ts wires this to AgentRouter.getRecentDecisions(). */
  getRecentDecisions?: (limit: number) => RoutingDecisionRecord[];
}

/** Set of valid Provider ids — kept in sync with buildBaseCatalog. PUT
 *  /api/providers/active validates against this list to prevent typos and
 *  unknown providers from being persisted. */
const KNOWN_PROVIDER_IDS = new Set([
  "aion-micro",
  "huggingface",
  "ollama",
  "lemonade",
  "anthropic",
  "openai",
]);

/** Allowed costMode values per agent-router.ts CostMode union. */
const KNOWN_COST_MODES = new Set(["local", "economy", "balanced", "max"]);

/**
 * The canonical catalog of Providers known to the system. We hard-code the core
 * tier (aion-micro + HF) and the local tier (Ollama + Lemonade) because each
 * has explicit Provider integration in `packages/gateway-core/src/llm/`. Cloud
 * Providers are surfaced based on whether their config block exists.
 *
 * This is intentionally a small static list rather than a plugin-registry-driven
 * one — the catalog itself is part of agi core, per the s111 framing. Plugins
 * can extend Provider behavior, but adding a new Provider type is an ADF-level
 * change that warrants explicit listing here.
 */
function buildBaseCatalog(config: AionimaConfig): ProviderCatalogEntry[] {
  const cfgRoot = config as Record<string, unknown>;
  const providers = (cfgRoot["providers"] as Record<string, unknown> | undefined) ?? {};
  const anthropic = providers["anthropic"] as { apiKey?: string } | undefined;
  const openai = providers["openai"] as { apiKey?: string } | undefined;

  const entries: Array<Omit<ProviderCatalogEntry, "timeoutMultiplier">> = [
    {
      id: "aion-micro",
      name: "aion-micro",
      tier: "floor",
      offGridCapable: true,
      health: "healthy",
      // Matches factory.ts createSingleProvider("aion-micro", ...) default
      // and AionMicroManager.DEFAULT_MODEL. The fine-tuned LoRA-merged GGUF
      // lives on HuggingFace Hub and is pulled via Lemonade on first request.
      defaultModel: "wishborn/aion-micro-v1",
      // Phase K.4 moved aion-micro serving to the Lemonade backplane — the
      // model can't answer chat completions if Lemonade isn't healthy. The
      // catalog UI uses this to show "Requires: Lemonade" on the card.
      dependsOn: ["lemonade"],
    },
    {
      id: "huggingface",
      name: "Hugging Face",
      tier: "core",
      offGridCapable: true,
      health: "healthy",
    },
    {
      id: "ollama",
      name: "Ollama",
      tier: "local",
      offGridCapable: true,
      health: "healthy",
      baseUrl: "http://127.0.0.1:11434",
      defaultModel: "llama3.1",
    },
    {
      id: "lemonade",
      name: "Lemonade",
      tier: "local",
      offGridCapable: true,
      health: "healthy",
      baseUrl: "http://127.0.0.1:13305",
      // Lemonade auto-routes between NPU/GPU/CPU and selects the loaded
      // model — "default" is its convention for "whatever's loaded."
      defaultModel: "default",
    },
    {
      id: "anthropic",
      name: "Anthropic",
      tier: "cloud",
      offGridCapable: false,
      health: anthropic?.apiKey ? "healthy" : "no-key",
    },
    {
      id: "openai",
      name: "OpenAI",
      tier: "cloud",
      offGridCapable: false,
      health: openai?.apiKey ? "healthy" : "no-key",
    },
  ];
  return entries.map((e) => ({ ...e, timeoutMultiplier: timeoutMultiplierForTier(e.tier) }));
}

function getActiveState(config: AionimaConfig): ActiveProviderState {
  const cfgRoot = config as Record<string, unknown>;
  const agent = (cfgRoot["agent"] as Record<string, unknown> | undefined) ?? {};
  const router = (agent["router"] as Record<string, unknown> | undefined) ?? {};

  return {
    activeProviderId: (agent["provider"] as string | undefined) ?? "anthropic",
    activeModel: (agent["model"] as string | undefined) ?? "claude-sonnet-4-6",
    router: {
      costMode: (router["costMode"] as string | undefined) ?? "balanced",
      escalation: (router["escalation"] as boolean | undefined) ?? false,
      simpleThresholdTokens: router["simpleThresholdTokens"] as number | undefined,
      complexThresholdTokens: router["complexThresholdTokens"] as number | undefined,
      maxEscalationsPerTurn: router["maxEscalationsPerTurn"] as number | undefined,
    },
    offGridMode: (router["offGrid"] as boolean | undefined) ?? false,
  };
}

export function registerProvidersRoutes(app: FastifyInstance, deps: ProvidersApiDeps): void {
  /**
   * GET /api/providers/catalog — full catalog with health + model counts.
   *
   * Response shape:
   *   { providers: ProviderCatalogEntry[], generatedAt: string }
   *
   * The dashboard's Provider catalog shelf consumes this directly. Each
   * provider's tier + offGridCapable drive the badge + sort order; health
   * drives the status dot.
   *
   * Note: the bare `/api/providers` path is owned by the legacy plugin-
   * registered provider list (server-runtime-state.ts) which the existing
   * settings UI + `agi providers` CLI consume. The new catalog ships under
   * /catalog so both can coexist.
   */
  app.get("/api/providers/catalog", async () => {
    const config = deps.readConfig();
    const catalog = buildBaseCatalog(config);

    if (deps.inspectProviders !== undefined) {
      try {
        const liveData = await deps.inspectProviders();
        for (const live of liveData) {
          const entry = catalog.find((c) => c.id === live.id);
          if (entry !== undefined) {
            entry.health = live.health;
            entry.modelCount = live.modelCount;
          }
        }
      } catch {
        // Inspection failures degrade to the config-only catalog; never block the response.
      }
    }

    return { providers: catalog, generatedAt: new Date().toISOString() };
  });

  /**
   * GET /api/providers/recent-decisions — recent routing decisions for the
   * Mission Control hero (s111 t419 UI slice). Returns newest-last array;
   * `limit` query param caps the slice (default 20, hard-capped server-side
   * to AgentRouter's RECENT_DECISIONS_MAX = 50).
   *
   * Returns { decisions: [], generatedAt } with an empty array when the
   * decisions thunk isn't wired (test fixtures, early-boot before the
   * router is ready) — the UI hides the hero gracefully in that case
   * rather than throwing.
   */
  app.get<{ Querystring: { limit?: string } }>(
    "/api/providers/recent-decisions",
    async (req) => {
      const rawLimit = req.query.limit;
      const parsed = rawLimit !== undefined ? Number.parseInt(rawLimit, 10) : 20;
      const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
      const decisions = deps.getRecentDecisions !== undefined
        ? deps.getRecentDecisions(limit)
        : [];
      return { decisions, generatedAt: new Date().toISOString() };
    },
  );

  /**
   * GET /api/providers/active — the active Provider + Agent Router config.
   *
   * Response shape: ActiveProviderState (see interface above).
   *
   * The Mission Control hero on the Providers page reads from here for the
   * "Right now" panel. Hot-reloaded — every call re-reads config.
   */
  app.get("/api/providers/active", async () => {
    return getActiveState(deps.readConfig());
  });

  /**
   * GET /api/providers/catalog/:id — single Provider detail (catalog entry +
   * any Provider-specific metadata). Used by the Provider card "View models"
   * flow in the dashboard mockup.
   *
   * Returns 404 when the id isn't in the canonical catalog.
   */
  app.get<{ Params: { id: string } }>("/api/providers/catalog/:id", async (req, reply) => {
    const config = deps.readConfig();
    const catalog = buildBaseCatalog(config);
    const entry = catalog.find((c) => c.id === req.params.id);
    if (entry === undefined) {
      return reply.code(404).send({ error: `unknown provider: ${req.params.id}` });
    }
    return entry;
  });

  /**
   * PUT /api/providers/active — switch the active Provider (and optionally the
   * model). Owner-driven, hot-reloaded — the agent-router picks up the new
   * Provider on the next invocation without a gateway restart.
   *
   * Body shape: { providerId: string, model?: string }
   *
   * Validates providerId against the canonical catalog (rejects unknown ids).
   * Persists agent.provider (and agent.model when supplied) via
   * systemConfigService.patch — same write-path the existing agent-config
   * Settings flow uses, so callers see the change immediately on the next
   * GET /api/providers/active.
   */
  app.put<{ Body: { providerId?: string; model?: string } }>(
    "/api/providers/active",
    async (req, reply) => {
      if (deps.patchConfig === undefined) {
        return reply.code(503).send({ error: "providers-api is read-only on this install" });
      }
      const body = req.body ?? {};
      const providerId = body.providerId;
      if (typeof providerId !== "string" || providerId.length === 0) {
        return reply.code(400).send({ error: "providerId required (string)" });
      }
      if (!KNOWN_PROVIDER_IDS.has(providerId)) {
        return reply.code(400).send({
          error: `unknown providerId: ${providerId}`,
          validIds: Array.from(KNOWN_PROVIDER_IDS),
        });
      }
      try {
        deps.patchConfig("agent.provider", providerId);
        if (typeof body.model === "string" && body.model.length > 0) {
          deps.patchConfig("agent.model", body.model);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: `config patch rejected: ${message}` });
      }
      return getActiveState(deps.readConfig());
    },
  );

  /**
   * PUT /api/providers/router — update Agent Router config (costMode,
   * escalation, thresholds, offGridMode). All fields optional; only provided
   * fields are patched. Each field validates independently:
   *   - costMode: must be one of local|economy|balanced|max
   *   - escalation: boolean
   *   - simpleThresholdTokens / complexThresholdTokens: positive integer
   *   - maxEscalationsPerTurn: non-negative integer
   *   - offGridMode: boolean — when true, the router filters cloud Providers
   *     from the option set (per memory feedback_off_grid_means_any_local_model)
   *
   * Returns the post-patch ActiveProviderState so the dashboard can
   * verify the write took effect.
   */
  app.put<{ Body: {
    costMode?: string;
    escalation?: boolean;
    simpleThresholdTokens?: number;
    complexThresholdTokens?: number;
    maxEscalationsPerTurn?: number;
    offGridMode?: boolean;
  } }>("/api/providers/router", async (req, reply) => {
    if (deps.patchConfig === undefined) {
      return reply.code(503).send({ error: "providers-api is read-only on this install" });
    }
    const body = req.body ?? {};
    const validationErrors: string[] = [];

    if (body.costMode !== undefined && !KNOWN_COST_MODES.has(body.costMode)) {
      validationErrors.push(`costMode must be one of ${Array.from(KNOWN_COST_MODES).join("|")}`);
    }
    if (body.escalation !== undefined && typeof body.escalation !== "boolean") {
      validationErrors.push("escalation must be boolean");
    }
    if (body.simpleThresholdTokens !== undefined && (!Number.isInteger(body.simpleThresholdTokens) || body.simpleThresholdTokens <= 0)) {
      validationErrors.push("simpleThresholdTokens must be a positive integer");
    }
    if (body.complexThresholdTokens !== undefined && (!Number.isInteger(body.complexThresholdTokens) || body.complexThresholdTokens <= 0)) {
      validationErrors.push("complexThresholdTokens must be a positive integer");
    }
    if (body.maxEscalationsPerTurn !== undefined && (!Number.isInteger(body.maxEscalationsPerTurn) || body.maxEscalationsPerTurn < 0)) {
      validationErrors.push("maxEscalationsPerTurn must be a non-negative integer");
    }
    if (body.offGridMode !== undefined && typeof body.offGridMode !== "boolean") {
      validationErrors.push("offGridMode must be boolean");
    }

    if (validationErrors.length > 0) {
      return reply.code(400).send({ error: "validation failed", details: validationErrors });
    }

    try {
      if (body.costMode !== undefined)               deps.patchConfig("agent.router.costMode", body.costMode);
      if (body.escalation !== undefined)             deps.patchConfig("agent.router.escalation", body.escalation);
      if (body.simpleThresholdTokens !== undefined)  deps.patchConfig("agent.router.simpleThresholdTokens", body.simpleThresholdTokens);
      if (body.complexThresholdTokens !== undefined) deps.patchConfig("agent.router.complexThresholdTokens", body.complexThresholdTokens);
      if (body.maxEscalationsPerTurn !== undefined)  deps.patchConfig("agent.router.maxEscalationsPerTurn", body.maxEscalationsPerTurn);
      if (body.offGridMode !== undefined)            deps.patchConfig("agent.router.offGrid", body.offGridMode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: `config patch rejected: ${message}` });
    }
    return getActiveState(deps.readConfig());
  });
}
