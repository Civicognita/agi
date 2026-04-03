/**
 * SQLite → PostgreSQL Migration — Task #192
 *
 * Data migration tooling for moving existing SQLite databases
 * to PostgreSQL for hosted multi-tenant mode.
 *
 * Features:
 * - Table-by-table data migration with progress reporting
 * - COA chain integrity validation post-migration
 * - Foreign key dependency ordering
 * - Rollback capability via PostgreSQL transactions
 * - Batch inserts for large datasets
 */

import type { DatabaseAdapter, Row } from "./database.js";
import type { TenantId } from "./tenant.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrationConfig {
  /** Source SQLite adapter. */
  source: DatabaseAdapter;
  /** Target PostgreSQL adapter. */
  target: DatabaseAdapter;
  /** Tenant ID to assign to all migrated rows. */
  tenantId: TenantId;
  /** Batch size for INSERT operations. */
  batchSize?: number;
  /** Progress callback invoked per table. */
  onProgress?: (event: MigrationProgress) => void;
}

export interface MigrationProgress {
  table: string;
  phase: "counting" | "migrating" | "validating" | "done";
  rowsMigrated: number;
  totalRows: number;
  elapsedMs: number;
}

export interface MigrationResult {
  success: boolean;
  tables: TableMigrationResult[];
  totalRows: number;
  totalMs: number;
  validationErrors: ValidationError[];
}

export interface TableMigrationResult {
  table: string;
  rowCount: number;
  durationMs: number;
  status: "ok" | "skipped" | "error";
  error?: string;
}

export interface ValidationError {
  table: string;
  check: string;
  message: string;
  severity: "warning" | "error";
}

// ---------------------------------------------------------------------------
// Migration table ordering (respects foreign key deps)
// ---------------------------------------------------------------------------

/**
 * Tables in dependency order — parents before children.
 * The `meta` table has no tenant_id in SQLite but does in PG, handled specially.
 */
const MIGRATION_TABLES = [
  { name: "entities", hasTenantId: false, pgHasTenantId: true },
  { name: "channel_accounts", hasTenantId: false, pgHasTenantId: true },
  { name: "coa_chains", hasTenantId: false, pgHasTenantId: true },
  { name: "impact_interactions", hasTenantId: false, pgHasTenantId: true },
  { name: "verification_requests", hasTenantId: false, pgHasTenantId: true },
  { name: "seals", hasTenantId: false, pgHasTenantId: true },
  { name: "message_queue", hasTenantId: false, pgHasTenantId: true },
  { name: "meta", hasTenantId: false, pgHasTenantId: true },
  { name: "memberships", hasTenantId: false, pgHasTenantId: true },
] as const;

// ---------------------------------------------------------------------------
// Column mappings (SQLite column names → PG column names)
// ---------------------------------------------------------------------------

/** Columns per table in the SQLite schema (used for SELECT and INSERT ordering). */
const TABLE_COLUMNS: Record<string, string[]> = {
  entities: ["id", "type", "display_name", "verification_tier", "coa_alias", "created_at", "updated_at"],
  channel_accounts: ["id", "entity_id", "channel", "channel_user_id", "verified", "created_at"],
  coa_chains: ["fingerprint", "resource_id", "entity_id", "node_id", "chain_counter", "work_type", "ref", "action", "payload_hash", "fork_id", "created_at"],
  impact_interactions: ["id", "entity_id", "coa_fingerprint", "channel", "work_type", "quant", "value_0bool", "bonus", "imp_score", "created_at"],
  verification_requests: ["id", "entity_id", "entity_type", "status", "proof_type", "proof_payload", "proof_submitted_at", "proof_submitted_by", "reviewer_id", "decision", "decision_reason", "decision_at", "coa_fingerprint", "created_at", "updated_at"],
  seals: ["seal_id", "entity_id", "entity_type", "issued_at", "issued_by", "coa", "alignment_aa", "alignment_uu", "alignment_cc", "checksum", "grid", "status", "revoked_at", "revoked_by", "revoke_reason"],
  message_queue: ["id", "channel", "direction", "payload", "status", "retries", "created_at", "processed_at"],
  meta: ["key", "value", "updated_at"],
  memberships: ["id", "org_id", "member_id", "role", "status", "impact_share", "invited_by", "joined_at", "created_at", "updated_at"],
};

// ---------------------------------------------------------------------------
// Migrator
// ---------------------------------------------------------------------------

/**
 * Migrates data from a SQLite database to PostgreSQL.
 *
 * The migration:
 * 1. Counts rows per table
 * 2. Reads batches from SQLite
 * 3. Inserts into PostgreSQL with tenant_id prepended
 * 4. Validates COA chain integrity and foreign key consistency
 *
 * All inserts are wrapped in a single transaction for atomicity.
 * On any error, the entire migration is rolled back.
 */
export async function migrateToPostgres(config: MigrationConfig): Promise<MigrationResult> {
  const { source, target, tenantId, onProgress } = config;
  const batchSize = config.batchSize ?? 500;
  const startTime = Date.now();

  const tableResults: TableMigrationResult[] = [];
  const validationErrors: ValidationError[] = [];
  let totalRows = 0;

  try {
    await target.transaction(async () => {
      for (const tableDef of MIGRATION_TABLES) {
        const tableStart = Date.now();
        const { name: table } = tableDef;
        const columns = TABLE_COLUMNS[table];

        if (!columns) {
          tableResults.push({ table, rowCount: 0, durationMs: 0, status: "skipped" });
          continue;
        }

        // Count source rows
        onProgress?.({ table, phase: "counting", rowsMigrated: 0, totalRows: 0, elapsedMs: 0 });
        const countResult = await source.queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM ${table}`);
        const totalForTable = countResult?.cnt ?? 0;

        if (totalForTable === 0) {
          tableResults.push({ table, rowCount: 0, durationMs: Date.now() - tableStart, status: "ok" });
          continue;
        }

        // Migrate in batches
        let migrated = 0;
        let offset = 0;

        while (offset < totalForTable) {
          const rows = await source.query<Row>(
            `SELECT ${columns.join(", ")} FROM ${table} LIMIT ${batchSize} OFFSET ${offset}`,
          );

          if (rows.length === 0) break;

          for (const row of rows) {
            // Build PG insert with tenant_id prepended
            const pgColumns = ["tenant_id", ...columns];
            const values: unknown[] = [tenantId];

            for (const col of columns) {
              let val = row[col];
              // SQLite uses 0/1 for booleans, PG uses true/false
              if (col === "verified" && typeof val === "number") {
                val = val === 1;
              }
              values.push(val);
            }

            const placeholders = pgColumns.map((_, i) => `$${i + 1}`).join(", ");
            await target.execute(
              `INSERT INTO ${table} (${pgColumns.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
              values,
            );
            migrated++;
          }

          offset += rows.length;
          onProgress?.({
            table,
            phase: "migrating",
            rowsMigrated: migrated,
            totalRows: totalForTable,
            elapsedMs: Date.now() - tableStart,
          });
        }

        totalRows += migrated;
        tableResults.push({
          table,
          rowCount: migrated,
          durationMs: Date.now() - tableStart,
          status: "ok",
        });

        onProgress?.({
          table,
          phase: "done",
          rowsMigrated: migrated,
          totalRows: totalForTable,
          elapsedMs: Date.now() - tableStart,
        });
      }

      // Post-migration validation
      const errors = await validateMigration(source, target, tenantId);
      validationErrors.push(...errors);

      if (errors.some(e => e.severity === "error")) {
        throw new Error(`Migration validation failed: ${errors.filter(e => e.severity === "error").map(e => e.message).join("; ")}`);
      }
    });

    return {
      success: true,
      tables: tableResults,
      totalRows,
      totalMs: Date.now() - startTime,
      validationErrors,
    };
  } catch (err) {
    // Transaction rolled back automatically
    return {
      success: false,
      tables: tableResults.map(t => ({
        ...t,
        status: "error" as const,
        error: t.status === "error" ? t.error : "rolled back",
      })),
      totalRows: 0,
      totalMs: Date.now() - startTime,
      validationErrors: [
        ...validationErrors,
        {
          table: "_migration",
          check: "transaction",
          message: err instanceof Error ? err.message : String(err),
          severity: "error" as const,
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Post-migration validation
// ---------------------------------------------------------------------------

/**
 * Validate data integrity after migration.
 * Checks row counts, COA chain references, and FK consistency.
 */
async function validateMigration(
  source: DatabaseAdapter,
  target: DatabaseAdapter,
  tenantId: TenantId,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  // 1. Row count comparison
  for (const tableDef of MIGRATION_TABLES) {
    const { name: table } = tableDef;
    const srcCount = await source.queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM ${table}`);
    const tgtCount = await target.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM ${table} WHERE tenant_id = $1`,
      [tenantId],
    );

    const srcN = srcCount?.cnt ?? 0;
    const tgtN = tgtCount?.cnt ?? 0;

    if (srcN !== tgtN) {
      errors.push({
        table,
        check: "row_count",
        message: `Row count mismatch: source=${srcN}, target=${tgtN}`,
        severity: "error",
      });
    }
  }

  // 2. COA chain integrity — every impact_interaction references a valid coa_chain
  const orphanedImpacts = await target.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM impact_interactions i
     WHERE i.tenant_id = $1
     AND NOT EXISTS (SELECT 1 FROM coa_chains c WHERE c.fingerprint = i.coa_fingerprint AND c.tenant_id = $1)`,
    [tenantId],
  );
  if (orphanedImpacts && orphanedImpacts.cnt > 0) {
    errors.push({
      table: "impact_interactions",
      check: "coa_chain_integrity",
      message: `${orphanedImpacts.cnt} impact interactions reference non-existent COA chains`,
      severity: "error",
    });
  }

  // 3. Entity FK integrity — channel_accounts reference valid entities
  const orphanedAccounts = await target.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM channel_accounts ca
     WHERE ca.tenant_id = $1
     AND NOT EXISTS (SELECT 1 FROM entities e WHERE e.id = ca.entity_id AND e.tenant_id = $1)`,
    [tenantId],
  );
  if (orphanedAccounts && orphanedAccounts.cnt > 0) {
    errors.push({
      table: "channel_accounts",
      check: "entity_fk_integrity",
      message: `${orphanedAccounts.cnt} channel accounts reference non-existent entities`,
      severity: "error",
    });
  }

  // 4. Membership integrity — org_id and member_id reference valid entities
  const orphanedMemberships = await target.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM memberships m
     WHERE m.tenant_id = $1
     AND (
       NOT EXISTS (SELECT 1 FROM entities e WHERE e.id = m.org_id AND e.tenant_id = $1)
       OR NOT EXISTS (SELECT 1 FROM entities e WHERE e.id = m.member_id AND e.tenant_id = $1)
     )`,
    [tenantId],
  );
  if (orphanedMemberships && orphanedMemberships.cnt > 0) {
    errors.push({
      table: "memberships",
      check: "membership_fk_integrity",
      message: `${orphanedMemberships.cnt} memberships reference non-existent entities`,
      severity: "error",
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Dry-run / estimation
// ---------------------------------------------------------------------------

/**
 * Estimate migration size without actually migrating.
 * Returns row counts per table and estimated time.
 */
export async function estimateMigration(
  source: DatabaseAdapter,
): Promise<{ tables: Array<{ name: string; rows: number }>; totalRows: number }> {
  const tables: Array<{ name: string; rows: number }> = [];
  let totalRows = 0;

  for (const tableDef of MIGRATION_TABLES) {
    const result = await source.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM ${tableDef.name}`,
    );
    const rows = result?.cnt ?? 0;
    tables.push({ name: tableDef.name, rows });
    totalRows += rows;
  }

  return { tables, totalRows };
}
