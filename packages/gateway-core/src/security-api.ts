/**
 * Security API routes — scan management, findings, and security posture endpoints.
 * All endpoints are gated to private network.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ScanRunner } from "@agi/security";
import type { ScanStore } from "@agi/security";
import type { ScanConfig, FindingSeverity, FindingStatus } from "@agi/security";

function isPrivateNetwork(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  if (ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  return false;
}

export interface SecurityRouteDeps {
  scanRunner: ScanRunner;
  scanStore: ScanStore;
}

export function registerSecurityRoutes(fastify: FastifyInstance, deps: SecurityRouteDeps): void {
  const { scanRunner, scanStore } = deps;

  function guard(req: FastifyRequest, reply: FastifyReply): boolean {
    const ip = req.ip ?? req.raw.socket.remoteAddress ?? "unknown";
    if (!isPrivateNetwork(ip)) {
      reply.code(403).send({ error: "Security API only allowed from private network" });
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Providers
  // ---------------------------------------------------------------------------

  fastify.get("/api/security/providers", async (req, reply) => {
    if (!guard(req, reply)) return;
    return reply.send(scanRunner.getProviders());
  });

  // ---------------------------------------------------------------------------
  // Scan runs
  // ---------------------------------------------------------------------------

  fastify.get("/api/security/scans", async (req, reply) => {
    if (!guard(req, reply)) return;
    const query = req.query as { projectPath?: string; limit?: string; offset?: string };
    return reply.send(await scanStore.listScanRuns({
      projectPath: query.projectPath,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    }));
  });

  fastify.get<{ Params: { id: string } }>("/api/security/scans/:id", async (req, reply) => {
    if (!guard(req, reply)) return;
    const run = await scanStore.getScanRun(req.params.id);
    if (!run) return reply.code(404).send({ error: "Scan not found" });
    return reply.send(run);
  });

  fastify.post("/api/security/scans", async (req, reply) => {
    if (!guard(req, reply)) return;
    const body = req.body as Partial<ScanConfig>;
    if (!body.scanTypes || !body.targetPath) {
      return reply.code(400).send({ error: "scanTypes and targetPath are required" });
    }
    const config: ScanConfig = {
      scanTypes: body.scanTypes,
      targetPath: body.targetPath,
      projectId: body.projectId,
      excludePaths: body.excludePaths ?? ["node_modules", ".git", "dist"],
      severityThreshold: body.severityThreshold,
      maxFindings: body.maxFindings,
    };
    // Run scan in background, return immediately with the scan ID
    const runsBefore = await scanStore.listScanRuns({ limit: 1 });
    const runCountBefore = runsBefore.length;
    scanRunner.runScan(config).catch((err: unknown) => {
      console.error("[security-api] scan failed:", err);
    });
    // Poll the store for the newly created run
    const newRuns = await scanStore.listScanRuns({ limit: 1 });
    const scanId = newRuns.length > runCountBefore ? (newRuns[0]?.id ?? "unknown") : "unknown";
    return reply.code(202).send({ scanId, status: "running" });
  });

  fastify.post<{ Params: { id: string } }>("/api/security/scans/:id/cancel", async (req, reply) => {
    if (!guard(req, reply)) return;
    const cancelled = scanRunner.cancelScan(req.params.id);
    if (!cancelled) return reply.code(404).send({ error: "No active scan with that ID" });
    return reply.send({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Findings
  // ---------------------------------------------------------------------------

  fastify.get("/api/security/findings", async (req, reply) => {
    if (!guard(req, reply)) return;
    const query = req.query as {
      severity?: string;
      scanType?: string;
      status?: string;
      projectPath?: string;
      limit?: string;
      offset?: string;
    };
    return reply.send(await scanStore.queryFindings({
      severity: query.severity as FindingSeverity | undefined,
      scanType: query.scanType,
      status: query.status as FindingStatus | undefined,
      projectPath: query.projectPath,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    }));
  });

  fastify.get<{ Params: { id: string } }>("/api/security/scans/:id/findings", async (req, reply) => {
    if (!guard(req, reply)) return;
    return reply.send(await scanStore.getFindings(req.params.id));
  });

  fastify.put<{ Params: { id: string } }>("/api/security/findings/:id/status", async (req, reply) => {
    if (!guard(req, reply)) return;
    const { status } = req.body as { status?: string };
    if (!status) return reply.code(400).send({ error: "status is required" });
    const validStatuses: FindingStatus[] = ["open", "acknowledged", "mitigated", "false_positive"];
    if (!validStatuses.includes(status as FindingStatus)) {
      return reply.code(400).send({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }
    const updated = await scanStore.updateFindingStatus(req.params.id, status as FindingStatus);
    if (!updated) return reply.code(404).send({ error: "Finding not found" });
    return reply.send({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  fastify.get("/api/security/summary", async (req, reply) => {
    if (!guard(req, reply)) return;
    const query = req.query as { projectPath?: string };
    return reply.send(await scanStore.getSummary(query.projectPath));
  });
}
