import { EventEmitter } from "node:events";
import type { OutboundContent } from "@agi/plugins";
import type { QueueMessage } from "@agi/entity-model";

import type {
  HeldMessage,
  InboundPayload,
  BridgeDispatcher,
  BridgeBroadcaster,
} from "./types.js";

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

/** Dependencies for {@link AgentBridge}, injected at construction time. */
export interface AgentBridgeDeps {
  /** Dispatch outbound replies to channel adapters. */
  dispatcher: BridgeDispatcher;
  /** Broadcast events to connected WebSocket clients. */
  broadcaster: BridgeBroadcaster;
}

// ---------------------------------------------------------------------------
// AgentBridge
// ---------------------------------------------------------------------------

/**
 * Human-in-the-loop message bridge.
 *
 * Receives inbound messages from the queue consumer, holds them for operator
 * review via the WebChat UI, and routes operator replies back through the
 * correct channel adapter.
 *
 * Events emitted:
 *  - `message_held(held: HeldMessage)` — a new message is waiting for review
 *  - `reply_sent(data)` — an operator reply was dispatched successfully
 *  - `reply_failed(data)` — an operator reply could not be dispatched
 *
 * @example
 * ```ts
 * const bridge = new AgentBridge({ dispatcher, broadcaster });
 * const consumer = new QueueConsumer({
 *   messageQueue,
 *   outboundDispatcher,
 *   onInbound: (msg) => bridge.notify(msg),
 * });
 * ```
 */
export class AgentBridge extends EventEmitter {
  private readonly held = new Map<string, HeldMessage>();
  private readonly dispatcher: BridgeDispatcher;
  private readonly broadcaster: BridgeBroadcaster;

  constructor(deps: AgentBridgeDeps) {
    super();
    this.dispatcher = deps.dispatcher;
    this.broadcaster = deps.broadcaster;
  }

  // -------------------------------------------------------------------------
  // Inbound — receive messages from QueueConsumer
  // -------------------------------------------------------------------------

  /**
   * Accept an inbound queue message and hold it for operator review.
   *
   * Broadcasts a `message_received` event to all connected WebSocket clients
   * so the WebChat UI can display it in real time.
   *
   * This method is designed to be used as the `onInbound` callback for
   * {@link QueueConsumer}.
   */
  async notify(queueMessage: QueueMessage): Promise<void> {
    const payload = queueMessage.payload as InboundPayload;

    const held: HeldMessage = {
      queueMessageId: queueMessage.id,
      entityId: payload.entityId,
      channelId: queueMessage.channel,
      channelUserId: payload.message.channelUserId,
      content: payload.message.content,
      coaFingerprint: payload.coaFingerprint,
      displayName:
        (payload.message.metadata?.["firstName"] as string | undefined) ??
        undefined,
      receivedAt: new Date().toISOString(),
    };

    this.held.set(queueMessage.id, held);

    this.broadcaster.broadcast("message_received", held);
    this.emit("message_held", held);
  }

  // -------------------------------------------------------------------------
  // Outbound — operator replies
  // -------------------------------------------------------------------------

  /**
   * Handle an operator reply to a held message.
   *
   * Resolves the original inbound message, builds an outbound route for the
   * originating channel, and dispatches it. On success, the held message is
   * removed and a `reply_sent` event is broadcast. On failure, an `error`
   * event is broadcast and the error is re-thrown.
   *
   * @throws {Error} If the message ID is not found in held messages.
   * @throws {Error} If the outbound dispatch fails (channel not found, etc.)
   */
  async handleReply(
    queueMessageId: string,
    content: OutboundContent,
  ): Promise<void> {
    const heldMsg = this.held.get(queueMessageId);
    if (heldMsg === undefined) {
      throw new Error(`Held message not found: ${queueMessageId}`);
    }

    try {
      const result = await this.dispatcher.dispatch({
        channelId: heldMsg.channelId,
        channelUserId: heldMsg.channelUserId,
        content,
        entityId: heldMsg.entityId,
        inReplyTo: heldMsg.queueMessageId,
      });

      // Remove from held on success
      this.held.delete(queueMessageId);

      const sentPayload = {
        queueMessageId,
        channelId: heldMsg.channelId,
        channelUserId: heldMsg.channelUserId,
        coaFingerprint: result.coaFingerprint,
        sentAt: result.deliveredAt,
      };

      this.broadcaster.broadcast("reply_sent", sentPayload);
      this.emit("reply_sent", sentPayload);
    } catch (err) {
      const errorPayload = {
        code: "REPLY_FAILED",
        message: err instanceof Error ? err.message : String(err),
        relatedMessageId: queueMessageId,
      };

      this.broadcaster.broadcast("error", errorPayload);
      this.emit("reply_failed", errorPayload);

      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /** Get all messages currently held for operator review. */
  getHeldMessages(): HeldMessage[] {
    return [...this.held.values()];
  }

  /** Get a single held message by its queue message ID. */
  getHeldMessage(queueMessageId: string): HeldMessage | undefined {
    return this.held.get(queueMessageId);
  }

  /** Number of messages currently held. */
  get heldCount(): number {
    return this.held.size;
  }
}
