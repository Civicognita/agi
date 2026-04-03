# Entity Model Extensions: Adding Tables, Stores, Managers

The entity model (`packages/entity-model/`) is the SQLite persistence layer for all Aionima data. It uses `better-sqlite3` for synchronous, zero-connection-overhead access. This guide explains how to extend it with new tables, store classes, and manager patterns.

## Architecture Overview

```
packages/entity-model/src/
  db.ts              # createDatabase() — opens SQLite, runs ALL_DDL
  schema.sql.ts      # DDL string constants for all tables (ALL_DDL)
  types.ts           # Entity domain types (Entity, ChannelAccount, etc.)
  store.ts           # EntityStore — CRUD for entities + channel accounts
  impact.ts          # ImpactRecorder — impact_interactions writes
  queue.ts           # MessageQueue — message_queue CRUD
  comms-log.ts       # CommsLog — comms_log reads/writes
  governance.ts      # GovernanceManager, membership logic
  verification.ts    # VerificationManager — seal issuance
  proposals.ts       # ProposalManager — governance votes
  # ... many more managers
  index.ts           # Re-exports everything
```

All SQL DDL strings are defined as constants in `schema.sql.ts` and collected in the `ALL_DDL` export. `createDatabase()` in `db.ts` runs `ALL_DDL` using `db.exec()` at startup — this is the migration strategy (all `CREATE TABLE IF NOT EXISTS`).

## Step 1: Define the SQL DDL

Add your table definition to `packages/entity-model/src/schema.sql.ts`:

```ts
// packages/entity-model/src/schema.sql.ts

export const CREATE_MY_TABLE = `
CREATE TABLE IF NOT EXISTS my_table (
  id          TEXT NOT NULL PRIMARY KEY,
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  category    TEXT NOT NULL,
  value       REAL NOT NULL DEFAULT 0,
  metadata    TEXT,              -- JSON blob for flexible extension
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
)` as const;

// Optional: indexes for frequent query patterns
export const CREATE_MY_TABLE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_my_table_entity_id ON my_table (entity_id);
CREATE INDEX IF NOT EXISTS idx_my_table_category ON my_table (category, created_at DESC)
` as const;
```

Then add to `ALL_DDL`:

```ts
// packages/entity-model/src/schema.sql.ts

export const ALL_DDL = [
  CREATE_ENTITIES,
  CREATE_CHANNEL_ACCOUNTS,
  CREATE_COA_CHAINS,
  CREATE_IMPACT_INTERACTIONS,
  CREATE_VERIFICATION_REQUESTS,
  CREATE_SEALS,
  CREATE_MESSAGE_QUEUE,
  CREATE_META,
  CREATE_COMMS_LOG,
  CREATE_NOTIFICATIONS,
  CREATE_MY_TABLE,           // add here
  CREATE_MY_TABLE_INDEXES,   // add here
] as const;
```

`createDatabase()` calls `db.exec(ALL_DDL.join(";\n"))` at startup, so your table is created automatically on the first run (or on restart if it was added to an existing database — `IF NOT EXISTS` makes this safe).

## Step 2: Define TypeScript Types

Add your row types to `packages/entity-model/src/types.ts` (or create a new file like `my-table.ts` for larger features):

```ts
// packages/entity-model/src/types.ts (or a dedicated file)

export interface MyRow {
  id: string;
  entity_id: string;
  category: string;
  value: number;
  metadata: string | null;   // raw JSON string from SQLite
  created_at: string;
  updated_at: string;
}

export interface MyRecord {
  id: string;
  entityId: string;
  category: string;
  value: number;
  metadata: Record<string, unknown> | null;  // parsed
  createdAt: string;
  updatedAt: string;
}
```

Keep the `Row` type (snake_case, raw SQLite values) separate from the domain type (camelCase, parsed JSON) to avoid confusion.

## Step 3: Create a Store or Manager Class

Use the existing classes as templates. `better-sqlite3` is synchronous — every method is sync, no `async`/`await`:

```ts
// packages/entity-model/src/my-store.ts
import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { MyRow, MyRecord } from "./types.js";

export interface CreateMyRecordParams {
  entityId: string;
  category: string;
  value: number;
  metadata?: Record<string, unknown>;
}

function rowToRecord(row: MyRow): MyRecord {
  return {
    id: row.id,
    entityId: row.entity_id,
    category: row.category,
    value: row.value,
    metadata: row.metadata !== null ? JSON.parse(row.metadata) as Record<string, unknown> : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MyStore {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  create(params: CreateMyRecordParams): MyRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const metadata = params.metadata !== undefined ? JSON.stringify(params.metadata) : null;

    this.db
      .prepare(
        `INSERT INTO my_table (id, entity_id, category, value, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, params.entityId, params.category, params.value, metadata, now, now);

    return this.findById(id)!;
  }

  findById(id: string): MyRecord | null {
    const row = this.db
      .prepare("SELECT * FROM my_table WHERE id = ?")
      .get(id) as MyRow | undefined;
    return row !== undefined ? rowToRecord(row) : null;
  }

  findByEntity(entityId: string, limit = 50, offset = 0): { records: MyRecord[]; total: number } {
    const total = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM my_table WHERE entity_id = ?")
        .get(entityId) as { n: number }
    ).n;

    const rows = this.db
      .prepare(
        "SELECT * FROM my_table WHERE entity_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      )
      .all(entityId, limit, offset) as MyRow[];

    return { records: rows.map(rowToRecord), total };
  }

  update(id: string, patch: { value?: number; metadata?: Record<string, unknown> }): MyRecord | null {
    const now = new Date().toISOString();

    const existing = this.findById(id);
    if (existing === null) return null;

    const newValue = patch.value ?? existing.value;
    const newMeta = patch.metadata !== undefined
      ? JSON.stringify(patch.metadata)
      : existing.metadata !== null ? JSON.stringify(existing.metadata) : null;

    this.db
      .prepare("UPDATE my_table SET value = ?, metadata = ?, updated_at = ? WHERE id = ?")
      .run(newValue, newMeta, now, id);

    return this.findById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM my_table WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
```

### Transactions

Use `db.transaction()` for multi-step writes:

```ts
createWithRelation(params: ComplexParams): MyRecord {
  return this.db.transaction(() => {
    const record = this.create(params);
    // ... other writes inside same transaction
    return record;
  })();
}
```

`db.transaction(fn)()` — the `()` at the end executes the transaction immediately. The inner `fn` is called synchronously.

## Step 4: Wire the Store into createDatabase

If your store needs to be instantiated alongside the database, add it to the return value of `createDatabase()` in `packages/entity-model/src/db.ts`:

```ts
// packages/entity-model/src/db.ts
import { MyStore } from "./my-store.js";

export function createDatabase(path: string): {
  db: Database;
  entityStore: EntityStore;
  // ...existing stores...
  myStore: MyStore;  // add here
} {
  const db = new Database(path);
  db.exec(ALL_DDL.join(";\n"));

  return {
    db,
    entityStore: new EntityStore(db),
    // ...
    myStore: new MyStore(db),
  };
}
```

## Step 5: Export from index.ts

```ts
// packages/entity-model/src/index.ts

export type { CreateMyRecordParams, MyRecord } from "./my-store.js";
export { MyStore } from "./my-store.js";
export { CREATE_MY_TABLE, CREATE_MY_TABLE_INDEXES } from "./schema.sql.js";
```

## Migration Strategy

The migration strategy is `CREATE TABLE IF NOT EXISTS` — the DDL is idempotent. There is no migration runner or version tracking for schema changes in SQLite.

**Safe changes (no migration needed):**
- Adding a new table
- Adding a new index

**Unsafe changes (require manual migration):**
- Renaming a column
- Dropping a column
- Changing a column's type or constraints
- Renaming a table

For unsafe changes, write a migration script or use `ALTER TABLE ... ADD COLUMN` (SQLite only supports `ADD COLUMN` in `ALTER TABLE`, not `DROP COLUMN` or `RENAME COLUMN` in older versions).

If you need to add a column to an existing table, add an `ALTER TABLE` statement to `ALL_DDL` that is also idempotent:

```ts
export const ALTER_MY_TABLE_ADD_NEW_COL = `
  -- SQLite doesn't support "IF NOT EXISTS" for columns, so guard with a try in application code
  -- or use a meta table to track applied migrations
  ALTER TABLE my_table ADD COLUMN new_col TEXT DEFAULT 'default'
` as const;
```

For complex migrations, do them outside the normal DDL system and add a record to the `meta` table (key/value store) to track what has been applied.

## COA Integration

If your store records actions that should be tracked in the Chain of Accountability:

```ts
import { COAChainLogger } from "@aionima/coa-chain";

// In your store method, after writing:
await coaLogger.log({
  resourceId: "$A0",
  entityId: params.entityId,
  nodeId: "@A0",
  workType: "data.create",
  ref: `my_table:${newRecord.id}`,
  payloadHash: hashOf(params),
});
```

The COA logger uses `COAChainLogger` from `packages/coa-chain/`. It writes to the `coa_chains` table in the same SQLite database.

## Verification Tiers

The `entities` table has a `verification_tier` column. Available tiers (from `packages/entity-model/src/verification-types.ts`):

```ts
type VerificationTier = "unverified" | "basic" | "verified" | "trusted" | "governor";
```

If your store records actions that should be gated by verification tier, check with `meetsMinimumTier(entity.verificationTier, requiredTier)`.

## Files to Modify

| File | Change |
|------|--------|
| `packages/entity-model/src/schema.sql.ts` | Add `CREATE_MY_TABLE` constant + add to `ALL_DDL` |
| `packages/entity-model/src/types.ts` | Add row and domain TypeScript types |
| `packages/entity-model/src/my-store.ts` | Create — store class with CRUD methods |
| `packages/entity-model/src/db.ts` | Add store to `createDatabase()` return value |
| `packages/entity-model/src/index.ts` | Re-export new store, types, DDL |

## Verification Checklist

- [ ] `CREATE TABLE IF NOT EXISTS` — DDL is idempotent
- [ ] All columns have sensible `NOT NULL` constraints or `DEFAULT` values
- [ ] Foreign key references use column types that match (TEXT → TEXT)
- [ ] `pnpm typecheck` — no type errors in store or index exports
- [ ] `pnpm build` — no compile errors
- [ ] `pnpm test` — existing tests pass (new store does not break entity model tests)
- [ ] Write a unit test: create a record, read it back, update it, delete it
- [ ] Restart with an existing database — old data is preserved, new table is added
- [ ] Start with a fresh database (delete `data/entities.db`) — table is created cleanly
- [ ] JSON metadata round-trips correctly (store object, retrieve same object)
