/**
 * MessageQueue — drizzle-based FIFO message queue.
 *
 * Messages move through: pending → processing → done
 *                                            ↘ pending (retry)
 *                                            ↘ dead (max retries exceeded)
 */

import { and, asc, eq, lt, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@agi/db-schema/client";
import { messageQueue } from "@agi/db-schema";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type QueueDirection = "inbound" | "outbound";
export type QueueStatus = "pending" | "processing" | "done" | "failed" | "dead";

export interface QueueMessage {
  id: string;
  channel: string;
  direction: QueueDirection;
  payload: unknown;
  status: QueueStatus;
  retries: number;
  createdAt: string;
  processedAt: string | null;
}

export interface EnqueueParams {
  channel: string;
  direction: QueueDirection;
  payload: unknown;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToMessage(row: typeof messageQueue.$inferSelect): QueueMessage {
  return {
    id: row.id,
    channel: row.channel,
    direction: row.direction as QueueDirection,
    payload: row.payload as unknown,
    status: row.status as QueueStatus,
    retries: row.retries,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    processedAt: row.processedAt
      ? (row.processedAt instanceof Date ? row.processedAt.toISOString() : String(row.processedAt))
      : null,
  };
}

// ---------------------------------------------------------------------------
// MessageQueue
// ---------------------------------------------------------------------------

export class MessageQueue {
  private readonly maxRetries: number;

  constructor(private readonly db: Db, opts?: { maxRetries?: number }) {
    this.maxRetries = opts?.maxRetries ?? 3;
  }

  /** Add a message to the queue with status "pending". */
  async enqueue(params: EnqueueParams): Promise<QueueMessage> {
    const id = ulid();
    const now = new Date();

    await this.db.insert(messageQueue).values({
      id,
      channel: params.channel,
      direction: params.direction,
      payload: params.payload as Record<string, unknown>,
      status: "pending",
      retries: 0,
      createdAt: now,
      processedAt: null,
    });

    const [row] = await this.db
      .select()
      .from(messageQueue)
      .where(eq(messageQueue.id, id));

    return rowToMessage(row!);
  }

  /**
   * Fetch the oldest pending message (FIFO) and atomically mark it as "processing".
   * Returns null if the queue is empty.
   */
  async dequeue(direction?: QueueDirection): Promise<QueueMessage | null> {
    return this.db.transaction(async (tx) => {
      const conditions = [eq(messageQueue.status, "pending")];
      if (direction !== undefined) conditions.push(eq(messageQueue.direction, direction));

      const [row] = await tx
        .select()
        .from(messageQueue)
        .where(and(...conditions))
        .orderBy(asc(messageQueue.createdAt))
        .limit(1);

      if (!row) return null;

      await tx.update(messageQueue)
        .set({ status: "processing" })
        .where(eq(messageQueue.id, row.id));

      return rowToMessage({ ...row, status: "processing" });
    });
  }

  /** Mark a message as "done". */
  async complete(id: string): Promise<void> {
    const now = new Date();
    await this.db.update(messageQueue)
      .set({ status: "done", processedAt: now })
      .where(eq(messageQueue.id, id));
  }

  /**
   * Mark a message as failed and increment retry counter.
   * Moves to "dead" if max retries exceeded.
   */
  async fail(id: string): Promise<void> {
    const now = new Date();
    await this.db.update(messageQueue)
      .set({
        retries: sql`${messageQueue.retries} + 1`,
        status: sql`CASE WHEN ${messageQueue.retries} + 1 >= ${this.maxRetries} THEN 'dead' ELSE 'pending' END`,
        processedAt: sql`CASE WHEN ${messageQueue.retries} + 1 >= ${this.maxRetries} THEN ${now.toISOString()} ELSE ${messageQueue.processedAt} END`,
      })
      .where(eq(messageQueue.id, id));
  }

  /** Retrieve dead-letter messages. */
  async getDeadLetters(opts?: { limit?: number }): Promise<QueueMessage[]> {
    const limit = opts?.limit ?? 1000;
    const rows = await this.db
      .select()
      .from(messageQueue)
      .where(eq(messageQueue.status, "dead"))
      .orderBy(asc(messageQueue.createdAt))
      .limit(limit);
    return rows.map(rowToMessage);
  }

  /** Re-enqueue a dead-letter message. */
  async retry(id: string): Promise<void> {
    await this.db.update(messageQueue)
      .set({ status: "pending", retries: 0, processedAt: null })
      .where(and(eq(messageQueue.id, id), eq(messageQueue.status, "dead")));
  }

  /** Count pending messages, optionally filtered by direction. */
  async depth(direction?: QueueDirection): Promise<number> {
    const conditions = [eq(messageQueue.status, "pending")];
    if (direction !== undefined) conditions.push(eq(messageQueue.direction, direction));

    const [row] = await this.db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(messageQueue)
      .where(and(...conditions));
    return row?.cnt ?? 0;
  }

  /** Peek at pending messages without marking them processing. */
  async peek(direction?: QueueDirection, limit?: number): Promise<QueueMessage[]> {
    const cap = limit ?? 100;
    const conditions = [eq(messageQueue.status, "pending")];
    if (direction !== undefined) conditions.push(eq(messageQueue.direction, direction));

    const rows = await this.db
      .select()
      .from(messageQueue)
      .where(and(...conditions))
      .orderBy(asc(messageQueue.createdAt))
      .limit(cap);
    return rows.map(rowToMessage);
  }

  /** Delete "done" messages older than the given ISO-8601 cutoff. */
  async cleanup(olderThan: string): Promise<number> {
    const result = await this.db
      .delete(messageQueue)
      .where(and(
        eq(messageQueue.status, "done"),
        lt(messageQueue.createdAt, new Date(olderThan)),
      ));
    return (result as unknown as { rowCount?: number | null }).rowCount ?? 0;
  }
}
