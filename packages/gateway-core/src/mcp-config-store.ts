/**
 * MCP project config — `.mcp.json` reader (s131 t680).
 *
 * Owner directive (cycle 68): per-project MCP servers live in a top-level
 * `.mcp.json` at the project root, matching Claude Code's convention. This
 * module is the single read entry-point during the migration window:
 * prefers `.mcp.json` if present, falls back to the legacy
 * `project.json mcp.servers[]` block for unmigrated installs.
 *
 * Write path is intentionally NOT in this module yet — t682 flips writes
 * to `.mcp.json` after the dual-read landing zone is solid. Until then,
 * existing API endpoints continue writing to project.json AND the
 * one-shot migration (t681) brings unmigrated projects forward at boot.
 *
 * ## Disk shape
 *
 * Claude Code's `.mcp.json` uses `mcpServers: { <id>: { ... } }` keyed by
 * id. Our internal model is `ProjectMcpServer[]` keyed by `id` field.
 * Adapt at the boundary.
 *
 * ```jsonc
 * {
 *   "mcpServers": {
 *     "tynn": {
 *       "type": "http",
 *       "url": "http://127.0.0.1:7123/mcp",
 *       "headers": { "Authorization": "Bearer $TYNN_API_KEY" }
 *     },
 *     "jira-stdio": {
 *       "type": "stdio",
 *       "command": "node",
 *       "args": ["/opt/jira-mcp/bin.js"],
 *       "env": { "JIRA_TOKEN": "$JIRA_TOKEN" }
 *     }
 *   }
 * }
 * ```
 *
 * `$VAR` resolution against `<projectPath>/.env` happens later via the
 * existing `resolveDollarVars` helper; this module returns config
 * verbatim.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ProjectMcpServer } from "@agi/config";

// ---------------------------------------------------------------------------
// .mcp.json schema (Claude Code shape)
// ---------------------------------------------------------------------------

const McpServerEntrySchema = z
  .object({
    /** Transport tag matching Claude Code's `type` field. */
    type: z.enum(["stdio", "http", "websocket", "sse"]).default("stdio"),
    name: z.string().optional(),
    /** http/websocket/sse: server URL. */
    url: z.string().optional(),
    /** stdio: executable to spawn. */
    command: z.string().optional(),
    /** stdio: argv after command. */
    args: z.array(z.string()).optional(),
    /** stdio: env-var injections. Values may use `$VAR` for .env resolution. */
    env: z.record(z.string(), z.string()).optional(),
    /** http: header map. Values may use `$VAR`. Authorization is the
     *  conventional auth-token slot per Claude Code. */
    headers: z.record(z.string(), z.string()).optional(),
    /** Whether to connect at boot (default true) or lazily. */
    autoConnect: z.boolean().default(true),
  })
  .passthrough();

export const DotMcpJsonSchema = z
  .object({
    mcpServers: z.record(z.string(), McpServerEntrySchema).default({}),
  })
  .passthrough();

export type DotMcpJson = z.infer<typeof DotMcpJsonSchema>;
export type McpServerEntry = z.infer<typeof McpServerEntrySchema>;

// ---------------------------------------------------------------------------
// Path + readers
// ---------------------------------------------------------------------------

/**
 * Where the project's `.mcp.json` lives. Always at the project root
 * regardless of the s130 universal-monorepo `k/` folder layout — Claude
 * Code expects this exact name + location and our gateway should respect
 * the convention so a project can be opened by either tool without copying
 * configuration around.
 */
export function projectMcpPath(projectPath: string): string {
  return join(projectPath, ".mcp.json");
}

/**
 * Adapt a single `.mcp.json` entry (Claude Code shape) into our internal
 * `ProjectMcpServer` shape.
 *
 * `type: "sse"` collapses to "http" (we don't model SSE separately yet —
 * the McpClient handles SSE-over-HTTP transparently). Authorization is
 * extracted from `headers` to populate `authToken` so existing wiring
 * keeps working without refactoring the consumer.
 */
export function mcpEntryToServer(id: string, entry: McpServerEntry): ProjectMcpServer {
  const transport = entry.type === "sse" ? "http" : entry.type;
  const authHeader = entry.headers?.Authorization ?? entry.headers?.authorization;
  const authToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : authHeader;

  // Combine `command` + `args` into the single `command: string[]` array
  // our internal schema uses.
  let command: string[] | undefined;
  if (entry.command !== undefined) {
    command = entry.args !== undefined ? [entry.command, ...entry.args] : [entry.command];
  }

  return {
    id,
    transport,
    autoConnect: entry.autoConnect,
    ...(entry.name !== undefined ? { name: entry.name } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(entry.env !== undefined ? { env: entry.env } : {}),
    ...(entry.url !== undefined ? { url: entry.url } : {}),
    ...(authToken !== undefined ? { authToken } : {}),
  } as ProjectMcpServer;
}

/**
 * Read `.mcp.json` for a project and return its servers in the internal
 * shape. Returns `null` when the file doesn't exist (caller should fall
 * back to project.json for unmigrated installs). Returns `[]` when the
 * file is present but parses to `mcpServers: {}`.
 *
 * Throws on parse / schema error (loud failure preferred over silent
 * fallback — a malformed `.mcp.json` should surface in `agi doctor
 * schema`, not be silently ignored).
 */
export function readDotMcpJson(projectPath: string): ProjectMcpServer[] | null {
  const path = projectMcpPath(projectPath);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  const result = DotMcpJsonSchema.parse(parsed);
  return Object.entries(result.mcpServers).map(([id, entry]) => mcpEntryToServer(id, entry));
}

/**
 * The dual-read entry-point. Prefers `.mcp.json` when present; otherwise
 * falls back to `legacyServers` (typically the `project.json mcp.servers`
 * block). Pass both even when only one is expected to be populated — the
 * caller doesn't need to know which migration era this project is in.
 *
 * Returns an empty array when neither is populated (project never
 * configured any MCP servers).
 */
export function readProjectMcpServers(
  projectPath: string,
  legacyServers: ProjectMcpServer[] | undefined,
): { servers: ProjectMcpServer[]; source: "dotmcp" | "legacy" | "none" } {
  const fromDot = readDotMcpJson(projectPath);
  if (fromDot !== null) return { servers: fromDot, source: "dotmcp" };
  if (legacyServers && legacyServers.length > 0) return { servers: legacyServers, source: "legacy" };
  return { servers: [], source: "none" };
}
