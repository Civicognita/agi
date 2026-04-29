import { describe, expect, it } from "vitest";
import { assembleSystemPrompt, type SystemPromptContext } from "./system-prompt.js";

/**
 * system-prompt — ops-mode preamble (s126 t484).
 *
 * The system prompt should inject "## Ops Mode Active" with the cross-project
 * authority + named ops tools when (and only when) `projectCategory` is `ops`
 * or `administration`. Mirrors the `requiresProjectCategory` tool gate in
 * computeAvailableTools so the prompt and tool palette move in lock-step.
 */

const baseCtx: SystemPromptContext = {
  requestType: "project",
  entity: {
    entityId: "e0",
    coaAlias: "#E0",
    displayName: "Owner",
    verificationTier: "sealed",
    channel: "chat",
  },
  coaFingerprint: "#E0.#O0.$A0.test()<>$REG",
  state: "ONLINE",
  capabilities: { remoteOps: true, tynn: true, memory: true, deletions: true },
  tools: [],
  ownerName: "Glenn",
  isOwner: true,
  projectPath: "/tmp/proj",
};

const OPS_PREAMBLE_HEADING = "## Ops Mode Active";
const OPS_TOOLS = [
  "pm_list_all_tasks",
  "pm_bulk_update",
  "hosting_list_projects",
  "hosting_restart",
  "hosting_stop",
  "hosting_deploy",
  "stacks_list",
  "stacks_add",
];

describe("assembleSystemPrompt — ops-mode preamble (s126)", () => {
  it("injects the preamble when projectCategory is 'ops'", () => {
    const out = assembleSystemPrompt({ ...baseCtx, projectCategory: "ops" });
    expect(out).toContain(OPS_PREAMBLE_HEADING);
  });

  it("injects the preamble when projectCategory is 'administration'", () => {
    const out = assembleSystemPrompt({ ...baseCtx, projectCategory: "administration" });
    expect(out).toContain(OPS_PREAMBLE_HEADING);
  });

  it("names all 8 ops tools by their canonical name", () => {
    const out = assembleSystemPrompt({ ...baseCtx, projectCategory: "ops" });
    for (const toolName of OPS_TOOLS) {
      expect(out).toContain(toolName);
    }
  });

  it("mentions the COA audit chain (cross-project actions are logged)", () => {
    const out = assembleSystemPrompt({ ...baseCtx, projectCategory: "ops" });
    expect(out).toMatch(/COA-logged|audit chain/i);
  });

  it("omits the preamble when projectCategory is 'app'", () => {
    const out = assembleSystemPrompt({ ...baseCtx, projectCategory: "app" });
    expect(out).not.toContain(OPS_PREAMBLE_HEADING);
  });

  it("omits the preamble when projectCategory is 'literature'", () => {
    const out = assembleSystemPrompt({ ...baseCtx, projectCategory: "literature" });
    expect(out).not.toContain(OPS_PREAMBLE_HEADING);
  });

  it("omits the preamble when projectCategory is undefined", () => {
    const out = assembleSystemPrompt(baseCtx);
    expect(out).not.toContain(OPS_PREAMBLE_HEADING);
  });

  it("omits the preamble on chat requests even when projectCategory is 'ops'", () => {
    const out = assembleSystemPrompt({
      ...baseCtx,
      requestType: "chat",
      projectCategory: "ops",
    });
    expect(out).not.toContain(OPS_PREAMBLE_HEADING);
  });

  it("preamble appears AFTER the active-project section so the agent reads project context first", () => {
    const out = assembleSystemPrompt({ ...baseCtx, projectCategory: "ops" });
    const projectIdx = out.indexOf("## Active Project");
    const opsIdx = out.indexOf(OPS_PREAMBLE_HEADING);
    expect(projectIdx).toBeGreaterThanOrEqual(0);
    expect(opsIdx).toBeGreaterThan(projectIdx);
  });
});
