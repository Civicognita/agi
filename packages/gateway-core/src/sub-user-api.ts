/**
 * Sub-User API — endpoints for managing sub-users (tenants) and visitors.
 *
 * Sub-users are local accounts on the node with entity, GEID, and
 * dashboard user accounts. Visitors are federated users who authenticate
 * via GEID challenge-response.
 */

import type { FastifyInstance } from "fastify";
import type { IdentityProvider } from "./identity-provider.js";
import type { VisitorAuthManager } from "./visitor-auth.js";
import type { DashboardUserStore, DashboardRole } from "./dashboard-user-store.js";
import { createComponentLogger } from "./logger.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubUserApiDeps {
  identityProvider: IdentityProvider;
  visitorAuth: VisitorAuthManager | null;
  dashboardUserStore: DashboardUserStore | null;
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerSubUserRoutes(
  fastify: FastifyInstance,
  deps: SubUserApiDeps,
): void {
  const log = createComponentLogger(deps.logger, "sub-user-api");
  const { identityProvider, visitorAuth, dashboardUserStore } = deps;

  // -----------------------------------------------------------------------
  // POST /api/sub-users — create a sub-user (tenant)
  //
  // Phase 3: routes through Local-ID when available, creating user + entity
  // + GEID in a single operation. Falls back to IdentityProvider +
  // DashboardUserStore when Local-ID is unavailable.
  // -----------------------------------------------------------------------

  fastify.post<{
    Body: {
      displayName: string;
      username: string;
      password: string;
      role?: DashboardRole;
    };
  }>("/api/sub-users", async (request, reply) => {
    const { displayName, username, password, role } = request.body;

    if (!displayName?.trim() || !username?.trim() || !password) {
      return reply.code(400).send({ error: "displayName, username, and password are required" });
    }

    const identity = await identityProvider.createEntityWithIdentity({
      displayName: displayName.trim(),
    });

    let dashboardUser = null;
    if (dashboardUserStore) {
      try {
        dashboardUser = dashboardUserStore.createUser({
          username: username.trim(),
          displayName: displayName.trim(),
          password,
          role: role ?? "viewer",
        });
      } catch (err) {
        return reply.code(409).send({
          error: err instanceof Error ? err.message : "Failed to create dashboard user",
        });
      }
    }

    log.info(`Sub-user created (legacy): ${identity.entityId} (${displayName})`);

    return reply.code(201).send({
      entityId: identity.entityId,
      geid: identity.geid,
      address: identity.address,
      dashboardUser,
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/sub-users — list sub-users
  // -----------------------------------------------------------------------

  fastify.get("/api/sub-users", async (_request, reply) => {
    if (!dashboardUserStore) {
      return reply.send({ users: [] });
    }
    const users = dashboardUserStore.listUsers();
    return reply.send({ users });
  });

  // -----------------------------------------------------------------------
  // POST /api/visitor/challenge — issue a challenge for visitor auth
  // -----------------------------------------------------------------------

  fastify.post<{
    Body: { geid: string; homeNodeId: string };
  }>("/api/visitor/challenge", async (request, reply) => {
    if (!visitorAuth) {
      return reply.code(501).send({ error: "Visitor authentication not enabled" });
    }

    const { geid, homeNodeId } = request.body;
    if (!geid || !homeNodeId) {
      return reply.code(400).send({ error: "geid and homeNodeId are required" });
    }

    const challenge = visitorAuth.issueChallenge(geid, homeNodeId);
    if (!challenge) {
      return reply.code(400).send({ error: "Invalid GEID format" });
    }

    return reply.send({
      challenge: challenge.challenge,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/visitor/verify — verify visitor challenge response
  // -----------------------------------------------------------------------

  fastify.post<{
    Body: { challenge: string; signature: string };
  }>("/api/visitor/verify", async (request, reply) => {
    if (!visitorAuth) {
      return reply.code(501).send({ error: "Visitor authentication not enabled" });
    }

    const { challenge, signature } = request.body;
    if (!challenge || !signature) {
      return reply.code(400).send({ error: "challenge and signature are required" });
    }

    const result = visitorAuth.verifyChallenge(challenge, signature);
    if (!result) {
      return reply.code(401).send({ error: "Authentication failed" });
    }

    log.info(`Visitor authenticated: ${result.session.geid} from ${result.session.homeNodeId}`);

    return reply.send({
      authenticated: true,
      token: result.token,
      geid: result.session.geid,
      homeNodeId: result.session.homeNodeId,
      expiresAt: new Date(result.session.expiresAt).toISOString(),
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/visitor/session — verify current visitor session
  // -----------------------------------------------------------------------

  fastify.get("/api/visitor/session", async (request, reply) => {
    if (!visitorAuth) {
      return reply.code(501).send({ error: "Visitor authentication not enabled" });
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing authorization header" });
    }

    const token = authHeader.slice(7);
    const session = visitorAuth.verifySession(token);
    if (!session) {
      return reply.code(401).send({ error: "Invalid or expired session" });
    }

    return reply.send({
      geid: session.geid,
      homeNodeId: session.homeNodeId,
      role: session.role,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  });
}
