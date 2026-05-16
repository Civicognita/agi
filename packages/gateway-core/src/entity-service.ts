/**
 * Entity Service — entity CRUD, GEID generation, COA alias management,
 * agent binding, and on-chain-ready registration records.
 *
 * Absorbed from agi-local-id Phase 3 (2026-05-16). Ported from
 * id/src/services/entity-service.ts with adaptations:
 * - nanoid() replaced with crypto.randomBytes(16).toString("hex")
 * - encrypt/decrypt delegated to crypto-tokens.ts (AES-256-GCM key param)
 * - DrizzleDb type replaced with gateway-core's Db type
 *
 * GEID generation matches agi/packages/entity-model/src/geid.ts
 * (Base58-encoded Ed25519 public key prefixed with "geid:").
 */

import {
  createPrivateKey,
  generateKeyPairSync,
  createHash,
  sign,
  randomBytes,
} from "node:crypto";
import { eq, and, like, sql } from "drizzle-orm";
import type { Db } from "@agi/db-schema/client";
import {
  entities,
  geidLocal,
  agentBindings,
  registrations,
  users,
} from "@agi/db-schema";
import { encryptToken, decryptToken } from "./crypto-tokens.js";

// ---------------------------------------------------------------------------
// Base58 encoding (Bitcoin-style — matches agi/packages/entity-model)
// ---------------------------------------------------------------------------

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(buffer: Uint8Array): string {
  const digits = [0];
  for (const byte of buffer) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j] as number) << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let output = "";
  for (const byte of buffer) {
    if (byte !== 0) break;
    output += BASE58_ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    output += BASE58_ALPHABET[digits[i] as number];
  }
  return output;
}

// ---------------------------------------------------------------------------
// GEID generation
// ---------------------------------------------------------------------------

interface EntityKeypair {
  privateKeyPem: string;
  publicKeyPem: string;
  geid: string;
  publicKeyBase58: string;
}

function generateEntityKeypair(): EntityKeypair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  // Extract raw 32-byte key from SPKI DER (12-byte header + 32-byte key)
  const spkiDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const rawPublicKey = spkiDer.subarray(12);
  const publicKeyBase58 = encodeBase58(rawPublicKey);
  return { privateKeyPem, publicKeyPem, geid: `geid:${publicKeyBase58}`, publicKeyBase58 };
}

// ---------------------------------------------------------------------------
// COA alias helpers
// ---------------------------------------------------------------------------

const SENTIENT_TYPES = new Set(["E", "O", "T", "F"]);

function aliasPrefix(type: string, scope: string): string {
  if (scope === "local") return "~";
  return SENTIENT_TYPES.has(type) ? "#" : "$";
}

// ---------------------------------------------------------------------------
// Registration record helpers
// ---------------------------------------------------------------------------

interface RegistrationPayload {
  version: number;
  type: "entity-registration";
  entity: { geid: string; classification: string; coaAlias: string; scope: string; displayName: string };
  registration: { type: string; agentBinding?: { geid: string; alias: string } | null; referrer: string | null; source: string; result: string };
  timestamp: string;
}

function buildRecordHash(payload: RegistrationPayload): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function signRecord(payload: RegistrationPayload, privateKeyPem: string): string {
  const privateKey = createPrivateKey(privateKeyPem);
  return `ed25519:${sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EntityRecord {
  id: string;
  type: string;
  displayName: string;
  coaAlias: string;
  scope: string;
  parentEntityId: string | null;
  verificationTier: string;
  userId: string | null;
  entityId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GeidRecord {
  entityId: string;
  geid: string;
  publicKeyPem: string;
  privateKeyPem: string | null;
  discoverable: boolean;
  createdAt: Date;
}

export interface CreateEntityResult {
  entity: EntityRecord;
  geid: GeidRecord;
}

export interface RegisterOwnerResult {
  owner: EntityRecord;
  ownerGeid: GeidRecord;
  agent: EntityRecord;
  agentGeid: GeidRecord;
  registrationId: string;
}

// ---------------------------------------------------------------------------
// Entity Service factory
// ---------------------------------------------------------------------------

export function createEntityService(db: Db, encKey: Buffer) {
  // -----------------------------------------------------------------------
  // nextAlias — compute the next sequential COA alias for a type/scope
  // -----------------------------------------------------------------------

  async function nextAlias(type: string, scope: "local" | "registered", parentAlias?: string): Promise<string> {
    const prefix = aliasPrefix(type, scope);
    const pattern = (scope === "local" && parentAlias)
      ? `${parentAlias}~${type}%`
      : `${prefix}${type}%`;

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(entities)
      .where(like(entities.coaAlias, pattern));

    const count = Number(result[0]?.count ?? 0);
    const index = scope === "local" ? count + 1 : count;

    return (scope === "local" && parentAlias)
      ? `${parentAlias}~${type}${index}`
      : `${prefix}${type}${index}`;
  }

  // -----------------------------------------------------------------------
  // createEntity — base entity creation with GEID keypair
  // -----------------------------------------------------------------------

  async function createEntity(
    type: string,
    displayName: string,
    scope: "local" | "registered",
    parentEntityId?: string,
    userId?: string,
  ): Promise<CreateEntityResult> {
    const id = randomBytes(16).toString("hex");
    const keypair = generateEntityKeypair();

    let parentAlias: string | undefined;
    if (scope === "local" && parentEntityId) {
      const [parent] = await db.select().from(entities).where(eq(entities.id, parentEntityId)).limit(1);
      parentAlias = parent?.coaAlias;
    }

    const coaAlias = await nextAlias(type, scope, parentAlias);
    const now = new Date();

    await db.insert(entities).values({
      id,
      type,
      displayName,
      coaAlias,
      scope,
      parentEntityId: parentEntityId ?? null,
      verificationTier: "unverified",
      userId: userId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    // Encrypt private key before storing
    const encryptedPrivateKey = encryptToken(encKey, keypair.privateKeyPem);

    await db.insert(geidLocal).values({
      entityId: id,
      geid: keypair.geid,
      publicKeyPem: keypair.publicKeyPem,
      privateKeyPem: encryptedPrivateKey,
      discoverable: false,
      createdAt: now,
    });

    const [entity] = await db.select().from(entities).where(eq(entities.id, id)).limit(1);
    const [geid] = await db.select().from(geidLocal).where(eq(geidLocal.entityId, id)).limit(1);

    return { entity: entity as EntityRecord, geid: geid as GeidRecord };
  }

  // -----------------------------------------------------------------------
  // createOwnerEntity — genesis: #E0 + $A0 + binding + registration
  // -----------------------------------------------------------------------

  async function createOwnerEntity(displayName: string): Promise<RegisterOwnerResult> {
    const owner = await createEntity("E", displayName, "registered");
    const agent = await createEntity("A", "Aionima", "registered");

    await db.insert(agentBindings).values({
      id: randomBytes(16).toString("hex"),
      ownerId: owner.entity.id,
      agentId: agent.entity.id,
      bindingType: "primary",
      createdAt: new Date(),
    });

    const timestamp = new Date().toISOString();
    const payload: RegistrationPayload = {
      version: 1,
      type: "entity-registration",
      entity: {
        geid: owner.geid.geid,
        classification: "#E",
        coaAlias: owner.entity.coaAlias,
        scope: "registered",
        displayName,
      },
      registration: {
        type: "owner",
        agentBinding: { geid: agent.geid.geid, alias: agent.entity.coaAlias },
        referrer: null,
        source: "direct",
        result: "instant",
      },
      timestamp,
    };

    const recordHash = buildRecordHash(payload);

    // Decrypt the owner's private key and sign the registration record
    const ownerPrivateKey = decryptToken(encKey, owner.geid.privateKeyPem!);
    const recordSignature = signRecord(payload, ownerPrivateKey);

    const regId = randomBytes(16).toString("hex");
    await db.insert(registrations).values({
      id: regId,
      entityId: owner.entity.id,
      registrationType: "owner",
      referrerEntityId: null,
      referralSource: "direct",
      referralResult: "instant",
      agentEntityId: agent.entity.id,
      recordHash,
      recordSignature,
      chainTxId: null,
      createdAt: new Date(),
    });

    return {
      owner: owner.entity,
      ownerGeid: owner.geid,
      agent: agent.entity,
      agentGeid: agent.geid,
      registrationId: regId,
    };
  }

  // -----------------------------------------------------------------------
  // Lookup functions
  // -----------------------------------------------------------------------

  async function getEntity(id: string): Promise<EntityRecord | null> {
    const [entity] = await db.select().from(entities).where(eq(entities.id, id)).limit(1);
    return (entity as EntityRecord | undefined) ?? null;
  }

  async function getByGeid(geid: string): Promise<EntityRecord | null> {
    const [mapping] = await db.select().from(geidLocal).where(eq(geidLocal.geid, geid)).limit(1);
    if (!mapping) return null;
    return getEntity(mapping.entityId);
  }

  async function getByAlias(alias: string): Promise<EntityRecord | null> {
    const [entity] = await db.select().from(entities).where(eq(entities.coaAlias, alias)).limit(1);
    return (entity as EntityRecord | undefined) ?? null;
  }

  async function getEntityGeid(entityId: string): Promise<GeidRecord | null> {
    const [geid] = await db.select().from(geidLocal).where(eq(geidLocal.entityId, entityId)).limit(1);
    return (geid as GeidRecord | undefined) ?? null;
  }

  async function listEntities(): Promise<EntityRecord[]> {
    return db.select().from(entities) as Promise<EntityRecord[]>;
  }

  // -----------------------------------------------------------------------
  // bindAgent — link a $A entity to an owner (#E or #O)
  // -----------------------------------------------------------------------

  async function bindAgent(ownerEntityId: string, agentEntityId: string, bindingType = "primary"): Promise<void> {
    const owner = await getEntity(ownerEntityId);
    if (!owner || !SENTIENT_TYPES.has(owner.type)) throw new Error("Owner must be a sentient entity (#E, #O, #T, or #F)");

    const agent = await getEntity(agentEntityId);
    if (!agent || agent.type !== "A") throw new Error("Agent must be a $A entity");

    await db.insert(agentBindings).values({
      id: randomBytes(16).toString("hex"),
      ownerId: ownerEntityId,
      agentId: agentEntityId,
      bindingType,
      createdAt: new Date(),
    });
  }

  async function getOwnerAgents(ownerEntityId: string): Promise<EntityRecord[]> {
    const bindings = await db.select().from(agentBindings).where(eq(agentBindings.ownerId, ownerEntityId));
    const result: EntityRecord[] = [];
    for (const b of bindings) {
      const entity = await getEntity(b.agentId);
      if (entity) result.push(entity);
    }
    return result;
  }

  async function linkUserToEntity(userId: string, entityId: string): Promise<void> {
    await db.update(users).set({ entityId }).where(eq(users.id, userId));
  }

  async function hasGenesisOwner(): Promise<boolean> {
    const [owner] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.coaAlias, "#E0"), eq(entities.scope, "registered")))
      .limit(1);
    return owner !== undefined;
  }

  return {
    createEntity,
    createOwnerEntity,
    getEntity,
    getByGeid,
    getByAlias,
    getEntityGeid,
    listEntities,
    bindAgent,
    getOwnerAgents,
    linkUserToEntity,
    hasGenesisOwner,
    nextAlias,
  };
}

export type EntityService = ReturnType<typeof createEntityService>;
