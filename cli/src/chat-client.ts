/**
 * Chat WebSocket client — Node-side counterpart to
 * `ui/dashboard/src/components/ChatFlyout.tsx`'s WS usage, deliberately
 * parallel in structure so the two clients can't silently drift on
 * protocol assumptions. Uses Node's built-in global `WebSocket` (stable
 * since Node 22; this repo requires `>=22.12.0`) — no new dependency.
 *
 * Auth: the gateway's WS `verifyClient` auto-allows any private-network
 * (including loopback) connection with no token — confirmed in
 * `ws-server.ts` (`isPrivateNetwork(ip)` check before the token check).
 * `GatewayClient`'s existing no-auth-token assumption for localhost HTTP
 * holds for the WS transport too.
 */

import type { ChatClientMessage, ChatServerMessage, ChatHistoryMessage } from "@agi/gateway-core";
export type { ChatHistoryMessage } from "@agi/gateway-core";

/** Structural subset of the global `WebSocket` this client actually uses — lets tests inject a mock instead of relying on global stubbing. */
export interface WebSocketLike {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  send(data: string): void;
  close(): void;
}

export interface ChatClientOptions {
  host?: string;
  port?: number;
  /** Injectable WebSocket constructor — defaults to the global `WebSocket` (stable in Node >=22). Tests pass a mock here instead of stubbing the global. */
  webSocketImpl?: new (url: string) => WebSocketLike;
  /**
   * Max ms to wait for a turn's terminal event (`chat:response`/`chat:error`/
   * `chat:cancelled`) before `send()` gives up locally and rejects with
   * `ChatTimeoutError`. A stuck server-side LLM call (or a Ctrl-C that never
   * reaches this process through a nested terminal layer) would otherwise
   * hang the REPL forever with no way out. Also fires a best-effort
   * `cancel()` on timeout, though it doesn't wait for the server to confirm.
   * Default 120_000 (2 min).
   */
  sendTimeoutMs?: number;
  /** Fires for every outbound send, inbound frame, and connection-lifecycle event — `agi chat --debug <path>`'s hook for streaming a diagnostic log. No-op when omitted; adds no overhead to normal use. */
  debugSink?: (event: ChatDebugEvent) => void;
}

export interface ChatDebugEvent {
  ts: string;
  direction: "send" | "recv" | "lifecycle";
  label: string;
  detail?: unknown;
}

export interface ChatSessionOpened {
  sessionId: string;
  context: string;
  contextLabel?: string;
  messages: ChatHistoryMessage[];
}

export interface ChatToolStartEvent {
  toolName: string;
  toolIndex: number;
  loopIteration: number;
  toolInput?: Record<string, unknown>;
}

export interface ChatToolResultEvent {
  toolName: string;
  toolIndex: number;
  loopIteration: number;
  success: boolean;
  summary: string;
}

export interface ChatProgressEvent {
  text: string;
  phase: string;
}

export interface ChatClientHandlers {
  onThinking?: () => void;
  onToolStart?: (event: ChatToolStartEvent) => void;
  onToolResult?: (event: ChatToolResultEvent) => void;
  onProgress?: (event: ChatProgressEvent) => void;
  onThought?: (content: string) => void;
  /** Fires for a `chat:response` that is NOT the answer to an in-flight `send()` — used for injected/async replies (e.g. a follow-up after a handoff). `send()`'s own turn resolves via its own promise instead. */
  onUnsolicitedResponse?: (text: string) => void;
  onClosed?: () => void;
}

export class ChatWsUnreachableError extends Error {
  constructor(url: string) {
    super(`Cannot reach gateway WebSocket at ${url}.\n  Is the gateway running? Start it with: aionima run`);
    this.name = "ChatWsUnreachableError";
  }
}

/** A chat turn ended in a gateway-reported error (not a transport failure). */
export class ChatTurnError extends Error {}

/** A turn went `sendTimeoutMs` with NO activity of any kind — the client gave up locally rather than hang forever. Long-but-active turns (many tool calls) never trip this; only genuine silence does. */
export class ChatTimeoutError extends Error {}

interface PendingTurn {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  /** Reset the inactivity timer — called on every inbound turn-activity event so a working turn never times out. */
  keepAlive: () => void;
}

export class ChatClient {
  private readonly url: string;
  private readonly webSocketImpl: new (url: string) => WebSocketLike;
  private ws: WebSocketLike | null = null;
  private handlers: ChatClientHandlers = {};
  private sessionId: string | null = null;
  private context = "general";
  private pendingOpen: { resolve: (v: ChatSessionOpened) => void; reject: (err: Error) => void } | null = null;
  private pendingTurn: PendingTurn | null = null;
  private readonly sendTimeoutMs: number;
  private readonly debugSink: (event: ChatDebugEvent) => void;

  constructor(opts: ChatClientOptions = {}) {
    const host = opts.host ?? "127.0.0.1";
    const port = opts.port ?? 3100;
    this.url = `ws://${host}:${port}/ws`;
    this.webSocketImpl = opts.webSocketImpl ?? (WebSocket as unknown as new (url: string) => WebSocketLike);
    this.sendTimeoutMs = opts.sendTimeoutMs ?? 120_000;
    this.debugSink = opts.debugSink ?? (() => {});
  }

  private debug(direction: ChatDebugEvent["direction"], label: string, detail?: unknown): void {
    this.debugSink({ ts: new Date().toISOString(), direction, label, detail });
  }

  on(handlers: ChatClientHandlers): void {
    this.handlers = handlers;
  }

  private connect(): Promise<WebSocketLike> {
    return new Promise((resolve, reject) => {
      this.debug("lifecycle", "ws:connecting", { url: this.url });
      const ws = new this.webSocketImpl(this.url);
      const onOpen = () => {
        ws.removeEventListener("error", onError);
        this.debug("lifecycle", "ws:open");
        resolve(ws);
      };
      const onError = () => {
        ws.removeEventListener("open", onOpen);
        this.debug("lifecycle", "ws:error", { url: this.url });
        reject(new ChatWsUnreachableError(this.url));
      };
      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onError, { once: true });
      ws.addEventListener("message", (event: { data?: unknown }) => { this.handleMessage(event); });
      ws.addEventListener("close", () => {
        this.debug("lifecycle", "ws:close");
        this.ws = null;
        this.handlers.onClosed?.();
      });
    });
  }

  /** Open (or resume, if `sessionId` is passed) a chat session scoped to `context` (a folder path, or "general"). */
  async open(context: string, sessionId?: string): Promise<ChatSessionOpened> {
    this.ws = await this.connect();
    this.context = context;
    return new Promise((resolve, reject) => {
      this.pendingOpen = { resolve, reject };
      this.wsSend({ type: "chat:open", payload: { sessionId, context } });
    });
  }

  /**
   * Send a message and wait for that turn's terminal response text.
   * Progress along the way arrives via the handlers registered with
   * `on()`.
   *
   * Never hangs forever, but is patient with legitimately long turns: the
   * timeout is an INACTIVITY deadline, not a total-duration cap. Every inbound
   * turn-activity event (thinking / tool_start / tool_result / progress /
   * thought) resets it, so an agentic turn making many tool calls over several
   * minutes stays alive as long as it keeps reporting progress. Only genuine
   * silence for `sendTimeoutMs` (the original "stuck at chat:thinking with no
   * further events" failure) rejects with `ChatTimeoutError` and fires a
   * best-effort `cancel()` (not awaited).
   */
  async send(text: string): Promise<string> {
    if (this.sessionId === null) throw new Error("ChatClient.send() called before open() resolved");
    if (this.pendingTurn !== null) throw new Error("ChatClient.send() called while a previous turn is still in flight");
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const onTimeout = (): void => {
        if (this.pendingTurn === turn) {
          this.pendingTurn = null;
          this.debug("lifecycle", "send:timeout", { sendTimeoutMs: this.sendTimeoutMs });
          this.cancel();
          reject(new ChatTimeoutError(`No activity for ${String(this.sendTimeoutMs)}ms — sent a cancel request, but the server may still be running this turn.`));
        }
      };
      timer = setTimeout(onTimeout, this.sendTimeoutMs);
      const turn: PendingTurn = {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (err) => { clearTimeout(timer); reject(err); },
        keepAlive: () => { clearTimeout(timer); timer = setTimeout(onTimeout, this.sendTimeoutMs); },
      };
      this.pendingTurn = turn;
      this.wsSend({ type: "chat:send", payload: { sessionId: this.sessionId!, text, context: this.context } });
    });
  }

  /**
   * Cancel the in-flight turn started by `send()`, if any. Rejects
   * `send()`'s promise immediately (client-side) rather than waiting for
   * the server's `chat:cancelled` echo — that round-trip can itself hang
   * if the server is genuinely stuck, and the caller (a Ctrl-C handler,
   * typically) needs to unblock right away either way. The `chat:cancel`
   * message is still sent so the server gets a chance to actually stop.
   */
  cancel(): void {
    if (this.sessionId === null) return;
    this.debug("lifecycle", "cancel()");
    this.wsSend({ type: "chat:cancel", payload: { sessionId: this.sessionId } });
    if (this.pendingTurn !== null) {
      const turn = this.pendingTurn;
      this.pendingTurn = null;
      turn.reject(new Error("Turn cancelled"));
    }
  }

  /** Close the session and the underlying WebSocket. */
  close(): void {
    if (this.sessionId !== null) {
      this.wsSend({ type: "chat:close", payload: { sessionId: this.sessionId } });
    }
    this.ws?.close();
    this.ws = null;
  }

  private wsSend(message: ChatClientMessage): void {
    this.debug("send", message.type, message);
    this.ws?.send(JSON.stringify(message));
  }

  private handleMessage(event: { data?: unknown }): void {
    let parsed: ChatServerMessage;
    try {
      parsed = JSON.parse(String(event.data)) as ChatServerMessage;
    } catch {
      this.debug("recv", "parse-error", { raw: event.data });
      return;
    }
    this.debug("recv", parsed.type, parsed);

    switch (parsed.type) {
      case "chat:opened": {
        this.sessionId = parsed.payload.sessionId;
        this.pendingOpen?.resolve(parsed.payload);
        this.pendingOpen = null;
        return;
      }
      case "chat:thinking": {
        this.pendingTurn?.keepAlive();
        this.handlers.onThinking?.();
        return;
      }
      case "chat:tool_start": {
        this.pendingTurn?.keepAlive();
        this.handlers.onToolStart?.(parsed.payload);
        return;
      }
      case "chat:tool_result": {
        this.pendingTurn?.keepAlive();
        this.handlers.onToolResult?.(parsed.payload);
        return;
      }
      case "chat:progress": {
        this.pendingTurn?.keepAlive();
        this.handlers.onProgress?.(parsed.payload);
        return;
      }
      case "chat:thought": {
        this.pendingTurn?.keepAlive();
        this.handlers.onThought?.(parsed.payload.content);
        return;
      }
      case "chat:response": {
        if (this.pendingTurn !== null) {
          const turn = this.pendingTurn;
          this.pendingTurn = null;
          turn.resolve(parsed.payload.text);
        } else {
          this.handlers.onUnsolicitedResponse?.(parsed.payload.text);
        }
        return;
      }
      case "chat:error": {
        const err = new ChatTurnError(parsed.payload.error);
        if (this.pendingOpen !== null) {
          const opened = this.pendingOpen;
          this.pendingOpen = null;
          opened.reject(err);
        } else if (this.pendingTurn !== null) {
          const turn = this.pendingTurn;
          this.pendingTurn = null;
          turn.reject(err);
        }
        return;
      }
      case "chat:cancelled": {
        if (this.pendingTurn !== null) {
          const turn = this.pendingTurn;
          this.pendingTurn = null;
          turn.reject(new Error("Turn cancelled"));
        }
        return;
      }
      case "chat:closed": {
        return;
      }
      default:
        return;
    }
  }
}
