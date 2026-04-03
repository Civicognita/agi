/**
 * Network Maturation Tests — Phase 4 (Stories #40-41)
 *
 * Covers:
 *   - trust-engine.ts (TrustEngine): L3 evaluation, anchor appointment, emergency protocol
 *   - node-health.ts (NodeHealthMonitor): heartbeat, metrics, reputation, quarantine, alerts
 *   - protocol-stability.ts: endpoint registry, report generation, milestone assessments
 *   - legal-compliance.ts: templates, data flows, seal positioning, compliance gaps
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  TrustEngine,
  TRUST_LEVEL_NAMES,
  DEFAULT_ESTABLISHED_REQUIREMENTS,
  DEFAULT_ANCHOR_QUORUM,
} from "./trust-engine.js";
import type {
  TrustEvaluationInput,
  AnchorAppointment,
  EmergencyProtocolChange,
} from "./trust-engine.js";

import {
  NodeHealthMonitor,
} from "./node-health.js";
import type {
  HealthCheckResult,
} from "./node-health.js";

import {
  generateStabilityReport,
  FEDERATION_ENDPOINTS,
  VERSIONING_STRATEGY,
} from "./protocol-stability.js";

import {
  TOS_TEMPLATE,
  DPA_TEMPLATE,
  DATA_FLOWS,
  SEAL_POSITIONING,
  getComplianceGaps,
} from "./legal-compliance.js";
import type { ComplianceDocument } from "./legal-compliance.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAnchorAppointment(nodeId: string, overrides: Partial<AnchorAppointment> = {}): AnchorAppointment {
  return {
    nodeId,
    proposalId: `prop-${nodeId}`,
    votesFor: 7,
    votesAgainst: 1,
    appointedAt: new Date().toISOString(),
    witnesses: ["witness-1", "witness-2"],
    ...overrides,
  };
}

function makeEvalInput(overrides: Partial<TrustEvaluationInput> = {}): TrustEvaluationInput {
  const firstHandshake = new Date();
  firstHandshake.setDate(firstHandshake.getDate() - 100);
  return {
    nodeId: "test-node",
    firstHandshakeDate: firstHandshake,
    establishedCoVerifications: 6,
    disputedClaims: 0,
    inGoodStanding: true,
    ...overrides,
  };
}

function makeCheckResult(
  nodeId: string,
  reachable: boolean,
  responseTimeMs: number | null = 200,
): HealthCheckResult {
  return {
    nodeId,
    timestamp: new Date().toISOString(),
    reachable,
    responseTimeMs: reachable ? responseTimeMs : null,
    latestDataTimestamp: new Date().toISOString(),
    dataStale: false,
  };
}

// ---------------------------------------------------------------------------
// TrustEngine — TRUST_LEVEL_NAMES
// ---------------------------------------------------------------------------

describe("TRUST_LEVEL_NAMES", () => {
  it("level 0 is Unknown", () => {
    expect(TRUST_LEVEL_NAMES[0]).toBe("Unknown");
  });

  it("level 1 is Handshake", () => {
    expect(TRUST_LEVEL_NAMES[1]).toBe("Handshake");
  });

  it("level 2 is Verified", () => {
    expect(TRUST_LEVEL_NAMES[2]).toBe("Verified");
  });

  it("level 3 is Established", () => {
    expect(TRUST_LEVEL_NAMES[3]).toBe("Established");
  });

  it("level 4 is Anchor", () => {
    expect(TRUST_LEVEL_NAMES[4]).toBe("Anchor");
  });
});

// ---------------------------------------------------------------------------
// TrustEngine — default constants
// ---------------------------------------------------------------------------

describe("DEFAULT_ESTABLISHED_REQUIREMENTS", () => {
  it("requires 90 operational days", () => {
    expect(DEFAULT_ESTABLISHED_REQUIREMENTS.minOperationalDays).toBe(90);
  });

  it("requires 5 established co-verifications", () => {
    expect(DEFAULT_ESTABLISHED_REQUIREMENTS.minEstablishedCoVerifications).toBe(5);
  });

  it("allows zero disputed claims", () => {
    expect(DEFAULT_ESTABLISHED_REQUIREMENTS.maxDisputedClaims).toBe(0);
  });
});

describe("DEFAULT_ANCHOR_QUORUM", () => {
  it("requires 4 anchors for quorum", () => {
    expect(DEFAULT_ANCHOR_QUORUM.minAnchors).toBe(4);
  });

  it("has 5 total anchors", () => {
    expect(DEFAULT_ANCHOR_QUORUM.totalAnchors).toBe(5);
  });

  it("has 24-hour deadline", () => {
    expect(DEFAULT_ANCHOR_QUORUM.deadlineHours).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// TrustEngine — evaluateEstablished (L3)
// ---------------------------------------------------------------------------

describe("TrustEngine.evaluateEstablished — qualifies", () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = new TrustEngine();
  });

  it("returns qualifies=true when all requirements met", () => {
    const result = engine.evaluateEstablished(makeEvalInput());
    expect(result.qualifies).toBe(true);
  });

  it("returns empty gaps array when qualifying", () => {
    const result = engine.evaluateEstablished(makeEvalInput());
    expect(result.gaps).toHaveLength(0);
  });

  it("sets targetLevel to 3", () => {
    const result = engine.evaluateEstablished(makeEvalInput());
    expect(result.targetLevel).toBe(3);
  });

  it("sets currentLevel to 2", () => {
    const result = engine.evaluateEstablished(makeEvalInput());
    expect(result.currentLevel).toBe(2);
  });

  it("qualifies with exactly 90 days operational", () => {
    const now = new Date();
    const firstHandshake = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const result = engine.evaluateEstablished(
      makeEvalInput({ firstHandshakeDate: firstHandshake }),
      now,
    );
    expect(result.qualifies).toBe(true);
  });

  it("qualifies with exactly 5 co-verifications", () => {
    const result = engine.evaluateEstablished(
      makeEvalInput({ establishedCoVerifications: 5 }),
    );
    expect(result.qualifies).toBe(true);
  });
});

describe("TrustEngine.evaluateEstablished — insufficient days", () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = new TrustEngine();
  });

  it("does not qualify with 89 days operational", () => {
    const now = new Date();
    const firstHandshake = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);
    const result = engine.evaluateEstablished(
      makeEvalInput({ firstHandshakeDate: firstHandshake }),
      now,
    );
    expect(result.qualifies).toBe(false);
  });

  it("includes operational days gap", () => {
    const now = new Date();
    const firstHandshake = new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000);
    const result = engine.evaluateEstablished(
      makeEvalInput({ firstHandshakeDate: firstHandshake }),
      now,
    );
    const dayGap = result.gaps.find(g => g.requirement === "Operational days");
    expect(dayGap).toBeDefined();
    expect(dayGap!.needed).toBe(90);
    expect(dayGap!.current).toBe(50);
  });
});

describe("TrustEngine.evaluateEstablished — insufficient co-verifications", () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = new TrustEngine();
  });

  it("does not qualify with 4 co-verifications", () => {
    const result = engine.evaluateEstablished(
      makeEvalInput({ establishedCoVerifications: 4 }),
    );
    expect(result.qualifies).toBe(false);
  });

  it("includes co-verification gap", () => {
    const result = engine.evaluateEstablished(
      makeEvalInput({ establishedCoVerifications: 2 }),
    );
    const gap = result.gaps.find(g => g.requirement === "Established co-verifications");
    expect(gap).toBeDefined();
    expect(gap!.current).toBe(2);
    expect(gap!.needed).toBe(5);
  });
});

describe("TrustEngine.evaluateEstablished — disputed claims", () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = new TrustEngine();
  });

  it("does not qualify with 1 disputed claim", () => {
    const result = engine.evaluateEstablished(
      makeEvalInput({ disputedClaims: 1 }),
    );
    expect(result.qualifies).toBe(false);
  });

  it("includes disputed claims gap", () => {
    const result = engine.evaluateEstablished(
      makeEvalInput({ disputedClaims: 3 }),
    );
    const gap = result.gaps.find(g => g.requirement === "No disputed claims");
    expect(gap).toBeDefined();
    expect(gap!.current).toBe(3);
    expect(gap!.needed).toBe(0);
  });
});

describe("TrustEngine.evaluateEstablished — not in good standing", () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = new TrustEngine();
  });

  it("does not qualify when not in good standing", () => {
    const result = engine.evaluateEstablished(
      makeEvalInput({ inGoodStanding: false }),
    );
    expect(result.qualifies).toBe(false);
  });

  it("includes good standing gap", () => {
    const result = engine.evaluateEstablished(
      makeEvalInput({ inGoodStanding: false }),
    );
    const gap = result.gaps.find(g => g.requirement === "Good standing");
    expect(gap).toBeDefined();
    expect(gap!.current).toBe(false);
    expect(gap!.needed).toBe(true);
  });

  it("reports multiple gaps simultaneously", () => {
    const now = new Date();
    const firstHandshake = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const result = engine.evaluateEstablished(
      makeEvalInput({
        firstHandshakeDate: firstHandshake,
        establishedCoVerifications: 0,
        disputedClaims: 2,
        inGoodStanding: false,
      }),
      now,
    );
    expect(result.gaps).toHaveLength(4);
  });
});

describe("TrustEngine.evaluateEstablished — custom requirements", () => {
  it("respects custom minOperationalDays", () => {
    const engine = new TrustEngine({ minOperationalDays: 30 });
    const now = new Date();
    const firstHandshake = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
    const result = engine.evaluateEstablished(
      makeEvalInput({ firstHandshakeDate: firstHandshake }),
      now,
    );
    expect(result.qualifies).toBe(true);
  });

  it("respects custom minEstablishedCoVerifications", () => {
    const engine = new TrustEngine({ minEstablishedCoVerifications: 10 });
    const result = engine.evaluateEstablished(
      makeEvalInput({ establishedCoVerifications: 6 }),
    );
    expect(result.qualifies).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TrustEngine — Anchor management
// ---------------------------------------------------------------------------

describe("TrustEngine — anchor appointment", () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = new TrustEngine();
  });

  it("isAnchor returns false for unknown node", () => {
    expect(engine.isAnchor("node-1")).toBe(false);
  });

  it("isAnchor returns true after appointment", () => {
    engine.appointAnchor(makeAnchorAppointment("node-1"));
    expect(engine.isAnchor("node-1")).toBe(true);
  });

  it("getAnchors returns empty array initially", () => {
    expect(engine.getAnchors()).toHaveLength(0);
  });

  it("getAnchors returns all appointed anchors", () => {
    engine.appointAnchor(makeAnchorAppointment("node-1"));
    engine.appointAnchor(makeAnchorAppointment("node-2"));
    expect(engine.getAnchors()).toHaveLength(2);
  });

  it("revokeAnchor returns true when anchor existed", () => {
    engine.appointAnchor(makeAnchorAppointment("node-1"));
    expect(engine.revokeAnchor("node-1")).toBe(true);
  });

  it("revokeAnchor removes anchor from registry", () => {
    engine.appointAnchor(makeAnchorAppointment("node-1"));
    engine.revokeAnchor("node-1");
    expect(engine.isAnchor("node-1")).toBe(false);
  });

  it("revokeAnchor returns false for non-existent node", () => {
    expect(engine.revokeAnchor("nonexistent")).toBe(false);
  });

  it("getEffectiveTrustLevel returns 4 for anchor node", () => {
    engine.appointAnchor(makeAnchorAppointment("node-1"));
    const level = engine.getEffectiveTrustLevel({
      nodeId: "node-1",
      endpoint: "https://node1.example.com",
      publicKey: "pk1",
      trustLevel: 3,
      discoveryMethod: "manual",
      lastSeen: new Date().toISOString(),
      lastHandshake: null,
      failureCount: 0,
      online: true,
    });
    expect(level).toBe(4);
  });

  it("getEffectiveTrustLevel returns peer.trustLevel for non-anchor", () => {
    const level = engine.getEffectiveTrustLevel({
      nodeId: "node-x",
      endpoint: "https://nodex.example.com",
      publicKey: "pkx",
      trustLevel: 2,
      discoveryMethod: "manual",
      lastSeen: new Date().toISOString(),
      lastHandshake: null,
      failureCount: 0,
      online: true,
    });
    expect(level).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TrustEngine — Emergency protocol changes
// ---------------------------------------------------------------------------

describe("TrustEngine — createEmergencyChange", () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = new TrustEngine();
    engine.appointAnchor(makeAnchorAppointment("anchor-1"));
    engine.appointAnchor(makeAnchorAppointment("anchor-2"));
    engine.appointAnchor(makeAnchorAppointment("anchor-3"));
    engine.appointAnchor(makeAnchorAppointment("anchor-4"));
    engine.appointAnchor(makeAnchorAppointment("anchor-5"));
  });

  it("returns null when initiator is not an anchor", () => {
    const result = engine.createEmergencyChange(
      "chg-1",
      "Test change",
      "protocol_patch",
      "non-anchor",
      "sig-x",
    );
    expect(result).toBeNull();
  });

  it("creates change when initiator is an anchor", () => {
    const result = engine.createEmergencyChange(
      "chg-1",
      "Test change",
      "protocol_patch",
      "anchor-1",
      "sig-1",
    );
    expect(result).not.toBeNull();
    expect(result!.changeId).toBe("chg-1");
  });

  it("sets initial status to pending", () => {
    const result = engine.createEmergencyChange(
      "chg-1",
      "Test change",
      "protocol_patch",
      "anchor-1",
      "sig-1",
    );
    expect(result!.status).toBe("pending");
  });

  it("includes initiator as first approval", () => {
    const result = engine.createEmergencyChange(
      "chg-1",
      "Test change",
      "protocol_patch",
      "anchor-1",
      "sig-1",
    );
    expect(result!.approvals).toHaveLength(1);
    expect(result!.approvals[0]!.nodeId).toBe("anchor-1");
  });

  it("sets deadline 24 hours from now by default", () => {
    const now = new Date();
    const result = engine.createEmergencyChange(
      "chg-1",
      "Test change",
      "protocol_patch",
      "anchor-1",
      "sig-1",
      now,
    );
    const deadline = new Date(result!.deadline);
    const expectedDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(Math.abs(deadline.getTime() - expectedDeadline.getTime())).toBeLessThan(1000);
  });

  it("sets createdAt to provided now", () => {
    const now = new Date("2025-06-01T12:00:00Z");
    const result = engine.createEmergencyChange(
      "chg-1",
      "Test change",
      "node_quarantine",
      "anchor-1",
      "sig-1",
      now,
    );
    expect(result!.createdAt).toBe("2025-06-01T12:00:00.000Z");
  });

  it("stores change for later retrieval", () => {
    engine.createEmergencyChange("chg-1", "Test change", "emergency_freeze", "anchor-1", "sig-1");
    const retrieved = engine.getEmergencyChange("chg-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.changeId).toBe("chg-1");
  });
});

describe("TrustEngine — approveEmergencyChange", () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = new TrustEngine();
    for (let i = 1; i <= 5; i++) {
      engine.appointAnchor(makeAnchorAppointment(`anchor-${i}`));
    }
    engine.createEmergencyChange("chg-1", "Test change", "protocol_patch", "anchor-1", "sig-1");
  });

  it("returns null for non-existent change", () => {
    const result = engine.approveEmergencyChange("nonexistent", "anchor-2", "sig-2");
    expect(result).toBeNull();
  });

  it("returns null when approver is not an anchor", () => {
    const result = engine.approveEmergencyChange("chg-1", "not-anchor", "sig-x");
    expect(result).toBeNull();
  });

  it("adds approval from second anchor", () => {
    engine.approveEmergencyChange("chg-1", "anchor-2", "sig-2");
    const change = engine.getEmergencyChange("chg-1")!;
    expect(change.approvals).toHaveLength(2);
  });

  it("does not add duplicate approval from same anchor", () => {
    engine.approveEmergencyChange("chg-1", "anchor-1", "sig-1-dup");
    const change = engine.getEmergencyChange("chg-1")!;
    expect(change.approvals).toHaveLength(1);
  });

  it("reaches approved status after 4 approvals (quorum)", () => {
    engine.approveEmergencyChange("chg-1", "anchor-2", "sig-2");
    engine.approveEmergencyChange("chg-1", "anchor-3", "sig-3");
    engine.approveEmergencyChange("chg-1", "anchor-4", "sig-4");
    const change = engine.getEmergencyChange("chg-1")!;
    expect(change.status).toBe("approved");
  });

  it("returns expired status when deadline has passed", () => {
    const pastDeadline = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const result = engine.approveEmergencyChange("chg-1", "anchor-2", "sig-2", pastDeadline);
    expect(result!.status).toBe("expired");
  });

  it("returns null when change is already approved (not pending)", () => {
    engine.approveEmergencyChange("chg-1", "anchor-2", "sig-2");
    engine.approveEmergencyChange("chg-1", "anchor-3", "sig-3");
    engine.approveEmergencyChange("chg-1", "anchor-4", "sig-4");
    const result = engine.approveEmergencyChange("chg-1", "anchor-5", "sig-5");
    expect(result).toBeNull();
  });
});

describe("TrustEngine — rejectEmergencyChange", () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = new TrustEngine();
    engine.appointAnchor(makeAnchorAppointment("anchor-1"));
    engine.appointAnchor(makeAnchorAppointment("anchor-2"));
    engine.createEmergencyChange("chg-1", "Test change", "protocol_patch", "anchor-1", "sig-1");
  });

  it("returns true when anchor rejects a pending change", () => {
    expect(engine.rejectEmergencyChange("chg-1", "anchor-2")).toBe(true);
  });

  it("sets status to rejected", () => {
    engine.rejectEmergencyChange("chg-1", "anchor-2");
    const change = engine.getEmergencyChange("chg-1")!;
    expect(change.status).toBe("rejected");
  });

  it("returns false for non-anchor rejector", () => {
    expect(engine.rejectEmergencyChange("chg-1", "not-anchor")).toBe(false);
  });

  it("returns false for non-existent change", () => {
    expect(engine.rejectEmergencyChange("nonexistent", "anchor-1")).toBe(false);
  });
});

describe("TrustEngine — expireOverdueChanges", () => {
  let engine: TrustEngine;

  beforeEach(() => {
    engine = new TrustEngine();
    engine.appointAnchor(makeAnchorAppointment("anchor-1"));
  });

  it("returns 0 when no overdue changes", () => {
    engine.createEmergencyChange("chg-1", "Test", "protocol_patch", "anchor-1", "sig-1");
    expect(engine.expireOverdueChanges(new Date())).toBe(0);
  });

  it("expires changes past their deadline", () => {
    const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
    engine.createEmergencyChange("chg-1", "Test", "protocol_patch", "anchor-1", "sig-1", past);
    const count = engine.expireOverdueChanges(new Date());
    expect(count).toBe(1);
  });

  it("sets expired changes to expired status", () => {
    const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
    engine.createEmergencyChange("chg-1", "Test", "protocol_patch", "anchor-1", "sig-1", past);
    engine.expireOverdueChanges(new Date());
    expect(engine.getEmergencyChange("chg-1")!.status).toBe("expired");
  });

  it("getPendingChanges returns only pending changes", () => {
    engine.createEmergencyChange("chg-1", "Test", "protocol_patch", "anchor-1", "sig-1");
    engine.createEmergencyChange("chg-2", "Test2", "node_quarantine", "anchor-1", "sig-x");
    const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
    engine.createEmergencyChange("chg-3", "Old", "emergency_freeze", "anchor-1", "sig-y", past);
    engine.expireOverdueChanges(new Date());
    const pending = engine.getPendingChanges();
    expect(pending.every((c: EmergencyProtocolChange) => c.status === "pending")).toBe(true);
    expect(pending.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// NodeHealthMonitor — health checks and history
// ---------------------------------------------------------------------------

describe("NodeHealthMonitor.createCheckResult", () => {
  let monitor: NodeHealthMonitor;

  beforeEach(() => {
    monitor = new NodeHealthMonitor();
  });

  it("marks reachable check correctly", () => {
    const result = monitor.createCheckResult("node-1", true, 150, null);
    expect(result.reachable).toBe(true);
    expect(result.responseTimeMs).toBe(150);
  });

  it("marks unreachable check correctly", () => {
    const result = monitor.createCheckResult("node-1", false, null, null);
    expect(result.reachable).toBe(false);
    expect(result.responseTimeMs).toBeNull();
  });

  it("sets nodeId correctly", () => {
    const result = monitor.createCheckResult("my-node", true, 100, null);
    expect(result.nodeId).toBe("my-node");
  });

  it("marks fresh data as not stale", () => {
    const now = new Date();
    const recentTimestamp = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const result = monitor.createCheckResult("node-1", true, 100, recentTimestamp, now);
    expect(result.dataStale).toBe(false);
  });

  it("marks old data as stale (30 hours ago > 24h threshold)", () => {
    const now = new Date();
    const staleTimestamp = new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString();
    const result = monitor.createCheckResult("node-1", true, 100, staleTimestamp, now);
    expect(result.dataStale).toBe(true);
  });

  it("returns false for dataStale when latestDataTimestamp is null", () => {
    const result = monitor.createCheckResult("node-1", true, 100, null);
    expect(result.dataStale).toBe(false);
  });
});

describe("NodeHealthMonitor.getMetrics", () => {
  let monitor: NodeHealthMonitor;

  beforeEach(() => {
    monitor = new NodeHealthMonitor();
  });

  it("returns null when no checks recorded", () => {
    expect(monitor.getMetrics("node-1")).toBeNull();
  });

  it("computes 100% uptime for all successful checks", () => {
    for (let i = 0; i < 5; i++) {
      monitor.recordCheck(makeCheckResult("node-1", true, 100));
    }
    const metrics = monitor.getMetrics("node-1")!;
    expect(metrics.uptimePercent).toBeCloseTo(1.0);
  });

  it("computes 50% uptime for half success/fail", () => {
    for (let i = 0; i < 4; i++) {
      monitor.recordCheck(makeCheckResult("node-1", i % 2 === 0, 100));
    }
    const metrics = monitor.getMetrics("node-1")!;
    expect(metrics.uptimePercent).toBeCloseTo(0.5);
  });

  it("computes correct totalChecks", () => {
    for (let i = 0; i < 7; i++) {
      monitor.recordCheck(makeCheckResult("node-1", true, 200));
    }
    const metrics = monitor.getMetrics("node-1")!;
    expect(metrics.totalChecks).toBe(7);
  });

  it("computes correct successfulChecks", () => {
    monitor.recordCheck(makeCheckResult("node-1", true, 100));
    monitor.recordCheck(makeCheckResult("node-1", true, 100));
    monitor.recordCheck(makeCheckResult("node-1", false, null));
    const metrics = monitor.getMetrics("node-1")!;
    expect(metrics.successfulChecks).toBe(2);
  });

  it("computes average response time", () => {
    monitor.recordCheck(makeCheckResult("node-1", true, 100));
    monitor.recordCheck(makeCheckResult("node-1", true, 300));
    const metrics = monitor.getMetrics("node-1")!;
    expect(metrics.avgResponseTimeMs).toBeCloseTo(200);
  });

  it("sets avgResponseTimeMs to 0 when no successful checks", () => {
    monitor.recordCheck(makeCheckResult("node-1", false, null));
    monitor.recordCheck(makeCheckResult("node-1", false, null));
    const metrics = monitor.getMetrics("node-1")!;
    expect(metrics.avgResponseTimeMs).toBe(0);
  });

  it("computes p95 response time", () => {
    for (let i = 1; i <= 20; i++) {
      monitor.recordCheck(makeCheckResult("node-1", true, i * 100));
    }
    const metrics = monitor.getMetrics("node-1")!;
    expect(metrics.p95ResponseTimeMs).toBeGreaterThan(0);
    expect(metrics.p95ResponseTimeMs).toBeLessThanOrEqual(2000);
  });

  it("sets dataFreshnessOk based on last check staleness", () => {
    const freshCheck: HealthCheckResult = {
      nodeId: "node-1",
      timestamp: new Date().toISOString(),
      reachable: true,
      responseTimeMs: 100,
      latestDataTimestamp: new Date().toISOString(),
      dataStale: false,
    };
    monitor.recordCheck(freshCheck);
    const metrics = monitor.getMetrics("node-1")!;
    expect(metrics.dataFreshnessOk).toBe(true);
  });

  it("reputationScore is between 0 and 1", () => {
    for (let i = 0; i < 5; i++) {
      monitor.recordCheck(makeCheckResult("node-1", true, 200));
    }
    const metrics = monitor.getMetrics("node-1", 3)!;
    expect(metrics.reputationScore).toBeGreaterThanOrEqual(0);
    expect(metrics.reputationScore).toBeLessThanOrEqual(1);
  });

  it("higher trust level contributes to higher reputation", () => {
    for (let i = 0; i < 5; i++) {
      monitor.recordCheck(makeCheckResult("node-1", true, 200));
      monitor.recordCheck(makeCheckResult("node-2", true, 200));
    }
    const m1 = monitor.getMetrics("node-1", 1)!;
    const m3 = monitor.getMetrics("node-2", 3)!;
    expect(m3.reputationScore).toBeGreaterThan(m1.reputationScore);
  });
});

describe("NodeHealthMonitor.getAllMetrics", () => {
  let monitor: NodeHealthMonitor;

  beforeEach(() => {
    monitor = new NodeHealthMonitor();
  });

  it("returns empty array when no nodes recorded", () => {
    expect(monitor.getAllMetrics(new Map())).toHaveLength(0);
  });

  it("returns metrics for all monitored nodes", () => {
    monitor.recordCheck(makeCheckResult("node-1", true, 100));
    monitor.recordCheck(makeCheckResult("node-2", true, 200));
    const result = monitor.getAllMetrics(new Map());
    expect(result).toHaveLength(2);
  });

  it("sorts by reputation score descending", () => {
    for (let i = 0; i < 5; i++) {
      monitor.recordCheck(makeCheckResult("node-good", true, 100));
      monitor.recordCheck(makeCheckResult("node-bad", false, null));
    }
    const result = monitor.getAllMetrics(new Map());
    expect(result[0]!.reputationScore).toBeGreaterThanOrEqual(result[result.length - 1]!.reputationScore);
  });
});

// ---------------------------------------------------------------------------
// NodeHealthMonitor — quarantine
// ---------------------------------------------------------------------------

describe("NodeHealthMonitor — quarantine", () => {
  let monitor: NodeHealthMonitor;

  beforeEach(() => {
    monitor = new NodeHealthMonitor();
  });

  it("isQuarantined returns false for unknown node", () => {
    expect(monitor.isQuarantined("node-1")).toBe(false);
  });

  it("quarantineNode activates quarantine", () => {
    monitor.quarantineNode("node-1", "governance_vote", "prop-001");
    expect(monitor.isQuarantined("node-1")).toBe(true);
  });

  it("quarantineNode creates quarantine record with correct reason", () => {
    monitor.quarantineNode("node-1", "sustained_downtime");
    const record = monitor.getQuarantine("node-1")!;
    expect(record.reason).toBe("sustained_downtime");
  });

  it("quarantineNode stores proposalId when provided", () => {
    monitor.quarantineNode("node-1", "governance_vote", "prop-123");
    const record = monitor.getQuarantine("node-1")!;
    expect(record.proposalId).toBe("prop-123");
  });

  it("quarantineNode sets expiresAt when provided", () => {
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    monitor.quarantineNode("node-1", "data_staleness", undefined, expiry);
    const record = monitor.getQuarantine("node-1")!;
    expect(record.expiresAt).toBe(expiry);
  });

  it("quarantineNode sets expiresAt to null when not provided", () => {
    monitor.quarantineNode("node-1", "security_concern");
    const record = monitor.getQuarantine("node-1")!;
    expect(record.expiresAt).toBeNull();
  });

  it("liftQuarantine returns true and deactivates quarantine", () => {
    monitor.quarantineNode("node-1", "protocol_violation");
    expect(monitor.liftQuarantine("node-1")).toBe(true);
    expect(monitor.isQuarantined("node-1")).toBe(false);
  });

  it("liftQuarantine returns false when node not quarantined", () => {
    expect(monitor.liftQuarantine("node-1")).toBe(false);
  });

  it("getQuarantine returns null for unknown node", () => {
    expect(monitor.getQuarantine("node-1")).toBeNull();
  });

  it("quarantine expires automatically when past expiry", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    monitor.quarantineNode("node-1", "data_staleness", undefined, past);
    expect(monitor.isQuarantined("node-1", new Date())).toBe(false);
  });

  it("expireQuarantines returns count of expired records", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    monitor.quarantineNode("node-1", "data_staleness", undefined, past);
    monitor.quarantineNode("node-2", "data_staleness", undefined, past);
    expect(monitor.expireQuarantines(new Date())).toBe(2);
  });

  it("quarantine creates a critical alert", () => {
    monitor.quarantineNode("node-1", "governance_vote");
    const alerts = monitor.getAlerts("node-1");
    const quarantineAlert = alerts.find(a => a.type === "quarantine_applied");
    expect(quarantineAlert).toBeDefined();
    expect(quarantineAlert!.severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// NodeHealthMonitor — alerts
// ---------------------------------------------------------------------------

describe("NodeHealthMonitor — alerts", () => {
  let monitor: NodeHealthMonitor;

  beforeEach(() => {
    monitor = new NodeHealthMonitor({ consecutiveFailuresAlert: 3 });
  });

  it("getAlerts returns empty array when no alerts", () => {
    expect(monitor.getAlerts()).toHaveLength(0);
  });

  it("generates downtime alert after consecutive failures", () => {
    for (let i = 0; i < 3; i++) {
      monitor.recordCheck(makeCheckResult("node-1", false, null));
    }
    const alerts = monitor.getAlerts("node-1");
    const downtimeAlert = alerts.find(a => a.type === "downtime");
    expect(downtimeAlert).toBeDefined();
    expect(downtimeAlert!.severity).toBe("critical");
  });

  it("generates high_latency alert when response exceeds threshold", () => {
    monitor.recordCheck({
      ...makeCheckResult("node-1", true, 6000),
      responseTimeMs: 6000,
    });
    const alerts = monitor.getAlerts("node-1");
    const latencyAlert = alerts.find(a => a.type === "high_latency");
    expect(latencyAlert).toBeDefined();
    expect(latencyAlert!.severity).toBe("warning");
  });

  it("generates data_stale alert when data is stale", () => {
    const staleCheck: HealthCheckResult = {
      nodeId: "node-1",
      timestamp: new Date().toISOString(),
      reachable: true,
      responseTimeMs: 200,
      latestDataTimestamp: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
      dataStale: true,
    };
    monitor.recordCheck(staleCheck);
    const alerts = monitor.getAlerts("node-1");
    const staleAlert = alerts.find(a => a.type === "data_stale");
    expect(staleAlert).toBeDefined();
  });

  it("acknowledgeAlert marks alert as acknowledged", () => {
    monitor.quarantineNode("node-1", "security_concern");
    const alerts = monitor.getAlerts("node-1");
    const alertId = alerts[0]!.alertId;
    expect(monitor.acknowledgeAlert(alertId)).toBe(true);
    expect(monitor.getAlerts("node-1")).toHaveLength(0);
  });

  it("acknowledgeAlert returns false for unknown alertId", () => {
    expect(monitor.acknowledgeAlert("nonexistent-alert")).toBe(false);
  });

  it("acknowledgeAll acknowledges all unacknowledged alerts for node", () => {
    monitor.quarantineNode("node-1", "security_concern");
    monitor.quarantineNode("node-1", "protocol_violation");
    const count = monitor.acknowledgeAll("node-1");
    expect(count).toBe(2);
    expect(monitor.getAlerts("node-1")).toHaveLength(0);
  });

  it("acknowledgeAll returns 0 when no unacknowledged alerts", () => {
    expect(monitor.acknowledgeAll("node-1")).toBe(0);
  });

  it("getAlerts without nodeId returns all unacknowledged alerts", () => {
    monitor.quarantineNode("node-1", "security_concern");
    monitor.quarantineNode("node-2", "data_staleness");
    expect(monitor.getAlerts()).toHaveLength(2);
  });

  it("generates quarantine_pending alert when uptime below threshold", () => {
    const mon = new NodeHealthMonitor({ autoQuarantineUptimeThreshold: 0.8 });
    for (let i = 0; i < 10; i++) {
      mon.recordCheck(makeCheckResult("node-1", i < 3, 100));
    }
    const alerts = mon.getAlerts("node-1");
    const pendingAlert = alerts.find(a => a.type === "quarantine_pending");
    expect(pendingAlert).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Protocol Stability — FEDERATION_ENDPOINTS
// ---------------------------------------------------------------------------

describe("FEDERATION_ENDPOINTS", () => {
  it("includes POST /fed/v1/peer/hello as stable", () => {
    const hello = FEDERATION_ENDPOINTS.find(e => e.path === "/fed/v1/peer/hello");
    expect(hello).toBeDefined();
    expect(hello!.status).toBe("stable");
  });

  it("hello endpoint has zero breaking change risk", () => {
    const hello = FEDERATION_ENDPOINTS.find(e => e.path === "/fed/v1/peer/hello");
    expect(hello!.breakingChangeRisk).toBe("none");
  });

  it("includes GET /fed/v1/entities/:geid", () => {
    const entity = FEDERATION_ENDPOINTS.find(e => e.path === "/fed/v1/entities/:geid");
    expect(entity).toBeDefined();
    expect(entity!.method).toBe("GET");
  });

  it("POST /fed/v1/peer/verify is experimental", () => {
    const verify = FEDERATION_ENDPOINTS.find(e => e.path === "/fed/v1/peer/verify");
    expect(verify).toBeDefined();
    expect(verify!.status).toBe("experimental");
  });

  it("POST /fed/v1/governance/emergency requires trust level 3", () => {
    const emergency = FEDERATION_ENDPOINTS.find(e => e.path === "/fed/v1/governance/emergency");
    expect(emergency).toBeDefined();
    expect(emergency!.minTrustLevel).toBe(3);
  });

  it("all endpoints have a sinceVersion field", () => {
    for (const ep of FEDERATION_ENDPOINTS) {
      expect(ep.sinceVersion).toBeTruthy();
    }
  });

  it("no endpoints have HIGH breaking change risk", () => {
    const highRisk = FEDERATION_ENDPOINTS.filter(e => e.breakingChangeRisk === "high");
    expect(highRisk).toHaveLength(0);
  });
});

describe("VERSIONING_STRATEGY", () => {
  it("uses path-based versioning approach", () => {
    expect(VERSIONING_STRATEGY.approach).toBe("path-based");
  });

  it("current version is v1", () => {
    expect(VERSIONING_STRATEGY.currentVersion).toBe("v1");
  });

  it("next version is v2", () => {
    expect(VERSIONING_STRATEGY.nextVersion).toBe("v2");
  });

  it("deprecation notice period is 90 days", () => {
    expect(VERSIONING_STRATEGY.deprecationNoticeDays).toBe(90);
  });

  it("sunset period is 180 days", () => {
    expect(VERSIONING_STRATEGY.sunsetPeriodDays).toBe(180);
  });
});

// ---------------------------------------------------------------------------
// Protocol Stability — generateStabilityReport
// ---------------------------------------------------------------------------

describe("generateStabilityReport — conditional (experimental endpoints)", () => {
  it("returns conditional recommendation when experimental endpoints exist", () => {
    const report = generateStabilityReport();
    expect(report.recommendation).toBe("conditional");
  });

  it("has no blockers when no high-risk endpoints", () => {
    const report = generateStabilityReport();
    expect(report.blockers).toHaveLength(0);
  });

  it("has warnings for experimental endpoints", () => {
    const report = generateStabilityReport();
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it("sets protocol version to v1", () => {
    const report = generateStabilityReport();
    expect(report.protocolVersion).toBe("v1");
  });

  it("includes all federation endpoints", () => {
    const report = generateStabilityReport();
    expect(report.endpoints).toHaveLength(FEDERATION_ENDPOINTS.length);
  });

  it("includes versioning strategy", () => {
    const report = generateStabilityReport();
    expect(report.versioningStrategy.approach).toBe("path-based");
  });

  it("includes two milestones", () => {
    const report = generateStabilityReport();
    expect(report.milestones).toHaveLength(2);
  });

  it("generatedAt is a valid ISO timestamp", () => {
    const report = generateStabilityReport();
    expect(() => new Date(report.generatedAt)).not.toThrow();
  });
});

describe("generateStabilityReport — milestone M1", () => {
  it("M1 not met when no voters or nodes", () => {
    const report = generateStabilityReport();
    const m1 = report.milestones.find(m => m.milestoneId === "M1")!;
    expect(m1.met).toBe(false);
  });

  it("M1 met when thresholds satisfied", () => {
    const report = generateStabilityReport({ tier2PlusVoters: 500, activeNodes: 5 });
    const m1 = report.milestones.find(m => m.milestoneId === "M1")!;
    expect(m1.met).toBe(true);
  });

  it("M1 gap lists voter shortfall", () => {
    const report = generateStabilityReport({ tier2PlusVoters: 100, activeNodes: 5 });
    const m1 = report.milestones.find(m => m.milestoneId === "M1")!;
    const voterGap = m1.gaps.find(g => g.includes("voters"));
    expect(voterGap).toBeDefined();
    expect(voterGap!).toContain("400");
  });

  it("M1 gap lists node shortfall", () => {
    const report = generateStabilityReport({ tier2PlusVoters: 500, activeNodes: 2 });
    const m1 = report.milestones.find(m => m.milestoneId === "M1")!;
    const nodeGap = m1.gaps.find(g => g.includes("nodes"));
    expect(nodeGap).toBeDefined();
    expect(nodeGap!).toContain("3");
  });

  it("M1 has no gaps when fully met", () => {
    const report = generateStabilityReport({ tier2PlusVoters: 600, activeNodes: 10 });
    const m1 = report.milestones.find(m => m.milestoneId === "M1")!;
    expect(m1.gaps).toHaveLength(0);
  });
});

describe("generateStabilityReport — milestone M2", () => {
  it("M2 not met with only M1 thresholds", () => {
    const report = generateStabilityReport({ tier2PlusVoters: 500, activeNodes: 5 });
    const m2 = report.milestones.find(m => m.milestoneId === "M2")!;
    expect(m2.met).toBe(false);
  });

  it("M2 met when 2000 voters and 10 nodes", () => {
    const report = generateStabilityReport({ tier2PlusVoters: 2000, activeNodes: 10 });
    const m2 = report.milestones.find(m => m.milestoneId === "M2")!;
    expect(m2.met).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Legal Compliance — templates
// ---------------------------------------------------------------------------

describe("TOS_TEMPLATE", () => {
  it("type is terms_of_service", () => {
    expect(TOS_TEMPLATE.type).toBe("terms_of_service");
  });

  it("status is draft", () => {
    expect(TOS_TEMPLATE.status).toBe("draft");
  });

  it("has at least 4 sections", () => {
    expect(TOS_TEMPLATE.sections.length).toBeGreaterThanOrEqual(4);
  });

  it("seal-positioning section exists", () => {
    const section = TOS_TEMPLATE.sections.find(s => s.id === "seal-positioning");
    expect(section).toBeDefined();
  });

  it("all sections require legal review", () => {
    for (const section of TOS_TEMPLATE.sections) {
      expect(section.legalReviewRequired).toBe(true);
    }
  });

  it("all sections have pending review status", () => {
    for (const section of TOS_TEMPLATE.sections) {
      expect(section.reviewStatus).toBe("pending");
    }
  });

  it("data-handling section references GDPR", () => {
    const section = TOS_TEMPLATE.sections.find(s => s.id === "data-handling");
    expect(section).toBeDefined();
    expect(section!.content).toContain("GDPR");
  });
});

describe("DPA_TEMPLATE", () => {
  it("type is data_processing_agreement", () => {
    expect(DPA_TEMPLATE.type).toBe("data_processing_agreement");
  });

  it("status is draft", () => {
    expect(DPA_TEMPLATE.status).toBe("draft");
  });

  it("has breach-notification section", () => {
    const section = DPA_TEMPLATE.sections.find(s => s.id === "breach-notification");
    expect(section).toBeDefined();
  });

  it("breach-notification mentions 72 hours", () => {
    const section = DPA_TEMPLATE.sections.find(s => s.id === "breach-notification")!;
    expect(section.content).toContain("72 hours");
  });

  it("sub-processors section mentions federated nodes", () => {
    const section = DPA_TEMPLATE.sections.find(s => s.id === "sub-processors")!;
    expect(section.content).toContain("Federated nodes");
  });
});

// ---------------------------------------------------------------------------
// Legal Compliance — DATA_FLOWS
// ---------------------------------------------------------------------------

describe("DATA_FLOWS", () => {
  it("contains at least 4 data flow records", () => {
    expect(DATA_FLOWS.length).toBeGreaterThanOrEqual(4);
  });

  it("entity GEID flow uses legitimate interest basis", () => {
    const flow = DATA_FLOWS.find(f => f.dataType.includes("GEID"));
    expect(flow).toBeDefined();
    expect(flow!.legalBasis).toContain("Legitimate interest");
  });

  it("governance votes flow uses consent basis", () => {
    const flow = DATA_FLOWS.find(f => f.dataType.includes("Governance votes"));
    expect(flow).toBeDefined();
    expect(flow!.legalBasis).toContain("Consent");
  });

  it("all flows have minimization measures", () => {
    for (const flow of DATA_FLOWS) {
      expect(flow.minimization).toBeTruthy();
    }
  });

  it("all flows have purpose defined", () => {
    for (const flow of DATA_FLOWS) {
      expect(flow.purpose).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Legal Compliance — SEAL_POSITIONING
// ---------------------------------------------------------------------------

describe("SEAL_POSITIONING", () => {
  it("sealIs has at least one entry", () => {
    expect(SEAL_POSITIONING.sealIs.length).toBeGreaterThan(0);
  });

  it("sealIsNot includes legal certification", () => {
    const entry = SEAL_POSITIONING.sealIsNot.find(s => s.toLowerCase().includes("legal certification"));
    expect(entry).toBeDefined();
  });

  it("sealIsNot includes financial instrument", () => {
    const entry = SEAL_POSITIONING.sealIsNot.find(s => s.toLowerCase().includes("financial instrument"));
    expect(entry).toBeDefined();
  });

  it("externalUseDisclaimer is not empty", () => {
    expect(SEAL_POSITIONING.externalUseDisclaimer).toBeTruthy();
    expect(SEAL_POSITIONING.externalUseDisclaimer.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// Legal Compliance — getComplianceGaps
// ---------------------------------------------------------------------------

describe("getComplianceGaps", () => {
  it("returns empty array for empty documents list", () => {
    expect(getComplianceGaps([])).toHaveLength(0);
  });

  it("returns gap for document with unreviewed sections", () => {
    const gaps = getComplianceGaps([TOS_TEMPLATE]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.document).toBe("terms_of_service");
  });

  it("lists all pending sections in gap", () => {
    const gaps = getComplianceGaps([TOS_TEMPLATE]);
    expect(gaps[0]!.unreviewedSections.length).toBe(TOS_TEMPLATE.sections.length);
  });

  it("returns no gaps for document with all approved sections", () => {
    const approved: ComplianceDocument = {
      type: "privacy_policy",
      version: "1.0.0",
      effectiveDate: "2025-01-01",
      lastReviewedDate: "2025-01-01",
      status: "active",
      sections: [
        {
          id: "s1",
          title: "Collection",
          content: "We collect...",
          legalReviewRequired: true,
          reviewStatus: "approved",
        },
      ],
    };
    expect(getComplianceGaps([approved])).toHaveLength(0);
  });

  it("skips sections that do not require legal review", () => {
    const noReview: ComplianceDocument = {
      type: "impact_liability_disclaimer",
      version: "1.0.0",
      effectiveDate: "",
      lastReviewedDate: "",
      status: "draft",
      sections: [
        {
          id: "s1",
          title: "Disclaimer",
          content: "...",
          legalReviewRequired: false,
          reviewStatus: "pending",
        },
      ],
    };
    expect(getComplianceGaps([noReview])).toHaveLength(0);
  });

  it("identifies gaps across multiple documents", () => {
    const gaps = getComplianceGaps([TOS_TEMPLATE, DPA_TEMPLATE]);
    expect(gaps.length).toBe(2);
  });

  it("reviewed (not approved) sections count as gaps", () => {
    const reviewed: ComplianceDocument = {
      type: "gdpr_erasure_memo",
      version: "1.0.0",
      effectiveDate: "",
      lastReviewedDate: "",
      status: "review",
      sections: [
        {
          id: "s1",
          title: "Erasure",
          content: "...",
          legalReviewRequired: true,
          reviewStatus: "reviewed",
        },
      ],
    };
    const gaps = getComplianceGaps([reviewed]);
    expect(gaps).toHaveLength(1);
  });
});
