import type { OutboundContent, AionimaMessage } from "@agi/plugins";

// ---------------------------------------------------------------------------
// Agent communication types
// ---------------------------------------------------------------------------

/** Message sent from gateway to agent */
export interface AgentMessage {
  id: string;
  entityId: string;
  coaFingerprint: string;
  channel: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/** Response from agent back to gateway */
export interface AgentResponse {
  id: string;
  inReplyTo: string;
  content: string;
  timestamp: string;
  toolsUsed?: string[];
}

// ---------------------------------------------------------------------------
// Held message — inbound messages waiting for human review
// ---------------------------------------------------------------------------

/** A message held in the bridge pending operator action. */
export interface HeldMessage {
  queueMessageId: string;
  entityId: string;
  channelId: string;
  channelUserId: string;
  content: unknown;
  coaFingerprint: string;
  displayName?: string;
  receivedAt: string;
}

// ---------------------------------------------------------------------------
// Inbound payload shape (as enqueued by InboundRouter)
// ---------------------------------------------------------------------------

/** Shape of the payload stored in MessageQueue by InboundRouter. */
export interface InboundPayload {
  message: AionimaMessage;
  entityId: string;
  coaFingerprint: string;
}

// ---------------------------------------------------------------------------
// Bridge dependency interfaces (DI, no gateway-core import)
// ---------------------------------------------------------------------------

/** Dispatch interface satisfied by OutboundDispatcher. */
export interface BridgeDispatcher {
  dispatch(route: {
    channelId: string;
    channelUserId: string;
    content: OutboundContent;
    entityId: string;
    inReplyTo?: string;
  }): Promise<{ coaFingerprint: string; deliveredAt: string }>;
}

/** Broadcast interface satisfied by GatewayWebSocketServer. */
export interface BridgeBroadcaster {
  broadcast(event: string, data: unknown): void;
}
