/**
 * WorkerRuntime — access-model regression guard.
 *
 * The change in this ship: workers used to run against a hardcoded 5-tool
 * mini-sandbox (read_file / write_file / list_files / search_files /
 * run_command). Now they use Aion's shared ToolRegistry filtered by the
 * worker's tier. This test locks that in: a worker given a registry with a
 * custom "git_status_stub" tool must see that tool in its tool set, not a
 * frozen 5-tool list.
 *
 * We don't drive a full LLM here — we stub the invoker and inspect what
 * tools got handed to it.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { WorkerRuntime } from "./worker-runtime.js";
import { ToolRegistry } from "./tool-registry.js";
import type { ToolManifestEntry } from "./system-prompt.js";
import type { LLMProvider } from "./llm/provider.js";

// Minimal mock LLM provider — records invocations and returns a no-tool-calls
// response to terminate the loop cleanly.
function makeMockLLMProvider(): {
  provider: LLMProvider;
  invocations: Array<{ tools: Array<{ name: string; description: string }> }>;
} {
  const invocations: Array<{ tools: Array<{ name: string; description: string }> }> = [];
  const provider: LLMProvider = {
    async invoke(params) {
      invocations.push({
        tools: (params.tools ?? []).map((t) => ({ name: t.name, description: t.description })),
      });
      return {
        text: "done",
        toolCalls: [],
        contentBlocks: [{ type: "text", text: "done" }],
        thinkingBlocks: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        model: params.model ?? "claude-sonnet-4-6",
        stopReason: "end_turn",
      };
    },
    async continueWithToolResults() {
      throw new Error("unexpected continueWithToolResults call — test invoker returns no tool calls");
    },
    async summarize() {
      throw new Error("unexpected summarize call in worker-runtime test");
    },
  };
  return { provider, invocations };
}

function makeManifest(name: string, overrides?: Partial<ToolManifestEntry>): ToolManifestEntry {
  return {
    name,
    description: `Tool ${name}`,
    requiresState: [],
    requiresTier: [],
    ...overrides,
  };
}

describe("WorkerRuntime — Aion tool-registry inheritance", () => {
  let registry: ToolRegistry;
  let mock: ReturnType<typeof makeMockLLMProvider>;

  beforeEach(() => {
    registry = new ToolRegistry();
    mock = makeMockLLMProvider();
  });

  it("surfaces registry-provided tools to the worker, not a hardcoded 5-tool list", async () => {
    // Register tools that the old sandbox never had.
    registry.register(makeManifest("git_status_stub"), () => "clean", { type: "object", properties: {} });
    registry.register(makeManifest("create_plan_stub"), () => "{}", { type: "object", properties: {} });

    const runtime = new WorkerRuntime(
      {
        autoApprove: false,
        maxConcurrentJobs: 3,
        workerTimeoutMs: 60_000,
        reportsDir: "/tmp/ignored",
        modelMap: { default: "claude-sonnet-4-6" },
        resourceId: "res-test",
        nodeId: "node-test",
        workerTier: "verified",
      },
      { llmProvider: mock.provider, toolRegistry: registry, getState: () => "ONLINE" },
    );

    // Drive runWorker directly via the internal method — we don't need the
    // dispatch file round-trip for this assertion.
    // @ts-expect-error — accessing private method for the test
    await runtime.runWorker(
      "job-test",
      { description: "noop", domain: "code", worker: "engineer", priority: "normal" },
      "coa-test",
      "/home/test/proj",
    );

    expect(mock.invocations).toHaveLength(1);
    const toolNames = mock.invocations[0]!.tools.map((t) => t.name).sort();
    expect(toolNames).toContain("git_status_stub");
    expect(toolNames).toContain("create_plan_stub");
    // The retired 5-tool mini-sandbox must not sneak back in.
    expect(toolNames).not.toContain("read_file");
    expect(toolNames).not.toContain("run_command");
  });

  it("hides agentOnly tools from workers (project/settings config is Aion's job)", async () => {
    registry.register(makeManifest("manage_project_stub", { agentOnly: true }), () => "ok", { type: "object" });
    registry.register(makeManifest("grep_search_stub"), () => "ok", { type: "object" });

    const runtime = new WorkerRuntime(
      {
        autoApprove: false,
        maxConcurrentJobs: 3,
        workerTimeoutMs: 60_000,
        reportsDir: "/tmp/ignored",
        modelMap: { default: "claude-sonnet-4-6" },
        resourceId: "res-test",
        nodeId: "node-test",
        workerTier: "verified",
      },
      { llmProvider: mock.provider, toolRegistry: registry, getState: () => "ONLINE" },
    );

    // @ts-expect-error — accessing private method for the test
    await runtime.runWorker(
      "job-agentonly",
      { description: "noop", domain: "code", worker: "engineer", priority: "normal" },
      "coa-agentonly",
      "/home/test/proj",
    );

    const names = mock.invocations[0]!.tools.map((t) => t.name);
    expect(names).toContain("grep_search_stub");
    expect(names).not.toContain("manage_project_stub");
  });

  it("fails cleanly when no tool registry is bound (no silent sandbox fallback)", async () => {
    const runtime = new WorkerRuntime(
      {
        autoApprove: false,
        maxConcurrentJobs: 3,
        workerTimeoutMs: 60_000,
        reportsDir: "/tmp/ignored",
        modelMap: { default: "claude-sonnet-4-6" },
      },
      { llmProvider: mock.provider, getState: () => "ONLINE" },
    );

    // @ts-expect-error — accessing private method for the test
    const result = await runtime.runWorker(
      "job-noreg",
      { description: "noop", domain: "code", worker: "engineer", priority: "normal" },
      "coa-noreg",
      "/home/test/proj",
    );

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toMatch(/ToolRegistry/);
    // Never called the LLM — if the registry is missing we don't even open a
    // request.
    expect(mock.invocations).toHaveLength(0);
  });
});
