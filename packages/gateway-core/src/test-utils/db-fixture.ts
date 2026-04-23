/**
 * Test DB fixture — pglite-backed drizzle client with the dashboard
 * subset of the @agi/db-schema tables.
 *
 * Why this exists: `DashboardQueries` and friends were migrated to
 * drizzle/Postgres (v0.4.39 → v0.4.96 cutover), but the test files under
 * packages/gateway-core/src/*.test.ts still seed via better-sqlite3 from
 * @agi/entity-model. The mismatch was frozen with `@ts-nocheck +
 * describe.skip` blocks pending a real Postgres harness
 * (see _plans/phase2-tests-pg.md).
 *
 * `@electric-sql/pglite` gives us in-process Postgres-in-WASM — no
 * external container, no VM. Since `pnpm.overrides.drizzle-orm: 0.38.4`
 * was added in v0.4.103, pglite's peer-dep closure shares drizzle-orm
 * with the rest of the workspace (verified: `pnpm ls drizzle-orm -r`
 * shows a single 0.38.4).
 *
 * This fixture covers the tables the DASHBOARD tests need. Other
 * deferred test files (gdpr, impact-scorer, governance, multi-tenancy,
 * queue, store, usage-store, verification, federation, gateway, seal,
 * store-diff — per _plans/phase2-tests-pg.md) can extend
 * SCHEMA_DDL with their own tables as they migrate.
 *
 * Usage:
 *   import { createTestDb, resetTestDb } from "./test-utils/db-fixture.js";
 *
 *   let ctx: TestDbContext;
 *   beforeEach(async () => { ctx = await createTestDb(); });
 *   afterEach(async () => { await ctx.close(); });
 *
 *   // Pass ctx.db wherever a drizzle PgDatabase is expected.
 *   const queries = new DashboardQueries(ctx.db);
 *
 * Type note: DashboardQueries' constructor today accepts the concrete
 * `Db = NodePgDatabase<schema>`. PgliteDatabase<schema> shares the
 * PgDatabase base class but has a different QueryResultHKT. Callers
 * that need to bridge can widen DashboardQueries' signature to accept
 * `PgDatabase<any, typeof schema>` (drizzle's own generic base type) or
 * cast the fixture's `db` at the call site. Both escape hatches are
 * ergonomic; production code keeps the tighter NodePgDatabase.
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "@agi/db-schema";

export interface TestDbContext {
  readonly pg: PGlite;
  readonly db: PgliteDatabase<typeof schema>;
  /** Close the pglite instance and release resources. */
  close(): Promise<void>;
  /** Truncate all fixture tables, keeping the schema — faster than reopening. */
  reset(): Promise<void>;
}

/**
 * Schema DDL covering the dashboard-test subset of the unified schema.
 *
 * Hand-written CREATE TABLE IF NOT EXISTS statements matching the
 * drizzle table objects in @agi/db-schema. Intentional mirror — update
 * whenever db-schema changes. We can't rely on drizzle-kit push here
 * because the monorepo's NodeNext .js imports confuse drizzle-kit's
 * CJS resolver (same reason agi/scripts/migrate-db.sh exists).
 *
 * Includes: entity enums, entities, coa_chains, impact_interactions.
 * Extend when migrating additional tests.
 */
const SCHEMA_DDL = `
-- Enums
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entity_scope') THEN
    CREATE TYPE entity_scope AS ENUM ('local', 'registered', 'federated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_tier') THEN
    CREATE TYPE verification_tier AS ENUM ('unverified', 'pending', 'verified', 'trusted', 'sealed', 'disabled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'federation_consent') THEN
    CREATE TYPE federation_consent AS ENUM ('none', 'discoverable', 'full');
  END IF;
END $$;

-- entities (from packages/db-schema/src/entities.ts)
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  coa_alias TEXT NOT NULL,
  scope entity_scope NOT NULL DEFAULT 'local',
  parent_entity_id TEXT,
  user_id TEXT,
  verification_tier verification_tier NOT NULL DEFAULT 'unverified',
  geid TEXT,
  public_key_pem TEXT,
  home_node_id TEXT,
  federation_consent federation_consent NOT NULL DEFAULT 'none',
  source_ip TEXT,
  integrity_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS entities_coa_alias_idx ON entities (coa_alias);
CREATE INDEX IF NOT EXISTS entities_parent_idx ON entities (parent_entity_id);
CREATE INDEX IF NOT EXISTS entities_user_idx ON entities (user_id);

-- coa_chains (from packages/db-schema/src/audit.ts)
CREATE TABLE IF NOT EXISTS coa_chains (
  fingerprint TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  entity_id TEXT NOT NULL REFERENCES entities (id),
  node_id TEXT NOT NULL,
  chain_counter INTEGER NOT NULL,
  work_type TEXT NOT NULL,
  ref TEXT,
  action TEXT,
  payload_hash TEXT,
  fork_id TEXT,
  source_ip TEXT,
  integrity_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS coa_chains_entity_idx ON coa_chains (entity_id);
CREATE INDEX IF NOT EXISTS coa_chains_created_idx ON coa_chains (created_at);

-- impact_interactions (from packages/db-schema/src/audit.ts)
CREATE TABLE IF NOT EXISTS impact_interactions (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities (id),
  coa_fingerprint TEXT NOT NULL REFERENCES coa_chains (fingerprint),
  channel TEXT,
  work_type TEXT,
  quant DOUBLE PRECISION NOT NULL,
  value_0bool DOUBLE PRECISION NOT NULL,
  bonus DOUBLE PRECISION NOT NULL DEFAULT 0,
  imp_score DOUBLE PRECISION NOT NULL,
  origin_node_id TEXT,
  relay_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS impact_interactions_entity_idx ON impact_interactions (entity_id);
CREATE INDEX IF NOT EXISTS impact_interactions_coa_idx ON impact_interactions (coa_fingerprint);
`;

/** Tables this fixture creates. Used by reset() to TRUNCATE. */
const FIXTURE_TABLES = ["impact_interactions", "coa_chains", "entities"] as const;

export async function createTestDb(): Promise<TestDbContext> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });

  // Run the DDL. pglite supports DO $$ blocks and full CREATE TABLE syntax.
  await pg.exec(SCHEMA_DDL);

  const ctx: TestDbContext = {
    pg,
    db,
    async close() {
      await pg.close();
    },
    async reset() {
      // TRUNCATE in FK-safe order (children first, then parents).
      // CASCADE covers any index/trigger state; RESTART IDENTITY resets sequences.
      await pg.exec(`TRUNCATE ${FIXTURE_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    },
  };

  return ctx;
}
