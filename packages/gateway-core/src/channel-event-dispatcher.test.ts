/**
 * ChannelEventDispatcher tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectConfigManager } from "./project-config-manager.js";
import { ChannelEventDispatcher } from "./channel-event-dispatcher.js";

describe("ChannelEventDispatcher", () => {
  let tmpDir: string;
  let workspaceRoot: string;
  let mgr: ProjectConfigManager;
  let dispatcher: ChannelEventDispatcher;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `ced-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    workspaceRoot = join(tmpDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    process.env.HOME = tmpDir;

    mgr = new ProjectConfigManager();

    // Two projects in the workspace, both with bindings
    const projA = join(workspaceRoot, "proj-a");
    const projB = join(workspaceRoot, "proj-b");
    mkdirSync(projA, { recursive: true });
    mkdirSync(projB, { recursive: true });
    mgr.create(projA, "Project A");
    mgr.create(projB, "Project B");
    await mgr.addRoomBinding(projA, {
      channelId: "discord",
      roomId: "guild-1:channel-x",
      label: "#x",
      boundAt: "2026-05-14T13:00:00Z",
    });
    await mgr.addRoomBinding(projB, {
      channelId: "telegram",
      roomId: "@y",
      boundAt: "2026-05-14T13:00:00Z",
    });

    dispatcher = new ChannelEventDispatcher({
      projectConfigManager: mgr,
      workspaceProjects: [workspaceRoot],
    });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it("returns the bound project for a matching event", () => {
    const result = dispatcher.dispatch("discord", "guild-1:channel-x");
    expect(result).not.toBeNull();
    expect(result?.projectPath.endsWith("proj-a")).toBe(true);
    expect(result?.binding.label).toBe("#x");
  });

  it("returns null when no project binds the event", () => {
    const result = dispatcher.dispatch("slack", "C9999");
    expect(result).toBeNull();
  });

  it("matches across multiple projects within the same workspace", () => {
    const result = dispatcher.dispatch("telegram", "@y");
    expect(result?.projectPath.endsWith("proj-b")).toBe(true);
  });

  it("skips hidden directories during candidate enumeration", async () => {
    // Create a hidden ".trash" dir that LOOKS like a project (project.json
    // present) — the dispatcher must NOT walk into it.
    const hidden = join(workspaceRoot, ".trash-folder");
    mkdirSync(hidden, { recursive: true });
    writeFileSync(
      join(hidden, "project.json"),
      JSON.stringify({
        name: "Trash",
        rooms: [{ channelId: "discord", roomId: "should-not-match", boundAt: "2026-05-14T13:00:00Z" }],
      }),
      "utf-8",
    );
    const result = dispatcher.dispatch("discord", "should-not-match");
    expect(result).toBeNull();
  });

  it("skips node_modules during candidate enumeration", () => {
    const nm = join(workspaceRoot, "node_modules");
    mkdirSync(nm, { recursive: true });
    // (No project.json in node_modules but the enumeration should skip
    // it before even checking.)
    // Sanity check: dispatch still works for the real projects.
    const result = dispatcher.dispatch("discord", "guild-1:channel-x");
    expect(result?.projectPath.endsWith("proj-a")).toBe(true);
  });

  it("tolerates missing workspace roots without throwing", () => {
    const ghost = new ChannelEventDispatcher({
      projectConfigManager: mgr,
      workspaceProjects: [join(tmpDir, "no-such-workspace"), workspaceRoot],
    });
    const result = ghost.dispatch("discord", "guild-1:channel-x");
    expect(result?.projectPath.endsWith("proj-a")).toBe(true);
  });

  it("returns null when workspace.projects[] is empty", () => {
    const empty = new ChannelEventDispatcher({
      projectConfigManager: mgr,
      workspaceProjects: [],
    });
    const result = empty.dispatch("discord", "guild-1:channel-x");
    expect(result).toBeNull();
  });

  it("matches events case-sensitively (Discord IDs are case-sensitive)", () => {
    const result = dispatcher.dispatch("Discord", "guild-1:channel-x"); // wrong case
    expect(result).toBeNull();
  });
});
