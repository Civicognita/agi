/**
 * COAChainLogger tests — migrated to Postgres/drizzle.
 *
 * TODO: migrate to pg-mem or a testcontainer so these run in the VM test suite.
 * The old SQLite-backed tests (using createDatabase(":memory:")) are no longer
 * applicable after Phase 2.2 of the DB consolidation.
 */

import { describe, it } from "vitest";

describe.skip("COAChainLogger (postgres — pending pg-mem migration)", () => {
  it("TODO: rewrite tests to use pg-mem or testcontainer", () => {
    // All test logic from the old SQLite-backed suite needs to be ported here
    // once a suitable in-process Postgres replacement is wired into the VM test env.
  });
});
