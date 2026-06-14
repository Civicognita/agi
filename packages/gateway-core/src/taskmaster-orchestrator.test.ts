import { describe, it, expect } from "vitest";
import { enforceChains } from "./taskmaster-orchestrator.js";
import type { WorkPhase, WorkerSummary } from "./taskmaster-orchestrator.js";

const ALL_WORKERS: WorkerSummary[] = [
  { domain: "code", role: "hacker",        name: "hacker",        description: "" },
  { domain: "code", role: "tester",        name: "tester",        description: "" },
  { domain: "code", role: "engineer",      name: "engineer",      description: "" },
  { domain: "comm", role: "writer.tech",   name: "writer-tech",   description: "" },
  { domain: "comm", role: "writer.policy", name: "writer-policy", description: "" },
  { domain: "comm", role: "editor",        name: "editor",        description: "" },
  { domain: "data", role: "modeler",       name: "modeler",       description: "" },
  { domain: "k",    role: "linguist",      name: "linguist",      description: "" },
  { domain: "strat", role: "planner",      name: "planner",       description: "" },
];

function phase(domain: string, role: string, gate: "auto" | "checkpoint" = "auto"): WorkPhase {
  return { domain, role, phaseDescription: `${domain}.${role} task`, gate };
}

describe("enforceChains", () => {
  it("injects tester after hacker when missing", () => {
    const input = [phase("code", "hacker")];
    const result = enforceChains(input, ALL_WORKERS);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ domain: "code", role: "tester" });
  });

  it("does NOT inject tester if already follows hacker", () => {
    const input = [phase("code", "hacker"), phase("code", "tester")];
    const result = enforceChains(input, ALL_WORKERS);
    expect(result).toHaveLength(2);
  });

  it("injects editor after writer.tech", () => {
    const input = [phase("comm", "writer.tech")];
    const result = enforceChains(input, ALL_WORKERS);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ domain: "comm", role: "editor" });
  });

  it("injects editor after writer.policy", () => {
    const input = [phase("comm", "writer.policy")];
    const result = enforceChains(input, ALL_WORKERS);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ domain: "comm", role: "editor" });
  });

  it("does NOT double-inject editor when writer.tech already followed by editor", () => {
    const input = [phase("comm", "writer.tech"), phase("comm", "editor")];
    const result = enforceChains(input, ALL_WORKERS);
    expect(result).toHaveLength(2);
  });

  it("injects linguist after modeler", () => {
    const input = [phase("data", "modeler")];
    const result = enforceChains(input, ALL_WORKERS);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ domain: "k", role: "linguist" });
  });

  it("does NOT inject linguist when already follows modeler", () => {
    const input = [phase("data", "modeler"), phase("k", "linguist")];
    const result = enforceChains(input, ALL_WORKERS);
    expect(result).toHaveLength(2);
  });

  it("handles multi-phase plan with multiple enforced chains", () => {
    const input = [
      phase("strat", "planner"),
      phase("code", "hacker"),
      phase("comm", "writer.tech"),
    ];
    const result = enforceChains(input, ALL_WORKERS);
    // planner (no chain), hacker → tester injected, writer.tech → editor injected
    expect(result).toHaveLength(5);
    expect(result[0]).toMatchObject({ domain: "strat", role: "planner" });
    expect(result[1]).toMatchObject({ domain: "code",  role: "hacker" });
    expect(result[2]).toMatchObject({ domain: "code",  role: "tester" });
    expect(result[3]).toMatchObject({ domain: "comm",  role: "writer.tech" });
    expect(result[4]).toMatchObject({ domain: "comm",  role: "editor" });
  });

  it("does not inject sink when it is not in the worker catalog", () => {
    const limitedWorkers = ALL_WORKERS.filter(
      (w) => !(w.domain === "code" && w.role === "tester"),
    );
    const input = [phase("code", "hacker")];
    const result = enforceChains(input, limitedWorkers);
    // tester not in catalog → no injection
    expect(result).toHaveLength(1);
  });

  it("preserves existing gate on injected phases (always auto)", () => {
    const input = [phase("code", "hacker", "checkpoint")];
    const result = enforceChains(input, ALL_WORKERS);
    expect(result[1]).toMatchObject({ gate: "auto" });
  });

  it("preserves passthrough phases with no chain rule untouched", () => {
    const input = [phase("strat", "planner"), phase("code", "engineer")];
    const result = enforceChains(input, ALL_WORKERS);
    expect(result).toHaveLength(2);
  });
});
