/**
 * RegistrationSessionStore — tracks in-progress Discord DM registration
 * sessions so Aion can resume a multi-step flow across multiple messages
 * without restarting from the beginning.
 *
 * s194: Discord proactive registration flow.
 * Session key: "discord::{userId}" — DM-scoped, not guild-scoped.
 * Persisted to ~/.agi/registration-sessions.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RegistrationStep =
  | "name"
  | "email"
  | "birthdate"
  | "pronouns"
  | "confirm"
  | "submitted"
  | "cancelled";

export interface RegistrationSession {
  /** "discord::{userId}" — stable per-user key. */
  sessionId: string;
  channelUserId: string;
  /** Discord username (pre-populated from Discord; not the display name). */
  discordHandle: string;
  /** Originating guild ID — for context only. */
  guildId?: string;
  step: RegistrationStep;
  data: {
    /** Pre-filled from Discord globalName; user can override. */
    name?: string;
    email?: string;
    /** MM/DD/YYYY format. */
    birthdate?: string;
    /** Preferred pronouns (e.g. "she/her", "they/them"). */
    pronouns?: string;
  };
  startedAt: string;
  updatedAt: string;
}

export interface RegistrationSessionStoreConfig {
  persistPath?: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class RegistrationSessionStore {
  private readonly sessions = new Map<string, RegistrationSession>();
  private readonly persistPath: string | null;

  constructor(config: RegistrationSessionStoreConfig = {}) {
    this.persistPath = config.persistPath ?? null;
    this.load();
  }

  private load(): void {
    if (this.persistPath === null) return;
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as { sessions: RegistrationSession[] };
      for (const s of data.sessions ?? []) {
        this.sessions.set(s.sessionId, s);
      }
    } catch {
      // Non-fatal — start with empty state
    }
  }

  private save(): void {
    if (this.persistPath === null) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const data = { sessions: [...this.sessions.values()] };
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // Non-fatal
    }
  }

  get(sessionId: string): RegistrationSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  set(session: RegistrationSession): void {
    this.sessions.set(session.sessionId, { ...session, updatedAt: new Date().toISOString() });
    this.save();
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.save();
  }
}
