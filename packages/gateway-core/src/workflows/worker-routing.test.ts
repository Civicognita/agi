/**
 * Worker Routing Workflow Tests — Story 17
 *
 * Covers:
 * - Worker emission parsing
 * - Task permission validation by verification tier
 * - Worker suggestion via keyword heuristics
 * - Dispatch report formatting
 */

import { describe, it, expect } from "vitest";
import {
  parseWorkerEmission,
  validateTaskPermissions,
  suggestWorker,
  formatDispatchReport,
} from "./worker-routing.js";
import type { WorkerTask } from "./worker-routing.js";

describe("parseWorkerEmission", () => {
  it("parses a standard emission", () => {
    const result = parseWorkerEmission("q:> implement user authentication module");
    expect(result).not.toBeNull();
    expect(result!.description).toBe("implement user authentication module");
  });

  it("returns null for non-emission text", () => {
    const result = parseWorkerEmission("just a regular message");
    expect(result).toBeNull();
  });

  it("returns null for empty emission", () => {
    const result = parseWorkerEmission("q:> ");
    expect(result).toBeNull();
  });

  it("assigns worker based on keywords", () => {
    const result = parseWorkerEmission("q:> test the authentication flow");
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("code");
    expect(result!.worker).toBe("tester");
  });

  it("assigns code engineer for implementation tasks", () => {
    const result = parseWorkerEmission("q:> implement new API endpoint for users");
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("code");
    expect(result!.worker).toBe("engineer");
  });

  it("assigns analyst for research tasks", () => {
    const result = parseWorkerEmission("q:> analyse the performance bottleneck");
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("k");
    expect(result!.worker).toBe("analyst");
  });

  it("extracts critical priority", () => {
    const result = parseWorkerEmission("q:> critical fix for auth bypass");
    expect(result).not.toBeNull();
    expect(result!.priority).toBe("critical");
  });

  it("defaults to normal priority", () => {
    const result = parseWorkerEmission("q:> implement feature X");
    expect(result).not.toBeNull();
    expect(result!.priority).toBe("normal");
  });
});

describe("validateTaskPermissions", () => {
  const codeDomainTask: WorkerTask = {
    description: "Build feature X",
    domain: "code",
    worker: "engineer",
    priority: "normal",
  };

  const knowledgeTask: WorkerTask = {
    description: "Analyze data",
    domain: "k",
    worker: "analyst",
    priority: "normal",
  };

  const opsTask: WorkerTask = {
    description: "Deploy to production",
    domain: "ops",
    worker: "deployer",
    priority: "normal",
  };

  it("allows code tasks for sealed tier", () => {
    expect(validateTaskPermissions(codeDomainTask, "sealed")).toBe(true);
  });

  it("allows code tasks for verified tier", () => {
    expect(validateTaskPermissions(codeDomainTask, "verified")).toBe(true);
  });

  it("rejects code tasks for unverified tier", () => {
    expect(validateTaskPermissions(codeDomainTask, "unverified")).toBe(false);
  });

  it("allows knowledge tasks for all tiers", () => {
    expect(validateTaskPermissions(knowledgeTask, "unverified")).toBe(true);
    expect(validateTaskPermissions(knowledgeTask, "verified")).toBe(true);
    expect(validateTaskPermissions(knowledgeTask, "sealed")).toBe(true);
  });

  it("allows ops tasks only for sealed tier", () => {
    expect(validateTaskPermissions(opsTask, "sealed")).toBe(true);
    expect(validateTaskPermissions(opsTask, "verified")).toBe(false);
    expect(validateTaskPermissions(opsTask, "unverified")).toBe(false);
  });
});

describe("suggestWorker", () => {
  it("suggests code engineer for implementation", () => {
    const result = suggestWorker("implement the new login flow");
    expect(result.domain).toBe("code");
    expect(result.worker).toBe("engineer");
  });

  it("suggests code tester for test tasks", () => {
    const result = suggestWorker("test the authentication flow");
    expect(result.domain).toBe("code");
    expect(result.worker).toBe("tester");
  });

  it("suggests analyst for analysis", () => {
    const result = suggestWorker("analyze the performance metrics");
    expect(result.domain).toBe("k");
    expect(result.worker).toBe("analyst");
  });

  it("suggests UX designer for UI work", () => {
    const result = suggestWorker("design the new dashboard component");
    expect(result.domain).toBe("ux");
    expect(result.worker).toBe("designer.web");
  });

  it("suggests code reviewer for reviews", () => {
    const result = suggestWorker("review the pull request for security issues");
    expect(result.domain).toBe("code");
    expect(result.worker).toBe("reviewer");
  });

  it("defaults to code engineer for ambiguous descriptions", () => {
    const result = suggestWorker("do something with the project");
    expect(result.domain).toBe("code");
    expect(result.worker).toBe("engineer");
  });
});

describe("formatDispatchReport", () => {
  it("formats a report with dispatched tasks", () => {
    const report = formatDispatchReport({
      dispatched: [
        { description: "Build feature", domain: "code", worker: "engineer", priority: "normal" },
      ],
      rejected: [],
    });

    expect(report).toContain("Dispatched");
    expect(report).toContain("Build feature");
  });

  it("formats a report with rejected tasks", () => {
    const report = formatDispatchReport({
      dispatched: [],
      rejected: [
        {
          task: { description: "Build feature", domain: "code", worker: "engineer", priority: "normal" },
          reason: "Insufficient permissions",
        },
      ],
    });

    expect(report).toContain("Rejected");
    expect(report).toContain("Insufficient permissions");
  });
});
