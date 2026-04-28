/**
 * Test-only Postgres connection helper (story #106 t338).
 *
 * Wraps `@agi/db-schema`'s `createDbClient` with a connectivity probe
 * that surfaces a clear "test VM Postgres unreachable" error rather
 * than letting individual tests fail with cryptic ECONNREFUSED. Tests
 * import this helper instead of constructing their own clients so the
 * connection-string resolution stays in one place and the probe runs
 * exactly once per process.
 *
 * Connection URL resolution (first match wins):
 *   1. AGI_TEST_DATABASE_URL env — explicit test override
 *   2. DATABASE_URL env — matches the production resolution path used
 *      by every other agi service
 *   3. Default: `postgres://agi:aionima@localhost:5432/agi_data` — the
 *      test VM's Postgres. Confirm it's reachable with
 *      `agi test-vm services-status` before invoking tests.
 *
 * Usage (typically called from the schema-per-test fixture in t339):
 *
 *   import { createTestDbConnection } from "./test-utils/db-connection.js";
 *
 *   beforeAll(async () => {
 *     const { db, pool } = await createTestDbConnection();
 *     // ...
 *   });
 */

import { createDbClient, type DbClient } from "@agi/db-schema";
import { Pool } from "pg";

const PROBE_TIMEOUT_MS = 3000;

let probed = false;
let probeError: Error | null = null;

function resolveTestUrl(): string {
  return process.env.AGI_TEST_DATABASE_URL
    ?? process.env.DATABASE_URL
    ?? "postgres://agi:aionima@localhost:5432/agi_data";
}

/**
 * Open a one-shot pool, run `SELECT 1`, close. Cheap probe with a
 * short timeout so a down VM fails fast with an actionable message
 * rather than the test runner's ~30s default.
 */
async function probeConnectivity(url: string): Promise<void> {
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: PROBE_TIMEOUT_MS,
    max: 1,
  });
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  } catch (err) {
    const original = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Test Postgres unreachable at ${url}.\n` +
        `If you're running tests, the test VM's Postgres must be up:\n` +
        `  agi test-vm services-status\n` +
        `  agi test-vm services-start  # if Postgres isn't 'active'\n` +
        `Original error: ${original}`,
    );
  } finally {
    await pool.end();
  }
}

/**
 * Open a test-scoped DB client. The first call probes connectivity
 * and caches the outcome; subsequent calls reuse the probe result so
 * a single test run pays the probe cost exactly once. Probe failures
 * are also cached — once the VM is confirmed down, every subsequent
 * call throws the same actionable error without re-probing.
 */
export async function createTestDbConnection(): Promise<DbClient> {
  const url = resolveTestUrl();
  if (probeError !== null) {
    throw probeError;
  }
  if (!probed) {
    try {
      await probeConnectivity(url);
      probed = true;
    } catch (err) {
      probeError = err instanceof Error ? err : new Error(String(err));
      throw probeError;
    }
  }
  return createDbClient({ url });
}

/** Test-only reset for the probe state. Used by self-tests of this module. */
export function _resetTestDbProbeState(): void {
  probed = false;
  probeError = null;
}

/** Read the resolved URL without opening a connection. Useful for diagnostics. */
export function getResolvedTestDbUrl(): string {
  return resolveTestUrl();
}
