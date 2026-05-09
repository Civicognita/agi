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

// ---------------------------------------------------------------------------
// s133 t677 — TTL'd response cache for list* + readResource (2026-05-09)
// ---------------------------------------------------------------------------
//
// Owner directive (cycle 70): "add a story for mcp cacheing to our setup in
// VIP so we don't have to hit server apis so much." Every dashboard MCP
// browse hits the upstream MCP server fresh; this layer wraps list*/read
// with a per-(serverId,kind) cache. Tool calls are NEVER cached (stateful
// by nature); cache invalidates on registerServer / unregisterServer /
// explicit invalidate() + bypassCache parameter on each method.
//
// In-memory only — survives gateway restart by re-fetching on first access.
// Per-server TTL configurable via McpServerConfig.cacheTtlSec (added to
// types.ts; defaults below kick in when unset).

/** Default TTL for tool / resource / prompt listings. 5 min. */
export const DEFAULT_LIST_CACHE_TTL_SEC = 5 * 60;

/** Default TTL for resource reads. 30 min — resources are typically static. */
export const DEFAULT_RESOURCE_READ_CACHE_TTL_SEC = 30 * 60;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  bypasses: number;
  invalidations: number;
  /** Last-fetch (cache-miss) timestamp ISO. */
  lastFetchAt?: string;
}

/** Per-server cache surface. Exposed for diagnostics + tests. */
export interface McpServerCacheStatus {
  serverId: string;
  hits: number;
  misses: number;
  bypasses: number;
  invalidations: number;
  hitRatio: number;
  lastFetchAt?: string;
}

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
  // s133 t677 — per-server caches. Keys for listing caches are the
  // bare kind string ("tools"|"resources"|"prompts"); resource-read
  // cache keys are the URI.
  private readonly listCache = new Map<string, Map<string, CacheEntry<unknown>>>();
  private readonly resourceCache = new Map<string, Map<string, CacheEntry<unknown>>>();
  private readonly cacheStats = new Map<string, CacheStats>();
  /** s133 t677 — clock injection point for tests. Defaults to Date.now. */
  private readonly now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  // ---- s133 t677 cache helpers ----

  private getStats(serverId: string): CacheStats {
    let s = this.cacheStats.get(serverId);
    if (s === undefined) {
      s = { hits: 0, misses: 0, bypasses: 0, invalidations: 0 };
      this.cacheStats.set(serverId, s);
    }
    return s;
  }

  private listCacheFor(serverId: string): Map<string, CacheEntry<unknown>> {
    let m = this.listCache.get(serverId);
    if (m === undefined) {
      m = new Map();
      this.listCache.set(serverId, m);
    }
    return m;
  }

  private resourceCacheFor(serverId: string): Map<string, CacheEntry<unknown>> {
    let m = this.resourceCache.get(serverId);
    if (m === undefined) {
      m = new Map();
      this.resourceCache.set(serverId, m);
    }
    return m;
  }

  private listTtlMs(serverId: string): number {
    const cfg = this.servers.get(serverId);
    const sec = cfg?.cacheTtlSec ?? DEFAULT_LIST_CACHE_TTL_SEC;
    return sec * 1000;
  }

  private resourceReadTtlMs(serverId: string): number {
    const cfg = this.servers.get(serverId);
    const sec = cfg?.resourceReadCacheTtlSec ?? DEFAULT_RESOURCE_READ_CACHE_TTL_SEC;
    return sec * 1000;
  }

  /** Clear all caches for a server. Call on reconnect / server config update. */
  invalidateCache(serverId: string): void {
    this.listCache.delete(serverId);
    this.resourceCache.delete(serverId);
    const s = this.getStats(serverId);
    s.invalidations++;
  }

  /** Diagnostic: per-server hit/miss totals. */
  getCacheStatus(): McpServerCacheStatus[] {
    const out: McpServerCacheStatus[] = [];
    for (const [serverId, s] of this.cacheStats) {
      const total = s.hits + s.misses;
      out.push({
        serverId,
        hits: s.hits,
        misses: s.misses,
        bypasses: s.bypasses,
        invalidations: s.invalidations,
        hitRatio: total > 0 ? s.hits / total : 0,
        ...(s.lastFetchAt !== undefined ? { lastFetchAt: s.lastFetchAt } : {}),
      });
    }
    return out;
  }

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
    // s133 t677 — config update invalidates cache so a TTL change or new
    // server URL doesn't serve stale data.
    this.invalidateCache(config.id);
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

  /** Disconnect a server's client. State returns to disconnected. Idempotent.
   *  s133 t677 — invalidates the server's cache so the next connect re-fetches. */
  async disconnect(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client !== undefined) {
      await client.close().catch(() => { /* swallow — already closed is fine */ });
      this.clients.delete(serverId);
    }
    this.states.set(serverId, "disconnected");
    this.invalidateCache(serverId);
  }

  /** Unregister a server entirely (disconnect + remove config). */
  async unregisterServer(serverId: string): Promise<void> {
    await this.disconnect(serverId);
    this.servers.delete(serverId);
    this.states.delete(serverId);
    this.cacheStats.delete(serverId);
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

  /**
   * List tools surfaced by a connected server. Cached per-(serverId,"tools")
   * with TTL from `McpServerConfig.cacheTtlSec` (default 5 min). Pass
   * `{ bypassCache: true }` to force-fetch (e.g. when the dashboard's
   * Refresh button is clicked).
   */
  async listTools(serverId: string, opts: { bypassCache?: boolean } = {}): Promise<McpToolDescriptor[]> {
    return this.cachedList(serverId, "tools", opts, async () => {
      const client = this.requireConnectedClient(serverId);
      const result = await client.listTools();
      return result.tools.map((t) => ({
        serverId,
        name: t.name,
        description: t.description,
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
      }));
    });
  }

  /** List resources surfaced by a connected server. Cached like listTools. */
  async listResources(serverId: string, opts: { bypassCache?: boolean } = {}): Promise<McpResourceDescriptor[]> {
    return this.cachedList(serverId, "resources", opts, async () => {
      const client = this.requireConnectedClient(serverId);
      const result = await client.listResources();
      return result.resources.map((r) => ({
        serverId,
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      }));
    });
  }

  /** List prompts surfaced by a connected server. Cached like listTools. */
  async listPrompts(serverId: string, opts: { bypassCache?: boolean } = {}): Promise<McpPromptDescriptor[]> {
    return this.cachedList(serverId, "prompts", opts, async () => {
      const client = this.requireConnectedClient(serverId);
      const result = await client.listPrompts();
      return result.prompts.map((p) => ({
        serverId,
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      }));
    });
  }

  /**
   * s133 t677 — generic listing-cache helper. Wraps a fetch fn with
   * per-(serverId,kind) TTL'd memoization. Used by listTools / listResources /
   * listPrompts.
   */
  private async cachedList<T>(
    serverId: string,
    kind: string,
    opts: { bypassCache?: boolean },
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const stats = this.getStats(serverId);
    const cache = this.listCacheFor(serverId);

    if (opts.bypassCache !== true) {
      const entry = cache.get(kind);
      if (entry !== undefined && entry.expiresAt > this.now()) {
        stats.hits++;
        return entry.value as T;
      }
    } else {
      stats.bypasses++;
    }

    const value = await fetcher();
    cache.set(kind, { value, expiresAt: this.now() + this.listTtlMs(serverId) });
    stats.misses++;
    stats.lastFetchAt = new Date(this.now()).toISOString();
    return value;
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

  /**
   * Read a resource by URI. Cached per-(serverId, uri) with TTL from
   * `McpServerConfig.resourceReadCacheTtlSec` (default 30 min). Pass
   * `{ bypassCache: true }` to force-fetch.
   */
  async readResource(
    serverId: string,
    uri: string,
    opts: { bypassCache?: boolean } = {},
  ): Promise<{ contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }> }> {
    const stats = this.getStats(serverId);
    const cache = this.resourceCacheFor(serverId);

    if (opts.bypassCache !== true) {
      const entry = cache.get(uri);
      if (entry !== undefined && entry.expiresAt > this.now()) {
        stats.hits++;
        return entry.value as { contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }> };
      }
    } else {
      stats.bypasses++;
    }

    const client = this.requireConnectedClient(serverId);
    const result = await client.readResource({ uri });
    const value = {
      contents: result.contents as Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>,
    };
    cache.set(uri, { value, expiresAt: this.now() + this.resourceReadTtlMs(serverId) });
    stats.misses++;
    stats.lastFetchAt = new Date(this.now()).toISOString();
    return value;
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
