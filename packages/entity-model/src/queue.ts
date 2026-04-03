import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";

import type { Database } from "./db.js";

// ---------------------------------------------------------------------------
// Convenience statement type aliases
// ---------------------------------------------------------------------------

/** Statement bound with a single named-parameter object. */
type NamedStmt<P extends object> = BetterSqlite3.Statement<[P]>;

/** Statement bound with positional parameters. */
type PosStmt<P extends unknown[]> = BetterSqlite3.Statement<P>;

// ---------------------------------------------------------------------------
// Named-parameter shapes used by prepared statements
// ---------------------------------------------------------------------------

interface InsertMessageParams {
  id: string;
  channel: string;
  direction: string;
  payload: string;
  created_at: string;
}

interface FailMessageParams {
  id: string;
  max_retries: number;
  now: string;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type QueueDirection = "inbound" | "outbound";
export type QueueStatus = "pending" | "processing" | "done" | "failed" | "dead";

/** A message in the queue with its full metadata */
export interface QueueMessage {
  id: string;
  channel: string;
  direction: QueueDirection;
  payload: unknown; // JSON parsed
  status: QueueStatus;
  retries: number;
  createdAt: string; // ISO-8601
  processedAt: string | null; // ISO-8601 or null
}

/** Parameters for enqueuing a new message */
export interface EnqueueParams {
  channel: string;
  direction: QueueDirection;
  payload: unknown; // will be JSON.stringify'd
}

// ---------------------------------------------------------------------------
// Row type — snake_case as returned by better-sqlite3
// ---------------------------------------------------------------------------

interface QueueRow {
  id: string;
  channel: string;
  direction: QueueDirection;
  payload: string; // JSON text
  status: QueueStatus;
  retries: number;
  created_at: string;
  processed_at: string | null;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

/** Maps a raw SQLite row to a QueueMessage (snake_case → camelCase, parses JSON payload) */
function rowToMessage(row: QueueRow): QueueMessage {
  return {
    id: row.id,
    channel: row.channel,
    direction: row.direction,
    payload: JSON.parse(row.payload) as unknown,
    status: row.status,
    retries: row.retries,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

// ---------------------------------------------------------------------------
// MessageQueue
// ---------------------------------------------------------------------------

/**
 * SQLite-backed FIFO message queue for async processing between gateway and agent bridge.
 *
 * Messages move through: pending → processing → done
 *                                            ↘ pending (retry)
 *                                            ↘ dead (max retries exceeded)
 *
 * @example
 * const queue = new MessageQueue(db);
 * const msg = queue.enqueue({ channel: "telegram", direction: "inbound", payload: { text: "hi" } });
 * const next = queue.dequeue("inbound");
 * if (next) queue.complete(next.id);
 */
export class MessageQueue {
  private readonly maxRetries: number;

  private readonly stmtEnqueue: NamedStmt<InsertMessageParams>;
  private readonly stmtGetById: PosStmt<[string]>;
  private readonly stmtDequeueSelect: PosStmt<[]>;
  private readonly stmtDequeueSelectFiltered: PosStmt<[string]>;
  private readonly stmtMarkProcessing: PosStmt<[string]>;
  private readonly stmtComplete: PosStmt<[string, string]>;
  private readonly stmtFail: NamedStmt<FailMessageParams>;
  private readonly stmtDeadLetters: PosStmt<[number]>;
  private readonly stmtRetry: PosStmt<[string]>;
  private readonly stmtDepth: PosStmt<[]>;
  private readonly stmtDepthFiltered: PosStmt<[string]>;
  private readonly stmtPeek: PosStmt<[number]>;
  private readonly stmtPeekFiltered: PosStmt<[string, number]>;
  private readonly stmtCleanup: PosStmt<[string]>;

  constructor(private readonly db: Database, opts?: { maxRetries?: number }) {
    this.maxRetries = opts?.maxRetries ?? 3;

    this.stmtEnqueue = db.prepare<InsertMessageParams>(`
      INSERT INTO message_queue (id, channel, direction, payload, status, retries, created_at, processed_at)
      VALUES (@id, @channel, @direction, @payload, 'pending', 0, @created_at, NULL)
    `);

    this.stmtGetById = db.prepare<[string]>(`
      SELECT id, channel, direction, payload, status, retries, created_at, processed_at
      FROM message_queue
      WHERE id = ?
    `);

    this.stmtDequeueSelect = db.prepare<[]>(`
      SELECT id, channel, direction, payload, status, retries, created_at, processed_at
      FROM message_queue
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `);

    this.stmtDequeueSelectFiltered = db.prepare<[string]>(`
      SELECT id, channel, direction, payload, status, retries, created_at, processed_at
      FROM message_queue
      WHERE status = 'pending' AND direction = ?
      ORDER BY created_at ASC
      LIMIT 1
    `);

    this.stmtMarkProcessing = db.prepare<[string]>(`
      UPDATE message_queue
      SET status = 'processing'
      WHERE id = ?
    `);

    this.stmtComplete = db.prepare<[string, string]>(`
      UPDATE message_queue
      SET status = 'done', processed_at = ?
      WHERE id = ?
    `);

    this.stmtFail = db.prepare<FailMessageParams>(`
      UPDATE message_queue
      SET retries = retries + 1,
          status = CASE WHEN retries + 1 >= @max_retries THEN 'dead' ELSE 'pending' END,
          processed_at = CASE WHEN retries + 1 >= @max_retries THEN @now ELSE processed_at END
      WHERE id = @id
    `);

    this.stmtDeadLetters = db.prepare<[number]>(`
      SELECT id, channel, direction, payload, status, retries, created_at, processed_at
      FROM message_queue
      WHERE status = 'dead'
      ORDER BY created_at ASC
      LIMIT ?
    `);

    this.stmtRetry = db.prepare<[string]>(`
      UPDATE message_queue
      SET status = 'pending', retries = 0, processed_at = NULL
      WHERE id = ? AND status = 'dead'
    `);

    this.stmtDepth = db.prepare<[]>(`
      SELECT COUNT(*) as count
      FROM message_queue
      WHERE status = 'pending'
    `);

    this.stmtDepthFiltered = db.prepare<[string]>(`
      SELECT COUNT(*) as count
      FROM message_queue
      WHERE status = 'pending' AND direction = ?
    `);

    this.stmtPeek = db.prepare<[number]>(`
      SELECT id, channel, direction, payload, status, retries, created_at, processed_at
      FROM message_queue
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `);

    this.stmtPeekFiltered = db.prepare<[string, number]>(`
      SELECT id, channel, direction, payload, status, retries, created_at, processed_at
      FROM message_queue
      WHERE status = 'pending' AND direction = ?
      ORDER BY created_at ASC
      LIMIT ?
    `);

    this.stmtCleanup = db.prepare<[string]>(`
      DELETE FROM message_queue
      WHERE status = 'done' AND created_at < ?
    `);
  }

  // ---------------------------------------------------------------------------
  // Write operations
  // ---------------------------------------------------------------------------

  /**
   * Add a message to the queue with status "pending".
   * The payload is JSON-serialised before storage.
   *
   * @example
   * const msg = queue.enqueue({ channel: "telegram", direction: "inbound", payload: { text: "hello" } });
   */
  enqueue(params: EnqueueParams): QueueMessage {
    const id = ulid();
    const now = new Date().toISOString();

    this.stmtEnqueue.run({
      id,
      channel: params.channel,
      direction: params.direction,
      payload: JSON.stringify(params.payload),
      created_at: now,
    });

    return rowToMessage(this.stmtGetById.get(id) as QueueRow);
  }

  /**
   * Fetch the oldest pending message (FIFO) and atomically mark it as "processing".
   * Returns null if the queue is empty (for the given direction).
   *
   * @example
   * const msg = queue.dequeue("inbound");
   * if (msg) {
   *   // process msg.payload
   *   queue.complete(msg.id);
   * }
   */
  dequeue(direction?: QueueDirection): QueueMessage | null {
    const dequeueTransaction = this.db.transaction(
      (dir: QueueDirection | undefined): QueueMessage | null => {
        const row =
          dir !== undefined
            ? (this.stmtDequeueSelectFiltered.get(dir) as QueueRow | undefined)
            : (this.stmtDequeueSelect.get() as QueueRow | undefined);

        if (row === undefined) {
          return null;
        }

        this.stmtMarkProcessing.run(row.id);
        return rowToMessage({ ...row, status: "processing" });
      },
    );

    return dequeueTransaction(direction);
  }

  /**
   * Mark a message as "done" and record the completion timestamp.
   *
   * @example
   * queue.complete(msg.id);
   */
  complete(id: string): void {
    const now = new Date().toISOString();
    this.stmtComplete.run(now, id);
  }

  /**
   * Mark a message as failed and increment its retry counter.
   * If retries reach maxRetries, the message is moved to "dead" (dead-letter queue).
   * Otherwise it is reset to "pending" for another processing attempt.
   *
   * @example
   * queue.fail(msg.id);
   */
  fail(id: string): void {
    const now = new Date().toISOString();
    this.stmtFail.run({ id, max_retries: this.maxRetries, now });
  }

  // ---------------------------------------------------------------------------
  // Read operations
  // ---------------------------------------------------------------------------

  /**
   * Retrieve all dead-letter messages (status "dead"), oldest first.
   *
   * @example
   * const dead = queue.getDeadLetters({ limit: 50 });
   */
  getDeadLetters(opts?: { limit?: number }): QueueMessage[] {
    const limit = opts?.limit ?? 1000;
    const rows = this.stmtDeadLetters.all(limit) as QueueRow[];
    return rows.map(rowToMessage);
  }

  /**
   * Re-enqueue a dead-letter message: resets retries to 0 and status back to "pending".
   * Only operates on messages with status "dead" — silently no-ops for others.
   *
   * @example
   * queue.retry(deadMsg.id);
   */
  retry(id: string): void {
    this.stmtRetry.run(id);
  }

  /**
   * Count of pending messages in the queue, optionally filtered by direction.
   *
   * @example
   * const inboundDepth = queue.depth("inbound");
   */
  depth(direction?: QueueDirection): number {
    const row =
      direction !== undefined
        ? (this.stmtDepthFiltered.get(direction) as { count: number })
        : (this.stmtDepth.get() as { count: number });

    return row.count;
  }

  /**
   * Return pending messages without marking them as "processing". Useful for
   * inspecting queue state or draining cleanly on shutdown.
   *
   * @example
   * const upcoming = queue.peek("outbound", 10);
   */
  peek(direction?: QueueDirection, limit?: number): QueueMessage[] {
    const cap = limit ?? 100;
    const rows =
      direction !== undefined
        ? (this.stmtPeekFiltered.all(direction, cap) as QueueRow[])
        : (this.stmtPeek.all(cap) as QueueRow[]);

    return rows.map(rowToMessage);
  }

  /**
   * Delete all "done" messages created before the given ISO-8601 date string.
   * Returns the number of rows deleted.
   *
   * @example
   * const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
   * const deleted = queue.cleanup(cutoff);
   */
  cleanup(olderThan: string): number {
    const result = this.stmtCleanup.run(olderThan);
    return result.changes;
  }
}
