/**
 * Project architecture tree in system prompt (s134 cycle 198).
 *
 * Owner directive 2026-05-11: "the existence of the project architecture
 * should be part of the compiled system prompt." Verified by exercising
 * assembleSystemPrompt with a tmpdir-staged project and asserting that
 * the compiled prompt contains the expected tree shape.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { assembleSystemPrompt, type SystemPromptContext } from "./system-prompt.js";

let project: string;

beforeEach(() => {
  project = join(tmpdir(), `prompt-arch-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(project, { recursive: true });
  // Owner-blessed shape: project root has only folders + project.json.
  writeFileSync(join(project, "project.json"), JSON.stringify({ name: "test-proj" }));
  mkdirSync(join(project, "k", "plans"), { recursive: true });
  mkdirSync(join(project, "k", "notes"), { recursive: true });
  mkdirSync(join(project, "repos", "agi"), { recursive: true });
  mkdirSync(join(project, "sandbox"), { recursive: true });
  mkdirSync(join(project, "node_modules"), { recursive: true }); // should be pruned
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

function ctx(): SystemPromptContext {
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
    projectPath: project,
  };
}

describe("assembleSystemPrompt — project architecture (s134 cycle 198)", () => {
  it("includes the Project Architecture heading when projectPath is set", () => {
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).toContain("Project Architecture");
  });

  it("renders project.json + folders at top-level", () => {
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).toContain("project.json");
    expect(prompt).toContain("k/");
    expect(prompt).toContain("repos/");
    expect(prompt).toContain("sandbox/");
  });

  it("expands k/ children", () => {
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).toContain("plans/");
    expect(prompt).toContain("notes/");
  });

  it("expands repos/ children one level deep", () => {
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).toContain("agi/");
  });

  it("prunes node_modules from the tree", () => {
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).not.toMatch(/[├└]── node_modules/);
  });

  it("includes root-write restriction note alongside the tree", () => {
    const prompt = assembleSystemPrompt(ctx());
    expect(prompt).toMatch(/restricted to .project\.json/i);
    expect(prompt).toContain("dir_create");
  });

  it("omits architecture section entirely when no projectPath", () => {
    const noProjectCtx: SystemPromptContext = { ...ctx(), requestType: "chat" };
    delete noProjectCtx.projectPath;
    const prompt = assembleSystemPrompt(noProjectCtx);
    expect(prompt).not.toContain("Project Architecture");
  });
});
