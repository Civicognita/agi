/**
 * @agi/mcp-client — public types (s111 t441)
 *
 * Wire shapes consumed by Aion's `mcp` agent tool + any agi-internal caller
 * (e.g. TynnPmProvider in s118 t432). The shapes mirror the MCP spec but
 * are NOT direct re-exports from `@modelcontextprotocol/sdk` — keeping a
 * thin local facade lets us evolve the agi-side surface independently of
 * SDK churn (the SDK is at v1.29.0 with active transport experimentation).
 */

/** Transport kind matching the MCP spec's official transports.
 *  - `stdio`: spawn a subprocess + talk over stdin/stdout (most common)
 *  - `http`: Streamable HTTP transport (POST for sending, SSE for receiving)
 *  - `websocket`: WebSocket protocol for bidirectional streaming
 *
 *  Note: the SDK ships a deprecated SSE-only client (`client/sse.js`) that
 *  predates Streamable HTTP. We expose only `http` here — it's the modern
 *  successor that supersedes the old SSE-only transport. */
export type McpTransport = "stdio" | "http" | "websocket";

/** Per-server config from project gateway.json `mcp.servers` block. */
export interface McpServerConfig {
  /** Stable id used to reference this server from agent tools / config. */
  id: string;
  /** Display name shown in UX. Defaults to id. */
  name?: string;
  /** Transport selector — chooses which connection strategy to use. */
  transport: McpTransport;
  /** Stdio: command to spawn (e.g. ["npx", "-y", "@some/mcp-server"]). */
  command?: string[];
  /** Stdio: env vars to inject when spawning. */
  env?: Record<string, string>;
  /** SSE/WebSocket: server URL. */
  url?: string;
  /** Whether to connect on first agi-server startup or lazily on first call. */
  autoConnect?: boolean;
  /** Optional server-supplied auth token, env-var-resolvable (e.g. "$TYNN_KEY"). */
  authToken?: string;
  /**
   * s133 t677 — TTL (seconds) for tool / resource / prompt LISTING caches
   * for this server. Defaults to 300 (5 min). Set to 0 to disable caching
   * for this server (every list call re-fetches).
   */
  cacheTtlSec?: number;
  /**
   * s133 t677 — TTL (seconds) for resource READ cache. Defaults to 1800
   * (30 min); resources are typically static markdown docs. Tool calls
   * remain uncached regardless.
   */
  resourceReadCacheTtlSec?: number;
}

/** Tool surfaced by an MCP server. Mirrors MCP's tool schema. */
export interface McpToolDescriptor {
  serverId: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** Resource surfaced by an MCP server. */
export interface McpResourceDescriptor {
  serverId: string;
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

/** Prompt template surfaced by an MCP server. */
export interface McpPromptDescriptor {
  serverId: string;
  name: string;
  description?: string;
  arguments?: Array<{ name: string; required?: boolean; description?: string }>;
}

/** Result of a tool call. Content blocks mirror MCP's content-block types
 *  (text / image / resource), kept loose here so SDK schema changes don't
 *  ripple into every consumer. */
export interface McpToolCallResult {
  isError: boolean;
  content: Array<{ type: string; [key: string]: unknown }>;
}

/** Connection state per server — surfaced to UX for status indicators. */
export type McpServerState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";
