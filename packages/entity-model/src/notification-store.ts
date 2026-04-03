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
  type: string;
  title: string;
  body: string;
  metadata: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  metadata: unknown;
  read: boolean;
  createdAt: string;
}

export interface CreateNotificationParams {
  type: string;
  title: string;
  body: string;
  metadata?: unknown;
}

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  metadata: string | null;
  read: number;
  created_at: string;
}

function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    metadata: row.metadata !== null ? JSON.parse(row.metadata) as unknown : null,
    read: row.read === 1,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// NotificationStore
// ---------------------------------------------------------------------------

export class NotificationStore {
  private readonly stmtInsert: NamedStmt<InsertParams>;
  private readonly stmtGetRecent: PosStmt<[number]>;
  private readonly stmtGetRecentUnread: PosStmt<[number]>;
  private readonly stmtCountUnread: PosStmt<[]>;
  private readonly stmtMarkAllRead: PosStmt<[]>;
  private readonly stmtCleanup: PosStmt<[string]>;

  constructor(private readonly db: Database) {
    this.stmtInsert = db.prepare<InsertParams>(`
      INSERT INTO notifications (id, type, title, body, metadata, read, created_at)
      VALUES (@id, @type, @title, @body, @metadata, 0, @created_at)
    `);

    this.stmtGetRecent = db.prepare<[number]>(`
      SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?
    `);

    this.stmtGetRecentUnread = db.prepare<[number]>(`
      SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC LIMIT ?
    `);

    this.stmtCountUnread = db.prepare<[]>(`
      SELECT COUNT(*) as count FROM notifications WHERE read = 0
    `);

    this.stmtMarkAllRead = db.prepare<[]>(`
      UPDATE notifications SET read = 1 WHERE read = 0
    `);

    this.stmtCleanup = db.prepare<[string]>(`
      DELETE FROM notifications WHERE created_at < ?
    `);
  }

  create(params: CreateNotificationParams): Notification {
    const id = ulid();
    const now = new Date().toISOString();

    this.stmtInsert.run({
      id,
      type: params.type,
      title: params.title,
      body: params.body,
      metadata: params.metadata !== undefined ? JSON.stringify(params.metadata) : null,
      created_at: now,
    });

    return {
      id,
      type: params.type,
      title: params.title,
      body: params.body,
      metadata: params.metadata ?? null,
      read: false,
      createdAt: now,
    };
  }

  getRecent(opts?: { limit?: number; unreadOnly?: boolean }): Notification[] {
    const limit = opts?.limit ?? 50;
    const rows = opts?.unreadOnly
      ? (this.stmtGetRecentUnread.all(limit) as NotificationRow[])
      : (this.stmtGetRecent.all(limit) as NotificationRow[]);
    return rows.map(rowToNotification);
  }

  countUnread(): number {
    return (this.stmtCountUnread.get() as { count: number }).count;
  }

  markRead(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db.prepare(`UPDATE notifications SET read = 1 WHERE id IN (${placeholders})`).run(...ids);
  }

  markAllRead(): void {
    this.stmtMarkAllRead.run();
  }

  cleanup(olderThan: string): number {
    return this.stmtCleanup.run(olderThan).changes;
  }
}
