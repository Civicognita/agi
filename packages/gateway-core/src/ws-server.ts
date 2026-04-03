import { EventEmitter } from "node:events";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { ulid } from "ulid";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";

/** Per-connection metadata assigned on connect */
export interface ConnectionMeta {
  id: string;          // ulid
  connectedAt: string; // ISO timestamp
  channelId?: string;  // set after authentication
  entityId?: string;   // set after entity resolution
}

/** JSON message protocol over WebSocket */
export interface WSMessage {
  type: string;        // e.g. "state_change", "subscribe", "ping"
  payload?: unknown;
}

/** Minimal auth interface required by the WebSocket server. */
export interface WSAuthProvider {
  authenticate(ip: string, token: string | undefined): { authenticated: boolean };
}

/**
 * Options for constructing the WebSocket server.
 * Provide either `port`+`host` for a standalone server,
 * or `server` to attach to an existing HTTP server (sharing the port).
 */
export type GatewayWSServerOptions =
  | { port: number; host?: string; server?: undefined; logger?: Logger; auth?: WSAuthProvider }
  | { server: HttpServer; port?: undefined; host?: undefined; logger?: Logger; auth?: WSAuthProvider };

/** Interval between heartbeat pings in milliseconds */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * WebSocket server for the aionima gateway control plane.
 * Manages client connections, heartbeats, and message routing.
 */
export class GatewayWebSocketServer extends EventEmitter {
  private readonly options: GatewayWSServerOptions;
  private readonly log: ComponentLogger;
  private wss: WebSocketServer | null = null;
  private connections: Map<string, WebSocket> = new Map();
  private connectionMeta: Map<string, ConnectionMeta> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: GatewayWSServerOptions) {
    super();
    this.options = options;
    this.log = createComponentLogger(options.logger, "ws-server");
  }

  /** Start the WebSocket server and begin accepting connections */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const auth = this.options.auth;
      const verifyClient = auth
        ? (info: { req: { url?: string; socket: { remoteAddress?: string } } }, cb: (result: boolean, code?: number, message?: string) => void): void => {
            const ip = info.req.socket.remoteAddress ?? "unknown";
            // Loopback connections bypass token auth (matches HTTP auth behavior)
            const isLoopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
            if (isLoopback) {
              cb(true);
              return;
            }
            const url = new URL(info.req.url ?? "", "http://localhost");
            const token = url.searchParams.get("token") ?? undefined;
            if (!token) {
              cb(false, 401, "Authentication required");
              return;
            }
            const result = auth.authenticate(ip, token);
            if (!result.authenticated) {
              cb(false, 403, "Invalid token");
              return;
            }
            cb(true);
          }
        : undefined;

      const wsOptions = "server" in this.options && this.options.server
        ? { server: this.options.server, verifyClient }
        : { port: this.options.port, host: this.options.host, verifyClient };

      const wss = new WebSocketServer(wsOptions);

      const onConnection = (socket: WebSocket) => {
        this.handleConnection(socket);
      };
      wss.on("connection", onConnection);

      if ("server" in this.options && this.options.server) {
        // Attached to existing HTTP server — ready immediately
        this.wss = wss;
        this.startHeartbeat();
        resolve();
      } else {
        wss.on("listening", () => {
          this.wss = wss;
          this.startHeartbeat();
          resolve();
        });

        wss.on("error", (err: Error) => {
          reject(err);
        });
      }
    });
  }

  /** Gracefully close all connections and shut down the server */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stopHeartbeat();

      for (const [id, socket] of this.connections) {
        socket.terminate();
        this.connections.delete(id);
        this.connectionMeta.delete(id);
      }

      if (this.wss === null) {
        resolve();
        return;
      }

      this.wss.close((err) => {
        if (err !== undefined) {
          reject(err);
        } else {
          this.wss = null;
          resolve();
        }
      });
    });
  }

  /** Send a typed JSON event to all connected clients */
  broadcast(event: string, data: unknown): void {
    const message: WSMessage = { type: event, payload: data };
    const serialized = JSON.stringify(message);

    for (const socket of this.connections.values()) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(serialized);
      }
    }
  }

  /** Send a typed JSON event to a specific connection by ID */
  sendTo(connectionId: string, event: string, data: unknown): boolean {
    const socket = this.connections.get(connectionId);
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: event, payload: data }));
    return true;
  }

  /** Returns the number of active connections */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /** Handle a new incoming WebSocket connection */
  private handleConnection(socket: WebSocket): void {
    const id = ulid();
    const meta: ConnectionMeta = {
      id,
      connectedAt: new Date().toISOString(),
    };

    this.connections.set(id, socket);
    this.connectionMeta.set(id, meta);

    this.emit("connection", id, meta);

    socket.on("message", (raw: Buffer | string) => {
      this.handleMessage(id, raw);
    });

    socket.on("close", () => {
      this.connections.delete(id);
      this.connectionMeta.delete(id);
      this.emit("disconnection", id);
    });

    socket.on("error", (err: Error) => {
      this.log.error(`connection error on ${id}: ${err.message}`);
      socket.terminate();
      this.connections.delete(id);
      this.connectionMeta.delete(id);
      this.emit("disconnection", id);
    });
  }

  /** Parse and emit an incoming message from a client */
  private handleMessage(connectionId: string, raw: Buffer | string): void {
    let message: WSMessage;

    try {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      const parsed: unknown = JSON.parse(text);

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("type" in parsed) ||
        typeof (parsed as Record<string, unknown>)["type"] !== "string"
      ) {
        throw new Error("missing or invalid 'type' field");
      }

      message = parsed as WSMessage;
    } catch (err) {
      this.log.error(
        `failed to parse message from ${connectionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    this.emit("message", connectionId, message);
  }

  /** Start the heartbeat interval — ping all clients every 30 seconds */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [id, socket] of this.connections) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.ping();
        } else {
          socket.terminate();
          this.connections.delete(id);
          this.connectionMeta.delete(id);
          this.emit("disconnection", id);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /** Stop the heartbeat interval */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
