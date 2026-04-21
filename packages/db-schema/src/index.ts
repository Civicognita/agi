/**
 * @agi/db-schema — unified drizzle schema for agi_data Postgres database.
 *
 * Single source of truth for all AGI platform services + Local-ID. Every table
 * lives in the `public` schema. Service-area prefixes (`hf_*`, `plugins_*`,
 * `mapps_*`) group related tables; core concepts (entities, users, coa_chains,
 * etc.) go unprefixed.
 *
 * Per memory `feedback_single_source_of_truth_db` — NEVER create a second
 * database or a subschema. When a new service needs tables, add them here.
 */

// Auth + identity
export * from "./auth.js";

// Entity graph + federation
export * from "./entities.js";

// Audit trails (COA chains, impact, usage, comms, revocation)
export * from "./audit.js";

// Compliance (incidents, consents, vendors, verification, seals)
export * from "./compliance.js";

// Platform runtime state (magic apps, notifications, kv meta)
export * from "./platform.js";

// Marketplace catalog indexes + installed state
export * from "./marketplaces.js";

// HuggingFace runtime (installed models, download progress, datasets)
export * from "./hf.js";

// Security scan runs and findings
export * from "./security.js";
