/**
 * Compliance API routes — incidents, vendors, sessions, backups.
 * All endpoints are gated to private network.
 */

import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import type { IncidentStore, IncidentSeverity, IncidentStatus, BreachClassification } from "@agi/entity-model";
import type { VendorStore, VendorType } from "@agi/entity-model";
import type { SessionStore } from "@agi/entity-model";
import type { BackupManager } from "./backup-manager.js";

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.socket.remoteAddress ?? "unknown";
}

function isPrivateNetwork(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true;
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

export interface ComplianceRouteDeps {
  incidentStore?: IncidentStore;
  vendorStore?: VendorStore;
  sessionStore?: SessionStore;
  backupManager?: BackupManager;
}

export function registerComplianceRoutes(fastify: FastifyInstance, deps: ComplianceRouteDeps): void {
  function guard(req: { raw: IncomingMessage }): string | null {
    return isPrivateNetwork(getClientIp(req.raw)) ? null : "Compliance API only from private network";
  }

  // ---------------------------------------------------------------------------
  // Incidents
  // ---------------------------------------------------------------------------

  if (deps.incidentStore) {
    const store = deps.incidentStore;

    fastify.get("/api/compliance/incidents", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      const limit = Number((req.query as { limit?: string }).limit) || 50;
      return reply.send({ incidents: store.list(limit) });
    });

    fastify.post("/api/compliance/incidents", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      const body = req.body as { severity?: string; title?: string; description?: string; affectedDataTypes?: string[]; affectedSystems?: string[] };
      if (!body.title) return reply.code(400).send({ error: "title is required" });
      const incident = store.create({
        severity: (body.severity as IncidentSeverity) ?? "medium",
        title: body.title,
        description: body.description ?? "",
        affectedDataTypes: body.affectedDataTypes,
        affectedSystems: body.affectedSystems,
      });
      return reply.send({ ok: true, incident });
    });

    fastify.put<{ Params: { id: string } }>("/api/compliance/incidents/:id/status", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      const { status } = req.body as { status?: string };
      if (!status) return reply.code(400).send({ error: "status is required" });
      store.updateStatus(req.params.id, status as IncidentStatus);
      return reply.send({ ok: true, incident: store.get(req.params.id) });
    });

    fastify.put<{ Params: { id: string } }>("/api/compliance/incidents/:id/breach", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      const { classification } = req.body as { classification?: string };
      if (!classification) return reply.code(400).send({ error: "classification is required" });
      store.updateBreachClassification(req.params.id, classification as BreachClassification);
      return reply.send({ ok: true, incident: store.get(req.params.id) });
    });
  }

  // ---------------------------------------------------------------------------
  // Vendors
  // ---------------------------------------------------------------------------

  if (deps.vendorStore) {
    const store = deps.vendorStore;

    fastify.get("/api/compliance/vendors", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      return reply.send({ vendors: store.list() });
    });

    fastify.post("/api/compliance/vendors", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      const body = req.body as { name?: string; type?: string; description?: string };
      if (!body.name) return reply.code(400).send({ error: "name is required" });
      const vendor = store.upsert({
        name: body.name,
        type: (body.type as VendorType) ?? "other",
        description: body.description,
      });
      return reply.send({ ok: true, vendor });
    });

    fastify.put<{ Params: { id: string } }>("/api/compliance/vendors/:id/compliance", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      const { status } = req.body as { status?: string };
      if (!status) return reply.code(400).send({ error: "status is required" });
      store.updateCompliance(req.params.id, status as "compliant" | "review_needed" | "non_compliant" | "unknown");
      return reply.send({ ok: true });
    });

    fastify.put<{ Params: { id: string } }>("/api/compliance/vendors/:id/dpa", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      const { signed } = req.body as { signed?: boolean };
      store.updateDpa(req.params.id, signed === true);
      return reply.send({ ok: true });
    });

    fastify.put<{ Params: { id: string } }>("/api/compliance/vendors/:id/baa", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      const { signed } = req.body as { signed?: boolean };
      store.updateBaa(req.params.id, signed === true);
      return reply.send({ ok: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  if (deps.sessionStore) {
    const store = deps.sessionStore;

    fastify.get("/api/compliance/sessions", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      const { entityId } = req.query as { entityId?: string };
      if (!entityId) return reply.code(400).send({ error: "entityId query param required" });
      return reply.send({ sessions: store.getActiveSessions(entityId) });
    });

    fastify.delete<{ Params: { id: string } }>("/api/compliance/sessions/:id", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      store.revokeSession(req.params.id);
      return reply.send({ ok: true });
    });

    fastify.delete("/api/compliance/sessions", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      const { entityId } = req.body as { entityId?: string };
      if (!entityId) return reply.code(400).send({ error: "entityId is required" });
      store.revokeAllForEntity(entityId);
      return reply.send({ ok: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Backups
  // ---------------------------------------------------------------------------

  if (deps.backupManager) {
    const manager = deps.backupManager;

    fastify.get("/api/compliance/backups", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      return reply.send({ backups: manager.listBackups() });
    });

    fastify.post("/api/compliance/backups", async (req, reply) => {
      const err = guard(req);
      if (err) return reply.code(403).send({ error: err });
      const result = manager.backup();
      return reply.send(result);
    });
  }
}
