/**
 * chat-persistence tests — focused on the s130 t518 slice 2 dual-write
 * + dual-delete behavior. Pre-existing save/load/list/delete behavior
 * (single-location) is exercised indirectly by every other test in
 * the suite; this file targets the s130-specific routing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatPersistence, type PersistedChatSession } from "./chat-persistence.js";

describe("ChatPersistence — s130 t518 slice 2 dual-write/delete", () => {
  let tmpRoot: string;
  let globalDir: string;
  let migratedProjectPath: string;
  let unmigratedProjectPath: string;
  let store: ChatPersistence;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `chat-pers-${String(Date.now())}-${String(Math.random()).slice(2)}`);
    globalDir = join(tmpRoot, "global-chat");
    migratedProjectPath = join(tmpRoot, "migrated-project");
    unmigratedProjectPath = join(tmpRoot, "unmigrated-project");

    mkdirSync(globalDir, { recursive: true });
    mkdirSync(migratedProjectPath, { recursive: true });
    mkdirSync(unmigratedProjectPath, { recursive: true });
    // Mark the migrated project as s130-layout by creating .agi/
    mkdirSync(join(migratedProjectPath, ".agi"), { recursive: true });

    store = new ChatPersistence(globalDir);
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeSession(id: string, context: string): PersistedChatSession {
    return {
      id,
      context,
      contextLabel: context,
      createdAt: "2026-04-29T00:00:00Z",
      updatedAt: "2026-04-29T00:00:00Z",
      messages: [],
      lastPreview: "",
    };
  }

  describe("save dual-write", () => {
    it("writes to global only when context is empty", () => {
      const session = makeSession("s1", "");
      store.save(session);

      expect(existsSync(join(globalDir, "s1.json"))).toBe(true);
      // No per-project dir was implicated; nothing to assert there.
    });

    it("writes to global only when project is NOT s130-migrated (no .agi/)", () => {
      const session = makeSession("s2", unmigratedProjectPath);
      store.save(session);

      expect(existsSync(join(globalDir, "s2.json"))).toBe(true);
      expect(existsSync(join(unmigratedProjectPath, "k", "chat", "s2.json"))).toBe(false);
    });

    it("writes to BOTH global and per-project when project IS s130-migrated", () => {
      const session = makeSession("s3", migratedProjectPath);
      store.save(session);

      expect(existsSync(join(globalDir, "s3.json"))).toBe(true);
      expect(existsSync(join(migratedProjectPath, "k", "chat", "s3.json"))).toBe(true);
      // Both copies should be identical.
      const g = readFileSync(join(globalDir, "s3.json"), "utf-8");
      const p = readFileSync(join(migratedProjectPath, "k", "chat", "s3.json"), "utf-8");
      expect(g).toBe(p);
    });

    it("creates the per-project chat dir if missing", () => {
      const projectChatDir = join(migratedProjectPath, "k", "chat");
      expect(existsSync(projectChatDir)).toBe(false);

      store.save(makeSession("s4", migratedProjectPath));

      expect(existsSync(projectChatDir)).toBe(true);
      expect(existsSync(join(projectChatDir, "s4.json"))).toBe(true);
    });

    it("doesn't fail when per-project write fails — global write still succeeds", () => {
      // Simulate write failure by pointing the project context at a
      // path that has .agi/ but is otherwise a file (mkdirSync inside
      // would fail). Simplest: make k/ a regular file.
      const breakProject = join(tmpRoot, "broken-project");
      mkdirSync(join(breakProject, ".agi"), { recursive: true });
      writeFileSync(join(breakProject, "k"), "not-a-dir", "utf-8");

      // This should not throw.
      expect(() => {
        store.save(makeSession("s5", breakProject));
      }).not.toThrow();
      // Global write still landed.
      expect(existsSync(join(globalDir, "s5.json"))).toBe(true);
    });
  });

  describe("delete dual-delete", () => {
    it("deletes from global only when session has no project context", () => {
      store.save(makeSession("d1", ""));
      expect(existsSync(join(globalDir, "d1.json"))).toBe(true);

      const result = store.delete("d1");
      expect(result).toBe(true);
      expect(existsSync(join(globalDir, "d1.json"))).toBe(false);
    });

    it("deletes from BOTH locations when session has s130-migrated context", () => {
      store.save(makeSession("d2", migratedProjectPath));
      expect(existsSync(join(globalDir, "d2.json"))).toBe(true);
      expect(existsSync(join(migratedProjectPath, "k", "chat", "d2.json"))).toBe(true);

      const result = store.delete("d2");
      expect(result).toBe(true);
      expect(existsSync(join(globalDir, "d2.json"))).toBe(false);
      expect(existsSync(join(migratedProjectPath, "k", "chat", "d2.json"))).toBe(false);
    });

    it("returns true when at least one location was deleted", () => {
      // Create only the global copy (simulate pre-slice-2 session).
      writeFileSync(join(globalDir, "d3.json"), JSON.stringify(makeSession("d3", "")), "utf-8");

      const result = store.delete("d3");
      expect(result).toBe(true);
      expect(existsSync(join(globalDir, "d3.json"))).toBe(false);
    });

    it("returns false when nothing existed to delete", () => {
      const result = store.delete("nonexistent");
      expect(result).toBe(false);
    });

    it("survives delete failures gracefully (non-fatal)", () => {
      // Save a session with a migrated context, then corrupt the
      // global file so JSON.parse fails — delete should still try to
      // unlink both locations.
      store.save(makeSession("d4", migratedProjectPath));
      writeFileSync(join(globalDir, "d4.json"), "{not valid json}", "utf-8");

      const result = store.delete("d4");
      expect(result).toBe(true); // global unlinked
      // Per-project copy may or may not be deleted depending on whether
      // we could read the context; either way, we don't crash.
    });
  });

  describe("list with additionalDirs (s130 t521 reader flip slice)", () => {
    it("returns global sessions when no additionalDirs passed (legacy)", () => {
      store.save(makeSession("g1", ""));
      store.save(makeSession("g2", ""));
      const summaries = store.list();
      expect(summaries.map((s) => s.id).sort()).toEqual(["g1", "g2"]);
    });

    it("combines global dir + per-project additional dirs", () => {
      // Global session
      store.save(makeSession("global-1", ""));
      // Per-project session — write directly into the migrated project's k/chat/
      const projChat = join(migratedProjectPath, "k", "chat");
      mkdirSync(projChat, { recursive: true });
      writeFileSync(
        join(projChat, "p1.json"),
        JSON.stringify(makeSession("p1", migratedProjectPath)),
        "utf-8",
      );

      const summaries = store.list([projChat]);
      expect(summaries.map((s) => s.id).sort()).toEqual(["global-1", "p1"]);
    });

    it("deduplicates sessions present in both locations, preferring most recent", () => {
      // Old version in global
      const oldSession = makeSession("d1", migratedProjectPath);
      oldSession.updatedAt = "2026-04-29T01:00:00Z";
      writeFileSync(join(globalDir, "d1.json"), JSON.stringify(oldSession), "utf-8");

      // Newer version in per-project
      const projChat = join(migratedProjectPath, "k", "chat");
      mkdirSync(projChat, { recursive: true });
      const newSession = { ...oldSession, updatedAt: "2026-04-29T02:00:00Z", lastPreview: "newer" };
      writeFileSync(join(projChat, "d1.json"), JSON.stringify(newSession), "utf-8");

      const summaries = store.list([projChat]);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.updatedAt).toBe("2026-04-29T02:00:00Z");
      expect(summaries[0]?.lastPreview).toBe("newer");
    });

    it("silently skips additionalDirs that don't exist", () => {
      store.save(makeSession("only-global", ""));
      const summaries = store.list([
        "/nonexistent/dir1",
        "/nonexistent/dir2",
      ]);
      expect(summaries.map((s) => s.id)).toEqual(["only-global"]);
    });

    it("sorts combined list by updatedAt descending", () => {
      const oldS = { ...makeSession("old", ""), updatedAt: "2026-04-29T01:00:00Z" };
      const newS = { ...makeSession("new", ""), updatedAt: "2026-04-29T03:00:00Z" };
      const midS = { ...makeSession("mid", ""), updatedAt: "2026-04-29T02:00:00Z" };
      writeFileSync(join(globalDir, "old.json"), JSON.stringify(oldS), "utf-8");
      writeFileSync(join(globalDir, "new.json"), JSON.stringify(newS), "utf-8");
      writeFileSync(join(globalDir, "mid.json"), JSON.stringify(midS), "utf-8");

      const summaries = store.list();
      expect(summaries.map((s) => s.id)).toEqual(["new", "mid", "old"]);
    });
  });
});
