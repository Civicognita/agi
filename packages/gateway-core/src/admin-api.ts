/**
 * Admin API — safemode + incidents endpoints.
 *
 * Endpoints:
 *   GET  /api/admin/safemode          — current safemode snapshot
 *   POST /api/admin/safemode/exit     — run recovery + clear safemode flag
 *   GET  /api/admin/incidents         — list incident reports (~/.agi/incidents)
 *   GET  /api/admin/incidents/:id     — full markdown of a single report
 *
 * Safemode endpoints are always available (even during safemode — the blocking
 * middleware specifically allows /api/admin/*). All endpoints are gated to
 * private network (loopback + LAN).
 */

import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ComponentLogger } from "./logger.js";
import { safemodeState } from "./safemode-state.js";
import { recoverAllManagedContainers } from "./boot-recovery.js";
import type { AionMicroManager } from "./aion-micro-manager.js";

const INCIDENTS_DIR = join(homedir(), ".agi", "incidents");

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

export interface IncidentSummary {
  id: string;
  createdAt: string;
  summary: string;
  size: number;
}

function listIncidents(): IncidentSummary[] {
  if (!existsSync(INCIDENTS_DIR)) return [];
  const entries = readdirSync(INCIDENTS_DIR)
    .filter((n) => n.endsWith(".md"))
    .map((name) => {
      const full = join(INCIDENTS_DIR, name);
      const stat = statSync(full);
      const id = name.replace(/\.md$/, "");
      let summary = "";
      try {
        const head = readFileSync(full, "utf8").split("\n").slice(0, 8).join(" ");
        summary = head.slice(0, 240);
      } catch {
        summary = "";
      }
      return { id, createdAt: stat.mtime.toISOString(), summary, size: stat.size };
    });
  entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return entries;
}

function readIncident(id: string): string | null {
  if (!/^[A-Za-z0-9._:T+-]+$/.test(id)) return null;
  const full = join(INCIDENTS_DIR, `${id}.md`);
  if (!existsSync(full)) return null;
  try {
    return readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

export function registerAdminRoutes(
  fastify: FastifyInstance,
  log: ComponentLogger,
  aionMicro?: AionMicroManager,
): void {
  function guard(req: { raw: IncomingMessage }): string | null {
    return isPrivateNetwork(getClientIp(req.raw)) ? null : "Admin API only from private network";
  }

  fastify.get("/api/admin/safemode", async (req, reply) => {
    const err = guard(req);
    if (err !== null) return reply.code(403).send({ error: err });
    return reply.send(safemodeState.snapshot());
  });

  fastify.post("/api/admin/safemode/exit", async (req, reply) => {
    const err = guard(req);
    if (err !== null) return reply.code(403).send({ error: err });

    log.info("safemode exit requested — running recovery");
    let recovery;
    try {
      recovery = await recoverAllManagedContainers(log);
    } catch (recoverErr) {
      log.error(
        `recovery failed: ${recoverErr instanceof Error ? recoverErr.message : String(recoverErr)}`,
      );
      return reply.code(500).send({
        error: "recovery_failed",
        message: recoverErr instanceof Error ? recoverErr.message : String(recoverErr),
      });
    }

    safemodeState.exit();
    log.info(
      `safemode cleared — recovered ${String(recovery.projects.started)}/${String(recovery.projects.total)} project(s), ${String(recovery.models.started)}/${String(recovery.models.total)} model(s)`,
    );

    return reply.send({
      ok: true,
      snapshot: safemodeState.snapshot(),
      recovery,
    });
  });

  fastify.get("/api/admin/incidents", async (req, reply) => {
    const err = guard(req);
    if (err !== null) return reply.code(403).send({ error: err });
    return reply.send({ incidents: listIncidents() });
  });

  fastify.get<{ Params: { id: string } }>("/api/admin/incidents/:id", async (req, reply) => {
    const err = guard(req);
    if (err !== null) return reply.code(403).send({ error: err });
    const content = readIncident(req.params.id);
    if (content === null) return reply.code(404).send({ error: "not_found" });
    return reply
      .header("content-type", "text/markdown; charset=utf-8")
      .send(content);
  });

  fastify.post("/api/admin/diagnose", async (req, reply) => {
    const err = guard(req);
    if (err !== null) return reply.code(403).send({ error: err });
    if (!aionMicro) return reply.code(503).send({ error: "aion-micro not configured" });
    const body = req.body as { checks?: unknown[]; systemInfo?: unknown } | undefined;
    if (!body?.checks) return reply.code(400).send({ error: "checks array required" });
    const analysis = await aionMicro.diagnose(body.checks, body.systemInfo);
    if (!analysis) return reply.code(503).send({ error: "aion-micro not available" });
    return reply.send({ analysis });
  });

  fastify.get("/api/admin/aion-micro/status", async (req, reply) => {
    const err = guard(req);
    if (err !== null) return reply.code(403).send({ error: err });
    return reply.send({
      enabled: aionMicro?.isEnabled() ?? false,
      running: aionMicro?.isRunning() ?? false,
      imageAvailable: aionMicro?.imageExists() ?? false,
      port: aionMicro?.getPort() ?? null,
    });
  });

  fastify.post("/api/admin/prompt-preview", async (req, reply) => {
    const err = guard(req);
    if (err !== null) return reply.code(403).send({ error: err });
    const body = req.body as { requestType?: string } | undefined;
    const { assembleSystemPrompt, estimateTokens } = await import("./system-prompt.js");
    const requestType = (body?.requestType ?? "chat") as import("./system-prompt.js").RequestType;
    const prompt = assembleSystemPrompt({
      requestType,
      entity: { entityId: "preview", coaAlias: "#E0", displayName: "Preview", verificationTier: "verified", channel: "dashboard" },
      coaFingerprint: "$A0.#E0.PREVIEW",
      state: "ONLINE" as import("./types.js").GatewayState,
      capabilities: { remoteOps: true, tynn: false, memory: true, deletions: false },
      tools: [],
    });
    return reply.send({
      requestType,
      prompt,
      tokenEstimate: estimateTokens(prompt),
      sections: prompt.split("\n\n").length,
    });
  });
}
