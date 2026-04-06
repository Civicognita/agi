/**
 * MagicAppStateStore — SQLite-backed persistence for open MagicApp instances.
 *
 * State survives browser close, AGI crash, and connection loss.
 * Destroyed only on explicit close (user or app-triggered).
 */

import BetterSqlite3 from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MagicAppInstanceRecord {
  instanceId: string;
  appId: string;
  userEntityId: string;
  mode: "floating" | "docked" | "minimized";
  state: Record<string, unknown>;
  position: { x: number; y: number; width: number; height: number } | null;
  openedAt: string;
  updatedAt: string;
}

export interface CreateInstanceParams {
  instanceId: string;
  appId: string;
  userEntityId: string;
  mode?: "floating" | "docked" | "minimized";
  state?: Record<string, unknown>;
  position?: { x: number; y: number; width: number; height: number };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const DDL = `
CREATE TABLE IF NOT EXISTS magic_app_instances (
  instance_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  user_entity_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'floating',
  state TEXT NOT NULL DEFAULT '{}',
  position TEXT,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_magic_app_user ON magic_app_instances(user_entity_id);
`;

export class MagicAppStateStore {
  private readonly db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(DDL);
  }

  /** List all open instances for a user. */
  listInstances(userEntityId: string): MagicAppInstanceRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM magic_app_instances WHERE user_entity_id = ? ORDER BY opened_at")
      .all(userEntityId) as Array<Record<string, unknown>>;
    return rows.map(deserialize);
  }

  /** Get a single instance by ID. */
  getInstance(instanceId: string): MagicAppInstanceRecord | null {
    const row = this.db
      .prepare("SELECT * FROM magic_app_instances WHERE instance_id = ?")
      .get(instanceId) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : null;
  }

  /** Create a new instance. */
  createInstance(params: CreateInstanceParams): MagicAppInstanceRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO magic_app_instances (instance_id, app_id, user_entity_id, mode, state, position, opened_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.instanceId,
        params.appId,
        params.userEntityId,
        params.mode ?? "floating",
        JSON.stringify(params.state ?? {}),
        params.position ? JSON.stringify(params.position) : null,
        now,
        now,
      );
    return this.getInstance(params.instanceId)!;
  }

  /** Update instance state (JSON blob). */
  updateState(instanceId: string, state: Record<string, unknown>): void {
    this.db
      .prepare("UPDATE magic_app_instances SET state = ?, updated_at = ? WHERE instance_id = ?")
      .run(JSON.stringify(state), new Date().toISOString(), instanceId);
  }

  /** Update instance mode. */
  updateMode(instanceId: string, mode: "floating" | "docked" | "minimized"): void {
    this.db
      .prepare("UPDATE magic_app_instances SET mode = ?, updated_at = ? WHERE instance_id = ?")
      .run(mode, new Date().toISOString(), instanceId);
  }

  /** Update instance position (for floating mode). */
  updatePosition(instanceId: string, position: { x: number; y: number; width: number; height: number }): void {
    this.db
      .prepare("UPDATE magic_app_instances SET position = ?, updated_at = ? WHERE instance_id = ?")
      .run(JSON.stringify(position), new Date().toISOString(), instanceId);
  }

  /** Close and destroy an instance. */
  deleteInstance(instanceId: string): void {
    this.db
      .prepare("DELETE FROM magic_app_instances WHERE instance_id = ?")
      .run(instanceId);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deserialize(row: Record<string, unknown>): MagicAppInstanceRecord {
  return {
    instanceId: row.instance_id as string,
    appId: row.app_id as string,
    userEntityId: row.user_entity_id as string,
    mode: row.mode as MagicAppInstanceRecord["mode"],
    state: parseJson(row.state as string),
    position: row.position ? parseJson(row.position as string) as { x: number; y: number; width: number; height: number } : null,
    openedAt: row.opened_at as string,
    updatedAt: row.updated_at as string,
  };
}

function parseJson(str: string): Record<string, unknown> {
  try { return JSON.parse(str); } catch { return {}; }
}
