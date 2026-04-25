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
  tools: [
    { name: "tool_a", description: "A", requiresState: ["ONLINE"], requiresTier: ["sealed"] },
    { name: "tool_b", description: "B", requiresState: ["ONLINE"], requiresTier: ["sealed"] },
  ],
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

    expect(local).toContain("tool_a");
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
