import BetterSqlite3 from "better-sqlite3";

import { generateEntityKeypair } from "./geid.js";
import { ALL_DDL, FEDERATION_MIGRATIONS, COA_MIGRATIONS, COA_COMPLIANCE_MIGRATIONS } from "./schema.sql.js";

export type { Database } from "better-sqlite3";

/**
 * Open (or create) a SQLite database at the given filepath, apply all DDL,
 * and return the ready-to-use handle.
 *
 * - WAL journal mode is enabled for concurrent read performance.
 * - Foreign key enforcement is enabled for referential integrity.
 *
 * @param filepath - Absolute path to the `.db` file (created if absent).
 *
 * @example
 * const db = createDatabase("/var/data/aionima.db");
 * const row = db.prepare("SELECT * FROM entities WHERE id = ?").get(id);
 */
export function createDatabase(filepath: string): BetterSqlite3.Database {
  const db = new BetterSqlite3(filepath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  for (const ddl of ALL_DDL) {
    db.exec(ddl);
  }

  // Run migrations (ALTER TABLE — may fail if columns already exist)
  // Strip SQL comments before splitting on ";" so comments don't swallow statements
  for (const migrations of [FEDERATION_MIGRATIONS, COA_MIGRATIONS]) {
    const migrationSql = migrations.replace(/--.*$/gm, "");
    for (const stmt of migrationSql.split(";")) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;
      try {
        db.exec(trimmed);
      } catch {
        // Column already exists — expected on subsequent runs
      }
    }
  }

  // Compliance migrations (individual statements, not semicolon-delimited)
  for (const stmt of COA_COMPLIANCE_MIGRATIONS) {
    try { db.exec(stmt); } catch { /* column already exists */ }
  }

  // Backfill GEIDs for pre-existing entities that don't have one
  backfillGeids(db);

  return db;
}

/**
 * Generate GEID keypairs for any entities missing a geid_mappings row.
 * Runs once at startup — idempotent (INSERT OR IGNORE).
 */
function backfillGeids(db: BetterSqlite3.Database): void {
  const rows = db
    .prepare(
      `SELECT e.id FROM entities e
       LEFT JOIN geid_mappings g ON g.local_entity_id = e.id
       WHERE g.local_entity_id IS NULL`,
    )
    .all() as Array<{ id: string }>;

  if (rows.length === 0) return;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO geid_mappings (local_entity_id, geid, public_key_pem, private_key_pem, discoverable, created_at)
     VALUES (@local_entity_id, @geid, @public_key_pem, @private_key_pem, 0, @created_at)`,
  );

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const row of rows) {
      const kp = generateEntityKeypair();
      insert.run({
        local_entity_id: row.id,
        geid: kp.geid,
        public_key_pem: kp.publicKeyPem,
        private_key_pem: kp.privateKeyPem,
        created_at: now,
      });
    }
  });
  tx();
}
