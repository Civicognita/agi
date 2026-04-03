/**
 * COA Chain Retrieval API — Task #201
 *
 * Provides the handler for GET /fed/v1/coa/{fingerprint} which returns
 * the full hash chain from C001 through the requested record, including
 * hashes and node signatures for each record.
 *
 * Features:
 * - Trust-level gating (Level 1+ peers only, enforced by FederationRouter)
 * - Pagination for long chains
 * - Entity consent check before sharing chain data
 */

import type { HashedCOARecord } from "./hash-chain.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Storage interface — implemented by the persistence layer. */
export interface COAChainStore {
  /**
   * Get the full hash chain for an entity up to (and including) the
   * specified fingerprint. Records are ordered oldest-first.
   *
   * @param fingerprint - Target fingerprint (e.g. "$A0.#E0.@A0.C010")
   * @param limit - Max records to return (pagination)
   * @param offset - Records to skip (pagination)
   * @returns Array of hashed COA records, or null if fingerprint not found
   */
  getChainUpTo(
    fingerprint: string,
    limit: number,
    offset: number,
  ): Promise<HashedCOARecord[] | null>;

  /**
   * Get a single hashed COA record by fingerprint.
   */
  getRecord(fingerprint: string): Promise<HashedCOARecord | null>;

  /**
   * Get the total record count for the chain containing this fingerprint.
   */
  getChainLength(fingerprint: string): Promise<number>;
}

/** Consent checker — verifies entity allows chain sharing. */
export interface EntityConsentChecker {
  /**
   * Check whether the entity that owns this fingerprint consents
   * to sharing their COA chain data with federated peers.
   *
   * @param fingerprint - The target fingerprint
   * @returns true if sharing is permitted
   */
  isShareable(fingerprint: string): Promise<boolean>;
}

/** API request for chain retrieval. */
export interface COAChainRequest {
  fingerprint: string;
  limit?: number;
  offset?: number;
}

/** API response for chain retrieval. */
export interface COAChainResponse {
  fingerprint: string;
  chain: HashedCOARecord[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/** Error response from chain API. */
export interface COAChainError {
  code: "NOT_FOUND" | "CONSENT_DENIED" | "INVALID_REQUEST" | "INTERNAL_ERROR";
  message: string;
}

/** Result union for API handler. */
export type COAChainResult =
  | { ok: true; data: COAChainResponse }
  | { ok: false; status: number; error: COAChainError };

// ---------------------------------------------------------------------------
// API Handler
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

/**
 * Handle a COA chain retrieval request.
 *
 * This is called by the FederationRouter for
 * GET /fed/v1/coa/{fingerprint}.
 *
 * The router handles trust-level gating (Level 1+); this handler
 * focuses on consent, retrieval, and pagination.
 */
export async function handleCOAChainRequest(
  request: COAChainRequest,
  store: COAChainStore,
  consent: EntityConsentChecker,
): Promise<COAChainResult> {
  const { fingerprint } = request;

  if (!fingerprint || fingerprint.split(".").length < 4) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid fingerprint format",
      },
    };
  }

  // Check entity consent
  const allowed = await consent.isShareable(fingerprint);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: {
        code: "CONSENT_DENIED",
        message: "Entity has not consented to COA chain sharing",
      },
    };
  }

  // Validate pagination
  const limit = Math.min(Math.max(request.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(request.offset ?? 0, 0);

  // Get chain
  const chain = await store.getChainUpTo(fingerprint, limit, offset);
  if (chain === null) {
    return {
      ok: false,
      status: 404,
      error: {
        code: "NOT_FOUND",
        message: `COA record not found: ${fingerprint}`,
      },
    };
  }

  const total = await store.getChainLength(fingerprint);

  return {
    ok: true,
    data: {
      fingerprint,
      chain,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    },
  };
}
