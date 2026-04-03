import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";

import type { Database } from "./db.js";

// ---------------------------------------------------------------------------
// Statement type aliases
// ---------------------------------------------------------------------------

type NamedStmt<P extends object> = BetterSqlite3.Statement<[P]>;
type PosStmt<P extends unknown[]> = BetterSqlite3.Statement<P>;

// ---------------------------------------------------------------------------
// Named-parameter shapes
// ---------------------------------------------------------------------------

interface InsertParams {
  id: string;
  channel: string;
  direction: string;
  sender_id: string;
  sender_name: string | null;
  subject: string | null;
  preview: string;
  full_payload: string;
  entity_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CommsLogEntry {
  id: string;
  channel: string;
  direction: "inbound" | "outbound";
  senderId: string;
  senderName: string | null;
  subject: string | null;
  preview: string;
  fullPayload: string;
  entityId: string | null;
  createdAt: string;
}

export type CommsLogParams = Omit<CommsLogEntry, "id" | "createdAt">;

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface CommsLogRow {
  id: string;
  channel: string;
  direction: "inbound" | "outbound";
  sender_id: string;
  sender_name: string | null;
  subject: string | null;
  preview: string;
  full_payload: string;
  entity_id: string | null;
  created_at: string;
}

function rowToEntry(row: CommsLogRow): CommsLogEntry {
  return {
    id: row.id,
    channel: row.channel,
    direction: row.direction,
    senderId: row.sender_id,
    senderName: row.sender_name,
    subject: row.subject,
    preview: row.preview,
    fullPayload: row.full_payload,
    entityId: row.entity_id,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// CommsLog
// ---------------------------------------------------------------------------

export class CommsLog {
  private readonly stmtInsert: NamedStmt<InsertParams>;
  private readonly stmtQueryAll: PosStmt<[number, number]>;
  private readonly stmtQueryByChannel: PosStmt<[string, number, number]>;
  private readonly stmtQueryByDirection: PosStmt<[string, number, number]>;
  private readonly stmtQueryByBoth: PosStmt<[string, string, number, number]>;
  private readonly stmtCountAll: PosStmt<[]>;
  private readonly stmtCountByChannel: PosStmt<[string]>;
  private readonly stmtCountByDirection: PosStmt<[string]>;
  private readonly stmtCountByBoth: PosStmt<[string, string]>;
  private readonly stmtCleanup: PosStmt<[string]>;

  constructor(db: Database) {
    this.stmtInsert = db.prepare<InsertParams>(`
      INSERT INTO comms_log (id, channel, direction, sender_id, sender_name, subject, preview, full_payload, entity_id, created_at)
      VALUES (@id, @channel, @direction, @sender_id, @sender_name, @subject, @preview, @full_payload, @entity_id, @created_at)
    `);

    this.stmtQueryAll = db.prepare<[number, number]>(`
      SELECT * FROM comms_log ORDER BY created_at DESC LIMIT ? OFFSET ?
    `);

    this.stmtQueryByChannel = db.prepare<[string, number, number]>(`
      SELECT * FROM comms_log WHERE channel = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `);

    this.stmtQueryByDirection = db.prepare<[string, number, number]>(`
      SELECT * FROM comms_log WHERE direction = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `);

    this.stmtQueryByBoth = db.prepare<[string, string, number, number]>(`
      SELECT * FROM comms_log WHERE channel = ? AND direction = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `);

    this.stmtCountAll = db.prepare<[]>(`SELECT COUNT(*) as count FROM comms_log`);

    this.stmtCountByChannel = db.prepare<[string]>(`
      SELECT COUNT(*) as count FROM comms_log WHERE channel = ?
    `);

    this.stmtCountByDirection = db.prepare<[string]>(`
      SELECT COUNT(*) as count FROM comms_log WHERE direction = ?
    `);

    this.stmtCountByBoth = db.prepare<[string, string]>(`
      SELECT COUNT(*) as count FROM comms_log WHERE channel = ? AND direction = ?
    `);

    this.stmtCleanup = db.prepare<[string]>(`
      DELETE FROM comms_log WHERE created_at < ?
    `);
  }

  log(params: CommsLogParams): CommsLogEntry {
    const id = ulid();
    const now = new Date().toISOString();

    this.stmtInsert.run({
      id,
      channel: params.channel,
      direction: params.direction,
      sender_id: params.senderId,
      sender_name: params.senderName,
      subject: params.subject,
      preview: params.preview,
      full_payload: params.fullPayload,
      entity_id: params.entityId,
      created_at: now,
    });

    return {
      id,
      ...params,
      createdAt: now,
    };
  }

  query(opts?: {
    channel?: string;
    direction?: string;
    limit?: number;
    offset?: number;
  }): CommsLogEntry[] {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const channel = opts?.channel;
    const direction = opts?.direction;

    let rows: CommsLogRow[];
    if (channel && direction) {
      rows = this.stmtQueryByBoth.all(channel, direction, limit, offset) as CommsLogRow[];
    } else if (channel) {
      rows = this.stmtQueryByChannel.all(channel, limit, offset) as CommsLogRow[];
    } else if (direction) {
      rows = this.stmtQueryByDirection.all(direction, limit, offset) as CommsLogRow[];
    } else {
      rows = this.stmtQueryAll.all(limit, offset) as CommsLogRow[];
    }

    return rows.map(rowToEntry);
  }

  count(opts?: { channel?: string; direction?: string }): number {
    const channel = opts?.channel;
    const direction = opts?.direction;

    if (channel && direction) {
      return (this.stmtCountByBoth.get(channel, direction) as { count: number }).count;
    } else if (channel) {
      return (this.stmtCountByChannel.get(channel) as { count: number }).count;
    } else if (direction) {
      return (this.stmtCountByDirection.get(direction) as { count: number }).count;
    }
    return (this.stmtCountAll.get() as { count: number }).count;
  }

  cleanup(olderThan: string): number {
    return this.stmtCleanup.run(olderThan).changes;
  }
}
