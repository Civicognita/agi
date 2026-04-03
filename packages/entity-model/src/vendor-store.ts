/**
 * VendorStore — third-party processor/vendor tracking.
 *
 * Compliance: UCS-VEND-01 (HIPAA BAA, GDPR Art 28, PCI 12.8.4).
 */

import { ulid } from "ulid";
import type { Database } from "./db.js";

export type VendorType = "llm_provider" | "oauth_provider" | "voice_provider" | "hosting" | "analytics" | "payment" | "other";
export type ComplianceStatus = "compliant" | "review_needed" | "non_compliant" | "unknown";

export interface Vendor {
  id: string;
  name: string;
  type: VendorType;
  description: string;
  complianceStatus: ComplianceStatus;
  dpaSigned: boolean;
  baaSigned: boolean;
  lastReviewDate: string | null;
  nextReviewDate: string | null;
  certifications: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateVendorParams {
  name: string;
  type: VendorType;
  description?: string;
  dpaSigned?: boolean;
  baaSigned?: boolean;
  certifications?: string[];
}

export const CREATE_VENDORS = `
CREATE TABLE IF NOT EXISTS vendors (
  id                TEXT NOT NULL PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  type              TEXT NOT NULL DEFAULT 'other',
  description       TEXT NOT NULL DEFAULT '',
  compliance_status TEXT NOT NULL DEFAULT 'unknown',
  dpa_signed        INTEGER NOT NULL DEFAULT 0,
  baa_signed        INTEGER NOT NULL DEFAULT 0,
  last_review_date  TEXT,
  next_review_date  TEXT,
  certifications    TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
)` as const;

interface VendorRow {
  id: string;
  name: string;
  type: string;
  description: string;
  compliance_status: string;
  dpa_signed: number;
  baa_signed: number;
  last_review_date: string | null;
  next_review_date: string | null;
  certifications: string;
  created_at: string;
  updated_at: string;
}

function toVendor(row: VendorRow): Vendor {
  return {
    id: row.id,
    name: row.name,
    type: row.type as VendorType,
    description: row.description,
    complianceStatus: row.compliance_status as ComplianceStatus,
    dpaSigned: row.dpa_signed === 1,
    baaSigned: row.baa_signed === 1,
    lastReviewDate: row.last_review_date,
    nextReviewDate: row.next_review_date,
    certifications: JSON.parse(row.certifications) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class VendorStore {
  constructor(private readonly db: Database) {
    db.exec(CREATE_VENDORS);
  }

  upsert(params: CreateVendorParams): Vendor {
    const now = new Date().toISOString();
    const id = ulid();
    // Annual review cycle (PCI 12.8.4)
    const nextReview = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    this.db.prepare(`
      INSERT INTO vendors (id, name, type, description, dpa_signed, baa_signed, certifications, next_review_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (name) DO UPDATE SET type = ?, description = ?, updated_at = ?
    `).run(
      id, params.name, params.type, params.description ?? "", params.dpaSigned ? 1 : 0,
      params.baaSigned ? 1 : 0, JSON.stringify(params.certifications ?? []), nextReview, now, now,
      params.type, params.description ?? "", now,
    );

    return this.getByName(params.name)!;
  }

  getByName(name: string): Vendor | null {
    const row = this.db.prepare(`SELECT * FROM vendors WHERE name = ?`).get(name) as VendorRow | undefined;
    return row ? toVendor(row) : null;
  }

  list(): Vendor[] {
    return (this.db.prepare(`SELECT * FROM vendors ORDER BY name`).all() as VendorRow[]).map(toVendor);
  }

  updateCompliance(id: string, status: ComplianceStatus): void {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE vendors SET compliance_status = ?, last_review_date = ?, next_review_date = ?, updated_at = ? WHERE id = ?`)
      .run(status, now, new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), now, id);
  }

  updateDpa(id: string, signed: boolean): void {
    this.db.prepare(`UPDATE vendors SET dpa_signed = ?, updated_at = ? WHERE id = ?`).run(signed ? 1 : 0, new Date().toISOString(), id);
  }

  updateBaa(id: string, signed: boolean): void {
    this.db.prepare(`UPDATE vendors SET baa_signed = ?, updated_at = ? WHERE id = ?`).run(signed ? 1 : 0, new Date().toISOString(), id);
  }

  getOverdueReviews(): Vendor[] {
    const now = new Date().toISOString();
    return (this.db.prepare(`SELECT * FROM vendors WHERE next_review_date IS NOT NULL AND next_review_date < ? ORDER BY next_review_date`).all(now) as VendorRow[]).map(toVendor);
  }

  /** Auto-populate vendors from config (providers, OAuth, voice). */
  seedFromConfig(config: Record<string, unknown>): void {
    const providers = config.providers as Record<string, unknown> | undefined;
    if (providers) {
      for (const name of Object.keys(providers)) {
        this.upsert({ name: `${name} (LLM)`, type: "llm_provider", description: `${name} LLM API provider` });
      }
    }
    const identity = config.identity as { oauth?: Record<string, unknown> } | undefined;
    if (identity?.oauth) {
      for (const name of Object.keys(identity.oauth)) {
        this.upsert({ name: `${name} (OAuth)`, type: "oauth_provider", description: `${name} OAuth identity provider` });
      }
    }
  }
}
