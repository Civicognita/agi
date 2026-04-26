/**
 * Cost ledger — per-turn cost recording (s111 t421).
 *
 * One row per agent-router invocation: who/what/when ran, how many tokens
 * flowed, how many watts the system drew, what dollar cost the cloud
 * Provider charged (zero for local Providers). The Providers UX cost ticker
 * (cycle 19 placeholder) reads aggregations from this table; the Mission
 * Control hero narrative (cycle 21) gets richer with per-turn watt + dollar
 * data; future $WATCHER.RESOURCE views report rolling totals.
 *
 * Why a real Postgres table (not JSONL like statsHistory)?
 *   - Cross-session aggregation queries (today, week, by-Provider, by-cost-mode)
 *     are SQL-shaped, not log-shaped. Loading the whole JSONL to compute a
 *     7-day rollup would scale poorly.
 *   - Multi-user accounting will need entity-keyed rollups eventually
 *     (today: ~ alone; future: per-#E0 / per-$A0 / per-$M ledgers under COA).
 *   - $IMP minting (v0.6.0+) consumes this table as input to 0SCALE — the
 *     audit trail must be queryable, not log-line-readable-only.
 *
 * This file is the SCHEMA slice (cycle 23). The write path (AgentRouter
 * recording after each invoke), pricing table (per-Provider $/1M tokens),
 * read API (/api/providers/cost/today + /week + /recent), and Providers
 * page CostTicker integration land in subsequent cycles.
 *
 * Per memory `feedback_single_source_of_truth_db` — this table lives in
 * agi_data, not a per-service schema.
 */

import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const costRecords = pgTable(
  "cost_records",
  {
    /** UUID generated at write-time. ULID-ordered would also work; UUID v4
     *  is fine because primary lookup is by indexed (ts, entityId), not id. */
    id: text("id").primaryKey(),

    /** When the turn finalized (post-fallback / post-escalation), matching
     *  AgentRouter.recordDecision() timing. Drives all aggregation slices. */
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),

    /** Owner-side entity that initiated the turn — for COA<>COI accounting.
     *  Today this is `~` (local-only); future federation surfaces real
     *  HIVE-registered entities (#E0, #O0, $A0, $M*). */
    entityId: text("entity_id"),

    /** Resolved Provider id post-routing (anthropic, openai, ollama,
     *  lemonade, aion-micro, hf-local, plugin-id-*). Mirrors the catalog's
     *  ProviderCatalogEntry.id from t411. */
    provider: text("provider").notNull(),

    /** Resolved model the Provider served. Anthropic Sonnet, Llama 3.1, etc. */
    model: text("model").notNull(),

    /** Cost mode at routing time (local|economy|balanced|max). Mirrors
     *  the agent-router CostMode union. Stored as text for forward-
     *  compatibility — adding a 5th cost mode shouldn't require an enum
     *  migration. */
    costMode: text("cost_mode").notNull(),

    /** Request complexity classification (simple|moderate|complex). Drives
     *  cost-mode→model selection; useful for "complexity vs cost" analyses. */
    complexity: text("complexity").notNull(),

    /** Input tokens (post-system-prompt + history + tools). From LLMResponse.usage. */
    inputTokens: integer("input_tokens").notNull(),

    /** Output tokens generated. From LLMResponse.usage. */
    outputTokens: integer("output_tokens").notNull(),

    /** RAPL CPU watts at turn end (s111 t377). Null on non-Linux / no
     *  intel-rapl. Aggregated into "today's Wh" + per-provider energy
     *  rollups for the Providers UX cost ticker. */
    cpuWattsObserved: real("cpu_watts_observed"),

    /** NVIDIA GPU watts at turn end (s111 t417). Null on non-NVIDIA hosts. */
    gpuWattsObserved: real("gpu_watts_observed"),

    /** USD cost from the per-Provider pricing table (cloud rates ×
     *  tokens). Null pre-pricing-table-population; 0 for local Providers
     *  (aion-micro, ollama, lemonade, hf-local). */
    dollarCost: real("dollar_cost"),

    /** True when the agent-router escalated mid-turn (low-confidence
     *  detection → stronger model). Mirrors RoutingDecision.escalated. */
    escalated: boolean("escalated").notNull().default(false),

    /** End-to-end invoke duration (ms) — how long the user waited. Useful
     *  for latency analyses ("balanced cloud is N% faster than local"). */
    turnDurationMs: integer("turn_duration_ms").notNull(),

    /** RoutingDecision.reason — the human-readable why-this-route string
     *  ("balanced/simple", "fallback from anthropic", "escalated from
     *  haiku-4-5"). Surfaced in the Mission Control hero narrative. */
    routingReason: text("routing_reason").notNull(),
  },
  (t) => ({
    /** Time-range queries: today, week, recent. Most-frequent access path. */
    tsIdx: index("cost_records_ts_idx").on(t.ts),
    /** Per-Provider rollups: "anthropic spent $X today, lemonade Y Wh." */
    providerIdx: index("cost_records_provider_idx").on(t.provider),
    /** Per-entity history (for future federated accounting) — composite
     *  with ts so per-user time-range slices stay index-only. */
    entityTsIdx: index("cost_records_entity_ts_idx").on(t.entityId, t.ts),
  }),
);

/** Inferred TypeScript type for consumers (gateway-core write path,
 *  read API, dashboard cost ticker). Drizzle generates the full insert
 *  + select shapes from the pgTable definition. */
export type CostRecord = typeof costRecords.$inferSelect;
export type NewCostRecord = typeof costRecords.$inferInsert;
