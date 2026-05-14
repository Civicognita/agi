/**
 * ProjectConfigManager Tests — validates centralized config I/O service.
 *
 * Uses temp directories (same pattern as config/src/hot-reload.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectConfigManager } from "./project-config-manager.js";

describe("ProjectConfigManager", () => {
  let tmpDir: string;
  let agiDir: string;
  let mgr: ProjectConfigManager;
  let projectPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pcm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    agiDir = join(tmpDir, ".agi");
    mkdirSync(agiDir, { recursive: true });
    // Override HOME so legacy projectConfigPath fallback resolves to our
    // temp dir (the new path lives at <projectPath>/.agi/ per s130 t514).
    process.env.HOME = tmpDir;
    // Per t514 slice 1, project config lives at <projectPath>/.agi/
    // not ~/.agi/{slug}/. Test projectPath must be a real writable dir.
    projectPath = join(tmpDir, "my-project");
    mkdirSync(projectPath, { recursive: true });
    mgr = new ProjectConfigManager();
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it("read() returns null for missing file", () => {
    expect(mgr.read(projectPath)).toBeNull();
  });

  it("read() parses valid minimal config", () => {
    mgr.create(projectPath, "My Project");
    const config = mgr.read(projectPath);
    expect(config).not.toBeNull();
    expect(config?.name).toBe("My Project");
    expect(config?.createdAt).toBeDefined();
  });

  it("read() returns null for invalid JSON", () => {
    // Write garbage to the expected path
    const slug = projectPath.replace(/^\//, "").replace(/\//g, "-");
    const dir = join(agiDir, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project.json"), "{ not valid }");
    expect(mgr.read(projectPath)).toBeNull();
  });

  it("read() preserves plugin passthrough keys", () => {
    mgr.create(projectPath, "Test");
    // Per s140 (cycle 150 reframe), config lives at the project root —
    // <projectPath>/project.json — not under .agi/ (the s130 transitional
    // location) and not under ~/.agi/{slug}/ (the pre-s130 location).
    const filePath = join(projectPath, "project.json");
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    data.customPlugin = { setting: true };
    writeFileSync(filePath, JSON.stringify(data));

    const config = mgr.read(projectPath);
    expect((config as Record<string, unknown>).customPlugin).toEqual({ setting: true });
  });

  it("write() creates parent directories", () => {
    // Per s140, config lives at <projectPath>/project.json — write() needs
    // the parent dir to exist. Use a tmpDir-based path with a real parent.
    const deepPath = join(tmpDir, "deep", "nested", "project");
    mkdirSync(deepPath, { recursive: true });
    mgr.write(deepPath, { name: "Deep", createdAt: new Date().toISOString() });
    expect(mgr.read(deepPath)?.name).toBe("Deep");
  });

  it("update() merges partial patches", async () => {
    mgr.create(projectPath, "Original");
    await mgr.update(projectPath, { tynnToken: "tok-123" });
    const config = mgr.read(projectPath);
    expect(config?.name).toBe("Original"); // preserved
    expect(config?.tynnToken).toBe("tok-123"); // added
  });

  it("update() preserves unmodified fields", async () => {
    mgr.create(projectPath, "Test", { tynnToken: "keep-me" });
    await mgr.update(projectPath, { description: "Updated desc" });
    const config = mgr.read(projectPath);
    expect(config?.tynnToken).toBe("keep-me");
    expect(config?.description).toBe("Updated desc");
  });

  it("readHosting() returns null when no hosting", () => {
    mgr.create(projectPath, "No Hosting");
    expect(mgr.readHosting(projectPath)).toBeNull();
  });

  it("updateHosting() creates hosting if absent", async () => {
    mgr.create(projectPath, "Before Hosting");
    await mgr.updateHosting(projectPath, {
      enabled: true,
      type: "web-app",
      hostname: "test-host",
    });
    const hosting = mgr.readHosting(projectPath);
    expect(hosting?.enabled).toBe(true);
    expect(hosting?.type).toBe("web-app");
  });

  it("addStack() appends to stacks array", async () => {
    mgr.create(projectPath, "Stack Test");
    await mgr.updateHosting(projectPath, { enabled: true, type: "web-app", hostname: "test" });
    await mgr.addStack(projectPath, { stackId: "stack-node-app", addedAt: "2026-04-01T00:00:00Z" });
    const stacks = mgr.getStacks(projectPath);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.stackId).toBe("stack-node-app");
  });

  it("removeStack() filters correctly", async () => {
    mgr.create(projectPath, "Stack Test");
    await mgr.updateHosting(projectPath, { enabled: true, type: "web-app", hostname: "test" });
    await mgr.addStack(projectPath, { stackId: "stack-a", addedAt: "2026-04-01T00:00:00Z" });
    await mgr.addStack(projectPath, { stackId: "stack-b", addedAt: "2026-04-02T00:00:00Z" });
    expect(mgr.getStacks(projectPath)).toHaveLength(2);

    await mgr.removeStack(projectPath, "stack-a");
    const remaining = mgr.getStacks(projectPath);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.stackId).toBe("stack-b");
  });

  it("onChange emits on write", () => {
    const events: Array<{ projectPath: string; changedKeys: string[] }> = [];
    mgr.on("changed", (e) => events.push(e));

    mgr.create(projectPath, "Event Test");
    expect(events).toHaveLength(1);
    expect(events[0]?.changedKeys).toContain("name");
  });

  it("onChange emits on update", async () => {
    mgr.create(projectPath, "Event Test");
    const events: Array<{ projectPath: string; changedKeys: string[] }> = [];
    mgr.on("changed", (e) => events.push(e));

    await mgr.update(projectPath, { description: "New desc" });
    expect(events).toHaveLength(1);
    expect(events[0]?.changedKeys).toContain("description");
  });

  it("exists() returns true for existing config", () => {
    expect(mgr.exists(projectPath)).toBe(false);
    mgr.create(projectPath, "Test");
    expect(mgr.exists(projectPath)).toBe(true);
  });

  it("create() with options sets all fields", () => {
    const config = mgr.create(projectPath, "Full", {
      tynnToken: "tok",
      category: "web",
      type: "web-app",
      description: "A web app",
    });
    expect(config.name).toBe("Full");
    expect(config.tynnToken).toBe("tok");
    expect(config.category).toBe("web");
    expect(config.type).toBe("web-app");
    expect(config.description).toBe("A web app");
  });

  // -------------------------------------------------------------------------
  // s130 phase B (t515 slice 3) — provisionRepos()
  // -------------------------------------------------------------------------

  describe("provisionRepos", () => {
    it("returns null when no project config exists", () => {
      const result = mgr.provisionRepos(projectPath);
      expect(result).toBeNull();
    });

    it("returns null when config has no repos[] field", () => {
      mgr.create(projectPath, "Single-repo");
      const result = mgr.provisionRepos(projectPath);
      expect(result).toBeNull();
    });

    it("clones repos via the injected cloneFn when repos[] is populated", async () => {
      mgr.create(projectPath, "Multi-repo");
      await mgr.update(projectPath, {
        repos: [
          { name: "web", url: "https://example.com/web.git", writable: false },
          { name: "api", url: "https://example.com/api.git", writable: false, branch: "dev" },
        ],
      });

      const calls: Array<{ url: string; targetDir: string; branch?: string }> = [];
      const cloneFn = (url: string, targetDir: string, branch?: string) => {
        calls.push({ url, targetDir, branch });
        return { ok: true };
      };

      const result = mgr.provisionRepos(projectPath, { cloneFn });
      expect(result).not.toBeNull();
      expect(result?.provisioned).toBe(2);
      expect(calls).toHaveLength(2);
      expect(calls[0]?.url).toBe("https://example.com/web.git");
      expect(calls[1]?.branch).toBe("dev");
    });

    it("skips repos whose target dirs already exist (idempotent)", async () => {
      mgr.create(projectPath, "Idempotent");
      await mgr.update(projectPath, {
        repos: [{ name: "web", url: "https://example.com/web.git", writable: false }],
      });

      let cloneCount = 0;
      const cloneFn = (_url: string, targetDir: string) => {
        cloneCount += 1;
        mkdirSync(targetDir, { recursive: true });
        return { ok: true };
      };
      const r1 = mgr.provisionRepos(projectPath, { cloneFn });
      expect(r1?.provisioned).toBe(1);
      expect(cloneCount).toBe(1);

      const r2 = mgr.provisionRepos(projectPath, { cloneFn });
      expect(r2?.skipped).toBe(1);
      expect(cloneCount).toBe(1);
    });

    it("captures clone errors per-repo without aborting the run", async () => {
      mgr.create(projectPath, "Errors");
      await mgr.update(projectPath, {
        repos: [
          { name: "good", url: "https://example.com/good.git", writable: false },
          { name: "bad", url: "https://example.com/bad.git", writable: false },
        ],
      });

      const cloneFn = (url: string) => {
        if (url.includes("bad")) return { ok: false, error: "fatal" };
        return { ok: true };
      };
      const result = mgr.provisionRepos(projectPath, { cloneFn });
      expect(result?.provisioned).toBe(1);
      expect(result?.errors).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // CHN-D (s165) slice 2 — channel-room binding CRUD helpers
  // -------------------------------------------------------------------------
  describe("channel-room bindings (CHN-D)", () => {
    beforeEach(() => {
      mgr.create(projectPath, "Channels Test Project");
    });

    it("listRoomBindings returns empty array when no bindings", () => {
      expect(mgr.listRoomBindings(projectPath)).toEqual([]);
    });

    it("addRoomBinding persists a new binding", async () => {
      const cfg = await mgr.addRoomBinding(projectPath, {
        channelId: "discord",
        roomId: "12345",
        label: "#general",
        kind: "channel",
        privacy: "public",
        boundAt: "2026-05-14T12:00:00Z",
      });
      expect(cfg.rooms).toHaveLength(1);
      expect(cfg.rooms?.[0]?.channelId).toBe("discord");
      expect(mgr.listRoomBindings(projectPath)).toHaveLength(1);
    });

    it("addRoomBinding rejects a duplicate (channelId, roomId) pair", async () => {
      await mgr.addRoomBinding(projectPath, {
        channelId: "discord",
        roomId: "12345",
        boundAt: "2026-05-14T12:00:00Z",
      });
      await expect(
        mgr.addRoomBinding(projectPath, {
          channelId: "discord",
          roomId: "12345",
          boundAt: "2026-05-14T12:01:00Z",
        }),
      ).rejects.toThrow(/already exists/);
    });

    it("addRoomBinding allows same roomId under different channels", async () => {
      await mgr.addRoomBinding(projectPath, {
        channelId: "discord",
        roomId: "general",
        boundAt: "2026-05-14T12:00:00Z",
      });
      const cfg = await mgr.addRoomBinding(projectPath, {
        channelId: "slack",
        roomId: "general",
        boundAt: "2026-05-14T12:00:00Z",
      });
      expect(cfg.rooms).toHaveLength(2);
    });

    it("removeRoomBinding removes the matching entry", async () => {
      await mgr.addRoomBinding(projectPath, {
        channelId: "discord",
        roomId: "a",
        boundAt: "2026-05-14T12:00:00Z",
      });
      await mgr.addRoomBinding(projectPath, {
        channelId: "discord",
        roomId: "b",
        boundAt: "2026-05-14T12:00:00Z",
      });
      const cfg = await mgr.removeRoomBinding(projectPath, "discord", "a");
      expect(cfg.rooms).toHaveLength(1);
      expect(cfg.rooms?.[0]?.roomId).toBe("b");
    });

    it("removeRoomBinding throws when the binding doesn't exist", async () => {
      await expect(
        mgr.removeRoomBinding(projectPath, "discord", "nonexistent"),
      ).rejects.toThrow(/not found/);
    });

    it("addRoomBinding on a nonexistent project throws", async () => {
      const ghost = join(tmpDir, "no-such-project");
      mkdirSync(ghost, { recursive: true });
      await expect(
        mgr.addRoomBinding(ghost, {
          channelId: "discord",
          roomId: "x",
          boundAt: "2026-05-14T12:00:00Z",
        }),
      ).rejects.toThrow(/not found/);
    });

    it("survives a round-trip read-modify-write (binding persists in JSON)", async () => {
      await mgr.addRoomBinding(projectPath, {
        channelId: "telegram",
        roomId: "@myroom",
        label: "My Room",
        boundAt: "2026-05-14T12:00:00Z",
      });
      const raw = readFileSync(join(projectPath, "project.json"), "utf-8");
      expect(raw).toContain("telegram");
      expect(raw).toContain("@myroom");
      // Re-read via a fresh manager to confirm persistence is via the file
      const mgr2 = new ProjectConfigManager();
      expect(mgr2.listRoomBindings(projectPath)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // CHN-C (s164) slice 1 — findProjectByRoom dispatcher primitive
  // -------------------------------------------------------------------------
  describe("findProjectByRoom (CHN-C)", () => {
    let projectA: string;
    let projectB: string;

    beforeEach(async () => {
      projectA = join(tmpDir, "proj-a");
      projectB = join(tmpDir, "proj-b");
      mkdirSync(projectA, { recursive: true });
      mkdirSync(projectB, { recursive: true });
      mgr.create(projectA, "Project A");
      mgr.create(projectB, "Project B");
      await mgr.addRoomBinding(projectA, {
        channelId: "discord",
        roomId: "guild-1:channel-1",
        label: "#general",
        boundAt: "2026-05-14T12:00:00Z",
      });
      await mgr.addRoomBinding(projectB, {
        channelId: "telegram",
        roomId: "@channel-2",
        boundAt: "2026-05-14T12:00:00Z",
      });
    });

    it("returns the project + binding for a matching (channelId, roomId)", () => {
      const result = mgr.findProjectByRoom("discord", "guild-1:channel-1", [projectA, projectB]);
      expect(result).not.toBeNull();
      expect(result?.projectPath).toBe(projectA);
      expect(result?.binding.label).toBe("#general");
    });

    it("matches across multiple candidates (returns project B for telegram)", () => {
      const result = mgr.findProjectByRoom("telegram", "@channel-2", [projectA, projectB]);
      expect(result?.projectPath).toBe(projectB);
    });

    it("returns null when no project binds the room", () => {
      const result = mgr.findProjectByRoom("slack", "C9999", [projectA, projectB]);
      expect(result).toBeNull();
    });

    it("returns null when channelId matches but roomId doesn't", () => {
      const result = mgr.findProjectByRoom("discord", "wrong-id", [projectA, projectB]);
      expect(result).toBeNull();
    });

    it("skips candidates whose project.json doesn't exist or is invalid", () => {
      const ghost = join(tmpDir, "no-such-project");
      const result = mgr.findProjectByRoom("discord", "guild-1:channel-1", [ghost, projectA]);
      expect(result?.projectPath).toBe(projectA);
    });

    it("returns null on empty candidate list", () => {
      const result = mgr.findProjectByRoom("discord", "anything", []);
      expect(result).toBeNull();
    });

    it("first-match-wins when two candidates bind the same room (shouldn't happen but is graceful)", async () => {
      // Force a duplicate across projects (schema doesn't enforce cross-
      // project uniqueness, only within-project)
      await mgr.addRoomBinding(projectB, {
        channelId: "discord",
        roomId: "guild-1:channel-1",
        boundAt: "2026-05-14T12:01:00Z",
      });
      const result = mgr.findProjectByRoom("discord", "guild-1:channel-1", [projectA, projectB]);
      // Candidate order determines winner
      expect(result?.projectPath).toBe(projectA);
      const reversed = mgr.findProjectByRoom("discord", "guild-1:channel-1", [projectB, projectA]);
      expect(reversed?.projectPath).toBe(projectB);
    });
  });
});
