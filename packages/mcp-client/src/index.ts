/**
 * @agi/mcp-client — MCP client core for Aion (s118 t441).
 *
 * Cycle 30 shipped the package skeleton. Cycle 31 (this file) implements:
 *   - Stdio transport (most common; tynn uses it)
 *   - Connection lifecycle (registerServer / connect / disconnect / state tracking)
 *   - Tool / resource / prompt enumeration via the SDK's Client
 *   - Tool call dispatch + resource read
 *
 * SSE/HTTP + WebSocket transports land in a follow-up cycle (cycle 32+).
 *
 * The McpClient class wraps `@modelcontextprotocol/sdk`'s `Client` per
 * registered server and translates between the SDK's wire shapes and our
 * local structural types (defined in ./types.ts). Keeping the facade thin
 * lets us absorb SDK schema changes without rippling through every consumer.
 *
 * Reference: agi/docs/agents/mcp-integration.md
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";

export type {
  McpTransport,
  McpServerConfig,
  McpToolDescriptor,
  McpResourceDescriptor,
  McpPromptDescriptor,
  McpToolCallResult,
  McpServerState,
} from "./types.js";

import type {
  McpServerConfig,
  McpToolDescriptor,
  McpResourceDescriptor,
  McpPromptDescriptor,
  McpToolCallResult,
  McpServerState,
} from "./types.js";

/** Identity passed to the MCP handshake. Server-side may use this for
 *  auditing. Mirrors agi's package version where useful. */
const AGI_CLIENT_IDENTITY = {
  name: "agi-mcp-client",
  version: "0.1.0",
};

/**
 * McpClient — manages a pool of MCP server connections + dispatches calls.
 *
 * Each registered server gets its own SDK `Client` instance lazily on first
 * connect. State transitions: disconnected → connecting → connected (or
 * error). Reconnection on disconnect is the caller's responsibility for now;
 * a future cycle adds auto-reconnect + idle-close TTL.
 */
export class McpClient {
  private readonly servers = new Map<string, McpServerConfig>();
  private readonly states = new Map<string, McpServerState>();
  private readonly clients = new Map<string, Client>();

  /**
   * Register a server config. Idempotent — re-registering an id replaces the
   * config + flags the server as disconnected (any prior client connection
   * is closed). autoConnect: true triggers an immediate connect attempt.
   */
  async registerServer(config: McpServerConfig): Promise<void> {
    // Close any existing client for this id before replacing config.
    const existing = this.clients.get(config.id);
    if (existing !== undefined) {
      await existing.close().catch(() => { /* ignore close errors */ });
      this.clients.delete(config.id);
    }
    this.servers.set(config.id, config);
    this.states.set(config.id, "disconnected");
    if (config.autoConnect === true) {
      await this.connect(config.id);
    }
  }

  /**
   * Connect to a registered server. Spawns the process / opens the channel
   * per the configured transport. Throws if the server isn't registered or
   * the transport isn't supported in this slice (cycle 31 = stdio only).
   */
  async connect(serverId: string): Promise<void> {
    const config = this.servers.get(serverId);
    if (config === undefined) {
      throw new Error(`McpClient.connect: server ${serverId} not registered`);
    }
    // If already connected, no-op. Reconnect requires explicit disconnect first.
    if (this.states.get(serverId) === "connected") return;

    this.states.set(serverId, "connecting");
    try {
      const client = new Client(AGI_CLIENT_IDENTITY);
      const transport = this.makeTransport(config);
      await client.connect(transport);
      this.clients.set(serverId, client);
      this.states.set(serverId, "connected");
    } catch (err) {
      this.states.set(serverId, "error");
      throw err;
    }
  }

  /** Disconnect a server's client. State returns to disconnected. Idempotent. */
  async disconnect(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client !== undefined) {
      await client.close().catch(() => { /* swallow — already closed is fine */ });
      this.clients.delete(serverId);
    }
    this.states.set(serverId, "disconnected");
  }

  /** Unregister a server entirely (disconnect + remove config). */
  async unregisterServer(serverId: string): Promise<void> {
    await this.disconnect(serverId);
    this.servers.delete(serverId);
    this.states.delete(serverId);
  }

  /** Current state of all registered servers. UX consumes for status badges. */
  listServers(): Array<{ id: string; name: string; state: McpServerState; transport: McpServerConfig["transport"] }> {
    const result: Array<{ id: string; name: string; state: McpServerState; transport: McpServerConfig["transport"] }> = [];
    for (const [id, config] of this.servers) {
      result.push({
        id,
        name: config.name ?? id,
        state: this.states.get(id) ?? "disconnected",
        transport: config.transport,
      });
    }
    return result;
  }

  /** List tools surfaced by a connected server. */
  async listTools(serverId: string): Promise<McpToolDescriptor[]> {
    const client = this.requireConnectedClient(serverId);
    const result = await client.listTools();
    return result.tools.map((t) => ({
      serverId,
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
    }));
  }

  /** List resources surfaced by a connected server. */
  async listResources(serverId: string): Promise<McpResourceDescriptor[]> {
    const client = this.requireConnectedClient(serverId);
    const result = await client.listResources();
    return result.resources.map((r) => ({
      serverId,
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
  }

  /** List prompts surfaced by a connected server. */
  async listPrompts(serverId: string): Promise<McpPromptDescriptor[]> {
    const client = this.requireConnectedClient(serverId);
    const result = await client.listPrompts();
    return result.prompts.map((p) => ({
      serverId,
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    }));
  }

  /** Call a tool on a connected server. */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    const client = this.requireConnectedClient(serverId);
    const result = await client.callTool({ name: toolName, arguments: args });
    return {
      isError: Boolean(result.isError),
      content: result.content as Array<{ type: string; [key: string]: unknown }>,
    };
  }

  /** Read a resource by URI. */
  async readResource(
    serverId: string,
    uri: string,
  ): Promise<{ contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }> }> {
    const client = this.requireConnectedClient(serverId);
    const result = await client.readResource({ uri });
    return {
      contents: result.contents as Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>,
    };
  }

  /**
   * Build the SDK transport for a server config. Cycle 32 supports all
   * three MCP-spec transports: stdio, Streamable HTTP, and WebSocket.
   * Each branch validates its required config (command for stdio, url for
   * the network transports) before constructing the SDK transport.
   */
  private makeTransport(config: McpServerConfig) {
    if (config.transport === "stdio") {
      if (config.command === undefined || config.command.length === 0) {
        throw new Error(`McpClient: stdio transport requires command for server ${config.id}`);
      }
      const [cmd, ...args] = config.command;
      return new StdioClientTransport({
        command: cmd!,
        args,
        ...(config.env !== undefined ? { env: config.env } : {}),
      });
    }
    if (config.transport === "http") {
      if (config.url === undefined || config.url.length === 0) {
        throw new Error(`McpClient: http transport requires url for server ${config.id}`);
      }
      // Bearer-auth threading: the SDK accepts requestInit which is merged
      // into every fetch the transport makes (POST + GET-SSE). When the
      // server config carries an authToken (already $VAR-resolved upstream
      // at boot wiring), we surface it as `Authorization: Bearer <token>`.
      // Without this the transport sends only the URL, which fails for any
      // MCP service that gates access behind a key (tynn.ai, etc).
      const httpOpts = config.authToken !== undefined && config.authToken.length > 0
        ? { requestInit: { headers: { Authorization: `Bearer ${config.authToken}` } } }
        : undefined;
      return new StreamableHTTPClientTransport(new URL(config.url), httpOpts);
    }
    if (config.transport === "websocket") {
      if (config.url === undefined || config.url.length === 0) {
        throw new Error(`McpClient: websocket transport requires url for server ${config.id}`);
      }
      return new WebSocketClientTransport(new URL(config.url));
    }
    // Defensive — `config.transport` is a closed union, but a future SDK
    // upgrade or plugin-supplied config could surface an unknown value.
    const unknown: never = config.transport;
    throw new Error(`McpClient: unknown transport ${String(unknown)} for server ${config.id}`);
  }

  /** Return the connected client or throw a clear error. */
  private requireConnectedClient(serverId: string): Client {
    if (!this.servers.has(serverId)) {
      throw new Error(`McpClient: server ${serverId} not registered`);
    }
    if (this.states.get(serverId) !== "connected") {
      throw new Error(`McpClient: server ${serverId} not connected (state: ${this.states.get(serverId) ?? "unknown"})`);
    }
    const client = this.clients.get(serverId);
    if (client === undefined) {
      throw new Error(`McpClient: internal — server ${serverId} marked connected but client missing`);
    }
    return client;
  }
}
