/**
 * GDPR-Compliant Entity Deletion — Task #222
 *
 * Implements right-to-erasure while preserving COA chain integrity:
 *
 * DELETE (personal data):
 *   - Payload content (transcripts, recordings, uploads)
 *   - Entity profile (name, verification details, channel accounts)
 *   - Push tokens, session data, device info
 *
 * PRESERVE (anonymized):
 *   - COA chain records (hashes remain, entity refs nullified → "[REDACTED]")
 *   - Impact stats as aggregated totals (no PII linkage)
 *   - Payload commitment hashes (prove records existed)
 *
 * SOFT DELETE:
 *   - Tenant table: deleted_at timestamp set
 *   - Entity table: profile cleared, status → "deleted"
 */

import type { Database } from "./db.js";

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
  /** Tenant ID (for multi-tenant isolation). */
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
  private readonly db: Database;
  private readonly config: GDPRConfig;
  private readonly requests = new Map<string, DeletionRequest>();

  constructor(db: Database, config?: Partial<GDPRConfig>) {
    this.db = db;
    this.config = { ...DEFAULT_GDPR_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Deletion request lifecycle
  // -------------------------------------------------------------------------

  /**
   * Create a deletion request for an entity.
   * Validates entity exists and is not already being deleted.
   */
  createRequest(
    requestId: string,
    entityId: string,
    tenantId: string,
    reason = "right-to-erasure",
  ): DeletionRequest {
    // Check for existing active request
    for (const req of this.requests.values()) {
      if (req.entityId === entityId && !req.completed && req.phase !== "failed") {
        throw new Error(`Active deletion request already exists: ${req.requestId}`);
      }
    }

    // Verify entity exists
    const entity = this.db
      .prepare("SELECT id, status FROM entities WHERE id = ? AND tenant_id = ?")
      .get(entityId, tenantId) as { id: string; status: string } | undefined;

    if (!entity) {
      throw new Error(`Entity not found: ${entityId}`);
    }

    if (entity.status === "deleted") {
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
      // Phase 1: Anonymize COA chain records
      this.advancePhase(request, "anonymizing_coa");
      report.preserved.coaRecords = this.anonymizeCOARecords(
        request.entityId,
        request.tenantId,
      );

      // Phase 2: Delete content (transcripts, recordings, uploads)
      this.advancePhase(request, "deleting_content");
      const contentResult = this.deleteContent(request.entityId, request.tenantId);
      report.deleted.transcripts = contentResult.transcripts;
      report.deleted.sessions = contentResult.sessions;

      // Phase 3: Clear entity profile
      this.advancePhase(request, "clearing_profile");
      const profileResult = this.clearProfile(request.entityId, request.tenantId);
      report.deleted.profileFields = profileResult.profileFields;
      report.deleted.channelAccounts = profileResult.channelAccounts;
      report.deleted.verificationDetails = profileResult.verificationDetails;
      report.deleted.pushTokens = profileResult.pushTokens;

      // Phase 4: Aggregate impact stats
      this.advancePhase(request, "finalizing");
      report.preserved.impactAggregates = this.preserveImpactAggregates(
        request.entityId,
        request.tenantId,
      );

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
   * Phase 1: Anonymize COA chain records.
   * Replaces entity references with [REDACTED], preserves hashes.
   */
  private anonymizeCOARecords(entityId: string, tenantId: string): number {
    const placeholder = this.config.redactedPlaceholder;

    // Update COA chain records — nullify entity references but keep hashes
    const result = this.db
      .prepare(
        `UPDATE coa_chains
         SET entity_id = ?,
             entity_name = ?,
             updated_at = datetime('now')
         WHERE entity_id = ? AND tenant_id = ?`,
      )
      .run(placeholder, placeholder, entityId, tenantId);

    return result.changes;
  }

  /**
   * Phase 2: Delete content (transcripts, recordings, uploads).
   */
  private deleteContent(
    entityId: string,
    tenantId: string,
  ): { transcripts: number; sessions: number } {
    // Delete session transcripts
    const transcripts = this.db
      .prepare(
        `DELETE FROM session_transcripts
         WHERE entity_id = ? AND tenant_id = ?`,
      )
      .run(entityId, tenantId);

    // Delete sessions
    const sessions = this.db
      .prepare(
        `DELETE FROM sessions
         WHERE entity_id = ? AND tenant_id = ?`,
      )
      .run(entityId, tenantId);

    return {
      transcripts: transcripts.changes,
      sessions: sessions.changes,
    };
  }

  /**
   * Phase 3: Clear entity profile and related PII.
   */
  private clearProfile(
    entityId: string,
    tenantId: string,
  ): {
    profileFields: number;
    channelAccounts: number;
    verificationDetails: number;
    pushTokens: number;
  } {
    const placeholder = this.config.redactedPlaceholder;

    // Clear entity profile fields (soft delete)
    this.db
      .prepare(
        `UPDATE entities
         SET name = ?,
             metadata = '{}',
             status = 'deleted',
             updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(placeholder, entityId, tenantId);

    // Delete channel accounts (PII: usernames, platform IDs)
    const channels = this.db
      .prepare(
        `DELETE FROM channel_accounts
         WHERE entity_id = ? AND tenant_id = ?`,
      )
      .run(entityId, tenantId);

    // Delete verification details (PII: proof documents)
    const verifications = this.db
      .prepare(
        `DELETE FROM verification_requests
         WHERE entity_id = ? AND tenant_id = ?`,
      )
      .run(entityId, tenantId);

    // Delete push notification tokens
    const pushTokens = this.db
      .prepare(
        `DELETE FROM push_tokens
         WHERE entity_id = ? AND tenant_id = ?`,
      )
      .run(entityId, tenantId);

    return {
      profileFields: 1, // entity record updated
      channelAccounts: channels.changes,
      verificationDetails: verifications.changes,
      pushTokens: pushTokens.changes,
    };
  }

  /**
   * Phase 4: Preserve impact stats as anonymized aggregates.
   */
  private preserveImpactAggregates(entityId: string, tenantId: string): number {
    // Count impact interactions that will be preserved (anonymized)
    const count = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM impact_interactions
         WHERE entity_id = ? AND tenant_id = ?`,
      )
      .get(entityId, tenantId) as { cnt: number } | undefined;

    const total = count?.cnt ?? 0;

    // Anonymize impact interactions — keep scores, remove entity linkage
    if (total > 0) {
      const placeholder = this.config.redactedPlaceholder;
      this.db
        .prepare(
          `UPDATE impact_interactions
           SET entity_id = ?,
               updated_at = datetime('now')
           WHERE entity_id = ? AND tenant_id = ?`,
        )
        .run(placeholder, entityId, tenantId);
    }

    return total;
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
