import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase } from "./db.js";
import type { Database } from "./db.js";
import { MessageQueue } from "./queue.js";

let db: Database;
let queue: MessageQueue;

beforeEach(() => {
  db = createDatabase(":memory:");
  queue = new MessageQueue(db);
});

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

describe("MessageQueue.enqueue", () => {
  it("returns QueueMessage with ULID id", () => {
    const msg = queue.enqueue({ channel: "telegram", direction: "inbound", payload: { text: "hi" } });
    expect(msg.id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("sets status to 'pending'", () => {
    const msg = queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    expect(msg.status).toBe("pending");
  });

  it("sets retries to 0", () => {
    const msg = queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    expect(msg.retries).toBe(0);
  });

  it("parses payload from JSON correctly", () => {
    const payload = { text: "hello", userId: 42, nested: { a: true } };
    const msg = queue.enqueue({ channel: "telegram", direction: "inbound", payload });
    expect(msg.payload).toEqual(payload);
  });

  it("sets channel and direction correctly", () => {
    const msg = queue.enqueue({ channel: "discord", direction: "outbound", payload: "ping" });
    expect(msg.channel).toBe("discord");
    expect(msg.direction).toBe("outbound");
  });

  it("processedAt is null initially", () => {
    const msg = queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    expect(msg.processedAt).toBeNull();
  });

  it("sets createdAt to ISO-8601 timestamp", () => {
    const before = new Date().toISOString();
    const msg = queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    const after = new Date().toISOString();
    expect(msg.createdAt >= before).toBe(true);
    expect(msg.createdAt <= after).toBe(true);
  });

  it("round-trips object payload through JSON correctly", () => {
    const payload = { type: "command", args: [1, "two", null], meta: { ok: true } };
    const msg = queue.enqueue({ channel: "telegram", direction: "inbound", payload });
    expect(msg.payload).toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// Dequeue
// ---------------------------------------------------------------------------

describe("MessageQueue.dequeue", () => {
  it("returns oldest pending message and marks it 'processing'", () => {
    const msg = queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    const dequeued = queue.dequeue();
    expect(dequeued).not.toBeNull();
    expect(dequeued!.id).toBe(msg.id);
    expect(dequeued!.status).toBe("processing");
  });

  it("returns null on empty queue", () => {
    const result = queue.dequeue();
    expect(result).toBeNull();
  });

  it("returns null when no messages of the filtered direction exist", () => {
    queue.enqueue({ channel: "telegram", direction: "outbound", payload: {} });
    const result = queue.dequeue("inbound");
    expect(result).toBeNull();
  });

  it("filters by direction when specified", () => {
    queue.enqueue({ channel: "telegram", direction: "outbound", payload: { x: 1 } });
    const inbound = queue.enqueue({ channel: "telegram", direction: "inbound", payload: { x: 2 } });

    const result = queue.dequeue("inbound");
    expect(result).not.toBeNull();
    expect(result!.id).toBe(inbound.id);
    expect(result!.direction).toBe("inbound");
  });

  it("FIFO ordering: dequeues messages in enqueue order", async () => {
    const m1 = queue.enqueue({ channel: "telegram", direction: "inbound", payload: { n: 1 } });
    await new Promise((r) => setTimeout(r, 5));
    const m2 = queue.enqueue({ channel: "telegram", direction: "inbound", payload: { n: 2 } });
    await new Promise((r) => setTimeout(r, 5));
    const m3 = queue.enqueue({ channel: "telegram", direction: "inbound", payload: { n: 3 } });

    const d1 = queue.dequeue();
    const d2 = queue.dequeue();
    const d3 = queue.dequeue();

    expect(d1!.id).toBe(m1.id);
    expect(d2!.id).toBe(m2.id);
    expect(d3!.id).toBe(m3.id);
  });

  it("dequeued message is no longer available for next dequeue", () => {
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    queue.dequeue();
    const second = queue.dequeue();
    expect(second).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Complete
// ---------------------------------------------------------------------------

describe("MessageQueue.complete", () => {
  it("removes message from pending (status set to 'done')", () => {
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    const dequeued = queue.dequeue()!;
    queue.complete(dequeued.id);

    // Done messages do not appear in pending depth or peek
    expect(queue.depth()).toBe(0);
    expect(queue.peek().length).toBe(0);
  });

  it("done messages are excluded from depth count", () => {
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    const d = queue.dequeue()!;
    queue.complete(d.id);
    expect(queue.depth()).toBe(0);
  });

  it("completed messages are removed by cleanup()", async () => {
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    const d = queue.dequeue()!;
    queue.complete(d.id);
    await new Promise((r) => setTimeout(r, 5));
    const future = new Date().toISOString();
    const deleted = queue.cleanup(future);
    expect(deleted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fail / retry
// ---------------------------------------------------------------------------

describe("MessageQueue.fail", () => {
  it("increments retries and keeps status 'pending' if under maxRetries", () => {
    const queueWith3 = new MessageQueue(db, { maxRetries: 3 });
    queueWith3.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    const d = queueWith3.dequeue()!;

    queueWith3.fail(d.id);

    const pending = queueWith3.peek();
    const updated = pending.find((m) => m.id === d.id);
    expect(updated).not.toBeUndefined();
    expect(updated!.status).toBe("pending");
    expect(updated!.retries).toBe(1);
  });

  it("moves message to 'dead' after maxRetries failures", () => {
    const queueWith3 = new MessageQueue(db, { maxRetries: 3 });
    queueWith3.enqueue({ channel: "telegram", direction: "inbound", payload: {} });

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      const d = queueWith3.dequeue()!;
      queueWith3.fail(d.id);
    }

    const dead = queueWith3.getDeadLetters();
    expect(dead.length).toBe(1);
    expect(dead[0]!.status).toBe("dead");
    expect(dead[0]!.retries).toBe(3);
  });

  it("dead message is not returned by dequeue", () => {
    const queueWith1 = new MessageQueue(db, { maxRetries: 1 });
    queueWith1.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    const d = queueWith1.dequeue()!;
    queueWith1.fail(d.id);

    // Now it's dead — dequeue should return null
    const next = queueWith1.dequeue();
    expect(next).toBeNull();
  });
});

describe("MessageQueue.retry", () => {
  it("resets dead-letter back to 'pending' with retries 0", () => {
    const queueWith1 = new MessageQueue(db, { maxRetries: 1 });
    queueWith1.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    const d = queueWith1.dequeue()!;
    queueWith1.fail(d.id);

    // Confirm it's dead
    expect(queueWith1.getDeadLetters().length).toBe(1);

    // Retry it
    queueWith1.retry(d.id);

    // Should be pending again
    const pending = queueWith1.peek();
    const revived = pending.find((m) => m.id === d.id);
    expect(revived).not.toBeUndefined();
    expect(revived!.status).toBe("pending");
    expect(revived!.retries).toBe(0);

    // No longer in dead letters
    expect(queueWith1.getDeadLetters().length).toBe(0);
  });

  it("is a no-op for non-dead messages", () => {
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    const d = queue.dequeue()!;

    // Message is 'processing', not 'dead' — retry should no-op
    expect(() => queue.retry(d.id)).not.toThrow();
    // Still processing (not in pending)
    expect(queue.peek().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Queue inspection
// ---------------------------------------------------------------------------

describe("MessageQueue.depth", () => {
  it("returns count of pending messages", () => {
    expect(queue.depth()).toBe(0);
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    expect(queue.depth()).toBe(2);
  });

  it("filters by direction when specified", () => {
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    queue.enqueue({ channel: "telegram", direction: "outbound", payload: {} });

    expect(queue.depth("inbound")).toBe(2);
    expect(queue.depth("outbound")).toBe(1);
  });

  it("returns 0 when no pending messages exist", () => {
    expect(queue.depth()).toBe(0);
    expect(queue.depth("inbound")).toBe(0);
  });

  it("does not count 'processing' messages", () => {
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    queue.dequeue();
    expect(queue.depth()).toBe(0);
  });
});

describe("MessageQueue.peek", () => {
  it("returns pending messages without changing status", () => {
    const msg = queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    const peeked = queue.peek();
    expect(peeked.length).toBe(1);
    expect(peeked[0]!.id).toBe(msg.id);
    expect(peeked[0]!.status).toBe("pending");

    // Can still be dequeued (status unchanged)
    const dequeued = queue.dequeue();
    expect(dequeued).not.toBeNull();
    expect(dequeued!.id).toBe(msg.id);
  });

  it("supports limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      queue.enqueue({ channel: "telegram", direction: "inbound", payload: { i } });
    }
    const peeked = queue.peek(undefined, 3);
    expect(peeked.length).toBe(3);
  });

  it("supports direction filter", () => {
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    queue.enqueue({ channel: "telegram", direction: "outbound", payload: {} });

    const inbound = queue.peek("inbound");
    expect(inbound.length).toBe(1);
    expect(inbound[0]!.direction).toBe("inbound");
  });

  it("returns empty array when queue is empty", () => {
    expect(queue.peek()).toEqual([]);
  });
});

describe("MessageQueue.getDeadLetters", () => {
  it("returns dead-letter messages", () => {
    const q = new MessageQueue(db, { maxRetries: 1 });
    q.enqueue({ channel: "telegram", direction: "inbound", payload: { x: 1 } });
    q.enqueue({ channel: "telegram", direction: "inbound", payload: { x: 2 } });

    const d1 = q.dequeue()!;
    q.fail(d1.id);
    const d2 = q.dequeue()!;
    q.fail(d2.id);

    const dead = q.getDeadLetters();
    expect(dead.length).toBe(2);
    expect(dead.every((m) => m.status === "dead")).toBe(true);
  });

  it("returns empty array when no dead letters", () => {
    expect(queue.getDeadLetters()).toEqual([]);
  });
});

describe("MessageQueue.cleanup", () => {
  it("deletes done messages older than cutoff and returns count", async () => {
    // Enqueue and complete first message before cutoff
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    queue.complete(queue.dequeue()!.id);
    // Wait to ensure the cutoff is strictly after the first message's created_at
    await new Promise((r) => setTimeout(r, 10));
    const cutoff = new Date().toISOString();

    // Enqueue and complete second message after cutoff
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    queue.complete(queue.dequeue()!.id);

    // Only the first (older) message should be deleted
    const deleted = queue.cleanup(cutoff);
    expect(deleted).toBe(1);
  });

  it("returns 0 when nothing to clean", () => {
    const future = new Date(Date.now() + 10000).toISOString();
    const deleted = queue.cleanup(future);
    expect(deleted).toBe(0);
  });

  it("does not delete pending messages", () => {
    queue.enqueue({ channel: "telegram", direction: "inbound", payload: {} });
    const past = new Date(Date.now() - 10000).toISOString();
    // Even with a past cutoff, pending messages are not deleted (only 'done')
    const deleted = queue.cleanup(past);
    expect(deleted).toBe(0);
    expect(queue.depth()).toBe(1);
  });
});
