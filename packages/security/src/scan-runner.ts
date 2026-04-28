/**
 * ScanRunner — orchestrates security scan execution.
 * Resolves applicable providers, runs them in parallel, collects findings.
 */

import { randomUUID } from "node:crypto";
import type { ScanConfig, ScanRun, ScannerRunResult, SecurityFinding, FindingSeverity } from "./types.js";
import type { ScanProviderRegistry } from "./scan-registry.js";
import type { ScanStore } from "./scan-store.js";

const SEVERITY_ORDER: FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

export class ScanRunner {
  private readonly registry: ScanProviderRegistry;
  private readonly store: ScanStore;
  private readonly logger: { debug(msg: string): void; info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  private readonly activeScanAborts = new Map<string, AbortController>();

  constructor(
    registry: ScanProviderRegistry,
    store: ScanStore,
    logger: { debug(msg: string): void; info(msg: string): void; warn(msg: string): void; error(msg: string): void },
  ) {
    this.registry = registry;
    this.store = store;
    this.logger = logger;
  }

  async runScan(config: ScanConfig): Promise<ScanRun> {
    const scanId = randomUUID();
    this.store.createScanRun(scanId, config);

    const providers = this.registry.getAll().filter(p =>
      config.scanTypes.includes(p.provider.scanType),
    );

    if (providers.length === 0) {
      const run: ScanRun = {
        id: scanId,
        status: "completed",
        config,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        totalFindings: 0,
        scannerResults: [],
      };
      this.store.updateScanRun(scanId, {
        status: "completed",
        completedAt: run.completedAt,
        findingCounts: run.findingCounts,
        totalFindings: 0,
        scannerResults: [],
      });
      return run;
    }

    const abortController = new AbortController();
    this.activeScanAborts.set(scanId, abortController);

    this.store.updateScanRun(scanId, { status: "running" });
    this.logger.info(`Starting scan ${scanId} with ${providers.length} providers`);

    const scannerResults: ScannerRunResult[] = [];
    const allFindings: SecurityFinding[] = [];

    const results = await Promise.allSettled(
      providers.map(async (p) => {
        const start = Date.now();
        try {
          const findings = await p.provider.scan(config, {
            logger: this.logger,
            workspaceRoot: config.targetPath,
            abortSignal: abortController.signal,
          });

          // Stamp each finding with scanId and provider info
          const stamped = findings.map(f => ({
            ...f,
            scanId,
            id: f.id || randomUUID(),
            createdAt: f.createdAt || new Date().toISOString(),
            status: f.status || "open" as const,
          }));

          // Apply severity threshold filter
          if (config.severityThreshold) {
            const minIdx = SEVERITY_ORDER.indexOf(config.severityThreshold);
            return {
              scannerId: p.provider.id,
              scanType: p.provider.scanType,
              status: "completed" as const,
              findings: stamped.filter(f => SEVERITY_ORDER.indexOf(f.severity) <= minIdx),
              durationMs: Date.now() - start,
            };
          }

          return {
            scannerId: p.provider.id,
            scanType: p.provider.scanType,
            status: "completed" as const,
            findings: stamped,
            durationMs: Date.now() - start,
          };
        } catch (err) {
          return {
            scannerId: p.provider.id,
            scanType: p.provider.scanType,
            status: "failed" as const,
            findings: [] as SecurityFinding[],
            durationMs: Date.now() - start,
            error: err instanceof Error ? err.message : "Unknown error",
          };
        }
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        scannerResults.push(result.value);
        allFindings.push(...result.value.findings);
      } else {
        scannerResults.push({
          scannerId: "unknown",
          scanType: "custom",
          status: "failed",
          findings: [],
          durationMs: 0,
          error: result.reason instanceof Error ? result.reason.message : "Promise rejected",
        });
      }
    }

    // Apply maxFindings cap
    const cappedFindings = config.maxFindings
      ? allFindings.slice(0, config.maxFindings)
      : allFindings;

    // Count by severity
    const findingCounts: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of cappedFindings) findingCounts[f.severity]++;

    // Persist findings
    if (cappedFindings.length > 0) {
      this.store.insertFindings(cappedFindings);
    }

    const completedAt = new Date().toISOString();
    const status = abortController.signal.aborted
      ? "cancelled"
      : (scannerResults.some(r => r.status === "failed") ? "completed" : "completed");

    this.store.updateScanRun(scanId, {
      status,
      completedAt,
      findingCounts,
      totalFindings: cappedFindings.length,
      scannerResults: scannerResults.map(r => ({ ...r, findings: undefined })),
    });

    this.activeScanAborts.delete(scanId);

    this.logger.info(`Scan ${scanId} completed: ${cappedFindings.length} findings`);

    return {
      id: scanId,
      status,
      config,
      startedAt: (await this.store.getScanRun(scanId))?.startedAt ?? new Date().toISOString(),
      completedAt,
      findingCounts,
      totalFindings: cappedFindings.length,
      scannerResults,
    };
  }

  cancelScan(scanId: string): boolean {
    const controller = this.activeScanAborts.get(scanId);
    if (!controller) return false;
    controller.abort();
    void this.store.updateScanRun(scanId, { status: "cancelled", completedAt: new Date().toISOString() });
    this.activeScanAborts.delete(scanId);
    return true;
  }

  async getFindings(scanId: string): Promise<SecurityFinding[]> {
    return this.store.getFindings(scanId);
  }

  async getScanHistory(projectPath?: string, limit?: number): Promise<ScanRun[]> {
    return this.store.listScanRuns({ projectPath, limit });
  }

  getProviders(): { id: string; name: string; scanType: string; description?: string }[] {
    return this.registry.getAll().map(p => ({
      id: p.provider.id,
      name: p.provider.name,
      scanType: p.provider.scanType,
      description: p.provider.description,
    }));
  }
}
