#!/usr/bin/env -S tsx
/**
 * One-time hard-cut migration from the fragmented per-service data stores
 * into the unified `agi_data` Postgres database.
 *
 * Runs the following phases sequentially, halting on first failure:
 *
 *   1. Preflight  — verify services stopped, source stores reachable
 *   2. Schema     — apply @agi/db-schema via drizzle-kit pushSchema
 *   3. Extract    — open each legacy SQLite/Postgres source
 *   4. Transform  — load rows into agi_data per the consolidation rules in
 *                   /home/wishborn/temp_core/_discovery/unified-schema-design.md
 *   5. Verify     — compare source vs destination row counts per table
 *   6. Rewrite    — update gateway config + Local-ID .env to point at agi_data
 *   7. Archive    — move legacy SQLite files under ~/.agi/_archived/<ts>/
 *                   and rename Local-ID's `agi` DB → `agi_legacy_<date>`
 *
 * Invoke manually:  pnpm tsx scripts/migrate-to-agi_data.ts [--dry-run]
 *
 * Dry-run mode reports the plan without writing. Always dry-run first on a
 * real host before flipping services.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

import * as schema from "@agi/db-schema";

// drizzle-kit ships a broken `/api.mjs` (embeds `require("fs")` which fails
// under ESM). The CJS `api.js` works fine — load it via createRequire.
const require = createRequire(import.meta.url);
const { pushSchema } = require("drizzle-kit/api") as {
  pushSchema: (
    imports: Record<string, unknown>,
    db: unknown,
    schemaFilters?: string[],
    tablesFilter?: string[],
    extensionsFilters?: unknown,
  ) => Promise<{
    hasDataLoss: boolean;
    warnings: string[];
    statementsToExecute: string[];
    apply: () => Promise<void>;
  }>;
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");
const AGI_DATA_URL =
  process.env.DATABASE_URL ?? "postgres://agi:aionima@localhost:5432/agi_data";
const LEGACY_LOCAL_ID_URL =
  process.env.LEGACY_LOCAL_ID_URL ??
  "postgres://agi:aionima@localhost:5432/agi";
const ARCHIVE_ROOT = join(homedir(), ".agi", "_archived");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const ARCHIVE_DIR = join(ARCHIVE_ROOT, TIMESTAMP);

const SQLITE_SOURCES = {
  entities: join(homedir(), ".agi", "entities.db"),
  magicAppState: join(homedir(), ".agi", "magic-app-state.db"),
  marketplace: join(homedir(), ".agi", "marketplace.db"),
  security: join(homedir(), ".agi", "security.db"),
} as const;

const GATEWAY_CONFIG_PATH = join(homedir(), ".agi", "gateway.json");
const LOCAL_ID_ENV_PATH = "/opt/agi-local-id/.env";

function log(tag: string, msg: string): void {
  const dry = DRY_RUN ? " [dry-run]" : "";
  console.log(`[migrate${dry}] ${tag}: ${msg}`);
}

// ---------------------------------------------------------------------------
// Phase 1 — Preflight
// ---------------------------------------------------------------------------

function preflight(): void {
  log("preflight", `target database: ${AGI_DATA_URL}`);
  log("preflight", `legacy Local-ID: ${LEGACY_LOCAL_ID_URL}`);

  const missingSources: string[] = [];
  for (const [name, path] of Object.entries(SQLITE_SOURCES)) {
    if (!existsSync(path)) missingSources.push(`${name} (${path})`);
  }
  if (missingSources.length > 0) {
    log(
      "preflight",
      `warn: missing SQLite sources (will skip): ${missingSources.join(", ")}`,
    );
  }

  // Verify services are stopped. `systemctl is-active` exits 0 when active,
  // non-zero otherwise. Using execFileSync with an arg array avoids any shell
  // interpolation — the service names are hardcoded above and can never
  // contain user input.
  for (const svc of ["agi", "agi-id"]) {
    let isActive = false;
    try {
      execFileSync("systemctl", ["is-active", "--quiet", svc], {
        stdio: "ignore",
      });
      isActive = true;
    } catch {
      // non-zero exit — service is not active, which is what we want.
    }
    if (isActive) {
      if (DRY_RUN) {
        log(
          "preflight",
          `warn: ${svc} is active — real run will require \`sudo systemctl stop ${svc}\``,
        );
      } else {
        throw new Error(
          `${svc} is still running — stop it first with \`sudo systemctl stop ${svc}\``,
        );
      }
    }
  }
  log(
    "preflight",
    DRY_RUN ? "service-state check complete (dry-run advisory)" : "services confirmed stopped",
  );
}

// ---------------------------------------------------------------------------
// Phase 2 — Schema
// ---------------------------------------------------------------------------

async function createSchema(pool: Pool): Promise<void> {
  if (DRY_RUN) {
    log("schema", "would apply @agi/db-schema via pushSchema");
    return;
  }
  const db = drizzle(pool, { schema });
  const { statementsToExecute, apply, warnings, hasDataLoss } = await pushSchema(
    schema as unknown as Record<string, unknown>,
    db,
  );
  log("schema", `${statementsToExecute.length} DDL statements pending`);
  for (const w of warnings) log("schema", `warning: ${w}`);
  if (hasDataLoss) {
    log("schema", "refusing to apply — pushSchema reports data loss risk");
    throw new Error("Schema push would lose data; inspect and resolve manually");
  }
  await apply();
  log("schema", "tables + indexes + enums applied");
}

// ---------------------------------------------------------------------------
// Phase 3 + 4 — Extract, transform, load
// ---------------------------------------------------------------------------

interface TransferCounts {
  [table: string]: { source: number; dest: number };
}

async function migrateLocalIdPostgres(
  destPool: Pool,
  counts: TransferCounts,
): Promise<void> {
  const sourcePool = new Pool({ connectionString: LEGACY_LOCAL_ID_URL });
  try {
    await sourcePool.query("SELECT 1");
  } catch {
    log("extract", `legacy Local-ID DB unreachable — skipping`);
    await sourcePool.end();
    return;
  }

  // Per consolidation rules (§2 of the design doc):
  //   users            — straight copy, add authBackend='virtual' + principal
  //   entities         — Local-ID canonical; scope enum accepts old values
  //   geid_local       — straight copy
  //   agent_bindings   — straight copy
  //   registrations    — straight copy
  //   sessions         — → auth_sessions (web cookies only)
  //   connections      — straight copy
  //   handoffs         — straight copy
  const tables: Array<[string, string]> = [
    ["users", "users"],
    ["entities", "entities"],
    ["geid_local", "geid_local"],
    ["agent_bindings", "agent_bindings"],
    ["registrations", "registrations"],
    ["sessions", "auth_sessions"],
    ["connections", "connections"],
    ["handoffs", "handoffs"],
  ];

  for (const [src, dst] of tables) {
    const { rows: sourceRows } = await sourcePool.query(`SELECT * FROM ${src}`);
    counts[dst] = { source: sourceRows.length, dest: 0 };
    if (DRY_RUN || sourceRows.length === 0) {
      log("load", `${src} → ${dst}: ${sourceRows.length} rows (skipped in dry-run or empty)`);
      continue;
    }
    for (const row of sourceRows) {
      const patched = patchForSharedSchema(src, row);
      const cols = Object.keys(patched);
      const vals = Object.values(patched);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      await destPool.query(
        `INSERT INTO ${dst} (${cols.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        vals,
      );
      counts[dst].dest += 1;
    }
    log("load", `${src} → ${dst}: loaded ${counts[dst].dest}/${counts[dst].source}`);
  }

  await sourcePool.end();
}

function patchForSharedSchema(
  sourceTable: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (sourceTable === "users") {
    return {
      ...row,
      auth_backend: "virtual",
      principal:
        (row.username as string | null) ??
        (row.email as string | null) ??
        (row.id as string),
    };
  }
  return row;
}

async function migrateSqliteSources(
  destPool: Pool,
  counts: TransferCounts,
): Promise<void> {
  // better-sqlite3 is not a direct dep of AGI any more, but the host usually
  // has it installed from the plugin sandbox dep tree. Fail hard if missing —
  // cutover can't proceed without reading the legacy .db files.
  const { default: Database } = await import("better-sqlite3");

  // entities.db — splits into many tables. The entity-store historically
  // owned coa_chains, impact, audits, compliance, comms, usage, and more.
  const entityTableMap: Array<[string, string]> = [
    ["coa_chains", "coa_chains"],
    ["impact_interactions", "impact_interactions"],
    ["comms_log", "comms_log"],
    ["usage_log", "usage_log"],
    ["provider_balance_log", "provider_balance_log"],
    ["verification_requests", "verification_requests"],
    ["seals", "seals"],
    ["incidents", "incidents"],
    ["consents", "consents"],
    ["vendors", "vendors"],
    ["channel_accounts", "channel_accounts"],
    ["memberships", "memberships"],
    ["access_grants", "access_grants"],
    ["notifications", "notifications"],
    ["message_queue", "message_queue"],
    ["entity_map_cache", "entity_map_cache"],
    ["federation_peers", "federation_peers"],
    ["meta", "meta"],
    // entity-model's `sessions` was the compliance audit trail — renamed:
    ["sessions", "revocation_audit"],
  ];

  await copySqliteTables(
    Database,
    SQLITE_SOURCES.entities,
    destPool,
    entityTableMap,
    counts,
  );

  await copySqliteTables(
    Database,
    SQLITE_SOURCES.magicAppState,
    destPool,
    [["magic_app_instances", "magic_app_instances"]],
    counts,
  );

  await copySqliteTables(
    Database,
    SQLITE_SOURCES.marketplace,
    destPool,
    [
      // Legacy single-table marketplace → plugins_marketplace catalog. The
      // MarketplaceManager re-seeds on first boot from live repo manifests,
      // so perfect 1:1 migration isn't required.
      ["marketplace", "plugins_marketplace"],
    ],
    counts,
  );

  await copySqliteTables(
    Database,
    SQLITE_SOURCES.security,
    destPool,
    [
      ["scan_runs", "scan_runs"],
      ["security_findings", "security_findings"],
    ],
    counts,
  );
}

async function copySqliteTables(
  Database: typeof import("better-sqlite3"),
  sqlitePath: string,
  destPool: Pool,
  tableMap: Array<[string, string]>,
  counts: TransferCounts,
): Promise<void> {
  if (!existsSync(sqlitePath)) {
    log("extract", `skip ${sqlitePath}: not present`);
    return;
  }
  const src = new Database(sqlitePath, { readonly: true });
  try {
    for (const [srcTable, dstTable] of tableMap) {
      const hasTable = src
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
        )
        .get(srcTable);
      if (!hasTable) continue;
      const rows = src.prepare(`SELECT * FROM ${srcTable}`).all() as Record<
        string,
        unknown
      >[];
      counts[dstTable] = { source: rows.length, dest: 0 };
      if (DRY_RUN || rows.length === 0) {
        log("load", `${srcTable} → ${dstTable}: ${rows.length} rows (skipped)`);
        continue;
      }
      for (const row of rows) {
        const coerced = coerceSqliteRow(row);
        const cols = Object.keys(coerced);
        const vals = Object.values(coerced);
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
        try {
          await destPool.query(
            `INSERT INTO ${dstTable} (${cols.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
            vals,
          );
          counts[dstTable].dest += 1;
        } catch (e) {
          log(
            "load",
            `warn: ${srcTable} row failed (${(e as Error).message.split("\n")[0]})`,
          );
        }
      }
      log(
        "load",
        `${srcTable} → ${dstTable}: loaded ${counts[dstTable].dest}/${counts[dstTable].source}`,
      );
    }
  } finally {
    src.close();
  }
}

function coerceSqliteRow(row: Record<string, unknown>): Record<string, unknown> {
  // SQLite holds JSON in TEXT columns and booleans as 0/1 integers. We convert
  // anything that looks like a JSON object/array back to a native value so
  // pg's type driver stores it as jsonb, and we flip known boolean columns.
  const out: Record<string, unknown> = {};
  const booleanCols = /^(discoverable|granted|signed|verified|read|dpa_signed|baa_signed|escalated)$/;
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string" && (value.startsWith("{") || value.startsWith("["))) {
      try {
        out[key] = JSON.parse(value);
        continue;
      } catch {
        // fall through — keep as string
      }
    }
    if (typeof value === "number" && (value === 0 || value === 1) && booleanCols.test(key)) {
      out[key] = value === 1;
      continue;
    }
    out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 5 — Verify
// ---------------------------------------------------------------------------

function verifyCounts(counts: TransferCounts): void {
  let loss = 0;
  for (const [table, { source, dest }] of Object.entries(counts)) {
    const delta = source - dest;
    const status = delta === 0 ? "ok" : `LOSS (${delta})`;
    log("verify", `${table}: source=${source} dest=${dest} ${status}`);
    if (delta > 0) loss += delta;
  }
  if (loss > 0) {
    log("verify", `total rows lost: ${loss} — inspect logs before archiving`);
    if (!DRY_RUN) {
      throw new Error(
        `Row-count mismatch: ${loss} rows unaccounted for. Aborting before archive.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 6 — Config rewrite
// ---------------------------------------------------------------------------

function rewriteGatewayConfig(): void {
  if (!existsSync(GATEWAY_CONFIG_PATH)) {
    log("config", `${GATEWAY_CONFIG_PATH} not found — skipping`);
    return;
  }
  const raw = readFileSync(GATEWAY_CONFIG_PATH, "utf8");
  const config: Record<string, unknown> = JSON.parse(raw);
  const database = (config.database as Record<string, unknown> | undefined) ?? {};
  database.url = AGI_DATA_URL;
  config.database = database;
  if (DRY_RUN) {
    log("config", `would set database.url = ${AGI_DATA_URL} in gateway.json`);
    return;
  }
  writeFileSync(GATEWAY_CONFIG_PATH, JSON.stringify(config, null, 2));
  log("config", `updated ${GATEWAY_CONFIG_PATH}`);
}

function rewriteLocalIdEnv(): void {
  if (!existsSync(LOCAL_ID_ENV_PATH)) {
    log("config", `${LOCAL_ID_ENV_PATH} not found — skipping`);
    return;
  }
  const raw = readFileSync(LOCAL_ID_ENV_PATH, "utf8");
  const next = raw.replace(
    /^DATABASE_URL=.*$/m,
    `DATABASE_URL=${AGI_DATA_URL}`,
  );
  if (DRY_RUN) {
    log("config", `would patch DATABASE_URL in ${LOCAL_ID_ENV_PATH}`);
    return;
  }
  writeFileSync(LOCAL_ID_ENV_PATH, next);
  log("config", `updated ${LOCAL_ID_ENV_PATH}`);
}

// ---------------------------------------------------------------------------
// Phase 7 — Archive
// ---------------------------------------------------------------------------

function archiveSqlite(): void {
  if (DRY_RUN) {
    log("archive", `would move legacy .db files to ${ARCHIVE_DIR}`);
    return;
  }
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  for (const path of Object.values(SQLITE_SOURCES)) {
    if (!existsSync(path)) continue;
    const dest = join(ARCHIVE_DIR, path.split("/").pop() as string);
    renameSync(path, dest);
    // Move WAL/SHM sidecars too — SQLite journal files tied to the primary.
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${path}${suffix}`;
      if (existsSync(sidecar)) {
        renameSync(sidecar, `${dest}${suffix}`);
      }
    }
    log("archive", `moved ${path} → ${dest}`);
  }
}

async function renameLegacyLocalIdDb(rootPool: Pool): Promise<void> {
  const legacyName = `agi_legacy_${TIMESTAMP.slice(0, 10)}`;
  if (DRY_RUN) {
    log("archive", `would ALTER DATABASE agi RENAME TO ${legacyName}`);
    return;
  }
  try {
    await rootPool.query(`ALTER DATABASE agi RENAME TO ${legacyName}`);
    log("archive", `renamed legacy Local-ID DB → ${legacyName}`);
  } catch (e) {
    log(
      "archive",
      `warn: could not rename legacy agi DB (${(e as Error).message.split("\n")[0]})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  preflight();

  const destPool = new Pool({ connectionString: AGI_DATA_URL });
  const rootPool = new Pool({
    connectionString: AGI_DATA_URL.replace(/\/agi_data(\?|$)/, "/postgres$1"),
  });

  // Create agi_data if missing.
  try {
    await destPool.query("SELECT 1");
  } catch {
    if (!DRY_RUN) {
      log("preflight", "creating agi_data database");
      await rootPool.query("CREATE DATABASE agi_data OWNER agi");
    } else {
      log("preflight", "would CREATE DATABASE agi_data");
    }
  }

  await createSchema(destPool);

  const counts: TransferCounts = {};
  await migrateLocalIdPostgres(destPool, counts);
  await migrateSqliteSources(destPool, counts);

  verifyCounts(counts);

  rewriteGatewayConfig();
  rewriteLocalIdEnv();

  archiveSqlite();
  await renameLegacyLocalIdDb(rootPool);

  await destPool.end();
  await rootPool.end();

  // Retain sql import for tree-shakers; it's available for ad-hoc queries.
  void sql;

  log("done", `migration ${DRY_RUN ? "dry-run " : ""}complete`);
}

main().catch((e: unknown) => {
  console.error("[migrate] FATAL:", e);
  process.exit(1);
});
