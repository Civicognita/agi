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

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pcm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    agiDir = join(tmpDir, ".agi");
    mkdirSync(agiDir, { recursive: true });
    // Override HOME so projectConfigPath resolves to our temp dir
    process.env.HOME = tmpDir;
    mgr = new ProjectConfigManager();
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  const projectPath = "/test/my-project";

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
    // Manually add a plugin key
    const slug = projectPath.replace(/^\//, "").replace(/\//g, "-");
    const filePath = join(agiDir, slug, "project.json");
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    data.customPlugin = { setting: true };
    writeFileSync(filePath, JSON.stringify(data));

    const config = mgr.read(projectPath);
    expect((config as Record<string, unknown>).customPlugin).toEqual({ setting: true });
  });

  it("write() creates parent directories", () => {
    const deepPath = "/deep/nested/project";
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
});
