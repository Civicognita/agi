/**
 * Smoke tests for the test DB connection helper (story #106 t338).
 *
 * Two tiers:
 *   1. Connection (skipped if test VM Postgres is unreachable) — opens
 *      a real client, runs SELECT 1, closes. Proves the env-driven URL
 *      resolution + drizzle wiring work end-to-end.
 *   2. Probe failure — points at a closed port, asserts the error
 *      message names the test VM service so a fresh contributor knows
 *      what to do.
 *
 * The connection tier is fragile by design — if the VM is down, the
 * test SKIPS rather than fails. The probe-failure tier is always
 * runnable.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestDbConnection,
  getResolvedTestDbUrl,
  _resetTestDbProbeState,
} from "./db-connection.js";

describe("db-connection — URL resolution", () => {
  beforeEach(() => _resetTestDbProbeState());

  it("falls back to the test VM default when no env override", () => {
    const original = {
      AGI_TEST_DATABASE_URL: process.env.AGI_TEST_DATABASE_URL,
      DATABASE_URL: process.env.DATABASE_URL,
    };
    delete process.env.AGI_TEST_DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(getResolvedTestDbUrl()).toBe(
        "postgres://agi:aionima@localhost:5432/agi_data",
      );
    } finally {
      if (original.AGI_TEST_DATABASE_URL !== undefined) {
        process.env.AGI_TEST_DATABASE_URL = original.AGI_TEST_DATABASE_URL;
      }
      if (original.DATABASE_URL !== undefined) {
        process.env.DATABASE_URL = original.DATABASE_URL;
      }
    }
  });

  it("AGI_TEST_DATABASE_URL takes precedence over DATABASE_URL", () => {
    const original = {
      AGI_TEST_DATABASE_URL: process.env.AGI_TEST_DATABASE_URL,
      DATABASE_URL: process.env.DATABASE_URL,
    };
    process.env.AGI_TEST_DATABASE_URL = "postgres://test:test@localhost:5432/test_a";
    process.env.DATABASE_URL = "postgres://other:other@localhost:5432/other_b";
    try {
      expect(getResolvedTestDbUrl()).toBe(
        "postgres://test:test@localhost:5432/test_a",
      );
    } finally {
      if (original.AGI_TEST_DATABASE_URL === undefined) {
        delete process.env.AGI_TEST_DATABASE_URL;
      } else {
        process.env.AGI_TEST_DATABASE_URL = original.AGI_TEST_DATABASE_URL;
      }
      if (original.DATABASE_URL === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = original.DATABASE_URL;
      }
    }
  });
});

describe("db-connection — probe failure surfaces actionable error", () => {
  beforeEach(() => _resetTestDbProbeState());

  it("rejects with a message naming the test VM service when port is closed", async () => {
    const original = process.env.AGI_TEST_DATABASE_URL;
    // Point at a port that's almost certainly closed locally.
    process.env.AGI_TEST_DATABASE_URL = "postgres://agi:aionima@127.0.0.1:1/no_db";
    try {
      await expect(createTestDbConnection()).rejects.toThrow(
        /Test Postgres unreachable.*agi test-vm services-status/s,
      );
    } finally {
      if (original === undefined) {
        delete process.env.AGI_TEST_DATABASE_URL;
      } else {
        process.env.AGI_TEST_DATABASE_URL = original;
      }
    }
  });

  it("caches the probe failure so subsequent calls throw without re-probing", async () => {
    const original = process.env.AGI_TEST_DATABASE_URL;
    process.env.AGI_TEST_DATABASE_URL = "postgres://agi:aionima@127.0.0.1:1/no_db";
    try {
      await expect(createTestDbConnection()).rejects.toThrow(/Test Postgres unreachable/);
      // Second call should fail immediately with the same error (no probe).
      const start = Date.now();
      await expect(createTestDbConnection()).rejects.toThrow(/Test Postgres unreachable/);
      const elapsed = Date.now() - start;
      // If the cache works, the second call should be sub-100ms; allow 500ms slack.
      expect(elapsed).toBeLessThan(500);
    } finally {
      if (original === undefined) {
        delete process.env.AGI_TEST_DATABASE_URL;
      } else {
        process.env.AGI_TEST_DATABASE_URL = original;
      }
    }
  });
});

describe("db-connection — live Postgres (skipped if VM is down)", () => {
  beforeEach(() => _resetTestDbProbeState());

  it("opens a working drizzle client against the test VM Postgres", async () => {
    let client;
    try {
      client = await createTestDbConnection();
    } catch (err) {
      // VM is down — skip rather than fail. Test infrastructure isn't
      // the test's job to provision.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[db-connection.test] Skipping live test — ${msg.split("\n")[0]}`);
      return;
    }
    try {
      const rows = await client.pool.query("SELECT 1 AS one");
      expect(rows.rows[0]?.one).toBe(1);
      // drizzle client should also work
      expect(client.db).toBeDefined();
    } finally {
      await client.pool.end();
    }
  });
});
