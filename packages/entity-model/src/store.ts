/**
 * EntityStore — drizzle-based CRUD for entities, channel accounts, and GEID mappings.
 *
 * All methods are async (Postgres/drizzle requires await).
 */

import { eq, and, count, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { AnyDb } from "@agi/db-schema/client";
import { entities, channelAccounts, geidLocal, meta } from "@agi/db-schema";
import { generateEntityKeypair, type GEID } from "./geid.js";
import type { Entity, ChannelAccount, VerificationTier } from "./types.js";

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToEntity(row: typeof entities.$inferSelect): Entity {
  return {
    id: row.id,
    type: row.type as Entity["type"],
    displayName: row.displayName,
    verificationTier: row.verificationTier as VerificationTier,
    coaAlias: row.coaAlias,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

function rowToChannelAccount(row: typeof channelAccounts.$inferSelect): ChannelAccount {
  return {
    id: row.id,
    entityId: row.entityId,
    channel: row.channel,
    channelUserId: row.channelUserId,
  };
}

// ---------------------------------------------------------------------------
// EntityStore
// ---------------------------------------------------------------------------

/**
 * Async CRUD operations for entities and channel accounts.
 *
 * All methods return Promises — callers must await them.
 * Pass the `Db` handle from `createDbClient().db`.
 */
export class EntityStore {
  constructor(private readonly db: AnyDb) {}

  // ---------------------------------------------------------------------------
  // Entity operations
  // ---------------------------------------------------------------------------

  /** Create a new entity with the given type and display name. */
  async createEntity(params: { type: Entity["type"]; displayName: string }): Promise<Entity> {
    const now = new Date();
    const id = ulid();

    // Auto-generate COA alias: #<type><index>
    const [countRow] = await this.db
      .select({ cnt: count(entities.id) })
      .from(entities)
      .where(eq(entities.type, params.type));
    const coaAlias = `#${params.type}${countRow?.cnt ?? 0}`;

    await this.db.insert(entities).values({
      id,
      type: params.type,
      displayName: params.displayName,
      verificationTier: "unverified",
      coaAlias,
      createdAt: now,
      updatedAt: now,
    });

    // Auto-generate GEID keypair for new entities
    const keypair = generateEntityKeypair();
    await this.db.insert(geidLocal).values({
      entityId: id,
      geid: keypair.geid,
      publicKeyPem: keypair.publicKeyPem,
      privateKeyPem: keypair.privateKeyPem,
      discoverable: false,
      createdAt: now,
    }).onConflictDoNothing();

    return {
      id,
      type: params.type,
      displayName: params.displayName,
      verificationTier: "unverified",
      coaAlias,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  /** Return the entity with the given ULID, or null if not found. */
  async getEntity(id: string): Promise<Entity | null> {
    const [row] = await this.db
      .select()
      .from(entities)
      .where(eq(entities.id, id));
    return row ? rowToEntity(row) : null;
  }

  /** Return the entity linked to the given channel + channelUserId, or null. */
  async getEntityByChannel(channel: string, channelUserId: string): Promise<Entity | null> {
    const [row] = await this.db
      .select({ entity: entities })
      .from(entities)
      .innerJoin(channelAccounts, eq(channelAccounts.entityId, entities.id))
      .where(and(eq(channelAccounts.channel, channel), eq(channelAccounts.channelUserId, channelUserId)));
    return row ? rowToEntity(row.entity) : null;
  }

  /** Update displayName, verificationTier, or both. */
  async updateEntity(
    id: string,
    updates: Partial<Pick<Entity, "displayName" | "verificationTier">>,
  ): Promise<Entity> {
    const now = new Date();
    const patch: Partial<typeof entities.$inferInsert> = { updatedAt: now };
    if (updates.displayName !== undefined) patch.displayName = updates.displayName;
    if (updates.verificationTier !== undefined) {
      patch.verificationTier = updates.verificationTier as typeof entities.$inferInsert["verificationTier"];
    }

    await this.db.update(entities).set(patch).where(eq(entities.id, id));

    const updated = await this.getEntity(id);
    if (!updated) throw new Error(`Entity not found: ${id}`);
    return updated;
  }

  /** List entities, optionally filtered by type, with pagination. */
  async listEntities(opts?: { type?: Entity["type"]; limit?: number; offset?: number }): Promise<Entity[]> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;

    const query = this.db
      .select()
      .from(entities)
      .orderBy(sql`${entities.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    const rows = opts?.type !== undefined
      ? await query.where(eq(entities.type, opts.type))
      : await query;

    return rows.map(rowToEntity);
  }

  // ---------------------------------------------------------------------------
  // Channel account operations
  // ---------------------------------------------------------------------------

  /** Link a channel account to an existing entity. Throws on UNIQUE violation. */
  async linkChannelAccount(params: {
    entityId: string;
    channel: string;
    channelUserId: string;
  }): Promise<ChannelAccount> {
    const now = new Date();
    const id = ulid();

    await this.db.insert(channelAccounts).values({
      id,
      entityId: params.entityId,
      channel: params.channel,
      channelUserId: params.channelUserId,
      createdAt: now,
    });

    return {
      id,
      entityId: params.entityId,
      channel: params.channel,
      channelUserId: params.channelUserId,
    };
  }

  /** Return all channel accounts linked to the given entity. */
  async getChannelAccounts(entityId: string): Promise<ChannelAccount[]> {
    const rows = await this.db
      .select()
      .from(channelAccounts)
      .where(eq(channelAccounts.entityId, entityId))
      .orderBy(channelAccounts.createdAt);
    return rows.map(rowToChannelAccount);
  }

  /** Return entity by channel identity, or null. */
  async resolveEntityByChannel(channel: string, channelUserId: string): Promise<Entity | null> {
    return this.getEntityByChannel(channel, channelUserId);
  }

  /** Resolve or create entity by channel identity. */
  async resolveOrCreate(channel: string, channelUserId: string, displayName?: string): Promise<Entity> {
    const existing = await this.resolveEntityByChannel(channel, channelUserId);
    if (existing) return existing;

    const entity = await this.createEntity({ type: "E", displayName: displayName ?? "Unknown" });
    await this.linkChannelAccount({ entityId: entity.id, channel, channelUserId });
    return entity;
  }

  /** Upsert channel account — safe to call on every inbound message. */
  async upsertChannelAccount(params: {
    entityId: string;
    channel: string;
    channelUserId: string;
  }): Promise<void> {
    const now = new Date();
    const id = ulid();

    await this.db.insert(channelAccounts).values({
      id,
      entityId: params.entityId,
      channel: params.channel,
      channelUserId: params.channelUserId,
      createdAt: now,
    }).onConflictDoNothing();
  }

  // ---------------------------------------------------------------------------
  // Phone hash persistence
  // ---------------------------------------------------------------------------

  async upsertPhoneHash(channel: string, hash: string, rawPhone: string): Promise<void> {
    const key = `phone_hash:${channel}:${hash}`;
    const now = new Date();
    await this.db.insert(meta).values({
      key,
      value: rawPhone as unknown as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: meta.key,
      set: { value: rawPhone as unknown as Record<string, unknown>, updatedAt: now },
    });
  }

  async lookupPhoneHash(channel: string, hash: string): Promise<string | undefined> {
    const key = `phone_hash:${channel}:${hash}`;
    const [row] = await this.db.select().from(meta).where(eq(meta.key, key));
    return row ? String(row.value) : undefined;
  }

  // ---------------------------------------------------------------------------
  // GEID operations
  // ---------------------------------------------------------------------------

  /** Look up an entity by its GEID. */
  async getByGeid(geid: string): Promise<Entity | null> {
    const [row] = await this.db
      .select({ entity: entities })
      .from(entities)
      .innerJoin(geidLocal, eq(geidLocal.entityId, entities.id))
      .where(eq(geidLocal.geid, geid));
    return row ? rowToEntity(row.entity) : null;
  }

  /** Get the GEID mapping for an entity. */
  async getGeidMapping(entityId: string): Promise<{
    geid: GEID;
    publicKeyPem: string;
    privateKeyPem: string | null;
    discoverable: boolean;
  } | null> {
    const [row] = await this.db
      .select()
      .from(geidLocal)
      .where(eq(geidLocal.entityId, entityId));
    if (!row) return null;
    return {
      geid: row.geid as GEID,
      publicKeyPem: row.publicKeyPem,
      privateKeyPem: row.privateKeyPem ?? null,
      discoverable: row.discoverable,
    };
  }

  /** Update federation fields on an entity. */
  async updateFederation(
    entityId: string,
    params: { geid: string; publicKeyPem: string; homeNodeId?: string | null; federationConsent?: string },
  ): Promise<void> {
    await this.db.update(entities).set({
      geid: params.geid,
      publicKeyPem: params.publicKeyPem,
      homeNodeId: params.homeNodeId ?? null,
      federationConsent: (params.federationConsent ?? "none") as typeof entities.$inferInsert["federationConsent"],
      updatedAt: new Date(),
    }).where(eq(entities.id, entityId));
  }

  /** Look up an entity by COA address (alias with optional @node). */
  async getByAddress(address: string): Promise<Entity | null> {
    const atIdx = address.indexOf("@");
    const alias = atIdx >= 0 ? address.slice(0, atIdx) : address;
    const dotIdx = alias.indexOf(".");
    const entityAlias = dotIdx >= 0 ? alias.slice(0, dotIdx) : alias;

    const [row] = await this.db
      .select()
      .from(entities)
      .where(eq(entities.coaAlias, entityAlias));
    return row ? rowToEntity(row) : null;
  }
}
