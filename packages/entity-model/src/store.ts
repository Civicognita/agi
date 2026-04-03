import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";

import type { Database } from "./db.js";
import { generateEntityKeypair, type GEID } from "./geid.js";
import type { Entity, ChannelAccount, VerificationTier } from "./types.js";

// ---------------------------------------------------------------------------
// Meta row type
// ---------------------------------------------------------------------------

interface MetaRow {
  key: string;
  value: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Convenience statement type aliases
// ---------------------------------------------------------------------------

/** Statement bound with a single named-parameter object. */
type NamedStmt<P extends object> = BetterSqlite3.Statement<[P]>;

/** Statement bound with positional parameters. */
type PosStmt<P extends unknown[]> = BetterSqlite3.Statement<P>;

// ---------------------------------------------------------------------------
// Named-parameter shapes used by prepared statements
// ---------------------------------------------------------------------------

interface InsertEntityParams {
  id: string;
  type: string;
  display_name: string;
  verification_tier: string;
  coa_alias: string;
  created_at: string;
  updated_at: string;
}

interface UpdateDisplayNameParams {
  id: string;
  display_name: string;
  updated_at: string;
}

interface UpdateTierParams {
  id: string;
  verification_tier: string;
  updated_at: string;
}

interface UpdateBothParams {
  id: string;
  display_name: string;
  verification_tier: string;
  updated_at: string;
}

interface ListParams {
  limit: number;
  offset: number;
}

interface ListByTypeParams {
  type: string;
  limit: number;
  offset: number;
}

interface InsertChannelAccountParams {
  id: string;
  entity_id: string;
  channel: string;
  channel_user_id: string;
  created_at: string;
}

interface InsertGeidMappingParams {
  local_entity_id: string;
  geid: string;
  public_key_pem: string;
  private_key_pem: string | null;
  discoverable: number;
  created_at: string;
}

interface UpdateFederationParams {
  id: string;
  geid: string;
  public_key_pem: string;
  home_node_id: string | null;
  federation_consent: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Row types — snake_case as returned by better-sqlite3
// ---------------------------------------------------------------------------

interface EntityRow {
  id: string;
  type: string;
  display_name: string;
  verification_tier: string;
  coa_alias: string;
  created_at: string;
  updated_at: string;
}

interface ChannelAccountRow {
  id: string;
  entity_id: string;
  channel: string;
  channel_user_id: string;
}

interface GeidMappingRow {
  local_entity_id: string;
  geid: string;
  public_key_pem: string;
  private_key_pem: string | null;
  discoverable: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    type: row.type as Entity["type"],
    displayName: row.display_name,
    verificationTier: row.verification_tier as VerificationTier,
    coaAlias: row.coa_alias,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToChannelAccount(row: ChannelAccountRow): ChannelAccount {
  return {
    id: row.id,
    entityId: row.entity_id,
    channel: row.channel,
    channelUserId: row.channel_user_id,
  };
}

// ---------------------------------------------------------------------------
// EntityStore
// ---------------------------------------------------------------------------

/**
 * Synchronous CRUD operations for entities and channel accounts.
 *
 * All methods use prepared statements for performance and are safe to call
 * repeatedly. Pass the `Database` handle returned by `createDatabase()`.
 *
 * @example
 * const db = createDatabase("/var/data/aionima.db");
 * const store = new EntityStore(db);
 * const entity = store.resolveOrCreate("telegram", "123456789", "Alice");
 */
export class EntityStore {
  // Entity statements
  private readonly stmtInsertEntity: NamedStmt<InsertEntityParams>;
  private readonly stmtGetEntity: PosStmt<[string]>;
  private readonly stmtGetEntityByChannel: PosStmt<[string, string]>;
  private readonly stmtListEntities: NamedStmt<ListParams>;
  private readonly stmtListEntitiesByType: NamedStmt<ListByTypeParams>;
  private readonly stmtUpdateEntityDisplayName: NamedStmt<UpdateDisplayNameParams>;
  private readonly stmtUpdateEntityTier: NamedStmt<UpdateTierParams>;
  private readonly stmtUpdateEntityBoth: NamedStmt<UpdateBothParams>;

  // Alias counter
  private readonly stmtNextAliasIndex: PosStmt<[string]>;

  // Channel account statements
  private readonly stmtInsertChannelAccount: NamedStmt<InsertChannelAccountParams>;
  private readonly stmtUpsertChannelAccount: NamedStmt<InsertChannelAccountParams>;
  private readonly stmtGetChannelAccounts: PosStmt<[string]>;
  private readonly stmtResolveByChannel: PosStmt<[string, string]>;

  // GEID / federation statements
  private readonly stmtInsertGeidMapping: NamedStmt<InsertGeidMappingParams>;
  private readonly stmtGetByGeid: PosStmt<[string]>;
  private readonly stmtGetGeidMapping: PosStmt<[string]>;
  private readonly stmtUpdateEntityFederation: NamedStmt<UpdateFederationParams>;
  private readonly stmtGetByAlias: PosStmt<[string]>;

  // Meta table statements (used for persisting phone hash mappings)
  private readonly stmtUpsertMeta: BetterSqlite3.Statement<[{ key: string; value: string; updated_at: string }]>;
  private readonly stmtGetMeta: BetterSqlite3.Statement<[string]>;

  constructor(db: Database) {
    // Entity statements
    this.stmtInsertEntity = db.prepare<[InsertEntityParams], EntityRow>(`
      INSERT INTO entities (id, type, display_name, verification_tier, coa_alias, created_at, updated_at)
      VALUES (@id, @type, @display_name, @verification_tier, @coa_alias, @created_at, @updated_at)
    `);

    this.stmtGetEntity = db.prepare<[string], EntityRow>(`
      SELECT id, type, display_name, verification_tier, coa_alias, created_at, updated_at
      FROM entities
      WHERE id = ?
    `);

    this.stmtGetEntityByChannel = db.prepare<[string, string], EntityRow>(`
      SELECT e.id, e.type, e.display_name, e.verification_tier, e.coa_alias, e.created_at, e.updated_at
      FROM entities e
      JOIN channel_accounts ca ON ca.entity_id = e.id
      WHERE ca.channel = ? AND ca.channel_user_id = ?
    `);

    this.stmtListEntities = db.prepare<[ListParams], EntityRow>(`
      SELECT id, type, display_name, verification_tier, coa_alias, created_at, updated_at
      FROM entities
      ORDER BY created_at DESC
      LIMIT @limit OFFSET @offset
    `);

    this.stmtListEntitiesByType = db.prepare<[ListByTypeParams], EntityRow>(`
      SELECT id, type, display_name, verification_tier, coa_alias, created_at, updated_at
      FROM entities
      WHERE type = @type
      ORDER BY created_at DESC
      LIMIT @limit OFFSET @offset
    `);

    this.stmtUpdateEntityDisplayName = db.prepare<[UpdateDisplayNameParams]>(`
      UPDATE entities SET display_name = @display_name, updated_at = @updated_at
      WHERE id = @id
    `);

    this.stmtUpdateEntityTier = db.prepare<[UpdateTierParams]>(`
      UPDATE entities SET verification_tier = @verification_tier, updated_at = @updated_at
      WHERE id = @id
    `);

    this.stmtUpdateEntityBoth = db.prepare<[UpdateBothParams]>(`
      UPDATE entities
      SET display_name = @display_name, verification_tier = @verification_tier, updated_at = @updated_at
      WHERE id = @id
    `);

    // Alias counter — next index for a given entity type
    this.stmtNextAliasIndex = db.prepare<[string]>(`
      SELECT COUNT(*) AS count
      FROM entities
      WHERE type = ?
    `);

    // Channel account statements
    this.stmtInsertChannelAccount = db.prepare<[InsertChannelAccountParams]>(`
      INSERT INTO channel_accounts (id, entity_id, channel, channel_user_id, created_at)
      VALUES (@id, @entity_id, @channel, @channel_user_id, @created_at)
    `);

    this.stmtUpsertChannelAccount = db.prepare<[InsertChannelAccountParams]>(`
      INSERT INTO channel_accounts (id, entity_id, channel, channel_user_id, created_at)
      VALUES (@id, @entity_id, @channel, @channel_user_id, @created_at)
      ON CONFLICT (channel, channel_user_id) DO NOTHING
    `);

    // Meta table statements
    this.stmtUpsertMeta = db.prepare<[{ key: string; value: string; updated_at: string }]>(`
      INSERT INTO meta (key, value, updated_at) VALUES (@key, @value, @updated_at)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    this.stmtGetMeta = db.prepare<[string], MetaRow>(`
      SELECT key, value, updated_at FROM meta WHERE key = ?
    `);

    // GEID / federation statements
    this.stmtInsertGeidMapping = db.prepare<[InsertGeidMappingParams]>(`
      INSERT OR IGNORE INTO geid_mappings (local_entity_id, geid, public_key_pem, private_key_pem, discoverable, created_at)
      VALUES (@local_entity_id, @geid, @public_key_pem, @private_key_pem, @discoverable, @created_at)
    `);

    this.stmtGetByGeid = db.prepare<[string], EntityRow>(`
      SELECT e.id, e.type, e.display_name, e.verification_tier, e.coa_alias, e.created_at, e.updated_at
      FROM entities e
      JOIN geid_mappings g ON g.local_entity_id = e.id
      WHERE g.geid = ?
    `);

    this.stmtGetGeidMapping = db.prepare<[string], GeidMappingRow>(`
      SELECT local_entity_id, geid, public_key_pem, private_key_pem, discoverable, created_at
      FROM geid_mappings
      WHERE local_entity_id = ?
    `);

    this.stmtUpdateEntityFederation = db.prepare<[UpdateFederationParams]>(`
      UPDATE entities
      SET geid = @geid, public_key_pem = @public_key_pem, home_node_id = @home_node_id,
          federation_consent = @federation_consent, updated_at = @updated_at
      WHERE id = @id
    `);

    this.stmtGetByAlias = db.prepare<[string], EntityRow>(`
      SELECT id, type, display_name, verification_tier, coa_alias, created_at, updated_at
      FROM entities
      WHERE coa_alias = ?
    `);

    this.stmtGetChannelAccounts = db.prepare<[string], ChannelAccountRow>(`
      SELECT id, entity_id, channel, channel_user_id
      FROM channel_accounts
      WHERE entity_id = ?
      ORDER BY created_at ASC
    `);

    this.stmtResolveByChannel = db.prepare<[string, string], EntityRow>(`
      SELECT e.id, e.type, e.display_name, e.verification_tier, e.coa_alias, e.created_at, e.updated_at
      FROM entities e
      JOIN channel_accounts ca ON ca.entity_id = e.id
      WHERE ca.channel = ? AND ca.channel_user_id = ?
    `);
  }

  // ---------------------------------------------------------------------------
  // Entity operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new entity with the given type and display name.
   * The entity starts with `verificationTier: "unverified"`.
   */
  createEntity(params: { type: Entity["type"]; displayName: string }): Entity {
    const now = new Date().toISOString();
    const id = ulid();

    // Auto-generate COA alias: #<type><index> (e.g. #E0, #E1, #O0)
    const countRow = this.stmtNextAliasIndex.get(params.type) as { count: number };
    const coaAlias = `#${params.type}${countRow.count}`;

    this.stmtInsertEntity.run({
      id,
      type: params.type,
      display_name: params.displayName,
      verification_tier: "unverified",
      coa_alias: coaAlias,
      created_at: now,
      updated_at: now,
    });

    // Auto-generate GEID keypair for new entities
    const keypair = generateEntityKeypair();
    this.stmtInsertGeidMapping.run({
      local_entity_id: id,
      geid: keypair.geid,
      public_key_pem: keypair.publicKeyPem,
      private_key_pem: keypair.privateKeyPem,
      discoverable: 0,
      created_at: now,
    });

    return {
      id,
      type: params.type,
      displayName: params.displayName,
      verificationTier: "unverified",
      coaAlias,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Return the entity with the given ULID, or null if not found. */
  getEntity(id: string): Entity | null {
    const row = this.stmtGetEntity.get(id) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  /**
   * Return the entity linked to the given channel + channelUserId,
   * or null if no matching channel account exists.
   */
  getEntityByChannel(channel: string, channelUserId: string): Entity | null {
    const row = this.stmtGetEntityByChannel.get(channel, channelUserId) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  /**
   * Update `displayName`, `verificationTier`, or both on an existing entity.
   * `updatedAt` is always bumped to the current time.
   *
   * @throws Error if the entity does not exist.
   */
  updateEntity(
    id: string,
    updates: Partial<Pick<Entity, "displayName" | "verificationTier">>,
  ): Entity {
    const now = new Date().toISOString();
    const { displayName, verificationTier } = updates;

    if (displayName !== undefined && verificationTier !== undefined) {
      this.stmtUpdateEntityBoth.run({
        id,
        display_name: displayName,
        verification_tier: verificationTier,
        updated_at: now,
      });
    } else if (displayName !== undefined) {
      this.stmtUpdateEntityDisplayName.run({ id, display_name: displayName, updated_at: now });
    } else if (verificationTier !== undefined) {
      this.stmtUpdateEntityTier.run({ id, verification_tier: verificationTier, updated_at: now });
    }

    const updated = this.getEntity(id);
    if (!updated) {
      throw new Error(`Entity not found: ${id}`);
    }
    return updated;
  }

  /**
   * List entities, optionally filtered by type, with pagination.
   * Defaults: limit 100, offset 0.
   */
  listEntities(opts?: { type?: Entity["type"]; limit?: number; offset?: number }): Entity[] {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;

    let rows: EntityRow[];
    if (opts?.type !== undefined) {
      rows = this.stmtListEntitiesByType.all({ type: opts.type, limit, offset }) as EntityRow[];
    } else {
      rows = this.stmtListEntities.all({ limit, offset }) as EntityRow[];
    }

    return rows.map(rowToEntity);
  }

  // ---------------------------------------------------------------------------
  // Channel account operations
  // ---------------------------------------------------------------------------

  /**
   * Link a channel account to an existing entity.
   * The `(channel, channelUserId)` pair must be globally unique.
   *
   * @throws Error (SQLite UNIQUE constraint) if the pair is already linked.
   */
  linkChannelAccount(params: {
    entityId: string;
    channel: string;
    channelUserId: string;
  }): ChannelAccount {
    const now = new Date().toISOString();
    const id = ulid();

    this.stmtInsertChannelAccount.run({
      id,
      entity_id: params.entityId,
      channel: params.channel,
      channel_user_id: params.channelUserId,
      created_at: now,
    });

    return {
      id,
      entityId: params.entityId,
      channel: params.channel,
      channelUserId: params.channelUserId,
    };
  }

  /** Return all channel accounts linked to the given entity, ordered by creation time. */
  getChannelAccounts(entityId: string): ChannelAccount[] {
    const rows = this.stmtGetChannelAccounts.all(entityId) as ChannelAccountRow[];
    return rows.map(rowToChannelAccount);
  }

  /**
   * Return the entity linked to the given channel + channelUserId,
   * or null if no matching channel account exists.
   *
   * Alias for `getEntityByChannel` — kept as a distinct method to match the
   * public surface described in the store spec.
   */
  resolveEntityByChannel(channel: string, channelUserId: string): Entity | null {
    const row = this.stmtResolveByChannel.get(channel, channelUserId) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  // ---------------------------------------------------------------------------
  // Convenience
  // ---------------------------------------------------------------------------

  /**
   * Resolve an entity by channel identity, creating one if none exists.
   *
   * - If a channel account already exists for `(channel, channelUserId)`,
   *   returns the linked entity unchanged.
   * - Otherwise creates a new `"E"` entity with the given `displayName`
   *   (falling back to `"Unknown"`) and links the channel account to it.
   */
  resolveOrCreate(channel: string, channelUserId: string, displayName?: string): Entity {
    const existing = this.resolveEntityByChannel(channel, channelUserId);
    if (existing) {
      return existing;
    }

    const entity = this.createEntity({
      type: "E",
      displayName: displayName ?? "Unknown",
    });

    this.linkChannelAccount({ entityId: entity.id, channel, channelUserId });

    return entity;
  }

  /**
   * Upsert a channel account — inserts the record or does nothing if the
   * `(channel, channel_user_id)` pair already exists.
   *
   * Unlike `linkChannelAccount`, this method is safe to call on every inbound
   * message without risking UNIQUE constraint violations.
   */
  upsertChannelAccount(params: {
    entityId: string;
    channel: string;
    channelUserId: string;
  }): void {
    const now = new Date().toISOString();
    const id = ulid();

    this.stmtUpsertChannelAccount.run({
      id,
      entity_id: params.entityId,
      channel: params.channel,
      channel_user_id: params.channelUserId,
      created_at: now,
    });
  }

  // ---------------------------------------------------------------------------
  // Phone hash persistence (used by WhatsApp and Signal channel adapters)
  // ---------------------------------------------------------------------------

  /**
   * Persist a hash→phone mapping in the meta table so outbound sends
   * survive gateway restarts.
   *
   * Key format: `phone_hash:{channel}:{hash}`
   * Value: raw E.164 phone number
   */
  upsertPhoneHash(channel: string, hash: string, rawPhone: string): void {
    const key = `phone_hash:${channel}:${hash}`;
    this.stmtUpsertMeta.run({ key, value: rawPhone, updated_at: new Date().toISOString() });
  }

  /**
   * Look up a raw phone number by its hash from the meta table.
   *
   * Returns `undefined` if the mapping has not been persisted.
   */
  lookupPhoneHash(channel: string, hash: string): string | undefined {
    const key = `phone_hash:${channel}:${hash}`;
    const row = this.stmtGetMeta.get(key) as MetaRow | undefined;
    return row?.value;
  }

  // ---------------------------------------------------------------------------
  // GEID operations
  // ---------------------------------------------------------------------------

  /** Look up an entity by its GEID. */
  getByGeid(geid: string): Entity | null {
    const row = this.stmtGetByGeid.get(geid) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  /** Get the GEID mapping for an entity. */
  getGeidMapping(entityId: string): { geid: GEID; publicKeyPem: string; privateKeyPem: string | null; discoverable: boolean } | null {
    const row = this.stmtGetGeidMapping.get(entityId) as GeidMappingRow | undefined;
    if (!row) return null;
    return {
      geid: row.geid as GEID,
      publicKeyPem: row.public_key_pem,
      privateKeyPem: row.private_key_pem,
      discoverable: row.discoverable === 1,
    };
  }

  /** Update federation fields on an entity (GEID, public key, home node, consent). */
  updateFederation(
    entityId: string,
    params: { geid: string; publicKeyPem: string; homeNodeId?: string | null; federationConsent?: string },
  ): void {
    this.stmtUpdateEntityFederation.run({
      id: entityId,
      geid: params.geid,
      public_key_pem: params.publicKeyPem,
      home_node_id: params.homeNodeId ?? null,
      federation_consent: params.federationConsent ?? "none",
      updated_at: new Date().toISOString(),
    });
  }

  /** Look up an entity by COA address (alias with optional @node). */
  getByAddress(address: string): Entity | null {
    const atIdx = address.indexOf("@");
    const alias = atIdx >= 0 ? address.slice(0, atIdx) : address;
    const dotIdx = alias.indexOf(".");
    const entityAlias = dotIdx >= 0 ? alias.slice(0, dotIdx) : alias;
    const row = this.stmtGetByAlias.get(entityAlias) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  }
}
