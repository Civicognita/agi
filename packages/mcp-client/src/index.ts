/**
 * @agi/mcp-client — MCP client core for Aion (s118 t441 first slice).
 *
 * This package is the canonical MCP client used by:
 *   - Aion's `mcp` agent tool (mcp.list-servers, mcp.call, mcp.read-resource)
 *   - TynnPmProvider in s118 t432 (reaches tynn via stdio MCP transport)
 *   - Future plugin-registered MCP-server integrations
 *
 * Always-latest-schema commitment: this package targets the latest stable
 * `@modelcontextprotocol/sdk` (v1.29.0 as of cycle 30 ship). Schema-evolution
 * tests + dependabot watch on the SDK keep us current.
 *
 * **First-slice scope (cycle 30):** package skeleton + structural types +
 * stubbed McpClient class. No transport wiring yet — that lands in cycle 31
 * when the SDK's Client + StdioClientTransport API surface is read directly
 * from the installed .d.ts files.
 *
 * Reference: agi/docs/agents/mcp-integration.md
 */

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

/**
 * McpClient — manages a pool of MCP server connections + dispatches calls.
 *
 * Cycle 30 ships the class skeleton. Cycle 31 implements:
 *   - Stdio transport (most common; tynn uses it)
 *   - Connection lifecycle (connect/disconnect/reconnect)
 *   - Tool/resource/prompt enumeration via MCP's list endpoints
 *   - Tool call dispatch
 *
 * Cycle 32+ adds SSE/HTTP + WebSocket transports.
 */
export class McpClient {
  private readonly servers = new Map<string, McpServerConfig>();
  private readonly states = new Map<string, McpServerState>();

  /**
   * Register a server config. Idempotent — re-registering an id replaces the
   * config + flags the server for reconnect on next call. autoConnect: true
   * triggers an immediate connect attempt (cycle 31+).
   */
  registerServer(config: McpServerConfig): void {
    this.servers.set(config.id, config);
    this.states.set(config.id, "disconnected");
    // Connection logic ships in cycle 31. For cycle 30, we just track config.
  }

  /** Unregister + disconnect a server. */
  unregisterServer(_serverId: string): void {
    // Disconnect logic ships in cycle 31.
    throw new Error("McpClient.unregisterServer: not yet implemented (cycle 31)");
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
  async listTools(_serverId: string): Promise<McpToolDescriptor[]> {
    throw new Error("McpClient.listTools: not yet implemented (cycle 31)");
  }

  /** List resources surfaced by a connected server. */
  async listResources(_serverId: string): Promise<McpResourceDescriptor[]> {
    throw new Error("McpClient.listResources: not yet implemented (cycle 31)");
  }

  /** List prompts surfaced by a connected server. */
  async listPrompts(_serverId: string): Promise<McpPromptDescriptor[]> {
    throw new Error("McpClient.listPrompts: not yet implemented (cycle 31)");
  }

  /** Call a tool on a connected server. */
  async callTool(
    _serverId: string,
    _toolName: string,
    _args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    throw new Error("McpClient.callTool: not yet implemented (cycle 31)");
  }

  /** Read a resource by URI. */
  async readResource(_serverId: string, _uri: string): Promise<{ contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }> }> {
    throw new Error("McpClient.readResource: not yet implemented (cycle 31)");
  }
}
