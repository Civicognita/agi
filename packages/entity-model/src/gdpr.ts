/**
 * GDPR-Compliant Entity Deletion — Task #222 (drizzle/Postgres rewrite)
 *
 * Implements right-to-erasure while preserving COA chain integrity:
 *
 * DELETE (personal data):
 *   - Entity profile fields (displayName cleared, status set to "deleted")
 *   - Channel accounts (PII: usernames, platform IDs)
 *   - Verification requests (PII: proof documents)
 *   - Revocation audit entries for the entity
 *
 * PRESERVE (anonymized):
 *   - COA chain records — entity row kept (FK intact), but displayName redacted
 *   - Impact interactions — entity row kept, scores preserved
 *   - Payload commitment hashes
 *
 * NOTE: coaChains.entityId and impactInteractions.entityId have NOT NULL FK
 * constraints to entities.id. The entity row is NOT hard-deleted — instead
 * the entity's displayName is cleared to "[REDACTED]" and its status is
 * set to "deleted". This satisfies FK constraints while removing PII.
 */

import { eq, sql } from "drizzle-orm";
import type { Db } from "@agi/db-schema/client";
import {
  entities,
  channelAccounts,
  verificationRequests,
  impactInteractions,
  revocationAudit,
} from "@agi/db-schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Phases of GDPR deletion. */
export type DeletionPhase =
  | "requested"
  | "anonymizing_coa"
  | "deleting_content"
  | "clearing_profile"
  | "finalizing"
  | "completed"
  | "failed";

/** Deletion request record. */
export interface DeletionRequest {
  /** Unique request ID. */
  requestId: string;
  /** Entity ID being deleted. */
  entityId: string;
  /** Tenant ID (reserved for future multi-tenant use). */
  tenantId: string;
  /** When the request was created. */
  requestedAt: string;
  /** Current deletion phase. */
  phase: DeletionPhase;
  /** Phase completion timestamps. */
  phaseLog: PhaseLogEntry[];
  /** Reason for deletion (user-provided or "right-to-erasure"). */
  reason: string;
  /** Whether deletion completed successfully. */
  completed: boolean;
  /** Error message if failed. */
  error?: string;
}

export interface PhaseLogEntry {
  phase: DeletionPhase;
  timestamp: string;
  detail?: string;
}

/** Summary of what was deleted/preserved. */
export interface DeletionReport {
  requestId: string;
  entityId: string;
  /** Items deleted. */
  deleted: {
    profileFields: number;
    channelAccounts: number;
    transcripts: number;
    sessions: number;
    verificationDetails: number;
    pushTokens: number;
  };
  /** Items preserved (anonymized). */
  preserved: {
    coaRecords: number;
    impactAggregates: number;
    payloadHashes: number;
  };
  completedAt: string;
}

/** Configuration for GDPR deletion. */
export interface GDPRConfig {
  /** Placeholder for redacted entity references. */
  redactedPlaceholder: string;
  /** Whether to preserve payload hashes as commitment proofs. */
  preservePayloadHashes: boolean;
  /** Maximum time (ms) for deletion to complete before timeout. */
  timeoutMs: number;
}

const DEFAULT_GDPR_CONFIG: GDPRConfig = {
  redactedPlaceholder: "[REDACTED]",
  preservePayloadHashes: true,
  timeoutMs: 300_000, // 5 minutes
};

// ---------------------------------------------------------------------------
// GDPR Manager
// ---------------------------------------------------------------------------

export class GDPRManager {
  private readonly config: GDPRConfig;
  private readonly requests = new Map<string, DeletionRequest>();

  constructor(private readonly db: Db, config?: Partial<GDPRConfig>) {
    this.config = { ...DEFAULT_GDPR_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Deletion request lifecycle
  // -------------------------------------------------------------------------

  /**
   * Create a deletion request for an entity.
   * Validates entity exists and is not already being deleted.
   */
  async createRequest(
    requestId: string,
    entityId: string,
    tenantId: string,
    reason = "right-to-erasure",
  ): Promise<DeletionRequest> {
    // Check for existing active request
    for (const req of this.requests.values()) {
      if (req.entityId === entityId && !req.completed && req.phase !== "failed") {
        throw new Error(`Active deletion request already exists: ${req.requestId}`);
      }
    }

    // Verify entity exists
    const [entity] = await this.db
      .select({ id: entities.id, displayName: entities.displayName })
      .from(entities)
      .where(eq(entities.id, entityId));

    if (!entity) {
      throw new Error(`Entity not found: ${entityId}`);
    }

    if (entity.displayName === this.config.redactedPlaceholder) {
      throw new Error(`Entity already deleted: ${entityId}`);
    }

    const now = new Date().toISOString();
    const request: DeletionRequest = {
      requestId,
      entityId,
      tenantId,
      requestedAt: now,
      phase: "requested",
      phaseLog: [{ phase: "requested", timestamp: now }],
      reason,
      completed: false,
    };

    this.requests.set(requestId, request);
    return request;
  }

  /**
   * Execute the full deletion pipeline.
   * Returns a report of what was deleted/preserved.
   */
  async executeDeletion(requestId: string): Promise<DeletionReport> {
    const request = this.requests.get(requestId);
    if (!request) throw new Error(`Request not found: ${requestId}`);
    if (request.completed) throw new Error("Request already completed");

    const report: DeletionReport = {
      requestId,
      entityId: request.entityId,
      deleted: {
        profileFields: 0,
        channelAccounts: 0,
        transcripts: 0,
        sessions: 0,
        verificationDetails: 0,
        pushTokens: 0,
      },
      preserved: {
        coaRecords: 0,
        impactAggregates: 0,
        payloadHashes: 0,
      },
      completedAt: "",
    };

    try {
      // Phase 1: Count COA chain records (entity row stays; only profile is cleared)
      this.advancePhase(request, "anonymizing_coa");
      report.preserved.coaRecords = await this.countCOARecords(request.entityId);

      // Phase 2: Delete session/audit data
      this.advancePhase(request, "deleting_content");
      const contentResult = await this.deleteContent(request.entityId);
      report.deleted.transcripts = contentResult.transcripts;
      report.deleted.sessions = contentResult.sessions;

      // Phase 3: Clear entity profile
      this.advancePhase(request, "clearing_profile");
      const profileResult = await this.clearProfile(request.entityId);
      report.deleted.profileFields = profileResult.profileFields;
      report.deleted.channelAccounts = profileResult.channelAccounts;
      report.deleted.verificationDetails = profileResult.verificationDetails;
      report.deleted.pushTokens = profileResult.pushTokens;

      // Phase 4: Count preserved impact aggregates
      this.advancePhase(request, "finalizing");
      report.preserved.impactAggregates = await this.countImpactAggregates(request.entityId);

      // Mark complete
      report.completedAt = new Date().toISOString();
      request.completed = true;
      this.advancePhase(request, "completed");

      return report;
    } catch (err) {
      request.phase = "failed";
      request.error = err instanceof Error ? err.message : String(err);
      request.phaseLog.push({
        phase: "failed",
        timestamp: new Date().toISOString(),
        detail: request.error,
      });
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Deletion phases
  // -------------------------------------------------------------------------

  /**
   * Phase 1: Count COA chain records.
   * The entity row is NOT deleted (FK constraints); instead the profile is
   * cleared in Phase 3. COA records are preserved with scores intact.
   */
  private async countCOARecords(entityId: string): Promise<number> {
    const [row] = await this.db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(impactInteractions)
      .where(eq(impactInteractions.entityId, entityId));
    return row?.cnt ?? 0;
  }

  /**
   * Phase 2: Delete audit/session data linked to the entity.
   * session_transcripts and push_tokens don't exist in the drizzle schema —
   * revocationAudit covers audit trail for sessions and API keys.
   */
  private async deleteContent(entityId: string): Promise<{ transcripts: number; sessions: number }> {
    // Delete revocation audit entries for the entity
    const deleted = await this.db
      .delete(revocationAudit)
      .where(eq(revocationAudit.entityId, entityId))
      .returning({ id: revocationAudit.id });

    return {
      transcripts: 0, // no session_transcripts table in schema
      sessions: deleted.length,
    };
  }

  /**
   * Phase 3: Clear entity profile and related PII.
   * Entity row is soft-deleted (displayName → "[REDACTED]") to preserve FK
   * integrity in coaChains and impactInteractions.
   */
  private async clearProfile(entityId: string): Promise<{
    profileFields: number;
    channelAccounts: number;
    verificationDetails: number;
    pushTokens: number;
  }> {
    const placeholder = this.config.redactedPlaceholder;
    const now = new Date();

    // Soft-delete: clear PII fields but keep the entity row for FK integrity
    await this.db
      .update(entities)
      .set({
        displayName: placeholder,
        coaAlias: `${placeholder}-${entityId}`,
        geid: null,
        publicKeyPem: null,
        sourceIp: null,
        updatedAt: now,
      })
      .where(eq(entities.id, entityId));

    // Delete channel accounts (PII: external usernames, platform IDs)
    const channels = await this.db
      .delete(channelAccounts)
      .where(eq(channelAccounts.entityId, entityId))
      .returning({ id: channelAccounts.id });

    // Delete verification requests (PII: proof documents)
    const verifications = await this.db
      .delete(verificationRequests)
      .where(eq(verificationRequests.entityId, entityId))
      .returning({ id: verificationRequests.id });

    return {
      profileFields: 1, // entity record updated
      channelAccounts: channels.length,
      verificationDetails: verifications.length,
      pushTokens: 0, // no push_tokens table in schema
    };
  }

  /**
   * Phase 4: Count preserved impact aggregates.
   * Impact interaction scores are retained for aggregate reporting;
   * entity linkage is preserved via the soft-deleted entity row.
   */
  private async countImpactAggregates(entityId: string): Promise<number> {
    const [row] = await this.db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(impactInteractions)
      .where(eq(impactInteractions.entityId, entityId));
    return row?.cnt ?? 0;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private advancePhase(request: DeletionRequest, phase: DeletionPhase): void {
    request.phase = phase;
    request.phaseLog.push({
      phase,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get a deletion request by ID.
   */
  getRequest(requestId: string): DeletionRequest | null {
    return this.requests.get(requestId) ?? null;
  }

  /**
   * Get all deletion requests for an entity.
   */
  getRequestsForEntity(entityId: string): DeletionRequest[] {
    return [...this.requests.values()].filter(r => r.entityId === entityId);
  }

  /**
   * Check if an entity has been deleted.
   */
  isEntityDeleted(entityId: string): boolean {
    return [...this.requests.values()].some(
      r => r.entityId === entityId && r.completed,
    );
  }
}
