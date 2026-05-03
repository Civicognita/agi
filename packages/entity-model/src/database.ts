/**
 * Database Abstraction Layer — Task #188 (updated: drizzle/Postgres rewrite)
 *
 * Unified async interface over PostgreSQL (pg).
 * SQLiteAdapter is retained as a stub for migration tooling (migrateToPostgres)
 * but should not be used for live data access — all stores now use drizzle
 * via @agi/db-schema/client.
 */

import type { TenantId } from "./tenant.js";
import { DEFAULT_TENANT } from "./tenant.js";

// ---------------------------------------------------------------------------
// Core abstraction
// ---------------------------------------------------------------------------

/** A single row returned by a query. */
export type Row = Record<string, unknown>;

/** Query result from mutating operations (INSERT/UPDATE/DELETE). */
export interface MutationResult {
  /** Number of rows affected. */
  changes: number;
  /** Last inserted row ID (SQLite only, 0 for PostgreSQL). */
  lastInsertRowid: number;
}

/**
 * Unified database adapter interface.
 *
 * All methods are async to support PostgreSQL. The SQLite adapter resolves
 * synchronously (via Promise.resolve) for zero-overhead compatibility.
 */
export interface DatabaseAdapter {
  /** The backend type. */
  readonly backend: "sqlite" | "postgresql";

  /** The tenant this adapter is scoped to (DEFAULT_TENANT for self-hosted). */
  readonly tenantId: TenantId;

  /**
   * Execute a query that returns rows.
   * Use `$1`, `$2`, etc. for PostgreSQL-style positional params.
   */
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * Execute a query that returns a single row, or null if none.
   */
  queryOne<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T | null>;

  /**
   * Execute a mutating statement (INSERT, UPDATE, DELETE).
   */
  execute(sql: string, params?: unknown[]): Promise<MutationResult>;

  /**
   * Execute raw DDL or multi-statement SQL.
   */
  exec(sql: string): Promise<void>;

  /**
   * Run a function inside a transaction. Automatically commits on success,
   * rolls back on error.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  /**
   * Close the database connection.
   */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// SQLite adapter (stub — for migration tooling only)
// ---------------------------------------------------------------------------

/**
 * SQLite adapter stub.
 *
 * All live stores have been migrated to drizzle/Postgres via @agi/db-schema.
 * This stub exists only to satisfy the DatabaseAdapter interface for
 * migration.ts (migrateToPostgres) which reads from old SQLite databases.
 *
 * Pass the raw better-sqlite3 Database handle as `db: unknown` — this avoids
 * a hard dependency on better-sqlite3 in the package.
 */
export class SQLiteAdapter implements DatabaseAdapter {
  readonly backend = "sqlite" as const;
  readonly tenantId: TenantId;

  constructor(
    /** Legacy SQLite handle — typed as unknown to avoid better-sqlite3 dep. */
    private readonly db: unknown,
    tenantId?: TenantId,
  ) {
    this.tenantId = tenantId ?? DEFAULT_TENANT;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get rawDb(): any {
    return this.db;
  }

  async query<T extends Row = Row>(rawSql: string, params?: unknown[]): Promise<T[]> {
    const stmt = this.rawDb.prepare(rawSql) as { all: (...a: unknown[]) => T[] };
    return params ? stmt.all(...params) : stmt.all();
  }

  async queryOne<T extends Row = Row>(rawSql: string, params?: unknown[]): Promise<T | null> {
    const stmt = this.rawDb.prepare(rawSql) as { get: (...a: unknown[]) => T | undefined };
    const row = params ? stmt.get(...params) : stmt.get();
    return row ?? null;
  }

  async execute(rawSql: string, params?: unknown[]): Promise<MutationResult> {
    const stmt = this.rawDb.prepare(rawSql) as {
      run: (...a: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
    };
    const result = params ? stmt.run(...params) : stmt.run();
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  async exec(rawSql: string): Promise<void> {
    this.rawDb.exec(rawSql);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.rawDb.exec("SAVEPOINT txn");
    try {
      const result = await fn();
      this.rawDb.exec("RELEASE txn");
      return result;
    } catch (err) {
      this.rawDb.exec("ROLLBACK TO txn");
      throw err;
    }
  }

  async close(): Promise<void> {
    this.rawDb.close();
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL adapter
// ---------------------------------------------------------------------------

/**
 * PostgreSQL connection config.
 * Uses standard pg Pool options.
 */
export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  maxConnections?: number;
}

/**
 * PostgreSQL adapter using pg Pool.
 *
 * Injects tenant_id into all queries via RLS (Row-Level Security).
 * On each connection acquisition, executes:
 *   SET app.current_tenant = '<tenantId>';
 *
 * This is enforced by RLS policies on every tenant-scoped table.
 */
export class PostgresAdapter implements DatabaseAdapter {
  readonly backend = "postgresql" as const;
  readonly tenantId: TenantId;

  // pg Pool is dynamically imported to avoid bundling it for SQLite-only users
  private pool: PgPool | null = null;
  private readonly config: PostgresConfig;

  constructor(config: PostgresConfig, tenantId: TenantId) {
    this.config = config;
    this.tenantId = tenantId;
  }

  /** Lazily initialize the pg pool. */
  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;

    // Dynamic import so pg is not required for SQLite-only deployments
    const pgModule = "pg";
    const { Pool } = (await import(/* @vite-ignore */ pgModule)) as unknown as { Pool: PgPoolConstructor };
    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      max: this.config.maxConnections ?? 10,
    }) as PgPool;

    return this.pool;
  }

  /** Acquire a client with tenant context set. */
  private async withClient<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
    const pool = await this.getPool();
    const client = await pool.connect();
    try {
      // Set RLS tenant context for this connection
      await client.query(`SET app.current_tenant = $1`, [this.tenantId]);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async query<T extends Row = Row>(rawSql: string, params?: unknown[]): Promise<T[]> {
    return this.withClient(async (client) => {
      const result = await client.query(rawSql, params);
      return result.rows as T[];
    });
  }

  async queryOne<T extends Row = Row>(rawSql: string, params?: unknown[]): Promise<T | null> {
    return this.withClient(async (client) => {
      const result = await client.query(rawSql, params);
      return (result.rows[0] as T) ?? null;
    });
  }

  async execute(rawSql: string, params?: unknown[]): Promise<MutationResult> {
    return this.withClient(async (client) => {
      const result = await client.query(rawSql, params);
      return {
        changes: result.rowCount ?? 0,
        lastInsertRowid: 0,
      };
    });
  }

  async exec(rawSql: string): Promise<void> {
    return this.withClient(async (client) => {
      await client.query(rawSql);
    });
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const result = await fn();
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal pg type stubs (avoids requiring @types/pg at compile time)
// ---------------------------------------------------------------------------

interface PgPoolConstructor {
  new (config: Record<string, unknown>): PgPool;
}

interface PgPool {
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}

interface PgClient {
  query(rawSql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  release(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type DatabaseBackend = "sqlite" | "postgresql";

export interface CreateDatabaseOptions {
  backend: DatabaseBackend;
  /** SQLite file path (required when backend = "sqlite"). */
  sqlitePath?: string;
  /** PostgreSQL connection config (required when backend = "postgresql"). */
  postgres?: PostgresConfig;
  /** Tenant ID (defaults to DEFAULT_TENANT for SQLite). */
  tenantId?: TenantId;
}

/**
 * Create a database adapter based on configuration.
 *
 * For SQLite, dynamically imports better-sqlite3 and runs all DDL.
 * For PostgreSQL, assumes DDL is already applied (via drizzle migrations).
 */
export async function createDatabaseAdapter(
  options: CreateDatabaseOptions,
): Promise<DatabaseAdapter> {
  if (options.backend === "sqlite") {
    const path = options.sqlitePath ?? ":memory:";

    // Dynamic import — better-sqlite3 was removed from agi's direct deps
    // in v0.4.425 to drop the 10-20s native compile from every upgrade.
    // The SQLite backend remains as a fallback for tests + legacy code
    // paths; install ad-hoc with `pnpm add -D better-sqlite3` if you
    // need it. Postgres is the canonical backend (memory feedback_single
    // _source_of_truth_db).
    let BetterSqlite3Module: { default: new (p: string) => unknown };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      BetterSqlite3Module = await import("better-sqlite3" as any);
    } catch (err) {
      throw new Error(
        "SQLite backend requires better-sqlite3 — install ad-hoc with " +
        "`pnpm add -D better-sqlite3` (removed from agi direct deps in v0.4.425). " +
        "Postgres is the canonical backend; switch with backend: 'postgresql'. " +
        "Original error: " + (err instanceof Error ? err.message : String(err)),
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const BetterSqlite3Constructor: new (p: string) => any = BetterSqlite3Module.default;
    const db = new BetterSqlite3Constructor(path);

    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    return new SQLiteAdapter(db, options.tenantId);
  }

  if (options.backend === "postgresql") {
    if (!options.postgres) {
      throw new Error("PostgreSQL config required when backend is 'postgresql'");
    }
    if (!options.tenantId) {
      throw new Error("tenantId required for PostgreSQL multi-tenant mode");
    }
    return new PostgresAdapter(options.postgres, options.tenantId);
  }

  throw new Error(`Unknown database backend: ${options.backend as string}`);
}
