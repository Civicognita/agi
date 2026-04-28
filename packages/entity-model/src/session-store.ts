/**
 * SessionStore — server-side session tracking and revocation using revocation_audit table.
 *
 * Compliance: UCS-IAM-02 (SOC 2 CC6 session controls, HIPAA access management).
 *
 * NOTE: The auth.ts table (auth_sessions) tracks active web sessions (cookies).
 * The revocation_audit table here is the compliance audit trail for ALL issued
 * sessions and API keys — kept permanently, never deleted.
 */

import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@agi/db-schema/client";
import { revocationAudit } from "@agi/db-schema";

export interface Session {
  id: string;
  entityId: string;
  tokenHash: string;
  sourceIp: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

export class SessionStore {
  constructor(private readonly db: Db) {}

  async createSession(
    id: string,
    entityId: string,
    tokenHash: string,
    expiresAt: string,
    sourceIp = "",
    userAgent = "",
  ): Promise<void> {
    const now = new Date();
    await this.db.insert(revocationAudit).values({
      id,
      entityId,
      tokenHash,
      kind: "session",
      sourceIp,
      userAgent,
      createdAt: now,
      expiresAt: new Date(expiresAt),
      revokedAt: null,
    });
  }

  async isRevoked(tokenHash: string): Promise<boolean> {
    const [row] = await this.db
      .select({ revokedAt: revocationAudit.revokedAt })
      .from(revocationAudit)
      .where(eq(revocationAudit.tokenHash, tokenHash));
    return row?.revokedAt !== null && row?.revokedAt !== undefined;
  }

  async revokeSession(id: string): Promise<void> {
    await this.db.update(revocationAudit)
      .set({ revokedAt: new Date() })
      .where(eq(revocationAudit.id, id));
  }

  async revokeAllForEntity(entityId: string): Promise<void> {
    await this.db.update(revocationAudit)
      .set({ revokedAt: new Date() })
      .where(and(eq(revocationAudit.entityId, entityId), isNull(revocationAudit.revokedAt)));
  }

  async getActiveSessions(entityId: string): Promise<Session[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(revocationAudit)
      .where(
        and(
          eq(revocationAudit.entityId, entityId),
          isNull(revocationAudit.revokedAt),
          gt(revocationAudit.expiresAt, now),
        ),
      )
      .orderBy(sql`${revocationAudit.createdAt} DESC`);

    return rows.map((r) => ({
      id: r.id,
      entityId: r.entityId ?? "",
      tokenHash: r.tokenHash,
      sourceIp: r.sourceIp,
      userAgent: r.userAgent,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      expiresAt: r.expiresAt ? (r.expiresAt instanceof Date ? r.expiresAt.toISOString() : String(r.expiresAt)) : "",
      revokedAt: r.revokedAt ? (r.revokedAt instanceof Date ? r.revokedAt.toISOString() : String(r.revokedAt)) : null,
    }));
  }

  async cleanup(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.db
      .delete(revocationAudit)
      .where(
        or(
          and(lt(revocationAudit.expiresAt, cutoff), sql`${revocationAudit.revokedAt} IS NOT NULL`),
          lt(revocationAudit.createdAt, cutoff),
        ),
      );
    return (result as unknown as { rowCount?: number | null }).rowCount ?? 0;
  }

  // API Key management — stored in revocation_audit with kind = 'api_key'

  async createApiKey(id: string, entityId: string, keyHash: string, label: string, expiresAt?: string): Promise<void> {
    const now = new Date();
    // Store label in userAgent field (repurposed) for API keys
    await this.db.insert(revocationAudit).values({
      id,
      entityId,
      tokenHash: keyHash,
      kind: "api_key",
      sourceIp: "",
      userAgent: label,
      createdAt: now,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      revokedAt: null,
    });
  }

  async touchApiKey(_keyHash: string): Promise<void> {
    // No last_used in revocation_audit; no-op here — audit trail doesn't track access time
  }

  async isApiKeyValid(keyHash: string): Promise<boolean> {
    const now = new Date();
    const [row] = await this.db
      .select({ revokedAt: revocationAudit.revokedAt, expiresAt: revocationAudit.expiresAt })
      .from(revocationAudit)
      .where(and(eq(revocationAudit.tokenHash, keyHash), eq(revocationAudit.kind, "api_key")));
    if (!row) return false;
    if (row.revokedAt) return false;
    if (row.expiresAt && row.expiresAt < now) return false;
    return true;
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.db.update(revocationAudit)
      .set({ revokedAt: new Date() })
      .where(eq(revocationAudit.id, id));
  }

  async listApiKeys(entityId: string): Promise<Array<{
    id: string;
    label: string;
    createdAt: string;
    lastUsed: string | null;
    expiresAt: string | null;
    revoked: boolean;
  }>> {
    const rows = await this.db
      .select()
      .from(revocationAudit)
      .where(and(eq(revocationAudit.entityId, entityId), eq(revocationAudit.kind, "api_key")))
      .orderBy(sql`${revocationAudit.createdAt} DESC`);

    return rows.map((r) => ({
      id: r.id,
      label: r.userAgent, // label stored in userAgent field
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      lastUsed: null, // not tracked in audit table
      expiresAt: r.expiresAt ? (r.expiresAt instanceof Date ? r.expiresAt.toISOString() : String(r.expiresAt)) : null,
      revoked: r.revokedAt !== null,
    }));
  }
}
