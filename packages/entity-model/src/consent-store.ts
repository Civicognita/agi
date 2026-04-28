/**
 * ConsentStore — tracks consent per entity per purpose.
 *
 * Compliance: UCS-PRIV-01 (GDPR Art 6/7 — lawful basis via consent).
 */

import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@agi/db-schema/client";
import { consents } from "@agi/db-schema";

export type ConsentPurpose = "data_processing" | "analytics" | "communications" | "third_party_sharing";

export interface ConsentRecord {
  id: string;
  entityId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  source: string;
  version: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function toConsentRecord(row: typeof consents.$inferSelect): ConsentRecord {
  return {
    id: row.id,
    entityId: row.entityId,
    purpose: row.purpose as ConsentPurpose,
    granted: row.granted,
    source: row.source,
    version: row.version,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

// ---------------------------------------------------------------------------
// ConsentStore
// ---------------------------------------------------------------------------

export class ConsentStore {
  constructor(private readonly db: Db) {}

  async grant(entityId: string, purpose: ConsentPurpose, source = "user", version = "1.0"): Promise<ConsentRecord> {
    const now = new Date();
    const id = ulid();

    await this.db.insert(consents).values({
      id,
      entityId,
      purpose,
      granted: true,
      source,
      version,
      createdAt: now,
    }).onConflictDoUpdate({
      target: [consents.entityId, consents.purpose],
      set: { granted: true, source, version, createdAt: now },
    });

    const record = await this.get(entityId, purpose);
    return record!;
  }

  async revoke(entityId: string, purpose: ConsentPurpose, source = "user"): Promise<void> {
    const now = new Date();
    await this.db.update(consents)
      .set({ granted: false, source, createdAt: now })
      .where(and(eq(consents.entityId, entityId), eq(consents.purpose, purpose)));
  }

  async get(entityId: string, purpose: ConsentPurpose): Promise<ConsentRecord | null> {
    const [row] = await this.db
      .select()
      .from(consents)
      .where(and(eq(consents.entityId, entityId), eq(consents.purpose, purpose)));
    return row ? toConsentRecord(row) : null;
  }

  async getAll(entityId: string): Promise<ConsentRecord[]> {
    const rows = await this.db
      .select()
      .from(consents)
      .where(eq(consents.entityId, entityId))
      .orderBy(consents.purpose);
    return rows.map(toConsentRecord);
  }

  async hasConsent(entityId: string, purpose: ConsentPurpose): Promise<boolean> {
    const [row] = await this.db
      .select({ granted: consents.granted })
      .from(consents)
      .where(and(eq(consents.entityId, entityId), eq(consents.purpose, purpose)));
    return row?.granted === true;
  }
}
