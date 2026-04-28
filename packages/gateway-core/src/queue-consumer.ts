import { EventEmitter } from "node:events";

import type { MessageQueue, QueueDirection, QueueMessage } from "@agi/entity-model";

import type { OutboundDispatcher, OutboundRoute } from "./outbound-dispatcher.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_DRAIN_TIMEOUT_MS = 5000;
const DRAIN_POLL_INTERVAL_MS = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Dependency injection contract for QueueConsumer. */
export interface QueueConsumerDeps {
  messageQueue: MessageQueue;
  outboundDispatcher: OutboundDispatcher;
  /** Handler for inbound messages — will be wired to the agent bridge. */
  onInbound: (message: QueueMessage) => Promise<void>;
}

/** Configuration options for {@link QueueConsumer}. */
export interface QueueConsumerOptions {
  /** Polling interval in ms (default: 100). */
  pollIntervalMs?: number;
  /** Max concurrent message processing (default: 10). */
  concurrency?: number;
  /** Shutdown drain timeout in ms (default: 5000). */
  drainTimeoutMs?: number;
}

/** Live statistics snapshot from {@link QueueConsumer.getStats}. */
export interface ConsumerStats {
  processed: number;
  failed: number;
  inFlight: number;
  isRunning: boolean;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Narrow an unknown payload to OutboundRoute — trusts the internal pipeline. */
function isOutboundRoute(value: unknown): value is OutboundRoute {
  return (
    typeof value === "object" &&
    value !== null &&
    "channelId" in value &&
    "channelUserId" in value &&
    "content" in value &&
    "entityId" in value
  );
}

// ---------------------------------------------------------------------------
// QueueConsumer
// ---------------------------------------------------------------------------

/**
 * Polls the MessageQueue on a fixed interval, dispatching inbound messages
 * to a handler callback and outbound messages to the OutboundDispatcher.
 *
 * A configurable concurrency limit caps the number of messages being processed
 * simultaneously. Graceful shutdown via `stop()` drains in-flight messages
 * before resolving.
 *
 * @example
 * const consumer = new QueueConsumer(
 *   { messageQueue, outboundDispatcher, onInbound: agentBridge.handle.bind(agentBridge) },
 *   { pollIntervalMs: 200, concurrency: 5 },
 * );
 * consumer.on("message_processed", ({ id, direction }) => console.log("done", id, direction));
 * consumer.start();
 * // later…
 * await consumer.stop();
 */
export class QueueConsumer extends EventEmitter {
  private readonly messageQueue: MessageQueue;
  private readonly outboundDispatcher: OutboundDispatcher;
  private readonly onInbound: (message: QueueMessage) => Promise<void>;

  private readonly pollIntervalMs: number;
  private readonly concurrency: number;
  private readonly drainTimeoutMs: number;

  private running: boolean;
  private inFlight: number;
  private processed: number;
  private failed: number;
  private intervalHandle: ReturnType<typeof setInterval> | null;

  constructor(deps: QueueConsumerDeps, options?: QueueConsumerOptions) {
    super();
    this.messageQueue = deps.messageQueue;
    this.outboundDispatcher = deps.outboundDispatcher;
    this.onInbound = deps.onInbound;

    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
    this.drainTimeoutMs = options?.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;

    this.running = false;
    this.inFlight = 0;
    this.processed = 0;
    this.failed = 0;
    this.intervalHandle = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Begin the polling loop. No-op if already running.
   *
   * @example
   * consumer.start();
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.intervalHandle = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  /**
   * Stop polling and wait for all in-flight messages to complete.
   *
   * Resolves once the queue drains or the drain timeout elapses. Emits
   * `"drain_complete"` when finished.
   *
   * @example
   * await consumer.stop();
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    await this.drainInFlight();

    this.emit("drain_complete");
  }

  // ---------------------------------------------------------------------------
  // State accessors
  // ---------------------------------------------------------------------------

  /** Return `true` if the polling loop is active. */
  isRunning(): boolean {
    return this.running;
  }

  /** Return a snapshot of consumer statistics. */
  getStats(): ConsumerStats {
    return {
      processed: this.processed,
      failed: this.failed,
      inFlight: this.inFlight,
      isRunning: this.running,
    };
  }

  // ---------------------------------------------------------------------------
  // Poll
  // ---------------------------------------------------------------------------

  /**
   * One poll tick — dequeue up to one inbound and one outbound message if
   * concurrency permits, then dispatch each asynchronously.
   */
  private async poll(): Promise<void> {
    if (this.inFlight >= this.concurrency) {
      return;
    }

    const inboundMsg = await this.messageQueue.dequeue("inbound");
    if (inboundMsg !== null) {
      void this.processMessage(inboundMsg, "inbound");
    }

    if (this.inFlight >= this.concurrency) {
      return;
    }

    const outboundMsg = await this.messageQueue.dequeue("outbound");
    if (outboundMsg !== null) {
      void this.processMessage(outboundMsg, "outbound");
    }
  }

  // ---------------------------------------------------------------------------
  // Message processing
  // ---------------------------------------------------------------------------

  /**
   * Process a single dequeued message — routes inbound to the handler callback
   * and outbound to the OutboundDispatcher. Calls `complete()` on success or
   * `fail()` on error.
   */
  private async processMessage(
    message: QueueMessage,
    direction: QueueDirection,
  ): Promise<void> {
    this.inFlight += 1;

    try {
      if (direction === "inbound") {
        await this.processInbound(message);
      } else {
        await this.processOutbound(message);
      }

      this.messageQueue.complete(message.id);
      this.processed += 1;
      this.emit("message_processed", { id: message.id, direction });
    } catch (err) {
      this.messageQueue.fail(message.id);
      this.failed += 1;

      const error = err instanceof Error ? err.message : String(err);
      this.emit("message_failed", { id: message.id, direction, error });
    } finally {
      this.inFlight -= 1;
    }
  }

  /**
   * Invoke the inbound handler callback with the queued message.
   *
   * @throws {Error} If the handler rejects.
   */
  private async processInbound(message: QueueMessage): Promise<void> {
    await this.onInbound(message);
  }

  /**
   * Extract an OutboundRoute from the message payload and dispatch via
   * OutboundDispatcher.
   *
   * @throws {Error} If the payload is not a valid OutboundRoute or dispatch fails.
   */
  private async processOutbound(message: QueueMessage): Promise<void> {
    if (!isOutboundRoute(message.payload)) {
      throw new Error(
        `Outbound message ${message.id} has invalid payload shape — expected OutboundRoute`,
      );
    }

    await this.outboundDispatcher.dispatch(message.payload);
  }

  // ---------------------------------------------------------------------------
  // Drain
  // ---------------------------------------------------------------------------

  /**
   * Wait for `inFlight` to reach zero, with a hard timeout.
   *
   * Polls every {@link DRAIN_POLL_INTERVAL_MS} ms. Resolves immediately if
   * nothing is in-flight.
   */
  private drainInFlight(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.inFlight === 0) {
        resolve();
        return;
      }

      const deadline = Date.now() + this.drainTimeoutMs;
      const drainInterval = setInterval(() => {
        if (this.inFlight === 0 || Date.now() >= deadline) {
          clearInterval(drainInterval);
          resolve();
        }
      }, DRAIN_POLL_INTERVAL_MS);
    });
  }
}
