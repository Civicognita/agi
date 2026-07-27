/**
 * Chat WebSocket protocol — shared types.
 *
 * `server.ts`'s `wsServer.on("message", ...)` handler implements this
 * protocol today as ad hoc string-literal `case`s with inline payload
 * shapes (no prior shared type). This file documents the wire shapes as
 * types so a Node client (`cli/src/chat-client.ts`) can import them
 * instead of hand-typing string literals — purely additive; it does not
 * change `server.ts`'s handler logic.
 *
 * Not every `chat:*` message type is covered — only the subset a plain
 * chat client needs (open/send/cancel/close a session and read back its
 * events). Dashboard-only messages (plan approve/reject, inject, history,
 * suggestions) are intentionally out of scope here.
 */

/** One image attachment on a `chat:send` payload. */
export interface ChatImageAttachment {
  data: string;
  mediaType: string;
}

/** One document attachment on a `chat:send` payload. */
export interface ChatDocumentAttachment {
  data: string;
  mediaType: string;
  name: string;
}

export type ChatClientMessage =
  | { type: "chat:open"; payload?: { sessionId?: string; context?: string } }
  | {
      type: "chat:send";
      payload: {
        sessionId: string;
        text?: string;
        context?: string;
        images?: ChatImageAttachment[];
        documents?: ChatDocumentAttachment[];
      };
    }
  | { type: "chat:cancel"; payload?: { sessionId?: string } }
  | { type: "chat:close"; payload?: { sessionId?: string } };

export interface ChatHistoryMessage {
  role: "user" | "assistant" | "tool" | "thought";
  content: string;
  timestamp: string;
}

export type ChatServerMessage =
  | {
      type: "chat:opened";
      payload: { sessionId: string; context: string; contextLabel?: string; messages: ChatHistoryMessage[] };
    }
  | { type: "chat:thinking"; payload: { sessionId?: string; runId: string; timestamp: string } }
  | {
      type: "chat:tool_start";
      payload: {
        sessionId?: string;
        runId: string;
        toolName: string;
        toolIndex: number;
        loopIteration: number;
        toolInput?: Record<string, unknown>;
        timestamp: string;
      };
    }
  | {
      type: "chat:tool_result";
      payload: {
        sessionId?: string;
        runId: string;
        toolName: string;
        toolIndex: number;
        loopIteration: number;
        success: boolean;
        summary: string;
        detail?: Record<string, unknown>;
        timestamp: string;
      };
    }
  | { type: "chat:progress"; payload: { sessionId?: string; text: string; phase: string; timestamp: string } }
  | { type: "chat:thought"; payload: { sessionId?: string; runId: string; content: string; timestamp: string } }
  | {
      type: "chat:response";
      payload: {
        sessionId?: string;
        runId?: string;
        text: string;
        timestamp: string;
        suggestions?: string[];
        routingMeta?: Record<string, unknown>;
      };
    }
  | { type: "chat:error"; payload: { sessionId?: string; error: string } }
  | { type: "chat:cancelled"; payload: { sessionId: string; timestamp: string } }
  | { type: "chat:closed"; payload: { sessionId?: string } };
