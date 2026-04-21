/**
 * VendorStore — third-party processor/vendor tracking.
 *
 * Compliance: UCS-VEND-01 (HIPAA BAA, GDPR Art 28, PCI 12.8.4).
 */

import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@agi/db-schema/client";
import { vendors } from "@agi/db-schema";

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

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function toVendor(row: typeof vendors.$inferSelect): Vendor {
  return {
    id: row.id,
    name: row.name,
    type: row.type as VendorType,
    description: row.description ?? "",
    complianceStatus: (row.complianceStatus ?? "unknown") as ComplianceStatus,
    dpaSigned: row.dpaSigned,
    baaSigned: row.baaSigned,
    lastReviewDate: toIso(row.lastReviewDate),
    nextReviewDate: toIso(row.nextReviewDate),
    certifications: Array.isArray(row.certifications) ? (row.certifications as string[]) : [],
    createdAt: toIso(row.createdAt) ?? "",
    updatedAt: toIso(row.updatedAt) ?? "",
  };
}

// ---------------------------------------------------------------------------
// VendorStore
// ---------------------------------------------------------------------------

export class VendorStore {
  constructor(private readonly db: Db) {}

  async upsert(params: CreateVendorParams): Promise<Vendor> {
    const now = new Date();
    const id = ulid();
    const nextReview = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    await this.db.insert(vendors).values({
      id,
      name: params.name,
      type: params.type,
      description: params.description ?? "",
      dpaSigned: params.dpaSigned ?? false,
      baaSigned: params.baaSigned ?? false,
      certifications: (params.certifications ?? []) as unknown as Record<string, unknown>,
      nextReviewDate: nextReview,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: vendors.name,
      set: { type: params.type, description: params.description ?? "", updatedAt: now },
    });

    const record = await this.getByName(params.name);
    return record!;
  }

  async getByName(name: string): Promise<Vendor | null> {
    const [row] = await this.db.select().from(vendors).where(eq(vendors.name, name));
    return row ? toVendor(row) : null;
  }

  async list(): Promise<Vendor[]> {
    const rows = await this.db.select().from(vendors).orderBy(vendors.name);
    return rows.map(toVendor);
  }

  async updateCompliance(id: string, status: ComplianceStatus): Promise<void> {
    const now = new Date();
    await this.db.update(vendors).set({
      complianceStatus: status as typeof vendors.$inferInsert["complianceStatus"],
      lastReviewDate: now,
      nextReviewDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    }).where(eq(vendors.id, id));
  }

  async updateDpa(id: string, signed: boolean): Promise<void> {
    await this.db.update(vendors).set({ dpaSigned: signed, updatedAt: new Date() }).where(eq(vendors.id, id));
  }

  async updateBaa(id: string, signed: boolean): Promise<void> {
    await this.db.update(vendors).set({ baaSigned: signed, updatedAt: new Date() }).where(eq(vendors.id, id));
  }

  async getOverdueReviews(): Promise<Vendor[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(vendors)
      .where(sql`${vendors.nextReviewDate} IS NOT NULL AND ${vendors.nextReviewDate} < ${now.toISOString()}`)
      .orderBy(vendors.nextReviewDate);
    return rows.map(toVendor);
  }

  /** Auto-populate vendors from config (providers, OAuth, voice). */
  async seedFromConfig(config: Record<string, unknown>): Promise<void> {
    const providers = config.providers as Record<string, unknown> | undefined;
    if (providers) {
      for (const name of Object.keys(providers)) {
        await this.upsert({ name: `${name} (LLM)`, type: "llm_provider", description: `${name} LLM API provider` });
      }
    }
    const identity = config.identity as { oauth?: Record<string, unknown> } | undefined;
    if (identity?.oauth) {
      for (const name of Object.keys(identity.oauth)) {
        await this.upsert({ name: `${name} (OAuth)`, type: "oauth_provider", description: `${name} OAuth identity provider` });
      }
    }
  }
}
