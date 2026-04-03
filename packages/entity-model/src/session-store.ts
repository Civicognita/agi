/**
 * SessionStore — server-side session tracking and revocation.
 *
 * Compliance: UCS-IAM-02 (SOC 2 CC6 session controls, HIPAA access management).
 */

import type { Database } from "./db.js";

export interface Session {
  id: string;
  entityId: string;
  tokenHash: string;
  sourceIp: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export const CREATE_SESSIONS = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT NOT NULL PRIMARY KEY,
  entity_id   TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  source_ip   TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT
)` as const;

export const CREATE_API_KEYS = `
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT NOT NULL PRIMARY KEY,
  entity_id   TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  key_hash    TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  last_used   TEXT,
  expires_at  TEXT,
  revoked_at  TEXT
)` as const;

export class SessionStore {
  constructor(private readonly db: Database) {
    db.exec(CREATE_SESSIONS);
    db.exec(CREATE_API_KEYS);
  }

  createSession(id: string, entityId: string, tokenHash: string, expiresAt: string, sourceIp = "", userAgent = ""): void {
    this.db.prepare(`
      INSERT INTO sessions (id, entity_id, token_hash, source_ip, user_agent, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, entityId, tokenHash, sourceIp, userAgent, new Date().toISOString(), expiresAt);
  }

  isRevoked(tokenHash: string): boolean {
    const row = this.db.prepare(`SELECT revoked_at FROM sessions WHERE token_hash = ?`).get(tokenHash) as { revoked_at: string | null } | undefined;
    return row?.revoked_at !== null && row?.revoked_at !== undefined;
  }

  revokeSession(id: string): void {
    this.db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  }

  revokeAllForEntity(entityId: string): void {
    this.db.prepare(`UPDATE sessions SET revoked_at = ? WHERE entity_id = ? AND revoked_at IS NULL`).run(new Date().toISOString(), entityId);
  }

  getActiveSessions(entityId: string): Session[] {
    const now = new Date().toISOString();
    return this.db.prepare(`
      SELECT * FROM sessions WHERE entity_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC
    `).all(entityId, now) as Session[];
  }

  cleanup(): number {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return this.db.prepare(`DELETE FROM sessions WHERE (expires_at < ? AND revoked_at IS NOT NULL) OR created_at < ?`).run(cutoff, cutoff).changes;
  }

  // API Key management
  createApiKey(id: string, entityId: string, keyHash: string, label: string, expiresAt?: string): void {
    this.db.prepare(`
      INSERT INTO api_keys (id, entity_id, key_hash, label, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, entityId, keyHash, label, new Date().toISOString(), expiresAt ?? null);
  }

  touchApiKey(keyHash: string): void {
    this.db.prepare(`UPDATE api_keys SET last_used = ? WHERE key_hash = ?`).run(new Date().toISOString(), keyHash);
  }

  isApiKeyValid(keyHash: string): boolean {
    const now = new Date().toISOString();
    const row = this.db.prepare(`SELECT revoked_at, expires_at FROM api_keys WHERE key_hash = ?`).get(keyHash) as { revoked_at: string | null; expires_at: string | null } | undefined;
    if (!row) return false;
    if (row.revoked_at) return false;
    if (row.expires_at && row.expires_at < now) return false;
    return true;
  }

  revokeApiKey(id: string): void {
    this.db.prepare(`UPDATE api_keys SET revoked_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  }

  listApiKeys(entityId: string): Array<{ id: string; label: string; createdAt: string; lastUsed: string | null; expiresAt: string | null; revoked: boolean }> {
    const rows = this.db.prepare(`SELECT * FROM api_keys WHERE entity_id = ? ORDER BY created_at DESC`).all(entityId) as Array<{
      id: string; label: string; created_at: string; last_used: string | null; expires_at: string | null; revoked_at: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.created_at,
      lastUsed: r.last_used,
      expiresAt: r.expires_at,
      revoked: r.revoked_at !== null,
    }));
  }
}
