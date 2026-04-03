/**
 * ConsentStore — tracks consent per entity per purpose.
 *
 * Compliance: UCS-PRIV-01 (GDPR Art 6/7 — lawful basis via consent).
 */

import { ulid } from "ulid";
import type { Database } from "./db.js";

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

export const CREATE_CONSENTS = `
CREATE TABLE IF NOT EXISTS consents (
  id          TEXT NOT NULL PRIMARY KEY,
  entity_id   TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  granted     INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'system',
  version     TEXT NOT NULL DEFAULT '1.0',
  created_at  TEXT NOT NULL,
  UNIQUE (entity_id, purpose)
)` as const;

interface ConsentRow {
  id: string;
  entity_id: string;
  purpose: string;
  granted: number;
  source: string;
  version: string;
  created_at: string;
}

function toConsentRecord(row: ConsentRow): ConsentRecord {
  return {
    id: row.id,
    entityId: row.entity_id,
    purpose: row.purpose as ConsentPurpose,
    granted: row.granted === 1,
    source: row.source,
    version: row.version,
    createdAt: row.created_at,
  };
}

export class ConsentStore {
  constructor(private readonly db: Database) {
    db.exec(CREATE_CONSENTS);
  }

  grant(entityId: string, purpose: ConsentPurpose, source = "user", version = "1.0"): ConsentRecord {
    const now = new Date().toISOString();
    const id = ulid();
    this.db.prepare(`
      INSERT INTO consents (id, entity_id, purpose, granted, source, version, created_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT (entity_id, purpose) DO UPDATE SET granted = 1, source = ?, version = ?, created_at = ?
    `).run(id, entityId, purpose, source, version, now, source, version, now);
    return this.get(entityId, purpose)!;
  }

  revoke(entityId: string, purpose: ConsentPurpose, source = "user"): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE consents SET granted = 0, source = ?, created_at = ? WHERE entity_id = ? AND purpose = ?
    `).run(source, now, entityId, purpose);
  }

  get(entityId: string, purpose: ConsentPurpose): ConsentRecord | null {
    const row = this.db.prepare(`SELECT * FROM consents WHERE entity_id = ? AND purpose = ?`).get(entityId, purpose) as ConsentRow | undefined;
    return row ? toConsentRecord(row) : null;
  }

  getAll(entityId: string): ConsentRecord[] {
    const rows = this.db.prepare(`SELECT * FROM consents WHERE entity_id = ? ORDER BY purpose`).all(entityId) as ConsentRow[];
    return rows.map(toConsentRecord);
  }

  hasConsent(entityId: string, purpose: ConsentPurpose): boolean {
    const row = this.db.prepare(`SELECT granted FROM consents WHERE entity_id = ? AND purpose = ?`).get(entityId, purpose) as { granted: number } | undefined;
    return row?.granted === 1;
  }
}
