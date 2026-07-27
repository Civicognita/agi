/**
 * WorkerRuntime — Genie-agent execution mode.
 *
 * The change in this ship: workers no longer run against Taskmaster's own
 * in-process LLM tool-loop. They execute as a real coding agent (Claude
 * Code / Codex) via a paired Genie workspace's `runAgent` MCP tool, driven
 * through the shared `McpClient`. These tests stub `McpClient` and drive
 * `WorkerRuntime.runWorker()` directly (the private per-phase execution
 * step) to assert the state machine: no-mcpClient / no-paired-Genie fail
 * cleanly, a normal start→send→read→marker→stop round-trip completes, and
 * a worker that never emits the completion marker times out rather than
 * polling forever.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { WorkerRuntime } from "./worker-runtime.js";
import type { McpClient, McpToolCallResult } from "@agi/mcp-client";

const PROJECT_ROOT = "/home/test/proj";
const GENIE_SERVER_ID = "home-test-proj:genie";

type CallToolArgs = Record<string, unknown>;

function jsonResult(payload: Record<string, unknown>): McpToolCallResult {
  return { isError: false, content: [{ type: "text", text: JSON.stringify(payload) }] };
}

/** Minimal stub matching only what WorkerRuntime actually calls on McpClient:
 *  listServers() (to resolve/verify the paired Genie server) and callTool()
 *  (to drive runAgent). Cast to McpClient — the real class wraps the MCP SDK
 *  transport, which is out of scope for this unit test. */
function makeMockMcpClient(opts: {
  registered: boolean;
  onCallTool: (serverId: string, toolName: string, args: CallToolArgs) => McpToolCallResult;
}): { client: McpClient; calls: Array<{ toolName: string; args: CallToolArgs }> } {
  const calls: Array<{ toolName: string; args: CallToolArgs }> = [];
  const client = {
    listServers: () => (opts.registered ? [{ id: GENIE_SERVER_ID, name: "genie", state: "connected", transport: "http" }] : []),
    callTool: async (serverId: string, toolName: string, args: CallToolArgs) => {
      calls.push({ toolName, args });
      return opts.onCallTool(serverId, toolName, args);
    },
  };
  return { client: client as unknown as McpClient, calls };
}

function makeRuntime(
  mcpClient: McpClient | undefined,
  extraConfig: Partial<{ workerTimeoutMs: number; genieDonePollMs: number; autoApprove: boolean; stateDir: string }> = {},
) {
  return new WorkerRuntime(
    {
      autoApprove: false,
      maxConcurrentJobs: 3,
      workerTimeoutMs: 60_000,
      reportsDir: "/tmp/ignored",
      modelMap: { default: "claude-sonnet-4-6" },
      ...extraConfig,
    },
    { mcpClient },
  );
}

async function runWorker(runtime: WorkerRuntime) {
  // @ts-expect-error — accessing private method for the test
  return runtime.runWorker(
    "job-test",
    { description: "noop", domain: "code", worker: "engineer", priority: "normal" },
    "coa-test",
    PROJECT_ROOT,
  ) as Promise<{ status: string; text: string; errors: string[] }>;
}

describe("WorkerRuntime — Genie execution: failure paths", () => {
  it("fails cleanly when no McpClient is bound (no in-process fallback)", async () => {
    const runtime = makeRuntime(undefined);
    const result = await runWorker(runtime);
    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toMatch(/McpClient/);
  });

  it("fails cleanly when the project has no paired Genie workspace registered", async () => {
    const { client, calls } = makeMockMcpClient({ registered: false, onCallTool: () => jsonResult({}) });
    const runtime = makeRuntime(client);
    const result = await runWorker(runtime);
    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toMatch(/No paired Genie workspace/);
    expect(result.errors.join(" ")).toContain(GENIE_SERVER_ID);
    // Never even attempts runAgent when the server isn't registered.
    expect(calls).toHaveLength(0);
  });
});

describe("WorkerRuntime — Genie execution: happy path", () => {
  it("starts an agent, sends the task, polls until the done marker, then stops it", async () => {
    let reads = 0;
    const { client, calls } = makeMockMcpClient({
      registered: true,
      onCallTool: (_serverId, toolName, args) => {
        if (toolName !== "runAgent") throw new Error(`unexpected tool ${toolName}`);
        switch (args.action) {
          case "start":
            return jsonResult({ id: "agent-1", command: "claude" });
          case "send":
            return jsonResult({});
          case "read":
            reads++;
            // First poll: nothing yet. Second poll: the marker + summary.
            return reads === 1
              ? jsonResult({ output: "still working...\n", cursor: 10 })
              : jsonResult({ output: "<<<TASKMASTER_DONE>>>\nImplemented the thing.", cursor: 40 });
          case "stop":
            return jsonResult({});
          default:
            throw new Error(`unexpected action ${String(args.action)}`);
        }
      },
    });

    const runtime = makeRuntime(client, { genieDonePollMs: 1 });
    const result = await runWorker(runtime);

    expect(result.status).toBe("completed");
    expect(result.text).toContain("Implemented the thing.");

    const actions = calls.map((c) => c.args.action);
    expect(actions[0]).toBe("start");
    expect(actions[1]).toBe("send");
    expect(actions.filter((a) => a === "read").length).toBe(2);
    expect(actions.at(-1)).toBe("stop");
    // send delivers the resolved task prompt to the started agent id.
    expect(calls[1]!.args.id).toBe("agent-1");
    expect(String(calls[1]!.args.prompt)).toContain("noop");
  });
});

describe("WorkerRuntime — Genie execution: stalled worker", () => {
  it("times out rather than polling forever when the done marker never appears", async () => {
    const { client, calls } = makeMockMcpClient({
      registered: true,
      onCallTool: (_serverId, toolName, args) => {
        if (toolName !== "runAgent") throw new Error(`unexpected tool ${toolName}`);
        switch (args.action) {
          case "start":
            return jsonResult({ id: "agent-stalled" });
          case "send":
            return jsonResult({});
          case "read":
            return jsonResult({ output: "thinking forever...\n", cursor: 5 });
          case "stop":
            return jsonResult({});
          default:
            throw new Error(`unexpected action ${String(args.action)}`);
        }
      },
    });

    // Small timeout + small poll interval so the test exercises a handful of
    // real poll iterations without waiting on the production 4s interval.
    const runtime = makeRuntime(client, { workerTimeoutMs: 20, genieDonePollMs: 5 });
    const result = await runWorker(runtime);

    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toMatch(/did not emit/);
    // Cleans up the stalled agent's terminal even on timeout.
    expect(calls.at(-1)!.args.action).toBe("stop");
    expect(calls.at(-1)!.args.id).toBe("agent-stalled");
  });
});

describe("WorkerRuntime — checkpoint gate", () => {
  function makeInstantDoneMcpClient() {
    return makeMockMcpClient({
      registered: true,
      onCallTool: (_serverId, toolName, args) => {
        if (toolName !== "runAgent") throw new Error(`unexpected tool ${toolName}`);
        switch (args.action) {
          case "start":
            return jsonResult({ id: `agent-${String(args.cwd)}-${Math.random()}` });
          case "send":
          case "stop":
            return jsonResult({});
          case "read":
            return jsonResult({ output: "<<<TASKMASTER_DONE>>>\ndone.", cursor: 1 });
          default:
            throw new Error(`unexpected action ${String(args.action)}`);
        }
      },
    });
  }

  const PHASES = [
    { domain: "code", role: "engineer", phaseDescription: "design it", gate: "checkpoint" as const },
    { domain: "code", role: "hacker", phaseDescription: "build it", gate: "auto" as const },
  ];

  it("pauses after a checkpoint-gated phase instead of starting the next phase", async () => {
    const { client, calls } = makeInstantDoneMcpClient();
    const stateDir = mkdtempSync(join(tmpdir(), "agi-worker-runtime-test-"));
    const runtime = makeRuntime(client, { genieDonePollMs: 1, stateDir });

    // @ts-expect-error — accessing private method for the test
    const result = await runtime.executePhases(
      "job-checkpoint",
      { description: "noop", priority: "normal" },
      PHASES,
      "coa-test",
      PROJECT_ROOT,
    );

    expect(result.status).toBe("paused");
    // Only phase 0's agent ran — phase 1 never started.
    expect(calls.filter((c) => c.args.action === "start")).toHaveLength(1);
  });

  it("autoApprove skips the checkpoint pause and runs every phase in one call", async () => {
    const { client, calls } = makeInstantDoneMcpClient();
    const stateDir = mkdtempSync(join(tmpdir(), "agi-worker-runtime-test-"));
    const runtime = makeRuntime(client, { genieDonePollMs: 1, autoApprove: true, stateDir });

    // @ts-expect-error — accessing private method for the test
    const result = await runtime.executePhases(
      "job-autoapprove",
      { description: "noop", priority: "normal" },
      PHASES,
      "coa-test",
      PROJECT_ROOT,
    );

    expect(result.status).toBe("completed");
    expect(calls.filter((c) => c.args.action === "start")).toHaveLength(2);
  });
});
