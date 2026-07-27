/**
 * Bridges `ChatClient` (the WS protocol client — connect/open/send/cancel,
 * unchanged from `agi chat`'s original readline-REPL ship) into React state
 * shaped for `@particle-academy/fancy-tui`'s components. This is the only
 * file that touches `ChatClient` directly.
 *
 * The event → state mapping itself lives in the pure `chatSessionReducer`
 * below (unit-tested in `chat-session-reducer.test.ts` without any React
 * rendering) — `useChatSession` is a thin `useReducer` binding layer over
 * it plus the `ChatClient` wiring, matching this codebase's convention of
 * testing pure logic directly and manually smoke-testing framework glue.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { MessageData, MessageRole, ToolCallData } from "@particle-academy/fancy-tui";
import {
  ChatClient,
  ChatTimeoutError,
  ChatTurnError,
  type ChatClientOptions,
  type ChatHistoryMessage,
  type ChatToolStartEvent,
  type ChatToolResultEvent,
} from "../chat-client.js";

export type ConnectionState = "connecting" | "open" | "closed" | "error";

/** A 0REALTALK terminal attached to a user message — the raw terminal as typed plus the unpacker's output that was actually sent to Aion. */
export interface TerminalAttachment {
  raw: string;
  output: string;
}

/** A rendered message; user messages may carry unpacked-terminal attachments, and reasoning ("thought") messages are flagged `thinking` so the UI can collapse them. Superset of fancy-tui's MessageData. */
export interface ChatMessage extends MessageData {
  attachments?: TerminalAttachment[];
  thinking?: boolean;
}

export interface ChatSessionState {
  messages: ChatMessage[];
  /** True while a turn is in flight (from send() until its terminal event). */
  thinking: boolean;
  /** Latest thinking/progress/thought text, if any — used as the live spinner's label. */
  statusText: string | null;
  /** Tool calls still in flight for the current turn — folded into `messages` once each resolves. */
  liveToolCalls: ToolCallData[];
  nextMessageSeq: number;
}

export const initialChatSessionState: ChatSessionState = {
  messages: [],
  thinking: false,
  statusText: null,
  liveToolCalls: [],
  nextMessageSeq: 1,
};

/** `ChatHistoryMessage.role` → fancy-tui's `MessageRole`. "thought" (persisted reasoning) has no direct equivalent — "system" tone fits its dim, ephemeral-in-spirit content best. */
const HISTORY_ROLE_MAP: Record<ChatHistoryMessage["role"], MessageRole> = {
  user: "user",
  assistant: "agent",
  tool: "tool",
  thought: "system",
};

export type ChatSessionEvent =
  | { type: "userSent"; text: string; timestamp: string; attachments?: TerminalAttachment[] }
  | { type: "thinking" }
  | { type: "toolStart"; event: ChatToolStartEvent }
  | { type: "toolResult"; event: ChatToolResultEvent; timestamp: string }
  | { type: "progress"; text: string }
  | { type: "thought"; content: string }
  | { type: "agentResponded"; text: string; timestamp: string }
  | { type: "turnFailed"; message: string; timestamp: string }
  | { type: "historyLoaded"; messages: ChatHistoryMessage[] }
  | { type: "systemMessage"; text: string; timestamp: string }
  | { type: "cleared" };

/** Correlates a tool's `chat:tool_start` with its later `chat:tool_result` — same convention `server.ts` itself uses for tool-card ids. */
export function toolCallId(event: ChatToolStartEvent | ChatToolResultEvent): string {
  return `${String(event.loopIteration)}-${String(event.toolIndex)}`;
}

function appendMessage(
  state: ChatSessionState,
  role: MessageRole,
  content: string,
  timestamp: string,
  name?: string,
  extra?: { attachments?: TerminalAttachment[]; thinking?: boolean },
): ChatSessionState {
  return {
    ...state,
    nextMessageSeq: state.nextMessageSeq + 1,
    messages: [...state.messages, { id: `m${String(state.nextMessageSeq)}`, role, content, name, timestamp, ...extra }],
  };
}

export function chatSessionReducer(state: ChatSessionState, event: ChatSessionEvent): ChatSessionState {
  switch (event.type) {
    case "userSent":
      return appendMessage(state, "user", event.text, event.timestamp, undefined, { attachments: event.attachments });
    case "thinking":
      return { ...state, thinking: true, statusText: "Aion is thinking…" };
    case "toolStart": {
      const id = toolCallId(event.event);
      return {
        ...state,
        liveToolCalls: [
          ...state.liveToolCalls.filter((c) => c.id !== id),
          { id, name: event.event.toolName, status: "pending" },
        ],
      };
    }
    case "toolResult": {
      const id = toolCallId(event.event);
      const withoutLive = { ...state, liveToolCalls: state.liveToolCalls.filter((c) => c.id !== id) };
      return appendMessage(
        withoutLive,
        "tool",
        `${event.event.toolName}: ${event.event.summary}`,
        event.timestamp,
        event.event.toolName,
      );
    }
    case "progress":
      return { ...state, statusText: event.text };
    case "thought":
      return { ...state, statusText: event.content };
    case "agentResponded":
      return appendMessage({ ...state, thinking: false, statusText: null }, "agent", event.text, event.timestamp);
    case "turnFailed":
      return appendMessage(
        { ...state, thinking: false, statusText: null, liveToolCalls: [] },
        "error",
        event.message,
        event.timestamp,
      );
    case "historyLoaded": {
      if (event.messages.length === 0) return state;
      let next = state;
      for (const m of event.messages) {
        // A persisted `thought` message is reasoning — flag it so the UI can
        // collapse it (rendered raw it exposes `<thinking>` tags).
        next = appendMessage(next, HISTORY_ROLE_MAP[m.role], m.content, m.timestamp, undefined, m.role === "thought" ? { thinking: true } : undefined);
      }
      return next;
    }
    case "systemMessage":
      return appendMessage(state, "system", event.text, event.timestamp);
    case "cleared":
      return { ...state, messages: [] };
    default:
      return state;
  }
}

export interface UseChatSessionResult extends ChatSessionState {
  connectionState: ConnectionState;
  connectionError: string | null;
  /** Set once `chat:opened` resolves — null before then. Pairs with `--debug`'s JSONL log for cross-referencing a support report. */
  sessionId: string | null;
  /**
   * Send a turn. `wireText` is what actually reaches Aion (prose + unpacked
   * terminal output). `opts.displayText` is what the user's message bubble
   * shows (the prose alone — defaults to `wireText`); `opts.attachments` are
   * the unpacked 0REALTALK terminals rendered as distinct blocks on the bubble.
   */
  send: (wireText: string, opts?: { displayText?: string; attachments?: TerminalAttachment[] }) => void;
  cancel: () => void;
  /** Append a local, unsent role:system message — e.g. `/help`'s command list. Never reaches the server. */
  addSystemMessage: (text: string) => void;
  /** Clear the visible scrollback. Local only — the server's persisted session history is untouched, so a fresh `agi chat` in this container still resumes the full conversation. */
  clearMessages: () => void;
}

export interface UseChatSessionOptions extends ChatClientOptions {
  /** Resume this session (its prior history hydrates into `messages` once `chat:opened` returns it) instead of starting a fresh one. */
  resumeSessionId?: string;
}

export function useChatSession(context: string, opts: UseChatSessionOptions = {}): UseChatSessionResult {
  const { host, port, sendTimeoutMs, webSocketImpl, debugSink, resumeSessionId } = opts;
  const clientRef = useRef<ChatClient | null>(null);
  const [state, dispatch] = useReducer(chatSessionReducer, initialChatSessionState);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const client = new ChatClient({ host, port, sendTimeoutMs, webSocketImpl, debugSink });
    clientRef.current = client;
    let cancelled = false;

    client.on({
      onThinking: () => dispatch({ type: "thinking" }),
      onToolStart: (event) => dispatch({ type: "toolStart", event }),
      onToolResult: (event) => dispatch({ type: "toolResult", event, timestamp: new Date().toISOString() }),
      onProgress: (event) => dispatch({ type: "progress", text: event.text }),
      onThought: (content) => dispatch({ type: "thought", content }),
      onUnsolicitedResponse: (text) => dispatch({ type: "agentResponded", text, timestamp: new Date().toISOString() }),
      onClosed: () => { if (!cancelled) setConnectionState("closed"); },
    });

    client.open(context, resumeSessionId)
      .then((opened) => {
        if (cancelled) return;
        setSessionId(opened.sessionId);
        dispatch({ type: "historyLoaded", messages: opened.messages });
        setConnectionState("open");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setConnectionState("error");
        setConnectionError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      client.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resumeSessionId is read once at mount (a session, once opened, isn't meant to be re-resumed mid-App-lifetime); including it would reconnect on every parent re-render if the caller passes a fresh value each time.
  }, [context, host, port, sendTimeoutMs, webSocketImpl, debugSink]);

  const send = useCallback((wireText: string, sendOpts?: { displayText?: string; attachments?: TerminalAttachment[] }) => {
    const client = clientRef.current;
    if (!client) return;
    dispatch({ type: "userSent", text: sendOpts?.displayText ?? wireText, timestamp: new Date().toISOString(), attachments: sendOpts?.attachments });
    dispatch({ type: "thinking" });
    client.send(wireText)
      .then((responseText) => {
        dispatch({ type: "agentResponded", text: responseText, timestamp: new Date().toISOString() });
      })
      .catch((err: unknown) => {
        const timestamp = new Date().toISOString();
        if (err instanceof ChatTimeoutError) {
          dispatch({ type: "turnFailed", message: `Timed out: ${err.message}`, timestamp });
        } else if (err instanceof ChatTurnError) {
          dispatch({ type: "turnFailed", message: `Error: ${err.message}`, timestamp });
        } else {
          dispatch({ type: "turnFailed", message: err instanceof Error ? err.message : String(err), timestamp });
        }
      });
  }, []);

  const cancel = useCallback(() => {
    clientRef.current?.cancel();
  }, []);

  const addSystemMessage = useCallback((text: string) => {
    dispatch({ type: "systemMessage", text, timestamp: new Date().toISOString() });
  }, []);

  const clearMessages = useCallback(() => {
    dispatch({ type: "cleared" });
  }, []);

  return { ...state, connectionState, connectionError, sessionId, send, cancel, addSystemMessage, clearMessages };
}
