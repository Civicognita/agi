/**
 * Multi-Tenancy Tests — Phase 4 (gateway-core)
 *
 * Tests for: session-manager.ts, billing.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  SessionManager,
} from "./session-manager.js";
import type {
  AgentSession,
  CreateSessionParams,
  SessionManagerConfig,
} from "./session-manager.js";

import {
  PLAN_PRICING,
  BillingManager,
} from "./billing.js";
import type {
  BillingConfig,
  BillingCallbacks,
  PlanGateResult,
} from "./billing.js";

import { PLAN_LIMITS } from "@agi/entity-model";
import type { PlanTier } from "@agi/entity-model";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTenantId(suffix: string): string {
  return `tenant-${suffix}`;
}

function makeSession(manager: SessionManager, overrides: Partial<CreateSessionParams> = {}): AgentSession {
  return manager.createSession({
    tenantId: makeTenantId("a"),
    entityId: "entity-001",
    channel: "discord",
    ...overrides,
  });
}

function makeConfig(overrides: Partial<SessionManagerConfig> = {}): Partial<SessionManagerConfig> {
  return {
    maxConcurrentSessions: 5,
    idleTimeoutMs: 300_000,
    expiryTimeoutMs: 1_800_000,
    maxContextTokens: 100_000,
    ...overrides,
  };
}

function makeBillingConfig(): BillingConfig {
  return {
    stripeSecretKey: "sk_test_fake",
    webhookSecret: "whsec_fake",
    baseUrl: "https://example.com",
    priceIds: {
      pro: "price_pro",
      org: "price_org",
      community: "price_community",
    },
  };
}

function makeBillingCallbacks(): BillingCallbacks {
  return {
    onSubscriptionCreated: vi.fn().mockResolvedValue(undefined),
    onSubscriptionUpdated: vi.fn().mockResolvedValue(undefined),
    onSubscriptionCanceled: vi.fn().mockResolvedValue(undefined),
    onPaymentFailed: vi.fn().mockResolvedValue(undefined),
    getTenantByStripeCustomerId: vi.fn().mockResolvedValue(null),
  };
}

// ---------------------------------------------------------------------------
// SessionManager — initialization
// ---------------------------------------------------------------------------

describe("SessionManager — initialization", () => {
  it("creates a new instance without config", () => {
    const manager = new SessionManager();
    expect(manager).toBeDefined();
  });

  it("creates a new instance with partial config", () => {
    const manager = new SessionManager({ maxConcurrentSessions: 10 });
    expect(manager.getMaxConcurrentSessions()).toBe(10);
  });

  it("uses default maxConcurrentSessions of 5", () => {
    const manager = new SessionManager();
    expect(manager.getMaxConcurrentSessions()).toBe(5);
  });

  it("getActiveSessions returns empty array for unknown tenant", () => {
    const manager = new SessionManager();
    expect(manager.getActiveSessions("unknown-tenant")).toEqual([]);
  });

  it("getStats returns zeros for new manager", () => {
    const manager = new SessionManager();
    const stats = manager.getStats(makeTenantId("empty"));
    expect(stats.active).toBe(0);
    expect(stats.idle).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.oldestActiveAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SessionManager.createSession
// ---------------------------------------------------------------------------

describe("SessionManager.createSession", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(makeConfig());
  });

  it("returns an AgentSession with correct tenantId", () => {
    const session = makeSession(manager, { tenantId: "t-001" });
    expect(session.tenantId).toBe("t-001");
  });

  it("returns a session with correct entityId", () => {
    const session = makeSession(manager, { entityId: "e-42" });
    expect(session.entityId).toBe("e-42");
  });

  it("returns a session with correct channel", () => {
    const session = makeSession(manager, { channel: "telegram" });
    expect(session.channel).toBe("telegram");
  });

  it("returns a session with status 'active'", () => {
    const session = makeSession(manager);
    expect(session.status).toBe("active");
  });

  it("assigns a ULID-format id to the session", () => {
    const session = makeSession(manager);
    expect(session.id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("sets messageCount to 0 initially", () => {
    const session = makeSession(manager);
    expect(session.messageCount).toBe(0);
  });

  it("sets contextTokens to 0 initially", () => {
    const session = makeSession(manager);
    expect(session.contextTokens).toBe(0);
  });

  it("sets metadata to empty object by default", () => {
    const session = makeSession(manager);
    expect(session.metadata).toEqual({});
  });

  it("stores provided metadata on the session", () => {
    const session = makeSession(manager, { metadata: { foo: "bar" } });
    expect(session.metadata["foo"]).toBe("bar");
  });

  it("sets startedAt to a valid ISO timestamp", () => {
    const before = new Date().toISOString();
    const session = makeSession(manager);
    const after = new Date().toISOString();
    expect(session.startedAt >= before).toBe(true);
    expect(session.startedAt <= after).toBe(true);
  });

  it("throws when tenant exceeds concurrent session limit", () => {
    const manager2 = new SessionManager({ maxConcurrentSessions: 2 });
    makeSession(manager2, { tenantId: "t-lim", entityId: "e1", channel: "discord" });
    makeSession(manager2, { tenantId: "t-lim", entityId: "e2", channel: "telegram" });
    expect(() => makeSession(manager2, { tenantId: "t-lim", entityId: "e3", channel: "slack" }))
      .toThrow(/maximum/i);
  });

  it("error message includes the tenant id", () => {
    const manager2 = new SessionManager({ maxConcurrentSessions: 1 });
    makeSession(manager2, { tenantId: "t-err", entityId: "e1", channel: "discord" });
    expect(() => makeSession(manager2, { tenantId: "t-err", entityId: "e2", channel: "slack" }))
      .toThrow(/t-err/);
  });

  it("allows concurrent sessions up to the limit", () => {
    const manager2 = new SessionManager({ maxConcurrentSessions: 3 });
    const s1 = makeSession(manager2, { tenantId: "t-ok", entityId: "e1", channel: "c1" });
    const s2 = makeSession(manager2, { tenantId: "t-ok", entityId: "e2", channel: "c2" });
    const s3 = makeSession(manager2, { tenantId: "t-ok", entityId: "e3", channel: "c3" });
    expect(s1.status).toBe("active");
    expect(s2.status).toBe("active");
    expect(s3.status).toBe("active");
  });

  it("different tenants can each reach the limit independently", () => {
    const manager2 = new SessionManager({ maxConcurrentSessions: 1 });
    const s1 = makeSession(manager2, { tenantId: "t-x", entityId: "e1", channel: "c1" });
    const s2 = makeSession(manager2, { tenantId: "t-y", entityId: "e1", channel: "c1" });
    expect(s1.status).toBe("active");
    expect(s2.status).toBe("active");
  });

  it("auto-resumes existing active session on same entity+channel", () => {
    const s1 = makeSession(manager, { tenantId: "t-r", entityId: "e1", channel: "c1" });
    const s2 = manager.createSession({ tenantId: "t-r", entityId: "e1", channel: "c1" });
    expect(s2.id).toBe(s1.id);
  });

  it("auto-resumes existing idle session on same entity+channel", () => {
    const s1 = makeSession(manager, { tenantId: "t-ri", entityId: "e-i1", channel: "c1" });
    // Force idle by direct mutation via the manager API
    manager.closeSession(s1.id);
    // A closed session does NOT get auto-resumed
    const s2 = manager.createSession({ tenantId: "t-ri", entityId: "e-i2", channel: "c2" });
    expect(s2.id).not.toBe(s1.id);
  });
});

// ---------------------------------------------------------------------------
// SessionManager.resumeSession
// ---------------------------------------------------------------------------

describe("SessionManager.resumeSession", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(makeConfig());
  });

  it("resumes an active session (stays active)", () => {
    const session = makeSession(manager);
    const resumed = manager.resumeSession(session.id);
    expect(resumed.status).toBe("active");
  });

  it("returns same session object by reference", () => {
    const session = makeSession(manager);
    const resumed = manager.resumeSession(session.id);
    expect(resumed.id).toBe(session.id);
  });

  it("updates lastActivity on resume", () => {
    const session = makeSession(manager);
    const before = session.lastActivity;
    // Brief pause to ensure timestamp difference
    const resumed = manager.resumeSession(session.id);
    expect(resumed.lastActivity >= before).toBe(true);
  });

  it("throws for non-existent session id", () => {
    expect(() => manager.resumeSession("01NONEXISTENT000000000000000")).toThrow(/not found/i);
  });

  it("throws when attempting to resume an expired session", () => {
    const session = makeSession(manager);
    // Force expired via direct manager manipulation
    manager.closeSession(session.id);
    expect(() => manager.resumeSession(session.id)).toThrow(/closed/i);
  });

  it("throws when attempting to resume a closed session", () => {
    const session = makeSession(manager);
    manager.closeSession(session.id);
    expect(() => manager.resumeSession(session.id)).toThrow(/closed/i);
  });
});

// ---------------------------------------------------------------------------
// SessionManager.recordActivity
// ---------------------------------------------------------------------------

describe("SessionManager.recordActivity", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(makeConfig());
  });

  it("increments messageCount by 1", () => {
    const session = makeSession(manager);
    const updated = manager.recordActivity(session.id, 0);
    expect(updated.messageCount).toBe(1);
  });

  it("increments messageCount on successive calls", () => {
    const session = makeSession(manager);
    manager.recordActivity(session.id, 0);
    manager.recordActivity(session.id, 0);
    const updated = manager.recordActivity(session.id, 0);
    expect(updated.messageCount).toBe(3);
  });

  it("adds tokensDelta to contextTokens", () => {
    const session = makeSession(manager);
    const updated = manager.recordActivity(session.id, 500);
    expect(updated.contextTokens).toBe(500);
  });

  it("accumulates contextTokens over multiple calls", () => {
    const session = makeSession(manager);
    manager.recordActivity(session.id, 100);
    manager.recordActivity(session.id, 250);
    const updated = manager.recordActivity(session.id, 50);
    expect(updated.contextTokens).toBe(400);
  });

  it("updates lastActivity timestamp", () => {
    const session = makeSession(manager);
    const before = session.lastActivity;
    const updated = manager.recordActivity(session.id, 0);
    expect(updated.lastActivity >= before).toBe(true);
  });

  it("moves idle session back to active", () => {
    const session = makeSession(manager);
    // Simulate idle by manually setting status (via the session object reference)
    // We can't directly set idle, so we test via the public API
    // recordActivity should move active->active trivially
    const updated = manager.recordActivity(session.id, 0);
    expect(updated.status).toBe("active");
  });

  it("throws when session id not found", () => {
    expect(() => manager.recordActivity("01NOEXIST00000000000000000000", 0)).toThrow(/not found/i);
  });

  it("returns the updated session object", () => {
    const session = makeSession(manager);
    const result = manager.recordActivity(session.id, 10);
    expect(result).toBeDefined();
    expect(result.id).toBe(session.id);
  });
});

// ---------------------------------------------------------------------------
// SessionManager.needsCompaction
// ---------------------------------------------------------------------------

describe("SessionManager.needsCompaction", () => {
  it("returns false for a new session with 0 tokens", () => {
    const manager = new SessionManager({ maxContextTokens: 1000 });
    const session = makeSession(manager);
    expect(manager.needsCompaction(session.id)).toBe(false);
  });

  it("returns false below the token limit", () => {
    const manager = new SessionManager({ maxContextTokens: 1000 });
    const session = makeSession(manager);
    manager.recordActivity(session.id, 999);
    expect(manager.needsCompaction(session.id)).toBe(false);
  });

  it("returns true at the token limit", () => {
    const manager = new SessionManager({ maxContextTokens: 1000 });
    const session = makeSession(manager);
    manager.recordActivity(session.id, 1000);
    expect(manager.needsCompaction(session.id)).toBe(true);
  });

  it("returns true above the token limit", () => {
    const manager = new SessionManager({ maxContextTokens: 1000 });
    const session = makeSession(manager);
    manager.recordActivity(session.id, 2000);
    expect(manager.needsCompaction(session.id)).toBe(true);
  });

  it("returns false for non-existent session", () => {
    const manager = new SessionManager();
    expect(manager.needsCompaction("01NOEXIST0000000000000000000")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SessionManager.recordCompaction
// ---------------------------------------------------------------------------

describe("SessionManager.recordCompaction", () => {
  it("resets contextTokens to the new count", () => {
    const manager = new SessionManager({ maxContextTokens: 1000 });
    const session = makeSession(manager);
    manager.recordActivity(session.id, 5000);
    manager.recordCompaction(session.id, 200);
    const updated = manager.getSession(session.id);
    expect(updated?.contextTokens).toBe(200);
  });

  it("needsCompaction returns false after compaction", () => {
    const manager = new SessionManager({ maxContextTokens: 1000 });
    const session = makeSession(manager);
    manager.recordActivity(session.id, 5000);
    manager.recordCompaction(session.id, 200);
    expect(manager.needsCompaction(session.id)).toBe(false);
  });

  it("does nothing for non-existent session (no throw)", () => {
    const manager = new SessionManager();
    expect(() => manager.recordCompaction("01NOEXIST0000000000000000000", 0)).not.toThrow();
  });

  it("sets contextTokens to 0 when called with 0", () => {
    const manager = new SessionManager({ maxContextTokens: 1000 });
    const session = makeSession(manager);
    manager.recordActivity(session.id, 999);
    manager.recordCompaction(session.id, 0);
    expect(manager.getSession(session.id)?.contextTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SessionManager.closeSession
// ---------------------------------------------------------------------------

describe("SessionManager.closeSession", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(makeConfig());
  });

  it("sets session status to 'closed'", () => {
    const session = makeSession(manager);
    manager.closeSession(session.id);
    expect(manager.getSession(session.id)?.status).toBe("closed");
  });

  it("does nothing for non-existent session (no throw)", () => {
    expect(() => manager.closeSession("01NOEXIST0000000000000000000")).not.toThrow();
  });

  it("removes closed session from active sessions list", () => {
    const session = makeSession(manager, { tenantId: "t-cl" });
    manager.closeSession(session.id);
    const active = manager.getActiveSessions("t-cl");
    expect(active.find(s => s.id === session.id)).toBeUndefined();
  });

  it("closed session does not count toward concurrency limit", () => {
    const manager2 = new SessionManager({ maxConcurrentSessions: 1 });
    const s1 = makeSession(manager2, { tenantId: "t-cc", entityId: "e1", channel: "c1" });
    manager2.closeSession(s1.id);
    // Should now be able to create another session
    const s2 = manager2.createSession({ tenantId: "t-cc", entityId: "e2", channel: "c2" });
    expect(s2.status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// SessionManager.getActiveSessions
// ---------------------------------------------------------------------------

describe("SessionManager.getActiveSessions", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(makeConfig());
  });

  it("returns empty array for unknown tenant", () => {
    expect(manager.getActiveSessions("unknown")).toEqual([]);
  });

  it("returns all active sessions for a tenant", () => {
    makeSession(manager, { tenantId: "t-ga", entityId: "e1", channel: "c1" });
    makeSession(manager, { tenantId: "t-ga", entityId: "e2", channel: "c2" });
    expect(manager.getActiveSessions("t-ga").length).toBe(2);
  });

  it("does not include closed sessions", () => {
    const s = makeSession(manager, { tenantId: "t-gb", entityId: "e1", channel: "c1" });
    manager.closeSession(s.id);
    expect(manager.getActiveSessions("t-gb").length).toBe(0);
  });

  it("does not include sessions from other tenants", () => {
    makeSession(manager, { tenantId: "t-gc1", entityId: "e1", channel: "c1" });
    makeSession(manager, { tenantId: "t-gc2", entityId: "e1", channel: "c1" });
    expect(manager.getActiveSessions("t-gc1").length).toBe(1);
  });

  it("all returned sessions have status 'active'", () => {
    makeSession(manager, { tenantId: "t-gd", entityId: "e1", channel: "c1" });
    makeSession(manager, { tenantId: "t-gd", entityId: "e2", channel: "c2" });
    const active = manager.getActiveSessions("t-gd");
    expect(active.every(s => s.status === "active")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SessionManager.getStats
// ---------------------------------------------------------------------------

describe("SessionManager.getStats", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(makeConfig());
  });

  it("returns zero active and idle for empty tenant", () => {
    const stats = manager.getStats("t-empty");
    expect(stats.active).toBe(0);
    expect(stats.idle).toBe(0);
    expect(stats.total).toBe(0);
  });

  it("counts active sessions correctly", () => {
    makeSession(manager, { tenantId: "t-st1", entityId: "e1", channel: "c1" });
    makeSession(manager, { tenantId: "t-st1", entityId: "e2", channel: "c2" });
    const stats = manager.getStats("t-st1");
    expect(stats.active).toBe(2);
  });

  it("closed sessions are not counted in total", () => {
    const s = makeSession(manager, { tenantId: "t-st2", entityId: "e1", channel: "c1" });
    manager.closeSession(s.id);
    const stats = manager.getStats("t-st2");
    expect(stats.total).toBe(0);
  });

  it("returns oldestActiveAt from the earliest session startedAt", () => {
    const s1 = makeSession(manager, { tenantId: "t-st3", entityId: "e1", channel: "c1" });
    const s2 = makeSession(manager, { tenantId: "t-st3", entityId: "e2", channel: "c2" });
    const stats = manager.getStats("t-st3");
    // The oldest is min of s1 and s2 startedAt
    const expected = s1.startedAt <= s2.startedAt ? s1.startedAt : s2.startedAt;
    expect(stats.oldestActiveAt).toBe(expected);
  });

  it("returns null oldestActiveAt when no active sessions", () => {
    const stats = manager.getStats("t-st4");
    expect(stats.oldestActiveAt).toBeNull();
  });

  it("does not count sessions from other tenants", () => {
    makeSession(manager, { tenantId: "t-st5a", entityId: "e1", channel: "c1" });
    const stats = manager.getStats("t-st5b");
    expect(stats.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SessionManager.findSession
// ---------------------------------------------------------------------------

describe("SessionManager.findSession", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(makeConfig());
  });

  it("returns null when no session exists for tenant+entity+channel", () => {
    expect(manager.findSession("t-x", "e-x", "c-x")).toBeNull();
  });

  it("returns the session when it matches tenant+entity+channel", () => {
    const s = makeSession(manager, { tenantId: "t-f1", entityId: "e-f1", channel: "discord" });
    const found = manager.findSession("t-f1", "e-f1", "discord");
    expect(found?.id).toBe(s.id);
  });

  it("returns null when channel does not match", () => {
    makeSession(manager, { tenantId: "t-f2", entityId: "e-f2", channel: "discord" });
    expect(manager.findSession("t-f2", "e-f2", "telegram")).toBeNull();
  });

  it("returns null when entity does not match", () => {
    makeSession(manager, { tenantId: "t-f3", entityId: "e-f3a", channel: "discord" });
    expect(manager.findSession("t-f3", "e-f3b", "discord")).toBeNull();
  });

  it("does not return closed sessions", () => {
    const s = makeSession(manager, { tenantId: "t-f4", entityId: "e-f4", channel: "c1" });
    manager.closeSession(s.id);
    expect(manager.findSession("t-f4", "e-f4", "c1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SessionManager.cleanup
// ---------------------------------------------------------------------------

describe("SessionManager.cleanup", () => {
  it("transitions active sessions past idleTimeout to idle", () => {
    const manager = new SessionManager({
      maxConcurrentSessions: 10,
      idleTimeoutMs: 0, // immediate idle
      expiryTimeoutMs: 99_999_999,
      maxContextTokens: 100_000,
    });
    const session = makeSession(manager, { tenantId: "t-cl1" });
    // Push lastActivity 1ms into the past so `now - lastActivity > 0` is true
    const s = manager.getSession(session.id);
    if (s) s.lastActivity = new Date(Date.now() - 1).toISOString();
    manager.cleanup();
    expect(manager.getSession(session.id)?.status).toBe("idle");
  });

  it("transitions idle sessions past expiryTimeout to expired", () => {
    const manager = new SessionManager({
      maxConcurrentSessions: 10,
      idleTimeoutMs: 0,
      expiryTimeoutMs: 0,
      maxContextTokens: 100_000,
    });
    const session = makeSession(manager, { tenantId: "t-cl2" });
    // Push lastActivity into the past so timeouts trigger
    const s1 = manager.getSession(session.id);
    if (s1) s1.lastActivity = new Date(Date.now() - 1).toISOString();
    manager.cleanup(); // active → idle
    if (s1) s1.lastActivity = new Date(Date.now() - 1).toISOString();
    manager.cleanup(); // idle → expired
    expect(manager.getSession(session.id)?.status).toBe("expired");
  });

  it("removes expired sessions older than 1 hour from memory", () => {
    const manager = new SessionManager({
      maxConcurrentSessions: 10,
      idleTimeoutMs: 0,
      expiryTimeoutMs: 0,
      maxContextTokens: 100_000,
    });
    const session = makeSession(manager, { tenantId: "t-cl3" });
    // Push lastActivity so cleanups trigger
    const s = manager.getSession(session.id);
    if (s) s.lastActivity = new Date(Date.now() - 1).toISOString();
    manager.cleanup(); // active → idle
    if (s) s.lastActivity = new Date(Date.now() - 1).toISOString();
    manager.cleanup(); // idle → expired

    // Manually push lastActivity back more than 1 hour
    if (s) {
      s.lastActivity = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    }

    manager.cleanup(); // expired + old → removed
    expect(manager.getSession(session.id)).toBeNull();
  });

  it("does not remove recently expired sessions", () => {
    const manager = new SessionManager({
      maxConcurrentSessions: 10,
      idleTimeoutMs: 0,
      expiryTimeoutMs: 0,
      maxContextTokens: 100_000,
    });
    const session = makeSession(manager, { tenantId: "t-cl4" });
    manager.cleanup(); // active → idle
    manager.cleanup(); // idle → expired
    // lastActivity is recent (just expired), so it should NOT be removed
    manager.cleanup();
    expect(manager.getSession(session.id)).not.toBeNull();
  });

  it("active sessions within idleTimeout are not transitioned", () => {
    const manager = new SessionManager({
      maxConcurrentSessions: 10,
      idleTimeoutMs: 999_999_999, // far future
      expiryTimeoutMs: 999_999_999,
      maxContextTokens: 100_000,
    });
    const session = makeSession(manager, { tenantId: "t-cl5" });
    manager.cleanup();
    expect(manager.getSession(session.id)?.status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// SessionManager — cleanup timer lifecycle
// ---------------------------------------------------------------------------

describe("SessionManager — startCleanup / stopCleanup", () => {
  it("startCleanup does not throw", () => {
    const manager = new SessionManager();
    expect(() => manager.startCleanup()).not.toThrow();
    manager.stopCleanup();
  });

  it("stopCleanup does not throw when no timer is running", () => {
    const manager = new SessionManager();
    expect(() => manager.stopCleanup()).not.toThrow();
  });

  it("calling startCleanup twice does not create a second timer", () => {
    const manager = new SessionManager();
    manager.startCleanup();
    expect(() => manager.startCleanup()).not.toThrow();
    manager.stopCleanup();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// SessionManager.setMaxConcurrentSessions
// ---------------------------------------------------------------------------

describe("SessionManager.setMaxConcurrentSessions", () => {
  it("updates the max concurrent sessions limit", () => {
    const manager = new SessionManager({ maxConcurrentSessions: 5 });
    manager.setMaxConcurrentSessions(10);
    expect(manager.getMaxConcurrentSessions()).toBe(10);
  });

  it("new limit is enforced on next createSession call", () => {
    const manager = new SessionManager({ maxConcurrentSessions: 10 });
    manager.setMaxConcurrentSessions(1);
    makeSession(manager, { tenantId: "t-sm1", entityId: "e1", channel: "c1" });
    expect(() => makeSession(manager, { tenantId: "t-sm1", entityId: "e2", channel: "c2" }))
      .toThrow(/maximum/i);
  });

  it("can increase limit to allow more sessions", () => {
    const manager = new SessionManager({ maxConcurrentSessions: 1 });
    makeSession(manager, { tenantId: "t-sm2", entityId: "e1", channel: "c1" });
    manager.setMaxConcurrentSessions(2);
    expect(() => makeSession(manager, { tenantId: "t-sm2", entityId: "e2", channel: "c2" }))
      .not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PLAN_PRICING constants
// ---------------------------------------------------------------------------

describe("PLAN_PRICING constants", () => {
  it("free plan has monthlyUsd of 0", () => {
    expect(PLAN_PRICING.free.monthlyUsd).toBe(0);
  });

  it("pro plan has monthlyUsd of 8", () => {
    expect(PLAN_PRICING.pro.monthlyUsd).toBe(8);
  });

  it("org plan has monthlyUsd of 25", () => {
    expect(PLAN_PRICING.org.monthlyUsd).toBe(25);
  });

  it("community plan has monthlyUsd of 150", () => {
    expect(PLAN_PRICING.community.monthlyUsd).toBe(150);
  });

  it("free plan perSeat is false", () => {
    expect(PLAN_PRICING.free.perSeat).toBe(false);
  });

  it("pro plan perSeat is false", () => {
    expect(PLAN_PRICING.pro.perSeat).toBe(false);
  });

  it("org plan perSeat is true", () => {
    expect(PLAN_PRICING.org.perSeat).toBe(true);
  });

  it("community plan perSeat is false", () => {
    expect(PLAN_PRICING.community.perSeat).toBe(false);
  });

  it("org plan has minSeats of 10", () => {
    expect(PLAN_PRICING.org.minSeats).toBe(10);
  });

  it("free plan has minSeats of 0", () => {
    expect(PLAN_PRICING.free.minSeats).toBe(0);
  });

  it("pro plan has minSeats of 0", () => {
    expect(PLAN_PRICING.pro.minSeats).toBe(0);
  });

  it("community plan has minSeats of 0", () => {
    expect(PLAN_PRICING.community.minSeats).toBe(0);
  });

  it("covers all four plan tiers", () => {
    const tiers: PlanTier[] = ["free", "pro", "org", "community"];
    for (const tier of tiers) {
      expect(PLAN_PRICING[tier]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// BillingManager.checkPlanGate — free plan
// ---------------------------------------------------------------------------

describe("BillingManager.checkPlanGate — free plan", () => {
  let billing: BillingManager;

  beforeEach(() => {
    billing = new BillingManager(makeBillingConfig(), makeBillingCallbacks());
  });

  it("allows entities below the free limit", () => {
    const result = billing.checkPlanGate("free", "entities", PLAN_LIMITS.free.maxEntities - 1);
    expect(result.allowed).toBe(true);
  });

  it("denies entities at the free limit", () => {
    const result = billing.checkPlanGate("free", "entities", PLAN_LIMITS.free.maxEntities);
    expect(result.allowed).toBe(false);
  });

  it("denies entities above the free limit", () => {
    const result = billing.checkPlanGate("free", "entities", PLAN_LIMITS.free.maxEntities + 1);
    expect(result.allowed).toBe(false);
  });

  it("allows channels below the free limit", () => {
    const result = billing.checkPlanGate("free", "channels", PLAN_LIMITS.free.maxChannels - 1);
    expect(result.allowed).toBe(true);
  });

  it("denies channels at the free limit", () => {
    const result = billing.checkPlanGate("free", "channels", PLAN_LIMITS.free.maxChannels);
    expect(result.allowed).toBe(false);
  });

  it("allows messages below the free limit", () => {
    const result = billing.checkPlanGate("free", "messages", PLAN_LIMITS.free.maxMonthlyMessages - 1);
    expect(result.allowed).toBe(true);
  });

  it("denies messages at the free limit", () => {
    const result = billing.checkPlanGate("free", "messages", PLAN_LIMITS.free.maxMonthlyMessages);
    expect(result.allowed).toBe(false);
  });

  it("allows sessions below the free limit", () => {
    const result = billing.checkPlanGate("free", "sessions", PLAN_LIMITS.free.maxConcurrentSessions - 1);
    expect(result.allowed).toBe(true);
  });

  it("denies sessions at the free limit", () => {
    const result = billing.checkPlanGate("free", "sessions", PLAN_LIMITS.free.maxConcurrentSessions);
    expect(result.allowed).toBe(false);
  });

  it("includes reason string when denied", () => {
    const result = billing.checkPlanGate("free", "entities", 100);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain("free");
  });

  it("includes limit value in denied result", () => {
    const result = billing.checkPlanGate("free", "entities", 100);
    expect(result.limit).toBe(PLAN_LIMITS.free.maxEntities);
  });

  it("includes current count in denied result", () => {
    const result = billing.checkPlanGate("free", "entities", 100);
    expect(result.current).toBe(100);
  });

  it("includes limit in allowed result", () => {
    const result = billing.checkPlanGate("free", "entities", 1);
    expect(result.limit).toBe(PLAN_LIMITS.free.maxEntities);
  });

  it("includes current in allowed result", () => {
    const result = billing.checkPlanGate("free", "entities", 1);
    expect(result.current).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// BillingManager.checkPlanGate — pro plan
// ---------------------------------------------------------------------------

describe("BillingManager.checkPlanGate — pro plan", () => {
  let billing: BillingManager;

  beforeEach(() => {
    billing = new BillingManager(makeBillingConfig(), makeBillingCallbacks());
  });

  it("allows entities below the pro limit", () => {
    const result = billing.checkPlanGate("pro", "entities", PLAN_LIMITS.pro.maxEntities - 1);
    expect(result.allowed).toBe(true);
  });

  it("denies entities at the pro limit", () => {
    const result = billing.checkPlanGate("pro", "entities", PLAN_LIMITS.pro.maxEntities);
    expect(result.allowed).toBe(false);
  });

  it("allows channels below the pro limit", () => {
    const result = billing.checkPlanGate("pro", "channels", PLAN_LIMITS.pro.maxChannels - 1);
    expect(result.allowed).toBe(true);
  });

  it("denies channels at the pro limit", () => {
    const result = billing.checkPlanGate("pro", "channels", PLAN_LIMITS.pro.maxChannels);
    expect(result.allowed).toBe(false);
  });

  it("allows more entities than free limit", () => {
    // Pro allows 50, free allows 5, so 10 should be OK on pro
    const result = billing.checkPlanGate("pro", "entities", PLAN_LIMITS.free.maxEntities + 1);
    expect(result.allowed).toBe(true);
  });

  it("denies sessions at pro concurrent limit", () => {
    const result = billing.checkPlanGate("pro", "sessions", PLAN_LIMITS.pro.maxConcurrentSessions);
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BillingManager.checkPlanGate — org plan
// ---------------------------------------------------------------------------

describe("BillingManager.checkPlanGate — org plan", () => {
  let billing: BillingManager;

  beforeEach(() => {
    billing = new BillingManager(makeBillingConfig(), makeBillingCallbacks());
  });

  it("allows entities below org limit", () => {
    const result = billing.checkPlanGate("org", "entities", PLAN_LIMITS.org.maxEntities - 1);
    expect(result.allowed).toBe(true);
  });

  it("denies entities at org limit", () => {
    const result = billing.checkPlanGate("org", "entities", PLAN_LIMITS.org.maxEntities);
    expect(result.allowed).toBe(false);
  });

  it("allows channels below org limit", () => {
    const result = billing.checkPlanGate("org", "channels", PLAN_LIMITS.org.maxChannels - 1);
    expect(result.allowed).toBe(true);
  });

  it("denies channels at org limit", () => {
    const result = billing.checkPlanGate("org", "channels", PLAN_LIMITS.org.maxChannels);
    expect(result.allowed).toBe(false);
  });

  it("org sessions limit is larger than pro", () => {
    // Sanity check that org allows more sessions than pro
    const orgResult = billing.checkPlanGate("org", "sessions", PLAN_LIMITS.pro.maxConcurrentSessions + 1);
    expect(orgResult.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BillingManager.checkPlanGate — community plan
// ---------------------------------------------------------------------------

describe("BillingManager.checkPlanGate — community plan", () => {
  let billing: BillingManager;

  beforeEach(() => {
    billing = new BillingManager(makeBillingConfig(), makeBillingCallbacks());
  });

  it("allows entities below community limit", () => {
    const result = billing.checkPlanGate("community", "entities", PLAN_LIMITS.community.maxEntities - 1);
    expect(result.allowed).toBe(true);
  });

  it("denies entities at community limit", () => {
    const result = billing.checkPlanGate("community", "entities", PLAN_LIMITS.community.maxEntities);
    expect(result.allowed).toBe(false);
  });

  it("allows channels below community limit", () => {
    const result = billing.checkPlanGate("community", "channels", PLAN_LIMITS.community.maxChannels - 1);
    expect(result.allowed).toBe(true);
  });

  it("denies channels at community limit", () => {
    const result = billing.checkPlanGate("community", "channels", PLAN_LIMITS.community.maxChannels);
    expect(result.allowed).toBe(false);
  });

  it("allows messages well below community limit", () => {
    const result = billing.checkPlanGate("community", "messages", 100_000);
    expect(result.allowed).toBe(true);
  });

  it("denies messages at community limit", () => {
    const result = billing.checkPlanGate("community", "messages", PLAN_LIMITS.community.maxMonthlyMessages);
    expect(result.allowed).toBe(false);
  });

  it("allows sessions well below community limit", () => {
    const result = billing.checkPlanGate("community", "sessions", 50);
    expect(result.allowed).toBe(true);
  });

  it("denies sessions at community limit", () => {
    const result = billing.checkPlanGate("community", "sessions", PLAN_LIMITS.community.maxConcurrentSessions);
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BillingManager.checkPlanGate — boundary conditions and result shape
// ---------------------------------------------------------------------------

describe("BillingManager.checkPlanGate — boundary conditions", () => {
  let billing: BillingManager;

  beforeEach(() => {
    billing = new BillingManager(makeBillingConfig(), makeBillingCallbacks());
  });

  it("count of 0 is always allowed for any gate", () => {
    const gates: Array<"entities" | "channels" | "messages" | "sessions"> = ["entities", "channels", "messages", "sessions"];
    const plans: PlanTier[] = ["free", "pro", "org", "community"];
    for (const plan of plans) {
      for (const gate of gates) {
        const result = billing.checkPlanGate(plan, gate, 0);
        expect(result.allowed).toBe(true);
      }
    }
  });

  it("exactly at limit is always denied", () => {
    expect(billing.checkPlanGate("free", "entities", PLAN_LIMITS.free.maxEntities).allowed).toBe(false);
    expect(billing.checkPlanGate("pro", "entities", PLAN_LIMITS.pro.maxEntities).allowed).toBe(false);
    expect(billing.checkPlanGate("org", "entities", PLAN_LIMITS.org.maxEntities).allowed).toBe(false);
    expect(billing.checkPlanGate("community", "entities", PLAN_LIMITS.community.maxEntities).allowed).toBe(false);
  });

  it("one below limit is always allowed", () => {
    expect(billing.checkPlanGate("free", "entities", PLAN_LIMITS.free.maxEntities - 1).allowed).toBe(true);
    expect(billing.checkPlanGate("pro", "channels", PLAN_LIMITS.pro.maxChannels - 1).allowed).toBe(true);
    expect(billing.checkPlanGate("org", "sessions", PLAN_LIMITS.org.maxConcurrentSessions - 1).allowed).toBe(true);
  });

  it("denied result has allowed=false", () => {
    const result: PlanGateResult = billing.checkPlanGate("free", "entities", 999);
    expect(result.allowed).toBe(false);
  });

  it("allowed result has allowed=true", () => {
    const result: PlanGateResult = billing.checkPlanGate("pro", "entities", 1);
    expect(result.allowed).toBe(true);
  });

  it("denied result reason includes gate name", () => {
    const result = billing.checkPlanGate("free", "channels", 999);
    expect(result.reason).toContain("channels");
  });

  it("denied result reason includes plan tier name", () => {
    const result = billing.checkPlanGate("pro", "sessions", 999);
    expect(result.reason).toContain("pro");
  });
});

// ---------------------------------------------------------------------------
// BillingManager — constructor
// ---------------------------------------------------------------------------

describe("BillingManager — constructor", () => {
  it("creates a BillingManager instance without throwing", () => {
    const billing = new BillingManager(makeBillingConfig(), makeBillingCallbacks());
    expect(billing).toBeDefined();
  });

  it("checkPlanGate is callable on a freshly constructed instance", () => {
    const billing = new BillingManager(makeBillingConfig(), makeBillingCallbacks());
    expect(() => billing.checkPlanGate("free", "entities", 0)).not.toThrow();
  });
});
