/**
 * Shared drizzle + pg client factory for agi_data.
 *
 * All AGI services and Local-ID call `createDbClient()` to obtain a drizzle
 * instance bound to the unified schema. Connection pool is reused across
 * callers within a single process; each process gets its own pool instance.
 */

import { Pool, type PoolConfig } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./index.js";

export type Db = NodePgDatabase<typeof schema>;

/**
 * Widened DB type that accepts any drizzle Postgres driver bound to the
 * `@agi/db-schema` set. Used by services that want to run against node-postgres
 * in production AND in-process pglite under test. Production code should still
 * prefer the concrete `Db` (= NodePgDatabase); only test harnesses and
 * infrastructure that genuinely needs driver polymorphism should use `AnyDb`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema, any>;

export interface DbClient {
  pool: Pool;
  db: Db;
}

export interface CreateDbClientOptions {
  /** Postgres connection string. Defaults to DATABASE_URL env, then localhost agi_data. */
  url?: string;
  /** Extra pool options to merge on top of the default. */
  poolConfig?: Omit<PoolConfig, "connectionString">;
}

/**
 * Resolve the connection URL from options → env → default.
 * Default matches the local dev Postgres container: `agi-postgres-17`.
 */
function resolveConnectionUrl(url?: string): string {
  if (url !== undefined && url !== "") return url;
  const envUrl = process.env.DATABASE_URL;
  if (envUrl !== undefined && envUrl !== "") return envUrl;
  return "postgres://agi:aionima@localhost:5432/agi_data";
}

export function createDbClient(options: CreateDbClientOptions = {}): DbClient {
  const connectionString = resolveConnectionUrl(options.url);
  const pool = new Pool({
    connectionString,
    ...options.poolConfig,
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
