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

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

/**
 * Inverse of `mcpEntryToServer` — translate one internal ProjectMcpServer
 * into the Claude-Code-shaped `.mcp.json` entry. Lives here (not in the
 * migration module) so the write helpers below can call it without a
 * circular import. The migration module re-exports it for back-compat.
 *
 * - `transport` → `type`
 * - `command: string[]` → split into `{ command, args }` (head + tail)
 * - `authToken` → `headers: { Authorization: "Bearer <token>" }` for
 *   http/websocket only (stdio keeps authToken in env there)
 */
export function serverToMcpEntry(server: ProjectMcpServer): McpServerEntry {
  const entry: McpServerEntry = {
    type: server.transport,
    autoConnect: server.autoConnect,
  };
  if (server.name !== undefined) entry.name = server.name;
  if (server.url !== undefined) entry.url = server.url;
  if (server.command !== undefined && server.command.length > 0) {
    entry.command = server.command[0];
    if (server.command.length > 1) entry.args = server.command.slice(1);
  }
  if (server.env !== undefined) entry.env = server.env;
  if (server.authToken !== undefined && (server.transport === "http" || server.transport === "websocket")) {
    entry.headers = { Authorization: `Bearer ${server.authToken}` };
  }
  return entry;
}

/**
 * Write the full set of servers to `.mcp.json`, replacing any existing
 * file. Atomic via temp + rename so a SIGINT mid-write can't leave a
 * torn file. Pass an empty array to write `{ mcpServers: {} }` (used
 * when the last server is removed).
 */
export function writeDotMcpJson(projectPath: string, servers: readonly ProjectMcpServer[]): void {
  const path = projectMcpPath(projectPath);
  const mcpServers: Record<string, McpServerEntry> = {};
  for (const server of servers) mcpServers[server.id] = serverToMcpEntry(server);
  const payload: DotMcpJson = { mcpServers };
  // Atomic write — temp + rename so a torn file can't surface mid-write.
  const tmp = `${path}.tmp.${String(process.pid)}`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  renameSync(tmp, path);
}

/**
 * Add or update a single server in `.mcp.json`. Reads existing entries,
 * upserts by id, writes the merged set. Idempotent on re-add of the
 * same id with the same payload.
 */
export function setDotMcpServer(projectPath: string, server: ProjectMcpServer): void {
  const existing = readDotMcpJson(projectPath) ?? [];
  const filtered = existing.filter((s) => s.id !== server.id);
  filtered.push(server);
  writeDotMcpJson(projectPath, filtered);
}

/**
 * Remove a server from `.mcp.json` by id. No-op when the file or id
 * doesn't exist (caller doesn't need to check first).
 */
export function removeDotMcpServer(projectPath: string, id: string): void {
  const existing = readDotMcpJson(projectPath);
  if (existing === null) return;
  const filtered = existing.filter((s) => s.id !== id);
  writeDotMcpJson(projectPath, filtered);
}
