/**
 * db.ts — re-exports createDbClient from @agi/db-schema/client.
 *
 * Backward-compatible export. Callers that previously used
 * `createDatabase(path)` from here should migrate to:
 *
 *   import { createDbClient } from "@agi/db-schema/client";
 *   const { db } = createDbClient();
 *
 * The old SQLite-based `createDatabase(filepath)` is removed.
 * The `Database` type now refers to the drizzle Db type.
 */

export { createDbClient } from "@agi/db-schema/client";
export type { Db as Database } from "@agi/db-schema/client";
