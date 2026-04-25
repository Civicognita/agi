import { describe, expect, it } from "vitest";
import {
  assembleSystemPrompt,
  assembleSystemPromptWithBreakdown,
  estimateTokens,
  type SystemPromptContext,
} from "./system-prompt.js";

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
  capabilities: {
    remoteOps: true,
    tynn: true,
    memory: true,
    deletions: true,
  },
  tools: Array.from({ length: 25 }, (_, i) => ({
    name: `tool_${String(i)}`,
    description: `A reasonably descriptive tool description for tool number ${String(i)}, with enough text to mirror real manifest entries.`,
    requiresState: ["ONLINE"] as const,
    requiresTier: ["sealed"] as const,
  })).map((t) => ({ ...t, requiresState: [...t.requiresState], requiresTier: [...t.requiresTier] })),
  ownerName: "Glenn",
  isOwner: true,
  projectPath: "/tmp/proj",
  prime: {
    persona: "I am Aion.",
    purpose: "Help the owner.",
    topicIndex: { core: ["MPx", "COA"], gov: ["MINT", "0SCALE"] },
  },
};

describe("assembleSystemPrompt — costMode local trimming", () => {
  it("drops TASKMASTER, plan-workflow, knowledge-index, and uses compact response format", () => {
    const cloud = assembleSystemPrompt({ ...baseCtx, costMode: "balanced" });
    const local = assembleSystemPrompt({ ...baseCtx, costMode: "local" });

    expect(cloud).toContain("TASKMASTER");
    expect(local).not.toContain("TASKMASTER");

    expect(cloud).toContain("Plan Workflow");
    expect(local).not.toContain("Plan Workflow");

    expect(cloud).toContain("Capability discipline");
    expect(local).not.toContain("Capability discipline");
    expect(local).toContain("Response rules:");

    expect(local).toContain("tool_0");
    expect(local).toContain("Operational state: ONLINE");
    expect(local).toContain("Owner");

    expect(estimateTokens(local)).toBeLessThan(estimateTokens(cloud));
  });

  it("breakdown reflects the trimmed sections under local mode", () => {
    const cloud = assembleSystemPromptWithBreakdown({ ...baseCtx, costMode: "balanced" });
    const local = assembleSystemPromptWithBreakdown({ ...baseCtx, costMode: "local" });

    expect(local.breakdown.context).toBeLessThan(cloud.breakdown.context);
    expect(local.breakdown.identity).toBeLessThan(cloud.breakdown.identity);
    expect(local.prompt).not.toContain("TASKMASTER");
  });

  it("undefined or non-local costMode behaves like the previous default", () => {
    const noMode = assembleSystemPrompt({ ...baseCtx });
    const balanced = assembleSystemPrompt({ ...baseCtx, costMode: "balanced" });
    const max = assembleSystemPrompt({ ...baseCtx, costMode: "max" });

    expect(noMode).toEqual(balanced);
    expect(max).toEqual(balanced);
  });
});

describe("assembleSystemPrompt — toolsAvailable=false rendering (#326 option D)", () => {
  it("replaces the full tool list with a compact hint when no tools will be offered", () => {
    const withTools = assembleSystemPrompt({ ...baseCtx, toolsAvailable: true });
    const withoutTools = assembleSystemPrompt({ ...baseCtx, toolsAvailable: false });

    expect(withTools).toContain("Available tools:");
    expect(withTools).toContain("tool_0");
    expect(withTools).toContain("tool_5");

    expect(withoutTools).not.toContain("Available tools:");
    expect(withoutTools).not.toContain("- tool_0:");
    expect(withoutTools).toContain("Tools are not active on this turn");
    expect(withoutTools).toContain("do not invent tool calls");

    expect(estimateTokens(withoutTools)).toBeLessThan(estimateTokens(withTools));
  });

  it("undefined toolsAvailable preserves the prior full-list behavior", () => {
    const undef = assembleSystemPrompt({ ...baseCtx });
    const explicitTrue = assembleSystemPrompt({ ...baseCtx, toolsAvailable: true });
    expect(undef).toEqual(explicitTrue);
  });

  it("breakdown shrinks the identity slice when tools are hinted, not listed", () => {
    const withTools = assembleSystemPromptWithBreakdown({ ...baseCtx, toolsAvailable: true });
    const withoutTools = assembleSystemPromptWithBreakdown({ ...baseCtx, toolsAvailable: false });
    expect(withoutTools.breakdown.identity).toBeLessThan(withTools.breakdown.identity);
  });
});
