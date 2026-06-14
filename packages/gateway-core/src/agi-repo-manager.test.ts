/**
 * agi-repo-manager tests — Slice 0 hardening (story #207).
 * Pure-logic + real git via spawnSync; runs in the VM.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  getAgiRepoStatus, initAgiRepo,
  agiRemoteName, classifyEnvelopePath, getAgiConfigState, setAgiRemote,
} from "./agi-repo-manager.js";
import { KNOWLEDGE_DIR } from "./project-config-path.js";

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `agi-repo-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("getAgiRepoStatus — never throws (no 500)", () => {
  it("returns the not-initialized shape for a gitless envelope", () => {
    const proj = join(tmp, "envelope");
    mkdirSync(join(proj, "repos"), { recursive: true });
    const status = getAgiRepoStatus(proj);
    expect(status.initialized).toBe(false);
    expect(status.submodules).toEqual([]);
    expect(Array.isArray(status.unregisteredRepos)).toBe(true);
  });

  it("degrades to not-initialized instead of throwing on a malformed .gitmodules", () => {
    const proj = join(tmp, "broken");
    mkdirSync(join(proj, ".git"), { recursive: true }); // looks initialized
    // A .gitmodules that's actually a directory would make readFileSync throw —
    // getAgiRepoStatus must swallow it, not 500.
    mkdirSync(join(proj, ".gitmodules"), { recursive: true });
    expect(() => getAgiRepoStatus(proj)).not.toThrow();
    expect(getAgiRepoStatus(proj).initialized).toBe(true);
  });

  it("returns a clean shape for a path that does not exist", () => {
    expect(() => getAgiRepoStatus(join(tmp, "nope"))).not.toThrow();
    expect(getAgiRepoStatus(join(tmp, "nope")).initialized).toBe(false);
  });
});

describe("initAgiRepo — chats excluded from the envelope", () => {
  it("writes a .gitignore that excludes the knowledge chat dir, sandbox and .trash", () => {
    const proj = join(tmp, "init-me");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "project.json"), "{}", "utf-8");

    const result = initAgiRepo(proj);
    expect(result.ok).toBe(true);

    const gitignore = readFileSync(join(proj, ".gitignore"), "utf-8");
    expect(gitignore).toContain(`${KNOWLEDGE_DIR}/chat/`);
    expect(gitignore).toContain(`${KNOWLEDGE_DIR}/memory/`);
    expect(gitignore).toContain("sandbox/");
    expect(gitignore).toContain(".trash/");
    // The envelope itself became a git repo.
    expect(existsSync(join(proj, ".git"))).toBe(true);
  });
});

describe("config-state engine (Slice 1, story #207)", () => {
  it("agiRemoteName derives {slug}.agi and is idempotent", () => {
    expect(agiRemoteName("/x/civicognita_web")).toBe("civicognita_web.agi");
    expect(agiRemoteName("/x/foo.agi")).toBe("foo.agi");
  });

  it("classifyEnvelopePath separates config / knowledge / submodule and EXCLUDES chats+scratch", () => {
    expect(classifyEnvelopePath("project.json")).toBe("config");
    expect(classifyEnvelopePath(".gitmodules")).toBe("config");
    expect(classifyEnvelopePath(`${KNOWLEDGE_DIR}/plans/p1.mdc`)).toBe("knowledge");
    expect(classifyEnvelopePath(`${KNOWLEDGE_DIR}/pm/tasks.jsonl`)).toBe("knowledge");
    expect(classifyEnvelopePath("repos/agi")).toBe("submodule");
    // Local-only runtime state never syncs (chats + memory + scratch).
    expect(classifyEnvelopePath(`${KNOWLEDGE_DIR}/chat/s1.json`)).toBe("excluded");
    expect(classifyEnvelopePath(`${KNOWLEDGE_DIR}/memory/m.md`)).toBe("excluded");
    expect(classifyEnvelopePath("sandbox/tmp.txt")).toBe("excluded");
    expect(classifyEnvelopePath(".trash/old")).toBe("excluded");
  });

  it("setAgiRemote validates the url and configures origin on a real repo", () => {
    const proj = join(tmp, "remote-me");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "project.json"), "{}", "utf-8");
    initAgiRepo(proj);

    expect(setAgiRemote(proj, "not a url").ok).toBe(false);
    expect(setAgiRemote(proj, "https://github.com/wishborn/remote-me.agi.git").ok).toBe(true);
    // Idempotent — set-url on re-run.
    expect(setAgiRemote(proj, "https://github.com/wishborn/remote-me.agi.git").ok).toBe(true);
  });

  it("getAgiConfigState never throws and reports no-remote cleanly", () => {
    const proj = join(tmp, "state");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "project.json"), "{}", "utf-8");
    initAgiRepo(proj);

    const state = getAgiConfigState(proj);
    expect(state.initialized).toBe(true);
    expect(state.hasRemote).toBe(false);
    expect(state.ahead).toBe(0);
    expect(state.behind).toBe(0);
    expect(Array.isArray(state.incoming)).toBe(true);
  });

  it("getAgiConfigState classifies a local change and excludes a chat file", () => {
    const proj = join(tmp, "state2");
    mkdirSync(join(proj, KNOWLEDGE_DIR, "plans"), { recursive: true });
    mkdirSync(join(proj, KNOWLEDGE_DIR, "chat"), { recursive: true });
    writeFileSync(join(proj, "project.json"), "{}", "utf-8");
    initAgiRepo(proj);
    // New knowledge file + a chat file (chat is gitignored → never staged).
    writeFileSync(join(proj, KNOWLEDGE_DIR, "plans", "new.mdc"), "x", "utf-8");
    writeFileSync(join(proj, KNOWLEDGE_DIR, "chat", "s.json"), "{}", "utf-8");

    const state = getAgiConfigState(proj);
    const paths = state.localChanges.map((c) => c.path);
    expect(state.localChanges.some((c) => c.kind === "knowledge")).toBe(true);
    expect(paths.some((p) => p.includes("chat/"))).toBe(false);
  });

  it("getAgiConfigState returns the clean base for a non-git dir", () => {
    const proj = join(tmp, "plain");
    mkdirSync(proj, { recursive: true });
    expect(() => getAgiConfigState(proj)).not.toThrow();
    expect(getAgiConfigState(proj).initialized).toBe(false);
  });
});
