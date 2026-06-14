/**
 * run_security_scan — agent tool that exposes the security scanning
 * infrastructure to the agent pipeline.
 *
 * Actions:
 *   run      — launch a new scan (returns scanId immediately; scan runs async)
 *   status   — poll a scan's current status and finding counts
 *   findings — retrieve findings for a completed scan
 *   list     — list recent scan runs (optionally scoped to a projectPath)
 */

import type { ToolHandler, ToolExecutionContext } from "../tool-registry.js";
import type { ScanRunner } from "@agi/security";
import type { ScanStore } from "@agi/security";
import type { ScanConfig, ScanType } from "@agi/security";
import type { COAChainLogger } from "@agi/coa-chain";

export interface SecurityScanToolConfig {
  scanRunner?: ScanRunner;
  scanStore?: ScanStore;
  coaLogger?: COAChainLogger;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function createRunSecurityScanHandler(config: SecurityScanToolConfig): ToolHandler {
  return async (input: Record<string, unknown>, ctx?: ToolExecutionContext): Promise<string> => {
    const { scanRunner, scanStore, coaLogger } = config;
    if (!scanRunner || !scanStore) {
      return JSON.stringify({ error: "Security scanning not available in this environment" });
    }

    const action = String(input.action ?? "");

    // ── run ──────────────────────────────────────────────────────────────────
    if (action === "run") {
      const rawTypes = input.scanTypes;
      const scanTypes: ScanType[] = Array.isArray(rawTypes)
        ? rawTypes.map(String) as ScanType[]
        : ["sast", "secrets", "config"];

      const targetPath = input.targetPath ? String(input.targetPath) : ".";
      const projectId = input.projectId ? String(input.projectId) : undefined;

      const cfg: ScanConfig = {
        scanTypes,
        targetPath,
        projectId,
        excludePaths: ["node_modules", ".git", "dist"],
        severityThreshold: input.severityThreshold ? String(input.severityThreshold) as ScanConfig["severityThreshold"] : undefined,
        entityId: ctx?.entityId,
        entityAlias: ctx?.entityAlias,
      };

      // Fire async — return scanId immediately
      let scanId = "unknown";
      scanRunner.runScan(cfg).catch((err: unknown) => {
        console.error("[security-scan tool] scan failed:", err instanceof Error ? err.message : String(err));
      });

      // Best-effort: peek at the latest scan run to get the ID
      try {
        const recent = await scanStore.listScanRuns({ limit: 1 });
        if (recent.length > 0 && recent[0]) scanId = recent[0].id;
      } catch { /* non-fatal */ }

      // COA anchor — record who triggered the scan
      if (coaLogger && ctx) {
        coaLogger.log({
          resourceId: ctx.resourceId,
          entityId: ctx.entityId,
          entityAlias: ctx.entityAlias,
          nodeId: ctx.nodeId,
          workType: "security_scan",
          ref: scanId,
          action: "create",
        }).catch((err: unknown) => {
          console.error("[security-scan tool] COA log failed:", err instanceof Error ? err.message : String(err));
        });
      }

      return JSON.stringify({
        ok: true,
        scanId,
        status: "running",
        message: `Scan started. Poll status with action:"status", scanId:"${scanId}" or retrieve findings when done.`,
      });
    }

    // ── status ────────────────────────────────────────────────────────────────
    if (action === "status") {
      const scanId = input.scanId ? String(input.scanId) : "";
      if (!scanId) return JSON.stringify({ error: "scanId is required for action:status" });

      const run = await scanStore.getScanRun(scanId);
      if (!run) return JSON.stringify({ error: `No scan found with id: ${scanId}` });

      return JSON.stringify({
        scanId: run.id,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt ?? null,
        totalFindings: run.totalFindings,
        findingCounts: run.findingCounts,
        scanTypes: run.config.scanTypes,
        targetPath: run.config.targetPath,
      });
    }

    // ── findings ─────────────────────────────────────────────────────────────
    if (action === "findings") {
      const scanId = input.scanId ? String(input.scanId) : "";
      if (!scanId) return JSON.stringify({ error: "scanId is required for action:findings" });

      const run = await scanStore.getScanRun(scanId);
      if (!run) return JSON.stringify({ error: `No scan found with id: ${scanId}` });
      if (run.status !== "completed") {
        return JSON.stringify({ error: `Scan is still ${run.status} — wait for it to complete first` });
      }

      const findings = await scanStore.getFindings(scanId);
      const limit = input.limit ? Math.min(Number(input.limit), 100) : 50;
      const sliced = findings.slice(0, limit);

      return JSON.stringify({
        scanId,
        totalFindings: findings.length,
        returned: sliced.length,
        findings: sliced.map((f) => ({
          id: f.id,
          title: f.title,
          severity: f.severity,
          confidence: f.confidence,
          scanType: f.scanType,
          file: f.evidence?.file ?? null,
          line: f.evidence?.line ?? null,
          remediation: f.remediation?.description ?? null,
          effort: f.remediation?.effort ?? null,
          cwe: f.cwe ?? [],
          status: f.status,
        })),
      });
    }

    // ── list ─────────────────────────────────────────────────────────────────
    if (action === "list") {
      const projectPath = input.projectPath ? String(input.projectPath) : undefined;
      const limit = input.limit ? Math.min(Number(input.limit), 50) : 10;

      const runs = await scanStore.listScanRuns({ projectPath, limit });
      return JSON.stringify({
        runs: runs.map((r) => ({
          scanId: r.id,
          status: r.status,
          scanTypes: r.config.scanTypes,
          targetPath: r.config.targetPath,
          startedAt: r.startedAt,
          completedAt: r.completedAt ?? null,
          totalFindings: r.totalFindings,
          findingCounts: r.findingCounts,
        })),
      });
    }

    return JSON.stringify({ error: `Unknown action: ${action}. Valid actions: run, status, findings, list` });
  };
}

// ---------------------------------------------------------------------------
// Manifest + schema
// ---------------------------------------------------------------------------

export const RUN_SECURITY_SCAN_MANIFEST = {
  name: "run_security_scan",
  description:
    "Run security scans on the codebase and retrieve findings. " +
    "Actions: run (start a scan), status (poll scan state), findings (get findings for a completed scan), list (recent scan history).",
  requiresState: ["online"],
  requiresTier: ["verified", "sealed"],
} as const;

export const RUN_SECURITY_SCAN_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["run", "status", "findings", "list"],
      description: "Operation to perform.",
    },
    targetPath: {
      type: "string",
      description: "Filesystem path to scan (default: \".\"). Used with action:run.",
    },
    scanTypes: {
      type: "array",
      items: { type: "string", enum: ["sast", "dast", "sca", "secrets", "config", "container", "custom"] },
      description: "Scan types to run. Defaults to [\"sast\",\"secrets\",\"config\"]. Used with action:run.",
    },
    projectId: {
      type: "string",
      description: "Optional project ID to associate the scan with. Used with action:run.",
    },
    severityThreshold: {
      type: "string",
      enum: ["critical", "high", "medium", "low", "info"],
      description: "Minimum severity to report. Used with action:run.",
    },
    scanId: {
      type: "string",
      description: "Scan ID returned by action:run. Required for action:status and action:findings.",
    },
    projectPath: {
      type: "string",
      description: "Filter scan history by project path. Used with action:list.",
    },
    limit: {
      type: "number",
      description: "Max results to return for action:findings (max 100) or action:list (max 50).",
    },
  },
};
