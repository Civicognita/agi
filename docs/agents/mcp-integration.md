# MCP Integration

This doc describes how AGI talks to MCP (Model Context Protocol) servers via the `@agi/mcp-client` workspace package. MCP support is a core AGI feature with an always-latest-schema commitment per s118 t441.

## Why MCP

MCP is the protocol for connecting LLM agents to external tools, resources, and prompts. Many ecosystem services (tynn, Linear, GitHub via MCP servers, etc.) expose their surface via MCP. Building one MCP client in AGI core means **every MCP server becomes immediately available to Aion** with no per-integration code — versus building HTTP shims per-service which defeats the protocol's whole point.

## Package shape

`@agi/mcp-client` lives at `packages/mcp-client/` as a workspace package:
- `src/types.ts` — structural types consumed by Aion's `mcp` agent tool + agi-internal callers (TynnPmProvider, future plugin-registered MCP integrations)
- `src/index.ts` — the `McpClient` class managing server connections + dispatching calls
- Source-direct exports (no `dist/` build step) — matches `aion-sdk` + `channel-sdk` workspace patterns

Underlying SDK: `@modelcontextprotocol/sdk` (npm), pinned to `^1.29.0` as of cycle 30 ship. Schema-evolution discipline: dependabot watch on SDK + monitor for breaking changes.

## Transports

Three transports the client will support:

| Transport | Use case | Status (cycle 30) |
|-----------|----------|-------|
| `stdio` | Most common — spawns server binary, talks over stdin/stdout. Tynn uses this. | Skeleton only; impl in cycle 31 |
| `sse` | Hosted MCP servers reachable via HTTP/SSE | Cycle 32 |
| `websocket` | Newer streaming variant from MCP spec evolution | Cycle 32 |

## Configuration

Per-project `gateway.json` extension:

```json
{
  "mcp": {
    "servers": [
      {
        "id": "tynn",
        "transport": "stdio",
        "command": ["npx", "-y", "@tynn/mcp-server"],
        "env": { "TYNN_KEY": "$TYNN_KEY" },
        "autoConnect": true
      }
    ]
  }
}
```

Hot-reloadable per `feedback_hot_config` — adding/removing a server doesn't require gateway restart.

## Aion-side surface (cycle 31+)

The `mcp` agent tool will dispatch:

- `mcp.list-servers` → array of `{ id, name, state, transport }`
- `mcp.list-tools(serverId)` → array of `McpToolDescriptor`
- `mcp.call(serverId, toolName, args)` → `McpToolCallResult`
- `mcp.list-resources(serverId)` → array of `McpResourceDescriptor`
- `mcp.read-resource(serverId, uri)` → resource contents
- `mcp.list-prompts(serverId)` → array of `McpPromptDescriptor`

Internal API for other agi modules:

```ts
import { McpClient } from "@agi/mcp-client";
const client = new McpClient();
client.registerServer({ id: "tynn", transport: "stdio", command: [...] });
const tools = await client.listTools("tynn");
const result = await client.callTool("tynn", "next", {});
```

## Schema evolution commitment

When `@modelcontextprotocol/sdk` ships a new version:
1. Dependabot opens a PR
2. CI runs schema-evolution tests against a mock MCP server
3. If existing tool/resource/prompt calls still work, merge
4. If a breaking change is detected, file a migration task before merging

## Cycle plan

- ✅ Cycle 30 (this slice): package skeleton + types + design doc (this file)
- Cycle 31: stdio transport + connection lifecycle + tool/resource/prompt list + call dispatch
- Cycle 32: SSE/HTTP + WebSocket transports + agent tool registration
- After cycle 32: t432 (PM tool surface) unblocks — TynnPmProvider consumes this client

## Reference

- MCP spec: https://modelcontextprotocol.io/specification (always-latest commitment)
- SDK: `@modelcontextprotocol/sdk` (npm; targeting ^1.29.0)
- Tynn docs (MCP-side): see tynn-guidelines via `ReadMcpResourceTool(server: "tynn", uri: "file://instructions/tynn-guidelines.md")`
- Story: tynn s118 — Iterative work mode (cron-nudged Aion + pluggable PM tool + tynn-lite fallback)
