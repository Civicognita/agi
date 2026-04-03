/**
 * Node Health Monitoring & Quarantine — Task #225
 *
 * Heartbeat checks for federated nodes:
 * - Periodic ping with response time measurement
 * - Data freshness validation (stale node detection)
 * - Public node reputation scores
 * - Governance mechanism to quarantine nodes in bad standing
 * - Alert system for node operators
 */

import type { TrustLevel } from "./federation-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Health check result for a single node. */
export interface HealthCheckResult {
  nodeId: string;
  timestamp: string;
  /** Whether the node responded to ping. */
  reachable: boolean;
  /** Response time in milliseconds (null if unreachable). */
  responseTimeMs: number | null;
  /** Node-reported data freshness (ISO timestamp of latest COA record). */
  latestDataTimestamp: string | null;
  /** Whether data is considered stale. */
  dataStale: boolean;
  /** Error message if check failed. */
  error?: string;
}

/** Aggregated health metrics for a node. */
export interface NodeHealthMetrics {
  nodeId: string;
  /** Uptime percentage (0.0 - 1.0) over the measurement window. */
  uptimePercent: number;
  /** Average response time in milliseconds. */
  avgResponseTimeMs: number;
  /** P95 response time in milliseconds. */
  p95ResponseTimeMs: number;
  /** Number of checks performed. */
  totalChecks: number;
  /** Number of successful checks. */
  successfulChecks: number;
  /** Whether data has been stale for too long. */
  dataFreshnessOk: boolean;
  /** Last check timestamp. */
  lastCheckAt: string;
  /** Computed reputation score (0.0 - 1.0). */
  reputationScore: number;
}

/** Quarantine record for a node. */
export interface QuarantineRecord {
  nodeId: string;
  /** Reason for quarantine. */
  reason: QuarantineReason;
  /** Governance proposal ID (if quarantined by governance vote). */
  proposalId?: string;
  /** When quarantine was applied. */
  quarantinedAt: string;
  /** When quarantine expires (null = indefinite, requires governance to lift). */
  expiresAt: string | null;
  /** Whether quarantine is currently active. */
  active: boolean;
}

export type QuarantineReason =
  | "governance_vote"
  | "sustained_downtime"
  | "data_staleness"
  | "security_concern"
  | "protocol_violation";

/** Alert for node operators. */
export interface NodeAlert {
  alertId: string;
  nodeId: string;
  severity: AlertSeverity;
  type: AlertType;
  message: string;
  timestamp: string;
  acknowledged: boolean;
}

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertType =
  | "downtime"
  | "high_latency"
  | "data_stale"
  | "quarantine_pending"
  | "quarantine_applied"
  | "reputation_low";

/** Configuration for node health monitoring. */
export interface HealthMonitorConfig {
  /** Ping interval in milliseconds. */
  pingIntervalMs: number;
  /** Response time threshold for "high latency" alert (ms). */
  highLatencyThresholdMs: number;
  /** Data staleness threshold (hours since last COA record). */
  stalenessThresholdHours: number;
  /** Uptime threshold below which auto-quarantine triggers. */
  autoQuarantineUptimeThreshold: number;
  /** Number of consecutive failures before downtime alert. */
  consecutiveFailuresAlert: number;
  /** Reputation score threshold for "low reputation" alert. */
  lowReputationThreshold: number;
  /** Measurement window for metrics (hours). */
  metricsWindowHours: number;
}

const DEFAULT_HEALTH_CONFIG: HealthMonitorConfig = {
  pingIntervalMs: 60_000, // 1 minute
  highLatencyThresholdMs: 5_000, // 5 seconds
  stalenessThresholdHours: 24, // 1 day
  autoQuarantineUptimeThreshold: 0.5, // 50% uptime
  consecutiveFailuresAlert: 5,
  lowReputationThreshold: 0.3,
  metricsWindowHours: 168, // 7 days
};

// ---------------------------------------------------------------------------
// Reputation scoring weights
// ---------------------------------------------------------------------------

interface ReputationWeights {
  uptime: number;
  latency: number;
  freshness: number;
  trustLevel: number;
}

const REPUTATION_WEIGHTS: ReputationWeights = {
  uptime: 0.40,
  latency: 0.20,
  freshness: 0.20,
  trustLevel: 0.20,
};

// ---------------------------------------------------------------------------
// Health Monitor
// ---------------------------------------------------------------------------

export class NodeHealthMonitor {
  private readonly config: HealthMonitorConfig;
  private readonly checkHistory = new Map<string, HealthCheckResult[]>();
  private readonly quarantines = new Map<string, QuarantineRecord>();
  private readonly alerts: NodeAlert[] = [];
  private alertCounter = 0;

  constructor(config?: Partial<HealthMonitorConfig>) {
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Health checks
  // -------------------------------------------------------------------------

  /**
   * Record a health check result for a node.
   */
  recordCheck(result: HealthCheckResult): void {
    const history = this.checkHistory.get(result.nodeId) ?? [];
    history.push(result);

    // Keep only checks within the metrics window
    const cutoff = new Date(
      Date.now() - this.config.metricsWindowHours * 60 * 60 * 1000,
    ).toISOString();
    const trimmed = history.filter(c => c.timestamp >= cutoff);

    this.checkHistory.set(result.nodeId, trimmed);

    // Evaluate alerts
    this.evaluateAlerts(result, trimmed);
  }

  /**
   * Perform a simulated health check (for testing).
   * In production, this would make an HTTP request to the node.
   */
  createCheckResult(
    nodeId: string,
    reachable: boolean,
    responseTimeMs: number | null,
    latestDataTimestamp: string | null,
    now = new Date(),
  ): HealthCheckResult {
    const dataStale = latestDataTimestamp
      ? this.isDataStale(latestDataTimestamp, now)
      : false;

    return {
      nodeId,
      timestamp: now.toISOString(),
      reachable,
      responseTimeMs,
      latestDataTimestamp,
      dataStale,
    };
  }

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------

  /**
   * Compute aggregated health metrics for a node.
   */
  getMetrics(nodeId: string, trustLevel: TrustLevel = 1): NodeHealthMetrics | null {
    const history = this.checkHistory.get(nodeId);
    if (!history || history.length === 0) return null;

    const total = history.length;
    const successful = history.filter(c => c.reachable).length;
    const uptimePercent = successful / total;

    const responseTimes = history
      .filter(c => c.responseTimeMs !== null)
      .map(c => c.responseTimeMs!);

    const avgResponseTimeMs =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

    const sorted = [...responseTimes].sort((a, b) => a - b);
    const p95Index = Math.ceil(sorted.length * 0.95) - 1;
    const p95ResponseTimeMs = sorted.length > 0 ? sorted[Math.max(0, p95Index)]! : 0;

    const lastCheck = history[history.length - 1]!;
    const dataFreshnessOk = !lastCheck.dataStale;

    const reputationScore = this.computeReputation(
      uptimePercent,
      avgResponseTimeMs,
      dataFreshnessOk,
      trustLevel,
    );

    return {
      nodeId,
      uptimePercent,
      avgResponseTimeMs,
      p95ResponseTimeMs,
      totalChecks: total,
      successfulChecks: successful,
      dataFreshnessOk,
      lastCheckAt: lastCheck.timestamp,
      reputationScore,
    };
  }

  /**
   * Get metrics for all monitored nodes.
   */
  getAllMetrics(
    peerTrustLevels: Map<string, TrustLevel>,
  ): NodeHealthMetrics[] {
    const metrics: NodeHealthMetrics[] = [];
    for (const nodeId of this.checkHistory.keys()) {
      const trust = peerTrustLevels.get(nodeId) ?? 1;
      const m = this.getMetrics(nodeId, trust);
      if (m) metrics.push(m);
    }
    return metrics.sort((a, b) => b.reputationScore - a.reputationScore);
  }

  // -------------------------------------------------------------------------
  // Reputation
  // -------------------------------------------------------------------------

  /**
   * Compute public reputation score (0.0 - 1.0).
   */
  private computeReputation(
    uptimePercent: number,
    avgResponseTimeMs: number,
    dataFreshnessOk: boolean,
    trustLevel: TrustLevel,
  ): number {
    // Uptime factor: direct mapping
    const uptimeFactor = uptimePercent;

    // Latency factor: inverse — lower is better, capped at threshold
    const latencyFactor = Math.max(
      0,
      1 - avgResponseTimeMs / (this.config.highLatencyThresholdMs * 2),
    );

    // Freshness factor: binary
    const freshnessFactor = dataFreshnessOk ? 1.0 : 0.0;

    // Trust factor: normalized (0-3 → 0.0-1.0)
    const trustFactor = trustLevel / 3;

    return (
      uptimeFactor * REPUTATION_WEIGHTS.uptime +
      latencyFactor * REPUTATION_WEIGHTS.latency +
      freshnessFactor * REPUTATION_WEIGHTS.freshness +
      trustFactor * REPUTATION_WEIGHTS.trustLevel
    );
  }

  // -------------------------------------------------------------------------
  // Quarantine
  // -------------------------------------------------------------------------

  /**
   * Quarantine a node (via governance vote or auto-quarantine).
   */
  quarantineNode(
    nodeId: string,
    reason: QuarantineReason,
    proposalId?: string,
    expiresAt?: string,
  ): QuarantineRecord {
    const record: QuarantineRecord = {
      nodeId,
      reason,
      proposalId,
      quarantinedAt: new Date().toISOString(),
      expiresAt: expiresAt ?? null,
      active: true,
    };

    this.quarantines.set(nodeId, record);

    this.addAlert(nodeId, "critical", "quarantine_applied", `Node quarantined: ${reason}`);

    return record;
  }

  /**
   * Lift quarantine on a node.
   */
  liftQuarantine(nodeId: string): boolean {
    const record = this.quarantines.get(nodeId);
    if (!record || !record.active) return false;
    record.active = false;
    return true;
  }

  /**
   * Check if a node is quarantined.
   */
  isQuarantined(nodeId: string, now = new Date()): boolean {
    const record = this.quarantines.get(nodeId);
    if (!record || !record.active) return false;

    // Check expiration
    if (record.expiresAt && now > new Date(record.expiresAt)) {
      record.active = false;
      return false;
    }

    return true;
  }

  /**
   * Get quarantine record for a node.
   */
  getQuarantine(nodeId: string): QuarantineRecord | null {
    return this.quarantines.get(nodeId) ?? null;
  }

  /**
   * Expire all overdue quarantines.
   */
  expireQuarantines(now = new Date()): number {
    let expired = 0;
    for (const record of this.quarantines.values()) {
      if (record.active && record.expiresAt && now > new Date(record.expiresAt)) {
        record.active = false;
        expired++;
      }
    }
    return expired;
  }

  // -------------------------------------------------------------------------
  // Alerts
  // -------------------------------------------------------------------------

  /**
   * Get all unacknowledged alerts for a node.
   */
  getAlerts(nodeId?: string): NodeAlert[] {
    if (nodeId) {
      return this.alerts.filter(a => a.nodeId === nodeId && !a.acknowledged);
    }
    return this.alerts.filter(a => !a.acknowledged);
  }

  /**
   * Acknowledge an alert.
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.alertId === alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    return true;
  }

  /**
   * Acknowledge all alerts for a node.
   */
  acknowledgeAll(nodeId: string): number {
    let count = 0;
    for (const alert of this.alerts) {
      if (alert.nodeId === nodeId && !alert.acknowledged) {
        alert.acknowledged = true;
        count++;
      }
    }
    return count;
  }

  private addAlert(
    nodeId: string,
    severity: AlertSeverity,
    type: AlertType,
    message: string,
  ): void {
    this.alertCounter++;
    this.alerts.push({
      alertId: `alert-${this.alertCounter}`,
      nodeId,
      severity,
      type,
      message,
      timestamp: new Date().toISOString(),
      acknowledged: false,
    });
  }

  // -------------------------------------------------------------------------
  // Alert evaluation
  // -------------------------------------------------------------------------

  private evaluateAlerts(
    result: HealthCheckResult,
    history: HealthCheckResult[],
  ): void {
    // Check consecutive failures
    const recentFailures = this.countConsecutiveFailures(history);
    if (recentFailures >= this.config.consecutiveFailuresAlert) {
      this.addAlert(
        result.nodeId,
        "critical",
        "downtime",
        `Node has ${recentFailures} consecutive failed health checks`,
      );
    }

    // Check high latency
    if (result.reachable && result.responseTimeMs !== null) {
      if (result.responseTimeMs > this.config.highLatencyThresholdMs) {
        this.addAlert(
          result.nodeId,
          "warning",
          "high_latency",
          `Response time ${result.responseTimeMs}ms exceeds threshold ${this.config.highLatencyThresholdMs}ms`,
        );
      }
    }

    // Check data staleness
    if (result.dataStale) {
      this.addAlert(
        result.nodeId,
        "warning",
        "data_stale",
        "Node data is stale — no recent COA records",
      );
    }

    // Check auto-quarantine threshold
    if (history.length >= 10) {
      const uptime = history.filter(c => c.reachable).length / history.length;
      if (uptime < this.config.autoQuarantineUptimeThreshold) {
        if (!this.isQuarantined(result.nodeId)) {
          this.addAlert(
            result.nodeId,
            "critical",
            "quarantine_pending",
            `Uptime ${(uptime * 100).toFixed(1)}% is below auto-quarantine threshold`,
          );
        }
      }
    }
  }

  private countConsecutiveFailures(history: HealthCheckResult[]): number {
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (!history[i]!.reachable) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  private isDataStale(latestTimestamp: string, now: Date): boolean {
    const latest = new Date(latestTimestamp);
    const hoursOld = (now.getTime() - latest.getTime()) / (60 * 60 * 1000);
    return hoursOld > this.config.stalenessThresholdHours;
  }
}
