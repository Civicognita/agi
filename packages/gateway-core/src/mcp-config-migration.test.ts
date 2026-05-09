/**
 * mcp-config-migration tests (s131 t681). Pure-logic; runs on host.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  serverToMcpEntry,
  migrateProjectMcpConfig,
  migrateAllProjectMcpConfigs,
} from "./mcp-config-migration.js";
import { projectMcpPath } from "./mcp-config-store.js";
import type { ProjectMcpServer } from "@agi/config";

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `mcp-mig-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeProjectJson(projectPath: string, content: object): void {
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(join(projectPath, "project.json"), JSON.stringify(content, null, 2), "utf-8");
}

describe("serverToMcpEntry (s131 t681)", () => {
  it("translates an http server with authToken into Claude Code shape", () => {
    const server: ProjectMcpServer = {
      id: "tynn",
      transport: "http",
      url: "http://127.0.0.1:7123/mcp",
      authToken: "$TYNN_API_KEY",
      autoConnect: true,
    };
    expect(serverToMcpEntry(server)).toEqual({
      type: "http",
      url: "http://127.0.0.1:7123/mcp",
      headers: { Authorization: "Bearer $TYNN_API_KEY" },
      autoConnect: true,
    });
  });

  it("translates a stdio server with command + args + env", () => {
    const server: ProjectMcpServer = {
      id: "jira",
      transport: "stdio",
      command: ["node", "/opt/jira-mcp/bin.js", "--verbose"],
      env: { JIRA_TOKEN: "$JIRA_TOKEN" },
      autoConnect: false,
    };
    expect(serverToMcpEntry(server)).toEqual({
      type: "stdio",
      command: "node",
      args: ["/opt/jira-mcp/bin.js", "--verbose"],
      env: { JIRA_TOKEN: "$JIRA_TOKEN" },
      autoConnect: false,
    });
  });

  it("does NOT emit headers for stdio (authToken belongs in env there)", () => {
    const server: ProjectMcpServer = {
      id: "x",
      transport: "stdio",
      command: ["node"],
      authToken: "$TOKEN",
      autoConnect: true,
    };
    expect(serverToMcpEntry(server).headers).toBeUndefined();
  });

  it("preserves the id-less name field when present", () => {
    const server: ProjectMcpServer = {
      id: "x",
      transport: "http",
      name: "Tynn (production)",
      url: "http://x",
      autoConnect: true,
    };
    expect(serverToMcpEntry(server).name).toBe("Tynn (production)");
  });

  it("handles single-element command array (no args emitted)", () => {
    const server: ProjectMcpServer = {
      id: "x",
      transport: "stdio",
      command: ["binary-only"],
      autoConnect: true,
    };
    const out = serverToMcpEntry(server);
    expect(out.command).toBe("binary-only");
    expect(out.args).toBeUndefined();
  });

  it("round-trips through mcpEntryToServer (read inverse holds)", async () => {
    const { mcpEntryToServer } = await import("./mcp-config-store.js");
    const server: ProjectMcpServer = {
      id: "tynn",
      transport: "http",
      url: "http://127.0.0.1:7123/mcp",
      authToken: "$TYNN_API_KEY",
      autoConnect: true,
    };
    const roundTripped = mcpEntryToServer("tynn", serverToMcpEntry(server));
    expect(roundTripped).toEqual(server);
  });
});

describe("migrateProjectMcpConfig (s131 t681)", () => {
  it("writes .mcp.json + strips project.json mcp on a populated config", () => {
    const projectPath = join(tmp, "demo");
    writeProjectJson(projectPath, {
      name: "Demo",
      type: "static-site",
      mcp: {
        servers: [
          { id: "tynn", transport: "http", url: "http://x", authToken: "$T", autoConnect: true },
          { id: "jira", transport: "stdio", command: ["node", "/x.js"], autoConnect: false },
        ],
      },
    });

    const result = migrateProjectMcpConfig(projectPath);
    expect(result.dotMcpWritten).toBe(true);
    expect(result.projectJsonStripped).toBe(true);
    expect(result.serverCount).toBe(2);
    expect(existsSync(projectMcpPath(projectPath))).toBe(true);

    // .mcp.json contents are well-formed
    const parsed = JSON.parse(readFileSync(projectMcpPath(projectPath), "utf-8")) as {
      mcpServers: Record<string, { type: string }>;
    };
    expect(Object.keys(parsed.mcpServers)).toEqual(["tynn", "jira"]);
    expect(parsed.mcpServers.tynn?.type).toBe("http");
    expect(parsed.mcpServers.jira?.type).toBe("stdio");

    // project.json mcp field gone
    const projectJson = JSON.parse(readFileSync(join(projectPath, "project.json"), "utf-8")) as Record<string, unknown>;
    expect("mcp" in projectJson).toBe(false);
    expect(projectJson["name"]).toBe("Demo");
  });

  it("is idempotent — second pass on a migrated project skips silently", () => {
    const projectPath = join(tmp, "demo");
    writeProjectJson(projectPath, {
      name: "Demo",
      mcp: { servers: [{ id: "x", transport: "http", url: "http://x", autoConnect: true }] },
    });

    const first = migrateProjectMcpConfig(projectPath);
    expect(first.dotMcpWritten).toBe(true);

    const second = migrateProjectMcpConfig(projectPath);
    expect(second.dotMcpWritten).toBe(false);
    expect(second.skippedReason).toBe("already-migrated");
  });

  it("strips an empty mcp block from project.json without writing .mcp.json", () => {
    const projectPath = join(tmp, "demo");
    writeProjectJson(projectPath, { name: "Demo", mcp: { servers: [] } });

    const result = migrateProjectMcpConfig(projectPath);
    expect(result.dotMcpWritten).toBe(false);
    expect(result.projectJsonStripped).toBe(true);
    expect(result.skippedReason).toBe("no-mcp-block");
    expect(existsSync(projectMcpPath(projectPath))).toBe(false);

    const projectJson = JSON.parse(readFileSync(join(projectPath, "project.json"), "utf-8")) as Record<string, unknown>;
    expect("mcp" in projectJson).toBe(false);
  });

  it("skips when project.json doesn't exist", () => {
    const projectPath = join(tmp, "missing");
    mkdirSync(projectPath, { recursive: true });
    const result = migrateProjectMcpConfig(projectPath);
    expect(result.skippedReason).toBe("no-project-json");
    expect(result.dotMcpWritten).toBe(false);
  });

  it("skips when no mcp block AND no mcp field at all", () => {
    const projectPath = join(tmp, "no-mcp");
    writeProjectJson(projectPath, { name: "X" });
    const result = migrateProjectMcpConfig(projectPath);
    expect(result.dotMcpWritten).toBe(false);
    expect(result.projectJsonStripped).toBe(false);
    expect(result.skippedReason).toBe("no-mcp-block");
  });

  it("captures error on malformed project.json without throwing", () => {
    const projectPath = join(tmp, "bad");
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(projectPath, "project.json"), "not json", "utf-8");
    const result = migrateProjectMcpConfig(projectPath);
    expect(result.error).toBeDefined();
    expect(result.dotMcpWritten).toBe(false);
  });
});

describe("migrateAllProjectMcpConfigs (s131 t681)", () => {
  it("walks each workspace root + migrates each project", () => {
    const wsRoot = join(tmp, "ws");
    mkdirSync(wsRoot, { recursive: true });

    // Three projects: one to migrate, one already migrated, one with no mcp.
    writeProjectJson(join(wsRoot, "alpha"), {
      name: "Alpha",
      mcp: { servers: [{ id: "tynn", transport: "http", url: "http://x", autoConnect: true }] },
    });

    writeProjectJson(join(wsRoot, "beta"), { name: "Beta" });
    writeFileSync(join(wsRoot, "beta", ".mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");

    writeProjectJson(join(wsRoot, "gamma"), { name: "Gamma" }); // no mcp at all

    const out = migrateAllProjectMcpConfigs([wsRoot]);
    expect(out.scanned).toBe(3);
    expect(out.migrated).toBe(1); // only alpha
    expect(out.totalServers).toBe(1);
    expect(out.errors).toBe(0);

    expect(existsSync(projectMcpPath(join(wsRoot, "alpha")))).toBe(true);
  });

  it("ignores hidden directories under workspace roots", () => {
    const wsRoot = join(tmp, "ws");
    mkdirSync(join(wsRoot, ".hidden"), { recursive: true });
    writeProjectJson(join(wsRoot, ".hidden"), {
      name: "Hidden",
      mcp: { servers: [{ id: "x", transport: "http", url: "http://x", autoConnect: true }] },
    });
    const out = migrateAllProjectMcpConfigs([wsRoot]);
    expect(out.scanned).toBe(0);
    expect(out.migrated).toBe(0);
  });

  it("tolerates non-existent workspace roots silently", () => {
    const out = migrateAllProjectMcpConfigs([join(tmp, "does-not-exist")]);
    expect(out.scanned).toBe(0);
    expect(out.errors).toBe(0);
  });
});
