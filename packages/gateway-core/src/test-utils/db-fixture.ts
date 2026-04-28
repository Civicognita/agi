/**
 * Test DB fixture — schema-per-test against real Postgres (story #106 t339).
 *
 * Each call to `createTestDb()` allocates a fresh `test_<random>` schema
 * inside the test VM's `agi_data` Postgres, runs the dashboard-subset DDL
 * into it, and returns a drizzle `NodePgDatabase` with `search_path` pinned
 * to that schema so every query resolves unqualified table names there.
 * `close()` drops the schema; `reset()` truncates fixture tables between
 * tests within the same schema.
 *
 * Why we replaced pglite: the previous fixture used `@electric-sql/pglite`
 * (in-process Postgres-in-WASM) for fast boot but introduced a second
 * Postgres-compatible engine, a hand-written DDL mirror, and a load-bearing
 * `pnpm.overrides.drizzle-orm` pin — all of which violated the project's
 * single-source-of-truth principle (memory `feedback_single_source_of_truth_db`).
 * Owner direction 2026-04-25: tests use the test VM's real Postgres
 * (16.13, system-managed), connected via @agi/db-schema's createDbClient.
 * Per-test isolation comes from schema-per-test rather than per-test
 * database creation (cheaper) or transaction-rollback (drizzle pool
 * makes connection pinning awkward).
 *
 * Per-test cost: ~50–200ms for schema creation + DDL. For ~85 tests a
 * full run adds a few seconds; acceptable trade-off for one DB engine.
 *
 * Connection: defaults to the test VM's Postgres at
 * `postgres://agi:aionima@localhost:5432/agi_data`. Override via
 * `AGI_TEST_DATABASE_URL` (preferred) or `DATABASE_URL`. The VM must be
 * running; see `db-connection.ts` for the connectivity probe.
 *
 * This fixture covers the dashboard tests' table subset. As more test
 * files migrate (per `_plans/phase2-tests-pg.md`), they should swap their
 * hand-written DDL for the production migration path from `@agi/db-schema`
 * (a follow-up beyond t339's MVP scope).
 *
 * Usage (drop-in replacement for the previous pglite fixture):
 *   import { createTestDb, type TestDbContext } from "./test-utils/db-fixture.js";
 *
 *   let ctx: TestDbContext;
 *   beforeEach(async () => { ctx = await createTestDb(); });
 *   afterEach(async () => { await ctx.close(); });
 *
 *   const queries = new DashboardQueries(ctx.db);
 *
 * `ctx.db` is now a `NodePgDatabase<typeof schema>` — production-equivalent.
 * The `AnyDb` widening that DashboardQueries / EntityStore / ImpactRecorder
 * adopted for pglite still works (they accept any `PgDatabase` driver), but
 * the concrete `NodePgDatabase` could be tightened back where convenient.
 */

import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@agi/db-schema";

export interface TestDbContext {
  /** Postgres pool with `search_path` set to this test's schema. */
  readonly pool: Pool;
  /** drizzle client — production-equivalent NodePgDatabase. */
  readonly db: NodePgDatabase<typeof schema>;
  /** The per-test schema name (`test_<16-hex-char>`). */
  readonly schemaName: string;
  /** Drop the test schema and close the pool. */
  close(): Promise<void>;
  /** Truncate fixture tables within the test schema. Faster than reopening. */
  reset(): Promise<void>;
}

/**
 * DDL covering the dashboard-test subset.
 *
 * Hand-written for the dashboard tests' table needs; runs inside the
 * per-test schema thanks to `search_path`. CREATE TYPE statements are
 * unconditional because the schema is freshly created — types from
 * `public` (production) are not visible to these queries inside the
 * test schema unless qualified, and we never qualify here.
 *
 * Intentional mirror of the drizzle table objects in @agi/db-schema —
 * update both whenever db-schema changes. drizzle-kit can't bridge
 * the gap because the monorepo's NodeNext .js imports break drizzle-kit's
 * CJS resolver (same reason `agi/scripts/migrate-db.sh` exists). A follow-up
 * task can replace this DDL with the actual production migration path.
 */
const SCHEMA_DDL = `
-- Enums
CREATE TYPE entity_scope AS ENUM ('local', 'registered', 'federated');
CREATE TYPE verification_tier AS ENUM ('unverified', 'pending', 'verified', 'trusted', 'sealed', 'disabled');
CREATE TYPE federation_consent AS ENUM ('none', 'discoverable', 'full');

-- entities (mirrors packages/db-schema/src/entities.ts)
CREATE TABLE entities (
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
CREATE UNIQUE INDEX entities_coa_alias_idx ON entities (coa_alias);
CREATE INDEX entities_parent_idx ON entities (parent_entity_id);
CREATE INDEX entities_user_idx ON entities (user_id);

-- geid_local — required by EntityStore.createEntity (auto-generates GEID keypair).
CREATE TABLE geid_local (
  entity_id TEXT PRIMARY KEY REFERENCES entities (id) ON DELETE CASCADE,
  geid TEXT NOT NULL,
  public_key_pem TEXT NOT NULL,
  private_key_pem TEXT,
  discoverable BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX geid_local_geid_idx ON geid_local (geid);

-- coa_chains (mirrors packages/db-schema/src/audit.ts)
CREATE TABLE coa_chains (
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
CREATE INDEX coa_chains_entity_idx ON coa_chains (entity_id);
CREATE INDEX coa_chains_created_idx ON coa_chains (created_at);

-- impact_interactions (mirrors packages/db-schema/src/audit.ts)
CREATE TABLE impact_interactions (
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
CREATE INDEX impact_interactions_entity_idx ON impact_interactions (entity_id);
CREATE INDEX impact_interactions_coa_idx ON impact_interactions (coa_fingerprint);
`;

const FIXTURE_TABLES = ["impact_interactions", "coa_chains", "geid_local", "entities"] as const;

function resolveBaseUrl(): string {
  return process.env.AGI_TEST_DATABASE_URL
    ?? process.env.DATABASE_URL
    ?? "postgres://agi:aionima@localhost:5432/agi_data";
}

export async function createTestDb(): Promise<TestDbContext> {
  const baseUrl = resolveBaseUrl();
  // 16 hex chars (8 bytes) gives a wide enough namespace that collisions
  // between concurrent test runs are negligible.
  const schemaName = `test_${randomBytes(8).toString("hex")}`;

  // Setup: open a one-shot client to create the schema + run DDL inside it.
  // Pinning the schema via `SET search_path` for the lifetime of this
  // session is enough because the DDL runs in this same session before
  // the client is released.
  const setupPool = new Pool({ connectionString: baseUrl, max: 1 });
  try {
    const c = await setupPool.connect();
    try {
      await c.query(`CREATE SCHEMA "${schemaName}"`);
      await c.query(`SET search_path TO "${schemaName}"`);
      // Pin session to UTC so date_trunc / interval math match production
      // (which runs agi_data with TIME ZONE 'UTC' set globally).
      await c.query(`SET TIME ZONE 'UTC'`);
      await c.query(SCHEMA_DDL);
    } finally {
      c.release();
    }
  } finally {
    await setupPool.end();
  }

  // Test pool: every connection inherits search_path = <schema>,public
  // via the Postgres `options` connection string parameter. This is the
  // canonical way to scope a pool to a schema without pinning a specific
  // connection. `public` stays in the path so queries that reference
  // shared objects (extensions, e.g.) still resolve.
  const pool = new Pool({
    connectionString: baseUrl,
    options: `-c search_path=${schemaName},public -c timezone=UTC`,
    max: 4,
  });
  const db = drizzle(pool, { schema });

  const ctx: TestDbContext = {
    pool,
    db,
    schemaName,
    async close() {
      // Order: end the test pool first so no connections are pinning the
      // schema, then drop via a fresh admin pool.
      await pool.end();
      const adminPool = new Pool({ connectionString: baseUrl, max: 1 });
      try {
        await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } finally {
        await adminPool.end();
      }
    },
    async reset() {
      // TRUNCATE in FK-safe order (children first, then parents); CASCADE
      // covers any index/trigger state; RESTART IDENTITY resets sequences.
      // search_path is already set on every pool connection, so the
      // unqualified table names resolve to the test schema.
      const c = await pool.connect();
      try {
        await c.query(`TRUNCATE ${FIXTURE_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
      } finally {
        c.release();
      }
    },
  };

  return ctx;
}
