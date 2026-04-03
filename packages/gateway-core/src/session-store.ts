/**
 * Session Store — Task #231
 *
 * In-memory session store keyed by canonical format: agent:agentId:kind:userId.
 * Configurable max sessions (default 5K), idle TTL (24h), auto-reap.
 * Session creation rate limited (120/10s).
 * Maps entity IDs to session keys for multi-tenant isolation.
 *
 * @see openclaw/src/acp/session.ts, openclaw/src/config/sessions/session-key.ts
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Canonical session key components. */
export interface SessionKeyParts {
  agent: string;
  agentId: string;
  kind: string;
  userId: string;
}

/** Session record in the store. */
export interface SessionRecord {
  /** Canonical key (agent:agentId:kind:userId). */
  key: string;
  /** Parsed key components. */
  parts: SessionKeyParts;
  /** Entity ID mapped to this session. */
  entityId: string;
  /** Channel ID (telegram, discord, etc.). */
  channel: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last activity timestamp. */
  lastActivityAt: string;
  /** Arbitrary session metadata. */
  metadata: Record<string, unknown>;
}

/** Session store configuration. */
export interface SessionStoreConfig {
  /** Maximum concurrent sessions (default: 5000). */
  maxSessions: number;
  /** Session idle timeout in ms (default: 24 hours). */
  idleTtlMs: number;
  /** Auto-reap interval in ms (default: 5 minutes). */
  reapIntervalMs: number;
  /** Rate limit: max session creations per window. */
  creationRateLimit: number;
  /** Rate limit window in ms (default: 10 seconds). */
  creationRateWindowMs: number;
}

/** Session store statistics. */
export interface SessionStoreStats {
  activeSessions: number;
  maxSessions: number;
  creationsInWindow: number;
  lastReapAt: string | null;
  reaped: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: SessionStoreConfig = {
  maxSessions: 5000,
  idleTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  reapIntervalMs: 5 * 60 * 1000, // 5 minutes
  creationRateLimit: 120,
  creationRateWindowMs: 10_000, // 10 seconds
};

// ---------------------------------------------------------------------------
// Session Store
// ---------------------------------------------------------------------------

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly entityIndex = new Map<string, string>(); // entityId -> key
  private readonly config: SessionStoreConfig;

  // Rate limiting state
  private creationCount = 0;
  private creationWindowStart = Date.now();

  // Reaper state
  private reapTimer: ReturnType<typeof setInterval> | null = null;
  private lastReapAt: string | null = null;
  private totalReaped = 0;

  constructor(config?: Partial<SessionStoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Canonical key
  // ---------------------------------------------------------------------------

  /**
   * Build a canonical session key from parts.
   * Format: agent:agentId:kind:userId
   */
  static buildKey(parts: SessionKeyParts): string {
    return `${parts.agent}:${parts.agentId}:${parts.kind}:${parts.userId}`;
  }

  /**
   * Parse a canonical session key into parts.
   * Returns null if the key is malformed.
   */
  static parseKey(key: string): SessionKeyParts | null {
    const parts = key.split(":");
    if (parts.length !== 4) return null;
    return {
      agent: parts[0]!,
      agentId: parts[1]!,
      kind: parts[2]!,
      userId: parts[3]!,
    };
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * Get or create a session.
   * Returns null if rate limited or at max capacity.
   */
  getOrCreate(
    parts: SessionKeyParts,
    entityId: string,
    channel: string,
  ): SessionRecord | null {
    const key = SessionStore.buildKey(parts);

    // Check for existing session
    const existing = this.sessions.get(key);
    if (existing !== undefined) {
      existing.lastActivityAt = new Date().toISOString();
      return existing;
    }

    // Check rate limit
    if (!this.checkCreationRate()) return null;

    // Check capacity
    if (this.sessions.size >= this.config.maxSessions) {
      // Try to evict oldest idle session
      if (!this.evictOldest()) return null;
    }

    const now = new Date().toISOString();
    const record: SessionRecord = {
      key,
      parts,
      entityId,
      channel,
      createdAt: now,
      lastActivityAt: now,
      metadata: {},
    };

    this.sessions.set(key, record);
    this.entityIndex.set(entityId, key);

    return record;
  }

  /** Get session by canonical key. */
  get(key: string): SessionRecord | undefined {
    return this.sessions.get(key);
  }

  /** Get session by entity ID. */
  getByEntity(entityId: string): SessionRecord | undefined {
    const key = this.entityIndex.get(entityId);
    if (key === undefined) return undefined;
    return this.sessions.get(key);
  }

  /** Check if a session exists. */
  has(key: string): boolean {
    return this.sessions.has(key);
  }

  /** Touch a session (update lastActivityAt). */
  touch(key: string): boolean {
    const session = this.sessions.get(key);
    if (session === undefined) return false;
    session.lastActivityAt = new Date().toISOString();
    return true;
  }

  /** Remove a session by key. */
  remove(key: string): boolean {
    const session = this.sessions.get(key);
    if (session === undefined) return false;
    this.sessions.delete(key);
    this.entityIndex.delete(session.entityId);
    return true;
  }

  /** Remove a session by entity ID. */
  removeByEntity(entityId: string): boolean {
    const key = this.entityIndex.get(entityId);
    if (key === undefined) return false;
    return this.remove(key);
  }

  /** Get all active sessions. */
  getAll(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  /** Get active session count. */
  get count(): number {
    return this.sessions.size;
  }

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  private checkCreationRate(): boolean {
    const now = Date.now();

    // Reset window if expired
    if (now - this.creationWindowStart >= this.config.creationRateWindowMs) {
      this.creationCount = 0;
      this.creationWindowStart = now;
    }

    if (this.creationCount >= this.config.creationRateLimit) {
      return false;
    }

    this.creationCount++;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Eviction
  // ---------------------------------------------------------------------------

  private evictOldest(): boolean {
    let oldest: SessionRecord | null = null;
    let oldestTime = Infinity;

    for (const session of this.sessions.values()) {
      const time = new Date(session.lastActivityAt).getTime();
      if (time < oldestTime) {
        oldestTime = time;
        oldest = session;
      }
    }

    if (oldest === null) return false;

    this.remove(oldest.key);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Auto-reap idle sessions
  // ---------------------------------------------------------------------------

  /** Start the idle session reaper. */
  startReaper(): void {
    if (this.reapTimer !== null) return;

    this.reapTimer = setInterval(() => {
      this.reapIdleSessions();
    }, this.config.reapIntervalMs);

    // Unref so timer doesn't prevent process exit
    if (typeof this.reapTimer === "object" && "unref" in this.reapTimer) {
      this.reapTimer.unref();
    }
  }

  /** Stop the idle session reaper. */
  stopReaper(): void {
    if (this.reapTimer !== null) {
      clearInterval(this.reapTimer);
      this.reapTimer = null;
    }
  }

  /** Reap idle sessions beyond TTL. Returns count reaped. */
  reapIdleSessions(): number {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [key, session] of this.sessions) {
      const idle = now - new Date(session.lastActivityAt).getTime();
      if (idle >= this.config.idleTtlMs) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      this.remove(key);
    }

    this.lastReapAt = new Date().toISOString();
    this.totalReaped += toRemove.length;

    return toRemove.length;
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  /** Get store statistics. */
  getStats(): SessionStoreStats {
    return {
      activeSessions: this.sessions.size,
      maxSessions: this.config.maxSessions,
      creationsInWindow: this.creationCount,
      lastReapAt: this.lastReapAt,
      reaped: this.totalReaped,
    };
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /** Destroy all sessions and stop reaper. */
  destroy(): void {
    this.stopReaper();
    this.sessions.clear();
    this.entityIndex.clear();
  }
}
