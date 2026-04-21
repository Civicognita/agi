/**
 * NotificationStore — in-app notification queue (drizzle/Postgres).
 */

import { eq, inArray, lt, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@agi/db-schema/client";
import { notifications } from "@agi/db-schema";

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
// Row mapper
// ---------------------------------------------------------------------------

function rowToNotification(row: typeof notifications.$inferSelect): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    metadata: row.metadata ?? null,
    read: row.read,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

// ---------------------------------------------------------------------------
// NotificationStore
// ---------------------------------------------------------------------------

export class NotificationStore {
  constructor(private readonly db: Db) {}

  async create(params: CreateNotificationParams): Promise<Notification> {
    const id = ulid();
    const now = new Date();

    await this.db.insert(notifications).values({
      id,
      type: params.type,
      title: params.title,
      body: params.body,
      metadata: (params.metadata !== undefined ? params.metadata : null) as Record<string, unknown> | null,
      read: false,
      createdAt: now,
    });

    return {
      id,
      type: params.type,
      title: params.title,
      body: params.body,
      metadata: params.metadata ?? null,
      read: false,
      createdAt: now.toISOString(),
    };
  }

  async getRecent(opts?: { limit?: number; unreadOnly?: boolean }): Promise<Notification[]> {
    const limit = opts?.limit ?? 50;
    const query = this.db
      .select()
      .from(notifications)
      .orderBy(sql`${notifications.createdAt} DESC`)
      .limit(limit);

    const rows = opts?.unreadOnly
      ? await query.where(eq(notifications.read, false))
      : await query;

    return rows.map(rowToNotification);
  }

  async countUnread(): Promise<number> {
    const [row] = await this.db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(notifications)
      .where(eq(notifications.read, false));
    return row?.cnt ?? 0;
  }

  async markRead(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.update(notifications)
      .set({ read: true })
      .where(inArray(notifications.id, ids));
  }

  async markAllRead(): Promise<void> {
    await this.db.update(notifications)
      .set({ read: true })
      .where(eq(notifications.read, false));
  }

  async cleanup(olderThan: string): Promise<number> {
    const result = await this.db
      .delete(notifications)
      .where(lt(notifications.createdAt, new Date(olderThan)));
    return (result as unknown as { rowCount?: number | null }).rowCount ?? 0;
  }
}
