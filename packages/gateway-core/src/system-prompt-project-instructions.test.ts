/**
 * Project instructions (AGENTS.md/CLAUDE.md) + `.agi` envelope context —
 * additive context sections for the Aion Chat TUI's "launch folder as
 * container" model. Verified by exercising `assembleSystemPrompt` with a
 * tmpdir-staged project, same convention as
 * `system-prompt-project-architecture.test.ts`.
 *
 * Owner requirement: Aion's own system prompt/identity is never rewritten
 * by a project's docs — these are pure *context*, always additive, never
 * gated on dev mode (so an ad hoc, never-registered Chat TUI folder still
 * gets this context, not just registered projects in dev mode).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { assembleSystemPrompt, type SystemPromptContext } from "./system-prompt.js";

let project: string;

beforeEach(() => {
  project = join(tmpdir(), `prompt-instructions-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "project.json"), JSON.stringify({ name: "test-proj" }));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

function ctx(projectPath: string = project): SystemPromptContext {
  return {
    requestType: "project",
    entity: {
      entityId: "~$U0",
      coaAlias: "#E0",
      displayName: "Owner",
      verificationTier: "sealed",
      channel: "chat",
    },
    coaFingerprint: "#E0.#O0.$A0.test()<>$REG",
    state: "ONLINE",
    capabilities: { remoteOps: true, tynn: true, memory: true, deletions: true },
    tools: [],
    projectPath,
  };
}

describe("assembleSystemPrompt — project instructions (AGENTS.md/CLAUDE.md)", () => {
  it("includes AGENTS.md content as context, not identity, when present", () => {
    writeFileSync(join(project, "AGENTS.md"), "# Test Project Rules\n\nAlways run tests before committing.");
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).toContain("Project instructions (from AGENTS.md)");
    expect(prompt).toContain("Always run tests before committing.");
  });

  it("falls back to CLAUDE.md when AGENTS.md is absent", () => {
    writeFileSync(join(project, "CLAUDE.md"), "# Claude-flavored rules\n\nUse pnpm, not npm.");
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).toContain("Project instructions (from CLAUDE.md)");
    expect(prompt).toContain("Use pnpm, not npm.");
  });

  it("prefers AGENTS.md over CLAUDE.md when both exist", () => {
    writeFileSync(join(project, "AGENTS.md"), "AGENTS content");
    writeFileSync(join(project, "CLAUDE.md"), "CLAUDE content");
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).toContain("Project instructions (from AGENTS.md)");
    expect(prompt).not.toContain("Project instructions (from CLAUDE.md)");
  });

  it("truncates a long AGENTS.md with a marker", () => {
    writeFileSync(join(project, "AGENTS.md"), "x".repeat(1000));
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).toContain("[...truncated]");
  });

  it("omits the section entirely when neither file exists", () => {
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).not.toContain("Project instructions");
  });
});

describe("assembleSystemPrompt — .agi envelope detection", () => {
  it("detects an envelope at the project root and surfaces checkpoint.mdc's headline", () => {
    mkdirSync(join(project, ".ai", "plans", "_next"), { recursive: true });
    writeFileSync(
      join(project, ".ai", "plans", "_next", "checkpoint.mdc"),
      [
        "---",
        "activeFocus: \"Ship the widget\"",
        "lastShipped:",
        "  version: \"v1.2.3\"",
        "pendingQuestions: 2",
        "---",
        "",
        "body content",
      ].join("\n"),
    );
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).toContain(`.agi envelope detected at ${project}`);
    expect(prompt).toContain("Active focus: Ship the widget");
    expect(prompt).toContain("Last shipped: v1.2.3");
    expect(prompt).toContain("2 pending question(s)");
  });

  it("detects an envelope from a nested submodule folder (walk-up)", () => {
    mkdirSync(join(project, ".ai", "plans", "_next"), { recursive: true });
    writeFileSync(
      join(project, ".ai", "plans", "_next", "checkpoint.mdc"),
      ["---", "activeFocus: \"Nested detection works\"", "---", ""].join("\n"),
    );
    const nested = join(project, "repos", "agi");
    mkdirSync(nested, { recursive: true });
    const prompt = assembleSystemPrompt(ctx(nested));
    expect(prompt).toContain(`.agi envelope detected at ${project}`);
    expect(prompt).toContain("Active focus: Nested detection works");
  });

  it("says so when the envelope has no checkpoint.mdc yet", () => {
    mkdirSync(join(project, ".ai"), { recursive: true });
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).toContain("no checkpoint.mdc loop-state file yet");
  });

  it("detects no envelope when .ai/ is absent (plain project)", () => {
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).not.toContain(".agi envelope detected");
  });
});
