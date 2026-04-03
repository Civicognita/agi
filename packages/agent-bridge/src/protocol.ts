import type { OutboundContent } from "@aionima/channel-sdk";

// ---------------------------------------------------------------------------
// Bridge → WebChat UI (server-to-client)
// ---------------------------------------------------------------------------

/** A new inbound message is being held for human review. */
export interface BridgeMessageReceived {
  type: "message_received";
  payload: {
    queueMessageId: string;
    entityId: string;
    channelId: string;
    channelUserId: string;
    content: unknown;
    coaFingerprint: string;
    receivedAt: string;
  };
}

/** A reply was successfully dispatched to the originating channel. */
export interface BridgeReplySent {
  type: "reply_sent";
  payload: {
    queueMessageId: string;
    channelId: string;
    channelUserId: string;
    coaFingerprint: string;
    sentAt: string;
  };
}

/** An error occurred while processing a bridge operation. */
export interface BridgeError {
  type: "error";
  payload: {
    code: string;
    message: string;
    relatedMessageId?: string;
  };
}

/** Union of all server-to-client bridge messages. */
export type BridgeOutboundMessage =
  | BridgeMessageReceived
  | BridgeReplySent
  | BridgeError;

// ---------------------------------------------------------------------------
// WebChat UI → Bridge (client-to-server)
// ---------------------------------------------------------------------------

/** Operator sends a reply to a held message. */
export interface BridgeReplyRequest {
  type: "reply_request";
  payload: {
    queueMessageId: string;
    content: OutboundContent;
  };
}

/** Union of all client-to-server bridge messages. */
export type BridgeInboundMessage = BridgeReplyRequest;
