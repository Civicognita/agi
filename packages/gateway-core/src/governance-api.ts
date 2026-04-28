/**
 * Governance API Endpoints for Federation — Task #209
 *
 * POST /fed/v1/governance/vote — Cast cross-node vote with tier proof
 * GET /fed/v1/governance/active — List active proposals across federation
 *
 * Cross-node vote aggregation with co-verification.
 * Anchor node emergency session endpoint.
 */

import type { GovernanceTier } from "@agi/entity-model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cross-node vote request (POST /fed/v1/governance/vote). */
export interface CrossNodeVoteRequest {
  proposalId: string;
  /** GEID of the voter. */
  voterGeid: string;
  /** Voter's governance tier on the source node. */
  voterTier: GovernanceTier;
  vote: "approve" | "reject" | "abstain";
  /** Ed25519 signature over vote content. */
  signature: string;
  /** Source node ID. */
  sourceNode: string;
  /** Tier proof: co-verification IDs that confirm the voter's tier. */
  tierProofs: string[];
}

/** Cross-node vote response. */
export interface CrossNodeVoteResponse {
  accepted: boolean;
  voteId: string | null;
  reason?: string;
}

/** Active proposal listing (GET /fed/v1/governance/active). */
export interface ActiveProposalEntry {
  proposalId: string;
  type: number;
  title: string;
  originNode: string;
  status: string;
  closesAt: string | null;
  voteSummary: {
    totalVotes: number;
    approvals: number;
    rejections: number;
  };
}

/** Active proposals response. */
export interface ActiveProposalsResponse {
  proposals: ActiveProposalEntry[];
  nodeId: string;
  timestamp: string;
}

/** Emergency session request (Anchor nodes only). */
export interface EmergencySessionRequest {
  initiatorNode: string;
  reason: string;
  proposalDraft: {
    title: string;
    description: string;
  };
  /** Signatures from anchor nodes authorizing the emergency. */
  anchorSignatures: Array<{
    nodeId: string;
    signature: string;
  }>;
}

/** Emergency session response. */
export interface EmergencySessionResponse {
  sessionId: string;
  proposalId: string;
  accepted: boolean;
  expiresAt: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Governance API Handler
// ---------------------------------------------------------------------------

/** Dependencies for the governance API. */
export interface GovernanceApiDeps {
  /** Validate a cross-node vote and record it. */
  validateAndRecordVote(request: CrossNodeVoteRequest): Promise<CrossNodeVoteResponse>;
  /** List active proposals. */
  listActiveProposals(): Promise<ActiveProposalEntry[]>;
  /** Handle emergency session request. */
  handleEmergencySession?(request: EmergencySessionRequest): Promise<EmergencySessionResponse>;
  /** Get the local node ID. */
  getNodeId(): string;
}

/**
 * Governance API handler for federation endpoints.
 *
 * Called by FederationRouter for governance-related requests.
 */
export class GovernanceApi {
  constructor(private readonly deps: GovernanceApiDeps) {}

  /**
   * Handle POST /fed/v1/governance/vote
   *
   * Validates tier proof, records the cross-node vote.
   */
  async handleVote(body: unknown): Promise<{
    ok: boolean;
    status: number;
    data?: CrossNodeVoteResponse;
    error?: { code: string; message: string };
  }> {
    if (!body || typeof body !== "object") {
      return {
        ok: false,
        status: 400,
        error: { code: "INVALID_REQUEST", message: "Missing request body" },
      };
    }

    const request = body as CrossNodeVoteRequest;

    // Basic validation
    if (!request.proposalId || !request.voterGeid || !request.vote) {
      return {
        ok: false,
        status: 400,
        error: { code: "INVALID_REQUEST", message: "Missing required fields: proposalId, voterGeid, vote" },
      };
    }

    if (!["approve", "reject", "abstain"].includes(request.vote)) {
      return {
        ok: false,
        status: 400,
        error: { code: "INVALID_REQUEST", message: "Invalid vote value" },
      };
    }

    const result = await this.deps.validateAndRecordVote(request);

    return {
      ok: result.accepted,
      status: result.accepted ? 200 : 403,
      data: result,
    };
  }

  /**
   * Handle GET /fed/v1/governance/active
   *
   * Returns active proposals across the federation.
   */
  async handleListActive(): Promise<{
    ok: boolean;
    status: number;
    data: ActiveProposalsResponse;
  }> {
    const proposals = await this.deps.listActiveProposals();

    return {
      ok: true,
      status: 200,
      data: {
        proposals,
        nodeId: this.deps.getNodeId(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Handle POST /fed/v1/governance/emergency
   *
   * Anchor-only emergency session creation.
   */
  async handleEmergencySession(body: unknown): Promise<{
    ok: boolean;
    status: number;
    data?: EmergencySessionResponse;
    error?: { code: string; message: string };
  }> {
    if (!this.deps.handleEmergencySession) {
      return {
        ok: false,
        status: 501,
        error: { code: "NOT_IMPLEMENTED", message: "Emergency sessions not supported on this node" },
      };
    }

    if (!body || typeof body !== "object") {
      return {
        ok: false,
        status: 400,
        error: { code: "INVALID_REQUEST", message: "Missing request body" },
      };
    }

    const request = body as EmergencySessionRequest;

    if (!request.initiatorNode || !request.reason || !request.proposalDraft) {
      return {
        ok: false,
        status: 400,
        error: { code: "INVALID_REQUEST", message: "Missing required fields" },
      };
    }

    const result = await this.deps.handleEmergencySession(request);

    return {
      ok: result.accepted,
      status: result.accepted ? 200 : 403,
      data: result,
    };
  }
}
