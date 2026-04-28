/**
 * CommsLog — communication transcript store (drizzle/Postgres).
 */

import { and, eq, lt, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@agi/db-schema/client";
import { commsLog } from "@agi/db-schema";

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
// Row mapper
// ---------------------------------------------------------------------------

function rowToEntry(row: typeof commsLog.$inferSelect): CommsLogEntry {
  return {
    id: row.id,
    channel: row.channel,
    direction: row.direction as "inbound" | "outbound",
    senderId: row.senderId,
    senderName: row.senderName ?? null,
    subject: row.subject ?? null,
    preview: row.preview,
    // fullPayload stored as jsonb; serialize back to string for public interface
    fullPayload: typeof row.fullPayload === "string"
      ? row.fullPayload
      : JSON.stringify(row.fullPayload),
    entityId: row.entityId ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

// ---------------------------------------------------------------------------
// CommsLog
// ---------------------------------------------------------------------------

export class CommsLog {
  constructor(private readonly db: Db) {}

  async log(params: CommsLogParams): Promise<CommsLogEntry> {
    const id = ulid();
    const now = new Date();

    // Parse fullPayload back to object for jsonb storage
    let payloadObj: unknown;
    try {
      payloadObj = typeof params.fullPayload === "string"
        ? JSON.parse(params.fullPayload) as unknown
        : params.fullPayload;
    } catch {
      payloadObj = params.fullPayload;
    }

    await this.db.insert(commsLog).values({
      id,
      channel: params.channel,
      direction: params.direction as typeof commsLog.$inferInsert["direction"],
      senderId: params.senderId,
      senderName: params.senderName,
      subject: params.subject,
      preview: params.preview,
      fullPayload: payloadObj as Record<string, unknown>,
      entityId: params.entityId,
      createdAt: now,
    });

    return { id, ...params, createdAt: now.toISOString() };
  }

  async query(opts?: {
    channel?: string;
    direction?: string;
    limit?: number;
    offset?: number;
  }): Promise<CommsLogEntry[]> {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const conditions = [];
    if (opts?.channel !== undefined) conditions.push(eq(commsLog.channel, opts.channel));
    if (opts?.direction !== undefined) conditions.push(eq(commsLog.direction, opts.direction as typeof commsLog.$inferInsert["direction"]));

    const rows = await this.db
      .select()
      .from(commsLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`${commsLog.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    return rows.map(rowToEntry);
  }

  async count(opts?: { channel?: string; direction?: string }): Promise<number> {
    const conditions = [];
    if (opts?.channel !== undefined) conditions.push(eq(commsLog.channel, opts.channel));
    if (opts?.direction !== undefined) conditions.push(eq(commsLog.direction, opts.direction as typeof commsLog.$inferInsert["direction"]));

    const [row] = await this.db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(commsLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return row?.cnt ?? 0;
  }

  async cleanup(olderThan: string): Promise<number> {
    const result = await this.db
      .delete(commsLog)
      .where(lt(commsLog.createdAt, new Date(olderThan)));
    return (result as unknown as { rowCount?: number | null }).rowCount ?? 0;
  }
}
