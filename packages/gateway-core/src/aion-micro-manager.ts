/**
 * AionMicroManager — manages the aion-micro system operations container.
 *
 * Aion-micro is a lightweight local LLM (SmolLM2-135M-Instruct) used for:
 *   - agi doctor intelligent diagnostics
 *   - Container dependency analysis
 *   - Log parsing and root cause identification
 *
 * Auto-starts on first use, auto-stops after idle timeout.
 * Container: ghcr.io/civicognita/aion-micro:latest (model weights baked in).
 */

import { execFileSync } from "node:child_process";
import type { ComponentLogger } from "./logger.js";

const IMAGE = "ghcr.io/civicognita/aion-micro:latest";
const CONTAINER_NAME = "agi-aion-micro";
const INTERNAL_PORT = 8000;
const MEMORY_LIMIT = "768m";
const HEALTH_POLL_INTERVAL_MS = 2_000;
const HEALTH_TIMEOUT_MS = 60_000;

export interface AionMicroConfig {
  enabled: boolean;
  port: number;
  idleTimeoutMs: number;
}

const DEFAULT_CONFIG: AionMicroConfig = {
  enabled: true,
  port: 5200,
  idleTimeoutMs: 600_000,
};

export class AionMicroManager {
  private readonly config: AionMicroConfig;
  private readonly log: ComponentLogger;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<AionMicroConfig> | undefined, log: ComponentLogger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = log;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) return;

    try {
      execFileSync("podman", ["rm", "-f", CONTAINER_NAME], {
        stdio: "pipe",
        timeout: 10_000,
      });
    } catch { /* container may not exist */ }

    if (!this.imageExists()) {
      this.log.info("aion-micro image not available — skipping start");
      return;
    }

    const port = this.config.port;
    try {
      execFileSync("podman", [
        "run", "-d",
        "--name", CONTAINER_NAME,
        "-p", `127.0.0.1:${String(port)}:${String(INTERNAL_PORT)}`,
        "--memory", MEMORY_LIMIT,
        "--restart", "no",
        "--label", "agi.service=true",
        "--label", "agi.service.id=aion-micro",
        IMAGE,
      ], { stdio: "pipe", timeout: 60_000 });

      this.log.info(`aion-micro container started on port ${String(port)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`failed to start aion-micro: ${msg}`);
      throw new Error(`Failed to start aion-micro: ${msg}`);
    }

    const healthy = await this.waitForHealth();
    if (!healthy) {
      this.log.warn("aion-micro started but health check failed");
    }

    this.resetIdleTimer();
  }

  async stop(): Promise<void> {
    this.clearIdleTimer();
    try {
      execFileSync("podman", ["stop", "-t", "5", CONTAINER_NAME], {
        stdio: "pipe",
        timeout: 15_000,
      });
    } catch { /* already stopped */ }
    try {
      execFileSync("podman", ["rm", "-f", CONTAINER_NAME], {
        stdio: "pipe",
        timeout: 10_000,
      });
    } catch { /* already removed */ }
    this.log.info("aion-micro stopped");
  }

  isRunning(): boolean {
    try {
      const out = execFileSync(
        "podman", ["inspect", "--format", "{{.State.Running}}", CONTAINER_NAME],
        { stdio: "pipe", timeout: 5_000 },
      ).toString().trim();
      return out === "true";
    } catch {
      return false;
    }
  }

  imageExists(): boolean {
    try {
      execFileSync("podman", ["image", "exists", IMAGE], {
        stdio: "pipe",
        timeout: 10_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  async ensureAvailable(): Promise<boolean> {
    if (!this.config.enabled) return false;
    if (!this.imageExists()) return false;

    if (this.isRunning()) {
      this.resetIdleTimer();
      return true;
    }

    try {
      await this.start();
      return this.isRunning();
    } catch {
      return false;
    }
  }

  getPort(): number {
    return this.config.port;
  }

  getBaseUrl(): string {
    return `http://127.0.0.1:${String(this.config.port)}`;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.config.idleTimeoutMs > 0) {
      this.idleTimer = setTimeout(() => {
        if (this.isRunning()) {
          this.log.info("aion-micro idle timeout — stopping");
          void this.stop();
        }
      }, this.config.idleTimeoutMs);
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async waitForHealth(): Promise<boolean> {
    const url = `${this.getBaseUrl()}/health`;
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
        if (res.ok) return true;
      } catch { /* not ready yet */ }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
    }
    return false;
  }

  async diagnose(checks: unknown[], systemInfo?: unknown): Promise<string> {
    const available = await this.ensureAvailable();
    if (!available) return "";

    this.resetIdleTimer();
    try {
      const res = await fetch(`${this.getBaseUrl()}/v1/diagnose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checks, system_info: systemInfo }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return "";
      const data = await res.json() as { analysis?: string };
      return data.analysis ?? "";
    } catch {
      return "";
    }
  }

  /**
   * Ask aion-micro to resolve a single merge-conflict file. The caller
   * passes the raw file contents with `<<<<<<<`/`=======`/`>>>>>>>`
   * markers intact; aion-micro returns a fully resolved version plus a
   * confidence label. Callers MUST refuse to commit `low`-confidence
   * or partially-resolved results.
   */
  async resolveMergeConflict(
    filePath: string,
    oursLabel: string,
    theirsLabel: string,
    conflictText: string,
  ): Promise<{ resolvedText: string; confidence: "high" | "low"; unresolvedHunks: string[] } | null> {
    const available = await this.ensureAvailable();
    if (!available) return null;

    this.resetIdleTimer();
    try {
      const res = await fetch(`${this.getBaseUrl()}/v1/resolve-merge-conflict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_path: filePath,
          ours_label: oursLabel,
          theirs_label: theirsLabel,
          conflict_text: conflictText,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) return null;
      const data = await res.json() as {
        resolved_text?: string;
        confidence?: "high" | "low";
        unresolved_hunks?: string[];
      };
      if (typeof data.resolved_text !== "string") return null;
      return {
        resolvedText: data.resolved_text,
        confidence: data.confidence === "high" ? "high" : "low",
        unresolvedHunks: Array.isArray(data.unresolved_hunks) ? data.unresolved_hunks : [],
      };
    } catch {
      return null;
    }
  }
}
