/**
 * Identity API Routes — REST endpoints for local identity management.
 *
 * Provides:
 * - GET /api/identity/:entityId — get entity identity info
 * - GET /api/identity/resolve/:geid — resolve entity by GEID
 * - POST /api/auth/start/:provider — start OAuth flow
 * - GET /api/auth/callback/:provider — OAuth callback
 * - GET /api/auth/providers — list available OAuth providers
 */

import type { FastifyInstance } from "fastify";
import type { IdentityProvider } from "./identity-provider.js";
import type { OAuthHandler } from "./oauth-handler.js";
import { createComponentLogger } from "./logger.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface IdentityApiDeps {
  identityProvider: IdentityProvider;
  oauthHandler: OAuthHandler | null;
  logger?: Logger;
}

export function registerIdentityRoutes(
  fastify: FastifyInstance,
  deps: IdentityApiDeps,
): void {
  const log = createComponentLogger(deps.logger, "identity-api");
  const { identityProvider, oauthHandler } = deps;

  // -----------------------------------------------------------------------
  // GET /api/identity/:entityId — get identity info
  // -----------------------------------------------------------------------

  fastify.get<{ Params: { entityId: string } }>(
    "/api/identity/:entityId",
    async (request, reply) => {
      const identity = identityProvider.getIdentity(request.params.entityId);
      if (!identity) {
        return reply.code(404).send({ error: "Entity not found or has no identity" });
      }
      return reply.send(identity);
    },
  );

  // -----------------------------------------------------------------------
  // GET /api/identity/resolve/:geid — resolve by GEID
  // -----------------------------------------------------------------------

  fastify.get<{ Params: { geid: string } }>(
    "/api/identity/resolve/:geid",
    async (request, reply) => {
      const identity = identityProvider.resolveByGeid(decodeURIComponent(request.params.geid));
      if (!identity) {
        return reply.code(404).send({ error: "Entity not found for GEID" });
      }
      return reply.send(identity);
    },
  );

  // -----------------------------------------------------------------------
  // GET /api/auth/providers — list available OAuth providers
  // -----------------------------------------------------------------------

  fastify.get("/api/auth/providers", async (_request, reply) => {
    const providers = oauthHandler?.getAvailableProviders() ?? [];
    return reply.send({ providers });
  });

  // -----------------------------------------------------------------------
  // POST /api/auth/start/:provider — start OAuth flow
  // -----------------------------------------------------------------------

  fastify.post<{ Params: { provider: string } }>(
    "/api/auth/start/:provider",
    async (request, reply) => {
      if (!oauthHandler) {
        return reply.code(501).send({ error: "OAuth not configured" });
      }

      const result = oauthHandler.startFlow(request.params.provider);
      if (!result) {
        return reply.code(400).send({ error: `Unsupported provider: ${request.params.provider}` });
      }

      log.info(`OAuth flow started for ${request.params.provider}`);
      return reply.send({ authUrl: result.authUrl });
    },
  );

  // -----------------------------------------------------------------------
  // GET /api/auth/callback/:provider — OAuth callback
  // -----------------------------------------------------------------------

  fastify.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string } }>(
    "/api/auth/callback/:provider",
    async (request, reply) => {
      if (!oauthHandler) {
        return reply.code(501).send({ error: "OAuth not configured" });
      }

      const { code, state } = request.query;
      if (!code || !state) {
        return reply.code(400).send({ error: "Missing code or state parameter" });
      }

      const userInfo = await oauthHandler.handleCallback(
        request.params.provider,
        code,
        state,
      );

      if (!userInfo) {
        return reply.code(401).send({ error: "OAuth authentication failed" });
      }

      // Create or resolve entity for this OAuth user
      const entity = await identityProvider.createEntityWithIdentity({
        displayName: userInfo.displayName ?? userInfo.email ?? "Unknown",
      });

      // Bind the OAuth identity
      await identityProvider.bindOAuthIdentity(
        entity.entityId,
        userInfo.provider,
        userInfo.providerUserId,
      );

      log.info(`OAuth identity bound: ${userInfo.provider}:${userInfo.providerUserId} -> ${entity.entityId}`);

      return reply.send({
        entityId: entity.entityId,
        geid: entity.geid,
        address: entity.address,
        provider: userInfo.provider,
        displayName: userInfo.displayName,
        email: userInfo.email,
      });
    },
  );
}
