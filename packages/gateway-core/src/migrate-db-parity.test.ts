import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Schema ↔ migrate-db.sh parity guard (story #219 follow-up).
 *
 * This project does NOT apply Drizzle migrations to the live DB (drizzle-kit
 * push is disabled — CJS/NodeNext mismatch; `__drizzle_migrations` is empty).
 * The ONLY path that touches production is `scripts/migrate-db.sh`, a list of
 * idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` statements.
 *
 * That means a column can be added to the Drizzle schema (and even to a drizzle
 * .sql migration) yet NEVER reach production if it isn't ALSO added to
 * migrate-db.sh. That is exactly what happened to `connections.dtoken`: the
 * GitHub device-flow INSERT failed in prod with `column "dtoken" does not
 * exist`. The same class previously bit `cost_records` (see migrate-db.sh).
 *
 * This test fails if any `connections` column that was added AFTER the initial
 * schema (0000) is missing an ADD COLUMN in migrate-db.sh.
 */

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const AUTH_TS = here("../../db-schema/src/auth.ts");
const INITIAL_SQL = here("../../db-schema/drizzle/0000_glossy_toxin.sql");
const MIGRATE_DB = here("../../../scripts/migrate-db.sh");

/** DB column names of the `connections` pgTable in the Drizzle schema. */
function schemaConnectionsColumns(): string[] {
  const src = readFileSync(AUTH_TS, "utf-8");
  // The column object body: from `connections = pgTable("connections", {` up to
  // the `}, (t) =>` (indexes) or the closing `})`.
  const block = src.match(/connections\s*=\s*pgTable\(\s*"connections",\s*\{([\s\S]*?)\}\s*,?\s*(\(t\)|\)\s*;)/);
  expect(block, "could not locate connections pgTable block in auth.ts").toBeTruthy();
  // Each column is `name: <type>("db_name" ...)`. Capture the db_name string.
  return [...(block![1] ?? "").matchAll(/^\s*[a-zA-Z0-9_]+\s*:\s*[a-zA-Z]+\(\s*"([a-z_]+)"/gm)].map((m) => m[1]!);
}

/** Column names created by the initial 0000 migration's CREATE TABLE connections. */
function initialConnectionsColumns(): string[] {
  const sql = readFileSync(INITIAL_SQL, "utf-8");
  const create = sql.match(/CREATE TABLE "connections" \(([\s\S]*?)\);/);
  expect(create, "could not locate CREATE TABLE connections in 0000").toBeTruthy();
  // Each column line starts with "col_name" — skip CONSTRAINT/PRIMARY lines.
  return [...(create![1] ?? "").matchAll(/^\s*"([a-z_]+)"\s+[a-z]/gim)].map((m) => m[1]!);
}

/** Columns migrate-db.sh adds to `connections` via ADD COLUMN IF NOT EXISTS. */
function migrateDbConnectionsAdditions(): string[] {
  const sh = readFileSync(MIGRATE_DB, "utf-8");
  // Match `ALTER TABLE [IF EXISTS] connections … ADD COLUMN IF NOT EXISTS <col>`
  // across the multi-line statement.
  const adds: string[] = [];
  for (const stmt of sh.split(/ALTER TABLE/i).slice(1)) {
    const head = stmt.split(";")[0] ?? "";
    if (!/\bconnections\b/i.test(head)) continue;
    for (const m of head.matchAll(/ADD COLUMN IF NOT EXISTS\s+([a-z_]+)/gi)) {
      adds.push(m[1]!);
    }
  }
  return adds;
}

describe("migrate-db.sh ↔ Drizzle schema parity for connections (s219)", () => {
  it("every connections column added after 0000 is covered by migrate-db.sh", () => {
    const schemaCols = schemaConnectionsColumns();
    const baseCols = new Set(initialConnectionsColumns());
    const migrateCols = new Set(migrateDbConnectionsAdditions());

    // Sanity: parsing actually found the expected shapes.
    expect(schemaCols).toContain("dtoken");
    expect(baseCols.has("id")).toBe(true);
    expect(baseCols.has("dtoken")).toBe(false); // dtoken is post-0000

    const addedLater = schemaCols.filter((c) => !baseCols.has(c));
    const missing = addedLater.filter((c) => !migrateCols.has(c));
    expect(
      missing,
      `connections columns added after 0000 but missing from migrate-db.sh: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("specifically covers connections.dtoken (the device-flow regression)", () => {
    expect(migrateDbConnectionsAdditions()).toContain("dtoken");
  });
});
