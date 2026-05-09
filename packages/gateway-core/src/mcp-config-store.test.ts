/**
 * mcp-config-store tests (s131 t680). Pure-logic; runs on host.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  projectMcpPath,
  mcpEntryToServer,
  readDotMcpJson,
  readProjectMcpServers,
  writeDotMcpJson,
  setDotMcpServer,
  removeDotMcpServer,
  DotMcpJsonSchema,
  type McpServerEntry,
} from "./mcp-config-store.js";
import { existsSync as existsSyncFs } from "node:fs";
import type { ProjectMcpServer } from "@agi/config";

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `mcp-store-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("projectMcpPath (s131 t680)", () => {
  it("appends .mcp.json to the project path", () => {
    expect(projectMcpPath("/srv/proj")).toBe("/srv/proj/.mcp.json");
    expect(projectMcpPath("/home/u/work/x")).toBe("/home/u/work/x/.mcp.json");
  });
});

describe("DotMcpJsonSchema (s131 t680)", () => {
  it("accepts the canonical Claude Code shape", () => {
    const r = DotMcpJsonSchema.safeParse({
      mcpServers: {
        tynn: {
          type: "http",
          url: "http://127.0.0.1:7123/mcp",
          headers: { Authorization: "Bearer $TYNN_API_KEY" },
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it("defaults autoConnect to true and type to stdio", () => {
    const r = DotMcpJsonSchema.parse({ mcpServers: { foo: {} } });
    expect(r.mcpServers.foo?.autoConnect).toBe(true);
    expect(r.mcpServers.foo?.type).toBe("stdio");
  });

  it("accepts empty mcpServers", () => {
    const r = DotMcpJsonSchema.parse({ mcpServers: {} });
    expect(Object.keys(r.mcpServers)).toEqual([]);
  });

  it("accepts a missing mcpServers key (defaults to empty)", () => {
    const r = DotMcpJsonSchema.parse({});
    expect(r.mcpServers).toEqual({});
  });

  it("passes-through unknown top-level keys (forward-compat)", () => {
    const r = DotMcpJsonSchema.parse({ mcpServers: {}, _futureField: "ok" });
    expect((r as Record<string, unknown>)._futureField).toBe("ok");
  });
});

describe("mcpEntryToServer (s131 t680)", () => {
  it("translates an http server with bearer header to authToken", () => {
    const entry: McpServerEntry = {
      type: "http",
      url: "http://127.0.0.1:7123/mcp",
      headers: { Authorization: "Bearer $TYNN_API_KEY" },
      autoConnect: true,
    };
    const out = mcpEntryToServer("tynn", entry);
    expect(out).toEqual<ProjectMcpServer>({
      id: "tynn",
      transport: "http",
      url: "http://127.0.0.1:7123/mcp",
      authToken: "$TYNN_API_KEY",
      autoConnect: true,
    });
  });

  it("translates a stdio server with command + args + env", () => {
    const entry: McpServerEntry = {
      type: "stdio",
      command: "node",
      args: ["/opt/jira-mcp/bin.js", "--verbose"],
      env: { JIRA_TOKEN: "$JIRA_TOKEN" },
      autoConnect: false,
    };
    const out = mcpEntryToServer("jira", entry);
    expect(out).toEqual<ProjectMcpServer>({
      id: "jira",
      transport: "stdio",
      command: ["node", "/opt/jira-mcp/bin.js", "--verbose"],
      env: { JIRA_TOKEN: "$JIRA_TOKEN" },
      autoConnect: false,
    });
  });

  it("collapses sse to http transport", () => {
    const entry: McpServerEntry = {
      type: "sse",
      url: "http://example.com/sse",
      autoConnect: true,
    };
    const out = mcpEntryToServer("legacy-sse", entry);
    expect(out.transport).toBe("http");
    expect(out.url).toBe("http://example.com/sse");
  });

  it("preserves Authorization without 'Bearer ' prefix", () => {
    const entry: McpServerEntry = {
      type: "http",
      url: "http://x",
      headers: { Authorization: "$RAW_TOKEN" },
      autoConnect: true,
    };
    expect(mcpEntryToServer("x", entry).authToken).toBe("$RAW_TOKEN");
  });

  it("accepts lowercase 'authorization' header", () => {
    const entry: McpServerEntry = {
      type: "http",
      url: "http://x",
      headers: { authorization: "Bearer $TOKEN" },
      autoConnect: true,
    };
    expect(mcpEntryToServer("x", entry).authToken).toBe("$TOKEN");
  });
});

describe("readDotMcpJson (s131 t680)", () => {
  it("returns null when .mcp.json does not exist", () => {
    expect(readDotMcpJson(tmp)).toBe(null);
  });

  it("returns [] when .mcp.json has no servers", () => {
    writeFileSync(join(tmp, ".mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
    expect(readDotMcpJson(tmp)).toEqual([]);
  });

  it("returns servers in internal shape, sorted by file order", () => {
    writeFileSync(join(tmp, ".mcp.json"), JSON.stringify({
      mcpServers: {
        tynn: { type: "http", url: "http://127.0.0.1:7123/mcp", headers: { Authorization: "Bearer $TYNN_API_KEY" } },
        local: { type: "stdio", command: "node", args: ["/x/y.js"] },
      },
    }), "utf-8");
    const servers = readDotMcpJson(tmp);
    expect(servers).toHaveLength(2);
    expect(servers?.[0]?.id).toBe("tynn");
    expect(servers?.[1]?.id).toBe("local");
  });

  it("throws on malformed JSON (loud failure)", () => {
    writeFileSync(join(tmp, ".mcp.json"), "not json", "utf-8");
    expect(() => readDotMcpJson(tmp)).toThrow();
  });
});

describe("writeDotMcpJson + setDotMcpServer + removeDotMcpServer (s131 t682)", () => {
  it("writeDotMcpJson creates .mcp.json with the given servers", () => {
    const servers: ProjectMcpServer[] = [
      { id: "tynn", transport: "http", url: "http://x", authToken: "$T", autoConnect: true },
    ];
    writeDotMcpJson(tmp, servers);
    expect(existsSyncFs(projectMcpPath(tmp))).toBe(true);
    const round = readDotMcpJson(tmp);
    expect(round).toHaveLength(1);
    expect(round?.[0]?.id).toBe("tynn");
    expect(round?.[0]?.authToken).toBe("$T");
  });

  it("writeDotMcpJson overwrites existing file (replace semantics, not append)", () => {
    writeDotMcpJson(tmp, [
      { id: "old", transport: "http", url: "http://o", autoConnect: true },
    ]);
    writeDotMcpJson(tmp, [
      { id: "new", transport: "stdio", command: ["node"], autoConnect: true },
    ]);
    const round = readDotMcpJson(tmp);
    expect(round).toHaveLength(1);
    expect(round?.[0]?.id).toBe("new");
  });

  it("writeDotMcpJson with empty array writes { mcpServers: {} }", () => {
    writeDotMcpJson(tmp, []);
    expect(readDotMcpJson(tmp)).toEqual([]);
  });

  it("setDotMcpServer adds a new server when file is absent", () => {
    setDotMcpServer(tmp, { id: "x", transport: "http", url: "http://x", autoConnect: true });
    const round = readDotMcpJson(tmp);
    expect(round).toHaveLength(1);
    expect(round?.[0]?.id).toBe("x");
  });

  it("setDotMcpServer upserts (existing id overwritten in place)", () => {
    setDotMcpServer(tmp, { id: "x", transport: "http", url: "http://v1", autoConnect: true });
    setDotMcpServer(tmp, { id: "x", transport: "http", url: "http://v2", autoConnect: true });
    const round = readDotMcpJson(tmp);
    expect(round).toHaveLength(1);
    expect(round?.[0]?.url).toBe("http://v2");
  });

  it("setDotMcpServer preserves siblings", () => {
    setDotMcpServer(tmp, { id: "a", transport: "http", url: "http://a", autoConnect: true });
    setDotMcpServer(tmp, { id: "b", transport: "http", url: "http://b", autoConnect: true });
    const round = readDotMcpJson(tmp);
    expect(round).toHaveLength(2);
    expect(round?.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("removeDotMcpServer drops the matching id, leaves others", () => {
    setDotMcpServer(tmp, { id: "a", transport: "http", url: "http://a", autoConnect: true });
    setDotMcpServer(tmp, { id: "b", transport: "http", url: "http://b", autoConnect: true });
    removeDotMcpServer(tmp, "a");
    const round = readDotMcpJson(tmp);
    expect(round).toHaveLength(1);
    expect(round?.[0]?.id).toBe("b");
  });

  it("removeDotMcpServer is a no-op when file is absent", () => {
    removeDotMcpServer(tmp, "x");
    expect(readDotMcpJson(tmp)).toBe(null);
  });

  it("removeDotMcpServer is a no-op when id is absent", () => {
    setDotMcpServer(tmp, { id: "a", transport: "http", url: "http://a", autoConnect: true });
    removeDotMcpServer(tmp, "nonexistent");
    expect(readDotMcpJson(tmp)).toHaveLength(1);
  });
});

describe("readProjectMcpServers (s131 t680)", () => {
  it("returns dotmcp source when .mcp.json exists", () => {
    writeFileSync(join(tmp, ".mcp.json"), JSON.stringify({
      mcpServers: { tynn: { type: "http", url: "http://x" } },
    }), "utf-8");
    const r = readProjectMcpServers(tmp, undefined);
    expect(r.source).toBe("dotmcp");
    expect(r.servers).toHaveLength(1);
    expect(r.servers[0]?.id).toBe("tynn");
  });

  it("falls back to legacy servers when .mcp.json is absent", () => {
    const legacy: ProjectMcpServer[] = [
      { id: "tynn", transport: "http", url: "http://x", autoConnect: true },
    ];
    const r = readProjectMcpServers(tmp, legacy);
    expect(r.source).toBe("legacy");
    expect(r.servers).toBe(legacy);
  });

  it("prefers .mcp.json over legacy when both exist (.mcp.json wins migration)", () => {
    writeFileSync(join(tmp, ".mcp.json"), JSON.stringify({
      mcpServers: { fromdot: { type: "http", url: "http://dot" } },
    }), "utf-8");
    const legacy: ProjectMcpServer[] = [
      { id: "fromlegacy", transport: "http", url: "http://legacy", autoConnect: true },
    ];
    const r = readProjectMcpServers(tmp, legacy);
    expect(r.source).toBe("dotmcp");
    expect(r.servers[0]?.id).toBe("fromdot");
  });

  it("returns empty + source 'none' when neither populated", () => {
    expect(readProjectMcpServers(tmp, undefined)).toEqual({ servers: [], source: "none" });
    expect(readProjectMcpServers(tmp, [])).toEqual({ servers: [], source: "none" });
  });
});
