/**
 * chat-history-migration tests — verifies project-scoped session
 * migration from global ~/.agi/chat-history/ to per-project
 * <projectPath>/k/chat/.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateChatSessionsForProject } from "./chat-history-migration.js";

describe("migrateChatSessionsForProject", () => {
  let tmpRoot: string;
  let projectPath: string;
  let globalChatDir: string;
  let projectChatDir: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `chat-mig-${String(Date.now())}-${String(Math.random()).slice(2)}`);
    projectPath = join(tmpRoot, "myproject");
    globalChatDir = join(tmpRoot, "agi-home", ".agi", "chat-history");
    projectChatDir = join(projectPath, "k", "chat");
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(globalChatDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeSession(id: string, context: string | undefined, dir: string = globalChatDir) {
    const session = {
      id,
      context,
      contextLabel: context ?? "global",
      createdAt: "2026-04-29T00:00:00Z",
      updatedAt: "2026-04-29T00:00:00Z",
      messages: [],
      lastPreview: "",
    };
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(session), "utf-8");
  }

  it("no-op when global chat dir doesn't exist", () => {
    rmSync(globalChatDir, { recursive: true, force: true });
    const result = migrateChatSessionsForProject(projectPath, {
      globalChatDir,
      projectChatDir,
    });
    expect(result.migrated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("no-op when global dir is empty", () => {
    const result = migrateChatSessionsForProject(projectPath, {
      globalChatDir,
      projectChatDir,
    });
    expect(result.migrated).toBe(0);
    expect(result.notMatching).toBe(0);
  });

  it("migrates sessions matching the project context", () => {
    writeSession("session-1", projectPath);
    writeSession("session-2", projectPath);

    const result = migrateChatSessionsForProject(projectPath, {
      globalChatDir,
      projectChatDir,
    });

    expect(result.migrated).toBe(2);
    expect(result.notMatching).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.migratedIds.sort()).toEqual(["session-1", "session-2"]);

    // Files should exist at the per-project location.
    expect(existsSync(join(projectChatDir, "session-1.json"))).toBe(true);
    expect(existsSync(join(projectChatDir, "session-2.json"))).toBe(true);
    // Globals preserved (NOT deleted).
    expect(existsSync(join(globalChatDir, "session-1.json"))).toBe(true);
    expect(existsSync(join(globalChatDir, "session-2.json"))).toBe(true);
  });

  it("skips sessions whose context is a different project", () => {
    writeSession("for-me", projectPath);
    writeSession("for-other", join(tmpRoot, "different-project"));

    const result = migrateChatSessionsForProject(projectPath, {
      globalChatDir,
      projectChatDir,
    });

    expect(result.migrated).toBe(1);
    expect(result.notMatching).toBe(1);
    expect(result.migratedIds).toEqual(["for-me"]);
    expect(existsSync(join(projectChatDir, "for-other.json"))).toBe(false);
  });

  it("skips sessions with no context (global sessions)", () => {
    writeSession("global-1", undefined);
    writeSession("global-2", undefined);

    const result = migrateChatSessionsForProject(projectPath, {
      globalChatDir,
      projectChatDir,
    });

    expect(result.migrated).toBe(0);
    expect(result.notMatching).toBe(2);
  });

  it("is idempotent — second call skips already-migrated sessions", () => {
    writeSession("session-1", projectPath);

    const r1 = migrateChatSessionsForProject(projectPath, {
      globalChatDir,
      projectChatDir,
    });
    expect(r1.migrated).toBe(1);

    const r2 = migrateChatSessionsForProject(projectPath, {
      globalChatDir,
      projectChatDir,
    });
    expect(r2.migrated).toBe(0);
    expect(r2.skipped).toBe(1);
  });

  it("records parse errors per-file, doesn't crash the run", () => {
    writeSession("good", projectPath);
    writeFileSync(join(globalChatDir, "corrupt.json"), "{not valid json}", "utf-8");

    const result = migrateChatSessionsForProject(projectPath, {
      globalChatDir,
      projectChatDir,
    });

    expect(result.migrated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.file).toBe("corrupt.json");
    expect(result.errors[0]?.reason).toMatch(/parse failed/);
  });

  it("creates the per-project chat dir if missing", () => {
    rmSync(projectChatDir, { recursive: true, force: true });
    expect(existsSync(projectChatDir)).toBe(false);

    writeSession("new-project", projectPath);
    migrateChatSessionsForProject(projectPath, {
      globalChatDir,
      projectChatDir,
    });

    expect(existsSync(projectChatDir)).toBe(true);
    expect(existsSync(join(projectChatDir, "new-project.json"))).toBe(true);
  });
});
