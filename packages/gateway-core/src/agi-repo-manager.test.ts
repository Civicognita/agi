/**
 * agi-repo-manager tests — Slice 0 hardening (story #207).
 * Pure-logic + real git via spawnSync; runs in the VM.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  getAgiRepoStatus, initAgiRepo, importAgiRepo,
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

describe("initAgiRepo — chats + dev-env MCP config excluded from the envelope", () => {
  it("writes a .gitignore that excludes the knowledge chat dir, sandbox, .trash, and MCP config", () => {
    const proj = join(tmp, "init-me");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "project.json"), "{}", "utf-8");

    const result = initAgiRepo(proj);
    expect(result.ok).toBe(true);

    const gitignore = readFileSync(join(proj, ".gitignore"), "utf-8");
    const lines = gitignore.split("\n");
    expect(gitignore).toContain(`${KNOWLEDGE_DIR}/chat/`);
    expect(gitignore).toContain(`${KNOWLEDGE_DIR}/memory/`);
    expect(gitignore).toContain("sandbox/");
    expect(gitignore).toContain(".trash/");
    // MCP config is unique per dev (Tynn token + per-session Genie URL) — a shared
    // envelope must never carry it. Exact-line match so a substring can't pass.
    expect(lines).toContain(".mcp.json");
    expect(lines).toContain(".cursor/mcp.json");
    // The envelope itself became a git repo.
    expect(existsSync(join(proj, ".git"))).toBe(true);
  });
});

describe("config-state engine (Slice 1, story #207)", () => {
  it("agiRemoteName derives {slug}.agi and is idempotent", () => {
    expect(agiRemoteName("/x/civicognita_web")).toBe("civicognita_web.agi");
    expect(agiRemoteName("/x/foo.agi")).toBe("foo.agi");
  });

  it("agiRemoteName strips LEADING underscores (collection dirs), keeps internal ones", () => {
    // The workspace collection dir is `_aionima` (underscore-prefixed to hide it
    // from hosting discovery), but the envelope slug/remote is `aionima.agi`.
    expect(agiRemoteName("/x/_aionima")).toBe("aionima.agi");
    expect(agiRemoteName("/x/__aionima")).toBe("aionima.agi");
    // internal underscores are part of the name and must be preserved
    expect(agiRemoteName("/x/civicognita_web")).toBe("civicognita_web.agi");
    expect(agiRemoteName("/x/_my_workspace")).toBe("my_workspace.agi");
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

describe("importAgiRepo — adopt existing repos/ clones as submodules (Dev-Mode provisioning op)", () => {
  function initFakeFork(collectionDir: string, name: string, originUrl: string): void {
    const dir = join(collectionDir, "repos", name);
    mkdirSync(dir, { recursive: true });
    const g = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    g(["init", "-q"]);
    g(["remote", "add", "origin", originUrl]);
    writeFileSync(join(dir, "README.md"), `# ${name}\n`);
    g(["add", "-A"]);
    g(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  }

  it("inits the envelope and registers each repos/<name> as a submodule from its origin", () => {
    const proj = join(tmp, "_aionima");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "project.json"), "{}\n");
    initFakeFork(proj, "agi", "https://github.com/wishborn/agi.git");
    initFakeFork(proj, "prime", "https://github.com/wishborn/aionima.git");

    const res = importAgiRepo(proj);
    expect(res.ok).toBe(true);
    expect(res.initialized).toBe(true);
    expect([...(res.registered ?? [])].sort()).toEqual(["repos/agi", "repos/prime"]);

    const status = getAgiRepoStatus(proj);
    expect(status.initialized).toBe(true);
    expect([...status.submodules].sort()).toEqual(["repos/agi", "repos/prime"]);
    expect(status.unregisteredRepos).toEqual([]);

    const mods = readFileSync(join(proj, ".gitmodules"), "utf-8");
    expect(mods).toContain("url = https://github.com/wishborn/agi.git");
    expect(mods).toContain("url = https://github.com/wishborn/aionima.git");
  });
})
