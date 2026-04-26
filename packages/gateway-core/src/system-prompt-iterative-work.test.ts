import { describe, expect, it } from "vitest";
import {
  assembleSystemPrompt,
  assembleSystemPromptWithBreakdown,
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
  capabilities: { remoteOps: true, tynn: true, memory: true, deletions: true },
  tools: [],
  ownerName: "Glenn",
  isOwner: true,
  projectPath: "/tmp/proj",
};

const FAKE_PROMPT = "Race-to-DONE / look-for-MORE / slice schema → infra → behavior → wiring → UI.";

describe("assembleSystemPrompt — iterative-work injection", () => {
  it("omits the section when iterativeWorkPrompt is undefined", () => {
    const out = assembleSystemPrompt(baseCtx);
    expect(out).not.toContain("ITERATIVE-WORK MODE");
    expect(out).not.toContain(FAKE_PROMPT);
  });

  it("injects the section when iterativeWorkPrompt is provided on a project request", () => {
    const out = assembleSystemPrompt({ ...baseCtx, iterativeWorkPrompt: FAKE_PROMPT });
    expect(out).toContain("## ITERATIVE-WORK MODE");
    expect(out).toContain(FAKE_PROMPT);
  });

  it("omits the section on non-project requests even when iterativeWorkPrompt is provided", () => {
    const chat = assembleSystemPrompt({ ...baseCtx, requestType: "chat", iterativeWorkPrompt: FAKE_PROMPT });
    const knowledge = assembleSystemPrompt({ ...baseCtx, requestType: "knowledge", iterativeWorkPrompt: FAKE_PROMPT });
    const entity = assembleSystemPrompt({ ...baseCtx, requestType: "entity", iterativeWorkPrompt: FAKE_PROMPT });

    expect(chat).not.toContain("ITERATIVE-WORK MODE");
    expect(knowledge).not.toContain("ITERATIVE-WORK MODE");
    expect(entity).not.toContain("ITERATIVE-WORK MODE");
  });

  it("treats empty-string prompt as not-injected (defends against truncated reads)", () => {
    const out = assembleSystemPrompt({ ...baseCtx, iterativeWorkPrompt: "" });
    expect(out).not.toContain("ITERATIVE-WORK MODE");
  });

  it("breakdown counts the injection under context (not identity)", () => {
    const without = assembleSystemPromptWithBreakdown(baseCtx);
    const withInj = assembleSystemPromptWithBreakdown({ ...baseCtx, iterativeWorkPrompt: FAKE_PROMPT });

    const contextDelta = withInj.breakdown.context - without.breakdown.context;
    const identityDelta = withInj.breakdown.identity - without.breakdown.identity;

    expect(contextDelta).toBeGreaterThan(20);
    expect(identityDelta).toBeLessThanOrEqual(1);
    expect(withInj.prompt).toContain(FAKE_PROMPT);
  });
});
