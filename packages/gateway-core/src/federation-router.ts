/**
 * Federation Endpoint Router & Middleware — Task #198
 *
 * Routes all /fed/v1/* requests through federation middleware.
 * Provides signature verification, trust-level gating, rate limiting,
 * and audit logging for all federation interactions.
 *
 * This is a framework-agnostic router that works with any HTTP handler.
 * The gateway's HTTP server calls `handleFederationRequest()` for all
 * requests under /fed/v1/.
 */

import { createHash } from "node:crypto";

import type {
  FederationError,
  FederationErrorCode,
  HandshakeRequest,
  TrustLevel,
  EntityLookupResponse,
  COARelayRequest,
  COARelayResponse,
  RingAnnounceRequest,
  RingAnnounceResponse,
} from "./federation-types.js";
import type { FederationNode } from "./federation-node.js";
import {
  handleHandshakeRequest,
} from "./federation-handshake.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FederationRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  headers: Record<string, string | undefined>;
  body?: string;
  /** Peer IP for rate limiting. */
  remoteAddr?: string;
}

export interface FederationResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface FederationRouterConfig {
  /** Requests per minute per peer node. */
  rateLimitPerMinute?: number;
  /** Enable audit logging. */
  auditLog?: boolean;
}

export interface AuditLogEntry {
  timestamp: string;
  peerNodeId: string | null;
  method: string;
  path: string;
  status: number;
  trustLevel: TrustLevel | null;
  durationMs: number;
}

/** Callback for entity lookups (implemented by entity-model layer). */
export interface FederationEntityLookup {
  lookupByGEID(geid: string): Promise<EntityLookupResponse | null>;
}

/** Callback for COA relay (implemented by coa-chain layer). */
export interface FederationCOARelay {
  submitRelayRecords(request: COARelayRequest): Promise<COARelayResponse>;
}

/** Callback for COA chain retrieval (GET /fed/v1/coa/:fingerprint). */
export interface FederationCOAChainLookup {
  getChain(fingerprint: string, limit: number, offset: number): Promise<{
    ok: boolean;
    status?: number;
    data?: unknown;
    error?: { code: string; message: string };
  }>;
}

/** Callback for co-verification (POST /fed/v1/peer/verify). */
export interface FederationCoVerification {
  handleVerifyRequest(body: unknown, verifierNodeId: string): Promise<{
    ok: boolean;
    data?: unknown;
    error?: { code: string; message: string };
  }>;
}

/** Callback for governance operations. */
export interface FederationGovernance {
  handleVote(body: unknown): Promise<{
    ok: boolean;
    status: number;
    data?: unknown;
    error?: { code: string; message: string };
  }>;
  handleListActive(): Promise<{
    ok: boolean;
    status: number;
    data: unknown;
  }>;
  handleEmergencySession?(body: unknown): Promise<{
    ok: boolean;
    status: number;
    data?: unknown;
    error?: { code: string; message: string };
  }>;
}

/** Callback for EntityMap retrieval. */
export interface FederationEntityMapProvider {
  getEntityMap(geid: string): Promise<{ found: boolean; entityMap?: unknown } | null>;
}

// ---------------------------------------------------------------------------
// Rate limiter (simple sliding window per peer)
// ---------------------------------------------------------------------------

interface RateWindow {
  count: number;
  resetAt: number;
}

// ---------------------------------------------------------------------------
// Federation Router
// ---------------------------------------------------------------------------

/**
 * Framework-agnostic federation endpoint router.
 *
 * Handles all /fed/v1/* requests with:
 * - Mycelium-Sig signature verification
 * - Trust-level gating per endpoint
 * - Per-peer rate limiting
 * - Audit logging
 */
export class FederationRouter {
  private readonly node: FederationNode;
  private readonly config: Required<FederationRouterConfig>;
  private readonly rateWindows = new Map<string, RateWindow>();
  private readonly auditLog: AuditLogEntry[] = [];
  private entityLookup: FederationEntityLookup | null = null;
  private coaRelay: FederationCOARelay | null = null;
  private coaChainLookup: FederationCOAChainLookup | null = null;
  private coVerification: FederationCoVerification | null = null;
  private governance: FederationGovernance | null = null;
  private entityMapProvider: FederationEntityMapProvider | null = null;

  constructor(node: FederationNode, config?: FederationRouterConfig) {
    this.node = node;
    this.config = {
      rateLimitPerMinute: config?.rateLimitPerMinute ?? 60,
      auditLog: config?.auditLog ?? true,
    };
  }

  /**
   * Register the entity lookup handler.
   */
  setEntityLookup(handler: FederationEntityLookup): void {
    this.entityLookup = handler;
  }

  /**
   * Register the COA relay handler.
   */
  setCOARelay(handler: FederationCOARelay): void {
    this.coaRelay = handler;
  }

  /**
   * Register the COA chain retrieval handler.
   */
  setCOAChainLookup(handler: FederationCOAChainLookup): void {
    this.coaChainLookup = handler;
  }

  /**
   * Register the co-verification handler.
   */
  setCoVerification(handler: FederationCoVerification): void {
    this.coVerification = handler;
  }

  /**
   * Register the governance handler.
   */
  setGovernance(handler: FederationGovernance): void {
    this.governance = handler;
  }

  /**
   * Register the EntityMap provider.
   */
  setEntityMapProvider(handler: FederationEntityMapProvider): void {
    this.entityMapProvider = handler;
  }

  /**
   * Main request handler. Call this for all /fed/v1/* requests.
   */
  async handleRequest(req: FederationRequest): Promise<FederationResponse> {
    const startTime = Date.now();
    let peerNodeId: string | null = null;
    let trustLevel: TrustLevel | null = null;

    try {
      // Strip /fed/v1 prefix to get the route
      const route = req.path.replace(/^\/fed\/v1/, "") || "/";

      // /.well-known/mycelium-node.json — no auth required
      if (req.path === "/.well-known/mycelium-node.json" && req.method === "GET") {
        return this.handleManifestRequest();
      }

      // /fed/v1/node — public node info (no auth)
      if (route === "/node" && req.method === "GET") {
        return this.handleManifestRequest();
      }

      // /fed/v1/peer/hello — handshake (partial auth — we verify inline)
      if (route === "/peer/hello" && req.method === "POST") {
        return this.handleHandshake(req);
      }

      // All other endpoints require full signature verification
      const authResult = this.verifyAuth(req);
      if (!authResult.valid) {
        return this.errorResponse(401, authResult.errorCode ?? "INVALID_SIGNATURE", authResult.error ?? "Authentication failed");
      }
      peerNodeId = authResult.nodeId ?? null;
      trustLevel = authResult.trustLevel ?? null;

      // Rate limiting
      if (peerNodeId) {
        const rateLimited = this.checkRateLimit(peerNodeId);
        if (rateLimited) {
          return this.errorResponse(429, "RATE_LIMITED", "Too many requests");
        }
      }

      // Route to handlers
      switch (true) {
        // GET /fed/v1/peers — list known peers (trust >= 1)
        case route === "/peers" && req.method === "GET":
          return this.requireTrust(trustLevel, 1, () => this.handleListPeers());

        // GET /fed/v1/entities/:geid — entity lookup (trust >= 1)
        case route.startsWith("/entities/") && req.method === "GET":
          return this.requireTrust(trustLevel, 1, () => {
            const geid = route.slice("/entities/".length);
            return this.handleEntityLookup(geid);
          });

        // POST /fed/v1/coa/submit — COA relay (trust >= 2)
        case route === "/coa/submit" && req.method === "POST":
          return this.requireTrust(trustLevel, 2, () => this.handleCOARelay(req));

        // GET /fed/v1/coa/:fingerprint — COA chain retrieval (trust >= 1)
        case route.startsWith("/coa/") && route !== "/coa/submit" && req.method === "GET":
          return this.requireTrust(trustLevel, 1, () => {
            const fingerprint = decodeURIComponent(route.slice("/coa/".length));
            return this.handleCOAChainLookup(fingerprint, req);
          });

        // POST /fed/v1/peer/verify — Co-verification (trust >= 2)
        case route === "/peer/verify" && req.method === "POST":
          return this.requireTrust(trustLevel, 2, () =>
            this.handleCoVerification(req, peerNodeId!),
          );

        // POST /fed/v1/governance/vote — Cross-node vote (trust >= 1)
        case route === "/governance/vote" && req.method === "POST":
          return this.requireTrust(trustLevel, 1, () => this.handleGovernanceVote(req));

        // GET /fed/v1/governance/active — List active proposals (trust >= 1)
        case route === "/governance/active" && req.method === "GET":
          return this.requireTrust(trustLevel, 1, () => this.handleGovernanceList());

        // POST /fed/v1/governance/emergency — Emergency session (trust >= 3)
        case route === "/governance/emergency" && req.method === "POST":
          return this.requireTrust(trustLevel, 3, () => this.handleGovernanceEmergency(req));

        // POST /fed/v1/ring/announce — ring discovery (trust >= 1)
        case route === "/ring/announce" && req.method === "POST":
          return this.requireTrust(trustLevel, 1, () => this.handleRingAnnounce(req));

        // GET /fed/v1/identity/map/:geid — fetch EntityMap (trust >= 1)
        case route.startsWith("/identity/map/") && req.method === "GET":
          return this.requireTrust(trustLevel, 1, () => {
            const geid = route.slice("/identity/map/".length);
            return this.handleEntityMapRequest(geid);
          });

        default:
          return this.errorResponse(404, "PROTOCOL_MISMATCH", `Unknown endpoint: ${req.method} ${route}`);
      }
    } finally {
      if (this.config.auditLog) {
        this.auditLog.push({
          timestamp: new Date().toISOString(),
          peerNodeId,
          method: req.method,
          path: req.path,
          status: 0, // Would be set by the response, simplified here
          trustLevel,
          durationMs: Date.now() - startTime,
        });

        // Keep audit log bounded
        if (this.auditLog.length > 10_000) {
          this.auditLog.splice(0, this.auditLog.length - 5_000);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Route handlers
  // -------------------------------------------------------------------------

  private handleManifestRequest(): FederationResponse {
    return {
      status: 200,
      body: this.node.getManifest(),
      headers: { "content-type": "application/json" },
    };
  }

  private handleHandshake(req: FederationRequest): FederationResponse {
    if (!req.body) {
      return this.errorResponse(400, "HANDSHAKE_FAILED", "Missing request body");
    }

    let request: HandshakeRequest;
    try {
      request = JSON.parse(req.body) as HandshakeRequest;
    } catch {
      return this.errorResponse(400, "HANDSHAKE_FAILED", "Invalid JSON body");
    }

    const sigHeader = req.headers["authorization"] ?? req.headers["mycelium-sig"] ?? "";
    const response = handleHandshakeRequest(this.node, request, sigHeader);

    return {
      status: response.accepted ? 200 : 403,
      body: response,
      headers: { "content-type": "application/json" },
    };
  }

  private handleListPeers(): FederationResponse {
    const peers = this.node.getTrustedPeers(1).map(p => ({
      nodeId: p.nodeId,
      endpoint: p.endpoint,
      trustLevel: p.trustLevel,
      online: p.online,
      lastSeen: p.lastSeen,
    }));

    return {
      status: 200,
      body: { peers },
      headers: { "content-type": "application/json" },
    };
  }

  private async handleEntityLookup(geid: string): Promise<FederationResponse> {
    if (!this.entityLookup) {
      return this.errorResponse(501, "INTERNAL_ERROR", "Entity lookup not configured");
    }

    const result = await this.entityLookup.lookupByGEID(geid);
    if (!result || !result.found) {
      return this.errorResponse(404, "UNKNOWN_ENTITY", `Entity not found: ${geid}`);
    }

    return {
      status: 200,
      body: result,
      headers: { "content-type": "application/json" },
    };
  }

  private async handleCOARelay(req: FederationRequest): Promise<FederationResponse> {
    if (!this.coaRelay) {
      return this.errorResponse(501, "INTERNAL_ERROR", "COA relay not configured");
    }

    if (!req.body) {
      return this.errorResponse(400, "INTERNAL_ERROR", "Missing request body");
    }

    let request: COARelayRequest;
    try {
      request = JSON.parse(req.body) as COARelayRequest;
    } catch {
      return this.errorResponse(400, "INTERNAL_ERROR", "Invalid JSON body");
    }

    const result = await this.coaRelay.submitRelayRecords(request);

    return {
      status: 200,
      body: result,
      headers: { "content-type": "application/json" },
    };
  }

  private async handleCOAChainLookup(fingerprint: string, _req: FederationRequest): Promise<FederationResponse> {
    if (!this.coaChainLookup) {
      return this.errorResponse(501, "INTERNAL_ERROR", "COA chain lookup not configured");
    }

    // Parse query params from path (simple: ?limit=N&offset=M)
    let limit = 100;
    let offset = 0;
    const qIdx = fingerprint.indexOf("?");
    let cleanFingerprint = fingerprint;
    if (qIdx >= 0) {
      const params = new URLSearchParams(fingerprint.slice(qIdx + 1));
      cleanFingerprint = fingerprint.slice(0, qIdx);
      if (params.has("limit")) limit = parseInt(params.get("limit")!, 10) || 100;
      if (params.has("offset")) offset = parseInt(params.get("offset")!, 10) || 0;
    }

    const result = await this.coaChainLookup.getChain(cleanFingerprint, limit, offset);
    if (!result.ok) {
      return {
        status: result.status ?? 500,
        body: { error: result.error },
        headers: { "content-type": "application/json" },
      };
    }

    return {
      status: 200,
      body: result.data,
      headers: { "content-type": "application/json" },
    };
  }

  private async handleCoVerification(req: FederationRequest, verifierNodeId: string): Promise<FederationResponse> {
    if (!this.coVerification) {
      return this.errorResponse(501, "INTERNAL_ERROR", "Co-verification not configured");
    }

    if (!req.body) {
      return this.errorResponse(400, "INTERNAL_ERROR", "Missing request body");
    }

    let body: unknown;
    try {
      body = JSON.parse(req.body);
    } catch {
      return this.errorResponse(400, "INTERNAL_ERROR", "Invalid JSON body");
    }

    const result = await this.coVerification.handleVerifyRequest(body, verifierNodeId);
    if (!result.ok) {
      return {
        status: 400,
        body: { error: result.error },
        headers: { "content-type": "application/json" },
      };
    }

    return {
      status: 200,
      body: result.data,
      headers: { "content-type": "application/json" },
    };
  }

  private async handleGovernanceVote(req: FederationRequest): Promise<FederationResponse> {
    if (!this.governance) {
      return this.errorResponse(501, "INTERNAL_ERROR", "Governance not configured");
    }
    if (!req.body) {
      return this.errorResponse(400, "INTERNAL_ERROR", "Missing request body");
    }
    let body: unknown;
    try { body = JSON.parse(req.body); } catch { return this.errorResponse(400, "INTERNAL_ERROR", "Invalid JSON"); }

    const result = await this.governance.handleVote(body);
    return {
      status: result.status,
      body: result.ok ? result.data : { error: result.error },
      headers: { "content-type": "application/json" },
    };
  }

  private async handleGovernanceList(): Promise<FederationResponse> {
    if (!this.governance) {
      return this.errorResponse(501, "INTERNAL_ERROR", "Governance not configured");
    }
    const result = await this.governance.handleListActive();
    return {
      status: result.status,
      body: result.data,
      headers: { "content-type": "application/json" },
    };
  }

  private async handleGovernanceEmergency(req: FederationRequest): Promise<FederationResponse> {
    if (!this.governance?.handleEmergencySession) {
      return this.errorResponse(501, "INTERNAL_ERROR", "Emergency sessions not configured");
    }
    if (!req.body) {
      return this.errorResponse(400, "INTERNAL_ERROR", "Missing request body");
    }
    let body: unknown;
    try { body = JSON.parse(req.body); } catch { return this.errorResponse(400, "INTERNAL_ERROR", "Invalid JSON"); }

    const result = await this.governance.handleEmergencySession(body);
    return {
      status: result.status,
      body: result.ok ? result.data : { error: result.error },
      headers: { "content-type": "application/json" },
    };
  }

  private handleRingAnnounce(req: FederationRequest): FederationResponse {
    if (!req.body) {
      return this.errorResponse(400, "INTERNAL_ERROR", "Missing request body");
    }

    let request: RingAnnounceRequest;
    try {
      request = JSON.parse(req.body) as RingAnnounceRequest;
    } catch {
      return this.errorResponse(400, "INTERNAL_ERROR", "Invalid JSON body");
    }

    // Register any new peers from the announcement
    for (const peer of request.knownPeers) {
      if (!this.node.getPeer(peer.nodeId) && peer.nodeId !== this.node.getNodeId()) {
        try {
          this.node.addPeer(peer.nodeId, peer.endpoint, "", "peer-of-peer", 0);
        } catch {
          // Max peers reached — skip
        }
      }
    }

    // Return our known peers
    const myPeers = this.node.getTrustedPeers(1).map(p => ({
      nodeId: p.nodeId,
      endpoint: p.endpoint,
      trustLevel: p.trustLevel,
    }));

    const response: RingAnnounceResponse = {
      accepted: true,
      knownPeers: myPeers,
    };

    return {
      status: 200,
      body: response,
      headers: { "content-type": "application/json" },
    };
  }

  private async handleEntityMapRequest(geid: string): Promise<FederationResponse> {
    if (!this.entityMapProvider) {
      return this.errorResponse(501, "INTERNAL_ERROR", "EntityMap provider not configured");
    }

    const result = await this.entityMapProvider.getEntityMap(geid);
    if (!result || !result.found) {
      return this.errorResponse(404, "UNKNOWN_ENTITY", `EntityMap not found: ${geid}`);
    }

    return {
      status: 200,
      body: result.entityMap,
      headers: { "content-type": "application/json" },
    };
  }

  // -------------------------------------------------------------------------
  // Auth middleware
  // -------------------------------------------------------------------------

  private verifyAuth(req: FederationRequest): {
    valid: boolean;
    nodeId?: string;
    trustLevel?: TrustLevel;
    error?: string;
    errorCode?: FederationErrorCode;
  } {
    const sigHeader = req.headers["authorization"] ?? req.headers["mycelium-sig"];
    if (!sigHeader) {
      return { valid: false, error: "Missing Mycelium-Sig header", errorCode: "INVALID_SIGNATURE" };
    }

    const bodyHash = hashBody(req.body ?? "");
    const result = this.node.parseSigHeader(sigHeader, bodyHash);

    if (!result) {
      return { valid: false, error: "Malformed Mycelium-Sig header", errorCode: "INVALID_SIGNATURE" };
    }

    if (!result.valid) {
      // Check if it's a replay
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - result.timestamp) > 60) {
        return { valid: false, nodeId: result.nodeId, error: "Signature expired (replay window)", errorCode: "REPLAY_DETECTED" };
      }
      return { valid: false, nodeId: result.nodeId, error: "Invalid signature", errorCode: "INVALID_SIGNATURE" };
    }

    const peer = this.node.getPeer(result.nodeId);
    if (!peer) {
      return { valid: false, nodeId: result.nodeId, error: "Unknown node", errorCode: "UNTRUSTED_NODE" };
    }

    return { valid: true, nodeId: result.nodeId, trustLevel: peer.trustLevel };
  }

  // -------------------------------------------------------------------------
  // Trust gating
  // -------------------------------------------------------------------------

  private requireTrust<T>(
    currentTrust: TrustLevel | null,
    requiredTrust: TrustLevel,
    handler: () => T,
  ): T | FederationResponse {
    if (currentTrust === null || currentTrust < requiredTrust) {
      return this.errorResponse(403, "UNTRUSTED_NODE", `Requires trust level ${requiredTrust}, current: ${currentTrust ?? 0}`);
    }
    return handler();
  }

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  private checkRateLimit(nodeId: string): boolean {
    const now = Date.now();
    const window = this.rateWindows.get(nodeId);

    if (!window || now > window.resetAt) {
      this.rateWindows.set(nodeId, { count: 1, resetAt: now + 60_000 });
      return false;
    }

    window.count++;
    return window.count > this.config.rateLimitPerMinute;
  }

  // -------------------------------------------------------------------------
  // Audit log access
  // -------------------------------------------------------------------------

  /**
   * Get recent audit log entries.
   */
  getAuditLog(limit = 100): AuditLogEntry[] {
    return this.auditLog.slice(-limit);
  }

  /**
   * Clear the audit log.
   */
  clearAuditLog(): void {
    this.auditLog.length = 0;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private errorResponse(status: number, code: FederationErrorCode, message: string): FederationResponse {
    const error: FederationError = { code, message };
    return {
      status,
      body: { error },
      headers: { "content-type": "application/json" },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}
