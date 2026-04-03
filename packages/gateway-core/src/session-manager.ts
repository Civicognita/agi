/**
 * Session Manager — Task #190
 *
 * Manages concurrent agent sessions for multi-user hosted mode.
 * Each session represents an active conversation between an entity
 * and the agent, scoped to a tenant and channel.
 *
 * Features:
 * - Session creation with concurrency limits per tenant plan
 * - Session lifecycle (active → idle → expired)
 * - Context token tracking for compaction decisions
 * - Session resumption after disconnects
 */

import { ulid } from "ulid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStatus = "active" | "idle" | "expired" | "closed";

export interface AgentSession {
  id: string;
  tenantId: string;
  entityId: string;
  channel: string;
  status: SessionStatus;
  startedAt: string;
  lastActivity: string;
  messageCount: number;
  contextTokens: number;
  metadata: Record<string, unknown>;
}

export interface CreateSessionParams {
  tenantId: string;
  entityId: string;
  channel: string;
  metadata?: Record<string, unknown>;
}

export interface SessionManagerConfig {
  /** Max concurrent sessions per tenant. Overridden by plan limits. */
  maxConcurrentSessions: number;
  /** Idle timeout in milliseconds before session moves to idle. */
  idleTimeoutMs: number;
  /** Expiry timeout in milliseconds before idle session is expired. */
  expiryTimeoutMs: number;
  /** Max context tokens before compaction is recommended. */
  maxContextTokens: number;
}

export interface SessionStats {
  active: number;
  idle: number;
  total: number;
  oldestActiveAt: string | null;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: SessionManagerConfig = {
  maxConcurrentSessions: 5,
  idleTimeoutMs: 5 * 60 * 1000, // 5 minutes
  expiryTimeoutMs: 30 * 60 * 1000, // 30 minutes
  maxContextTokens: 100_000,
};

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

/**
 * In-memory session manager for concurrent agent sessions.
 *
 * For hosted mode, session state is also persisted to the agent_sessions
 * table via the DatabaseAdapter. This in-memory layer provides fast
 * lookups and enforces concurrency limits without DB round-trips.
 */
export class SessionManager {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly config: SessionManagerConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<SessionManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a new agent session.
   * @throws Error if tenant exceeds concurrent session limit.
   */
  createSession(params: CreateSessionParams): AgentSession {
    // Check concurrency limit
    const tenantActive = this.getActiveSessions(params.tenantId);
    if (tenantActive.length >= this.config.maxConcurrentSessions) {
      throw new Error(
        `Tenant ${params.tenantId} has reached the maximum of ` +
        `${this.config.maxConcurrentSessions} concurrent sessions`,
      );
    }

    // Check for existing session on same entity+channel (resume instead)
    const existing = this.findSession(params.tenantId, params.entityId, params.channel);
    if (existing && (existing.status === "active" || existing.status === "idle")) {
      return this.resumeSession(existing.id);
    }

    const now = new Date().toISOString();
    const session: AgentSession = {
      id: ulid(),
      tenantId: params.tenantId,
      entityId: params.entityId,
      channel: params.channel,
      status: "active",
      startedAt: now,
      lastActivity: now,
      messageCount: 0,
      contextTokens: 0,
      metadata: params.metadata ?? {},
    };

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Resume an existing session, moving it back to active.
   */
  resumeSession(sessionId: string): AgentSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (session.status === "expired" || session.status === "closed") {
      throw new Error(`Cannot resume ${session.status} session: ${sessionId}`);
    }
    session.status = "active";
    session.lastActivity = new Date().toISOString();
    return session;
  }

  /**
   * Record activity on a session (message received/sent).
   */
  recordActivity(sessionId: string, tokensDelta: number): AgentSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.lastActivity = new Date().toISOString();
    session.messageCount += 1;
    session.contextTokens += tokensDelta;

    // Move back to active if idle
    if (session.status === "idle") {
      session.status = "active";
    }

    return session;
  }

  /**
   * Check if a session needs compaction (context tokens exceeded).
   */
  needsCompaction(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.contextTokens >= this.config.maxContextTokens;
  }

  /**
   * Record that compaction occurred, resetting context token count.
   */
  recordCompaction(sessionId: string, newTokenCount: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.contextTokens = newTokenCount;
  }

  /**
   * Close a session explicitly.
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = "closed";
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): AgentSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /**
   * Find an existing session for a given entity+channel.
   */
  findSession(tenantId: string, entityId: string, channel: string): AgentSession | null {
    for (const session of this.sessions.values()) {
      if (
        session.tenantId === tenantId &&
        session.entityId === entityId &&
        session.channel === channel &&
        session.status !== "expired" &&
        session.status !== "closed"
      ) {
        return session;
      }
    }
    return null;
  }

  /**
   * Get all active sessions for a tenant.
   */
  getActiveSessions(tenantId: string): AgentSession[] {
    const result: AgentSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.tenantId === tenantId && session.status === "active") {
        result.push(session);
      }
    }
    return result;
  }

  /**
   * Get session statistics for a tenant.
   */
  getStats(tenantId: string): SessionStats {
    let active = 0;
    let idle = 0;
    let total = 0;
    let oldestActiveAt: string | null = null;

    for (const session of this.sessions.values()) {
      if (session.tenantId !== tenantId) continue;
      if (session.status === "closed" || session.status === "expired") continue;

      total++;
      if (session.status === "active") {
        active++;
        if (!oldestActiveAt || session.startedAt < oldestActiveAt) {
          oldestActiveAt = session.startedAt;
        }
      } else if (session.status === "idle") {
        idle++;
      }
    }

    return { active, idle, total, oldestActiveAt };
  }

  /**
   * Start the cleanup timer that transitions idle/expired sessions.
   */
  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  /**
   * Stop the cleanup timer.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Run cleanup: transition idle sessions to expired, active to idle.
   */
  cleanup(): void {
    const now = Date.now();

    for (const session of this.sessions.values()) {
      const lastActivity = new Date(session.lastActivity).getTime();

      if (session.status === "active") {
        if (now - lastActivity > this.config.idleTimeoutMs) {
          session.status = "idle";
        }
      } else if (session.status === "idle") {
        if (now - lastActivity > this.config.expiryTimeoutMs) {
          session.status = "expired";
        }
      }
    }

    // Remove expired/closed sessions older than 1 hour
    const ONE_HOUR = 60 * 60 * 1000;
    for (const [id, session] of this.sessions.entries()) {
      if (
        (session.status === "expired" || session.status === "closed") &&
        now - new Date(session.lastActivity).getTime() > ONE_HOUR
      ) {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Update the max concurrent sessions limit (e.g., when plan changes).
   */
  setMaxConcurrentSessions(max: number): void {
    (this.config as SessionManagerConfig).maxConcurrentSessions = max;
  }

  /**
   * Get the current concurrent session limit.
   */
  getMaxConcurrentSessions(): number {
    return this.config.maxConcurrentSessions;
  }
}
