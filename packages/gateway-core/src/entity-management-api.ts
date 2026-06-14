/**
 * Entity Management API — REST endpoints for local entity CRUD.
 *
 * Absorbed from agi-local-id Phase 3 (2026-05-16). Routes previously at
 * id.ai.on/api/entities are now served directly by the gateway.
 *
 * All routes are private-network only.
 *
 * Routes:
 *   POST   /api/entities/register-owner     — genesis: create #E0 + $A0
 *   POST   /api/entities                    — create entity (auth required)
 *   GET    /api/entities                    — list all entities
 *   GET    /api/entities/by-geid/:geid      — lookup by GEID
 *   GET    /api/entities/by-alias/:alias    — lookup by COA alias
 *   GET    /api/entities/:ownerId/agents    — list agents bound to owner
 *   POST   /api/entities/:id/bind-agent     — bind $A to #E or #O
 *   GET    /api/entities/:id               — get entity by ID
 */

import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import type { Db } from "@agi/db-schema/client";
import { createEntityService } from "./entity-service.js";
import { createComponentLogger } from "./logger.js";
import type { Logger } from "./logger.js";

export interface EntityManagementDeps {
  db: Db;
  encKey: Buffer;
  logger?: Logger;
}

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function isPrivate(ip: string): boolean {
  if (isLoopback(ip)) return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  if (ip.startsWith("fe80:")) return true;
  return false;
}

function getClientIp(req: IncomingMessage & { ip?: string }): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

export function registerEntityManagementRoutes(fastify: FastifyInstance, deps: EntityManagementDeps): void {
  const { db, encKey } = deps;
  const log = deps.logger
    ? createComponentLogger(deps.logger, "entity-management-api")
    : { info: console.log, warn: console.warn, error: console.error };

  const svc = createEntityService(db, encKey);

  function guardPrivate(req: { raw: IncomingMessage }): string | null {
    if (!isPrivate(getClientIp(req.raw))) return "Entity API only allowed from private network";
    return null;
  }

  // POST /api/entities/register-owner
  fastify.post("/api/entities/register-owner", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = (request.body ?? {}) as { displayName?: string };
    if (!body.displayName?.trim()) return reply.code(400).send({ error: "displayName is required" });

    const exists = await svc.hasGenesisOwner();
    if (exists) return reply.code(409).send({ error: "Genesis owner (#E0) already exists" });

    try {
      const result = await svc.createOwnerEntity(body.displayName.trim());
      log.info(`Genesis owner created: ${result.owner.coaAlias} geid=${result.ownerGeid.geid}`);
      return reply.code(201).send({
        owner: {
          id: result.owner.id,
          type: result.owner.type,
          displayName: result.owner.displayName,
          coaAlias: result.owner.coaAlias,
          scope: result.owner.scope,
          geid: result.ownerGeid.geid,
        },
        agent: {
          id: result.agent.id,
          type: result.agent.type,
          displayName: result.agent.displayName,
          coaAlias: result.agent.coaAlias,
          scope: result.agent.scope,
          geid: result.agentGeid.geid,
        },
        registrationId: result.registrationId,
      });
    } catch (e) {
      log.error(`register-owner failed: ${String(e)}`);
      return reply.code(500).send({ error: `Failed to create owner: ${String(e)}` });
    }
  });

  // POST /api/entities — create entity
  fastify.post("/api/entities", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = (request.body ?? {}) as {
      type?: string;
      displayName?: string;
      scope?: "local" | "registered";
      parentEntityId?: string;
    };

    if (!body.type || !["E", "O", "T", "F", "A"].includes(body.type)) {
      return reply.code(400).send({ error: "type must be one of: E, O, T, F, A" });
    }
    if (!body.displayName?.trim()) return reply.code(400).send({ error: "displayName is required" });

    const scope = body.scope ?? "local";
    if (scope !== "local" && scope !== "registered") {
      return reply.code(400).send({ error: "scope must be 'local' or 'registered'" });
    }

    try {
      const result = await svc.createEntity(body.type, body.displayName.trim(), scope, body.parentEntityId);
      return reply.code(201).send({
        id: result.entity.id,
        type: result.entity.type,
        displayName: result.entity.displayName,
        coaAlias: result.entity.coaAlias,
        scope: result.entity.scope,
        geid: result.geid.geid,
        createdAt: result.entity.createdAt,
      });
    } catch (e) {
      return reply.code(500).send({ error: `Failed to create entity: ${String(e)}` });
    }
  });

  // GET /api/entities — list all
  fastify.get("/api/entities", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });
    const all = await svc.listEntities();
    return reply.send({ entities: all });
  });

  // GET /api/entities/by-geid/:geid
  fastify.get<{ Params: { geid: string } }>("/api/entities/by-geid/:geid", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const entity = await svc.getByGeid(request.params.geid);
    if (!entity) return reply.code(404).send({ error: "Entity not found" });

    const geid = await svc.getEntityGeid(entity.id);
    return reply.send({ ...entity, geid: geid?.geid });
  });

  // GET /api/entities/by-alias/:alias
  fastify.get<{ Params: { alias: string } }>("/api/entities/by-alias/:alias", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const alias = decodeURIComponent(request.params.alias);
    const entity = await svc.getByAlias(alias);
    if (!entity) return reply.code(404).send({ error: "Entity not found" });

    const geid = await svc.getEntityGeid(entity.id);
    return reply.send({ ...entity, geid: geid?.geid });
  });

  // GET /api/entities/:ownerId/agents — must be registered before /:id
  fastify.get<{ Params: { ownerId: string } }>("/api/entities/:ownerId/agents", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const agents = await svc.getOwnerAgents(request.params.ownerId);
    return reply.send({ agents });
  });

  // POST /api/entities/:id/bind-agent
  fastify.post<{ Params: { id: string } }>("/api/entities/:id/bind-agent", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = (request.body ?? {}) as { agentEntityId?: string; bindingType?: string };
    if (!body.agentEntityId) return reply.code(400).send({ error: "agentEntityId is required" });

    try {
      await svc.bindAgent(request.params.id, body.agentEntityId, body.bindingType);
      return reply.send({ ok: true });
    } catch (e) {
      return reply.code(400).send({ error: String(e) });
    }
  });

  // GET /api/entities/:id
  fastify.get<{ Params: { id: string } }>("/api/entities/:id", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const entity = await svc.getEntity(request.params.id);
    if (!entity) return reply.code(404).send({ error: "Entity not found" });

    const geid = await svc.getEntityGeid(entity.id);
    return reply.send({ ...entity, geid: geid?.geid });
  });
}
