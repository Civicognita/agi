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

export interface WaitForDbOptions {
  /** Total budget in ms before giving up. Default 20_000. */
  timeoutMs?: number;
  /** Initial backoff in ms; doubles up to 2_000ms. Default 250. */
  initialDelayMs?: number;
  /** Optional logger for retry attempts. */
  onAttempt?: (attempt: number, lastError: Error | null) => void;
}

/**
 * Block until the pool can accept a query, or throw after the timeout.
 *
 * Boot order race: when the host reboots, systemd starts the gateway at the
 * same time the postgres container is coming up. The first DB query can
 * reject with ECONNREFUSED / "the database system is starting up" before
 * postgres is ready. Without this wait, the rejection lands in the global
 * unhandled-rejection safety net and the gateway zombies — process alive,
 * Fastify never bound. With this wait, the failure becomes a fatal boot
 * error and systemd restarts cleanly.
 */
export async function waitForDb(pool: Pool, options: WaitForDbOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const initialDelayMs = options.initialDelayMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let delay = initialDelayMs;
  let attempt = 0;
  let lastError: Error | null = null;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const client = await pool.connect();
      try {
        await client.query("select 1");
      } finally {
        client.release();
      }
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (options.onAttempt !== undefined) options.onAttempt(attempt, lastError);
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
      delay = Math.min(delay * 2, 2_000);
    }
  }
  throw new Error(
    `Database not ready after ${String(timeoutMs)}ms (${String(attempt)} attempts). ` +
      `Last error: ${lastError?.message ?? "unknown"}`,
  );
}
