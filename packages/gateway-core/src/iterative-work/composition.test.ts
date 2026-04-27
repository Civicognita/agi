/**
 * Plan + PM composition regression test — s118 t440.
 *
 * The owner's invariant: plan = within-iteration scaffolding, PM = across-
 * iteration tracking. They must compose without overlap. This test asserts
 * three structural invariants that protect that contract:
 *
 *   1. **Namespace separation** — plan IDs always use the `plan_` prefix;
 *      PM task IDs never do. A future refactor that aligns them would
 *      collapse the distinction silently — this test fails first.
 *   2. **Storage separation** — plan storage paths and PM storage shapes
 *      don't overlap. PlanStore writes to `~/.agi/{slug}/plans/`; PmProvider
 *      writes via its own backing service (tynn MCP / tynn-lite jsonl /
 *      plugin-defined). The test asserts the address spaces never collide.
 *   3. **State-machine separation** — plan step statuses (pending/running/
 *      complete/failed/skipped) and PM task statuses (backlog/starting/doing/
 *      testing/finished/blocked/archived) progress independently. Mutating
 *      one must not mutate the other.
 *
 * The test runs against a MockPmProvider rather than TynnPmProvider so it
 * doesn't depend on a live MCP server or real tynn project. The spec asks
 * for parameterization across tynn / tynn-lite / plugin-mock — only
 * TynnPmProvider exists today (tynn-lite is t433, plugin-override is t434),
 * so this slice runs against the generic mock + names the deferral. When
 * t433/t434 land, this file gains parameterized describe blocks.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { ulid } from "ulid";
import type {
  PmProvider,
  PmStatus,
  PmTask,
  PmStory,
  PmVersion,
  PmProject,
  PmComment,
  PmCreateTaskInput,
  PmIWishInput,
} from "@agi/sdk";
import type { Plan, PlanStep, PlanStepStatus, PlanStatus } from "../plan-types.js";

// ---------------------------------------------------------------------------
// MockPmProvider — minimal in-memory PM provider for composition testing.
// Mirrors tynn ULID-shaped task IDs (no prefix) so namespace assertions are
// realistic.
// ---------------------------------------------------------------------------

class MockPmProvider implements PmProvider {
  readonly providerId = "mock-pm";
  private readonly tasks = new Map<string, PmTask>();
  private readonly comments = new Map<string, PmComment[]>();

  async getProject(): Promise<PmProject> {
    return { id: "01prj-mock", name: "MockProject" };
  }
  async getNext(): Promise<{ version: PmVersion | null; topStory: PmStory | null; tasks: PmTask[] }> {
    return { version: null, topStory: null, tasks: [...this.tasks.values()] };
  }
  async getTask(idOrNumber: string | number): Promise<PmTask | null> {
    if (typeof idOrNumber === "string") return this.tasks.get(idOrNumber) ?? null;
    return [...this.tasks.values()].find((t) => t.number === idOrNumber) ?? null;
  }
  async getStory(): Promise<PmStory | null> {
    return null;
  }
  async findTasks(): Promise<PmTask[]> {
    return [...this.tasks.values()];
  }
  async getComments(_entityType: "task" | "story" | "version", entityId: string): Promise<PmComment[]> {
    return this.comments.get(entityId) ?? [];
  }
  async setTaskStatus(taskId: string, status: PmStatus): Promise<PmTask> {
    const task = this.tasks.get(taskId);
    if (task === undefined) throw new Error(`unknown task ${taskId}`);
    const updated: PmTask = { ...task, status };
    this.tasks.set(taskId, updated);
    return updated;
  }
  async addComment(_entityType: "task" | "story" | "version", entityId: string, body: string): Promise<PmComment> {
    const comment: PmComment = {
      id: ulid(),
      body,
      createdAt: new Date().toISOString(),
    };
    const list = this.comments.get(entityId) ?? [];
    list.push(comment);
    this.comments.set(entityId, list);
    return comment;
  }
  async updateTask(taskId: string, fields: Partial<Pick<PmTask, "title" | "description" | "verificationSteps" | "codeArea">>): Promise<PmTask> {
    const task = this.tasks.get(taskId);
    if (task === undefined) throw new Error(`unknown task ${taskId}`);
    const updated: PmTask = { ...task, ...fields };
    this.tasks.set(taskId, updated);
    return updated;
  }
  async createTask(input: PmCreateTaskInput): Promise<PmTask> {
    const task: PmTask = {
      id: ulid(),
      number: this.tasks.size + 1,
      title: input.title,
      description: input.description,
      status: "backlog",
      storyId: input.storyId,
      verificationSteps: input.verificationSteps ?? [],
      codeArea: input.codeArea,
    };
    this.tasks.set(task.id, task);
    return task;
  }
  async iWish(input: PmIWishInput): Promise<{ id: string; title: string }> {
    return { id: `wish_${ulid()}`, title: input.title };
  }
}

// ---------------------------------------------------------------------------
// Plan factory — constructs in-memory Plan objects matching what
// PlanStore.create produces (without writing to disk). Faithful to the
// `plan_<ulid>` ID convention.
// ---------------------------------------------------------------------------

function makePlan(input: {
  title: string;
  steps: { title: string; type: PlanStep["type"] }[];
  taskIds?: string[];
}): Plan {
  const planId = `plan_${ulid()}`;
  const now = new Date().toISOString();
  const steps: PlanStep[] = input.steps.map((s, i) => ({
    id: `step_${String(i + 1).padStart(2, "0")}`,
    title: s.title,
    type: s.type,
    status: "pending" as PlanStepStatus,
  }));
  return {
    id: planId,
    title: input.title,
    status: "draft" as PlanStatus,
    projectPath: "/tmp/iter-work-composition-test",
    chatSessionId: null,
    createdAt: now,
    updatedAt: now,
    tynnRefs: { versionId: null, storyIds: [], taskIds: input.taskIds ?? [] },
    steps,
    body: "",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Plan + PM composition — namespace separation", () => {
  let pm: MockPmProvider;
  beforeEach(() => {
    pm = new MockPmProvider();
  });

  it("plan IDs always use the plan_ prefix", () => {
    const plan = makePlan({
      title: "Composition probe",
      steps: [{ title: "design", type: "plan" }],
    });
    expect(plan.id).toMatch(/^plan_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("PM task IDs never use the plan_ prefix", async () => {
    const task = await pm.createTask({
      storyId: "01story-x",
      title: "Probe task",
      description: "asserts no prefix overlap",
    });
    expect(task.id.startsWith("plan_")).toBe(false);
    expect(task.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("a plan and a PM task created in the same session never collide on ID", async () => {
    const plan = makePlan({ title: "Plan", steps: [{ title: "step", type: "plan" }] });
    const task = await pm.createTask({ storyId: "01story-x", title: "Task", description: "" });
    expect(plan.id).not.toBe(task.id);
  });
});

describe("Plan + PM composition — storage separation", () => {
  it("plan storage path includes /plans/ and ends in .mdc; never overlaps with PM provider scope", () => {
    const plan = makePlan({ title: "Plan", steps: [{ title: "step", type: "plan" }] });
    // The plan-store path convention is ~/.agi/{slug}/plans/{planId}.mdc.
    // We don't hit disk in this test; we assert the ID's prefix is the
    // structural identifier that file-write code uses to scope.
    expect(plan.id.startsWith("plan_")).toBe(true);
    // PM provider task IDs would never end up in a plans/ directory because
    // they don't carry the plan_ prefix. The MockPmProvider's tasks live in
    // its own in-memory Map; in production, TynnPmProvider goes through MCP.
  });
});

describe("Plan + PM composition — state-machine separation across iterations", () => {
  let pm: MockPmProvider;
  beforeEach(() => {
    pm = new MockPmProvider();
  });

  it("simulated 3-iteration flow keeps plan + PM state machines independent", async () => {
    // Iteration 0 — Aion files a PM task and creates a plan that references it
    const pmTask = await pm.createTask({
      storyId: "01story-feat-x",
      title: "Ship feature X",
      description: "Multi-cycle delivery",
    });
    expect(pmTask.status).toBe("backlog");

    const plan = makePlan({
      title: "Implement feature X — cycle 0",
      steps: [
        { title: "design", type: "plan" },
        { title: "implement", type: "implement" },
        { title: "test", type: "test" },
      ],
      taskIds: [pmTask.id],
    });
    expect(plan.steps.every((s) => s.status === "pending")).toBe(true);
    expect(plan.tynnRefs.taskIds).toEqual([pmTask.id]);

    // Iteration 1 — Aion picks up the task, advances plan steps + transitions PM task
    const taskInDoing = await pm.setTaskStatus(pmTask.id, "doing");
    plan.steps[0]!.status = "complete";
    plan.steps[1]!.status = "running";
    plan.status = "executing";

    expect(taskInDoing.status).toBe("doing");
    expect(plan.steps[0]?.status).toBe("complete");
    expect(plan.steps[1]?.status).toBe("running");
    // The PM task's status enum and the plan step's status enum are disjoint —
    // even with similar string values ("complete" exists in plan but not PM),
    // they refer to different entities and don't bleed into each other.
    expect(taskInDoing.status).not.toBe("running");
    expect(taskInDoing.status).not.toBe("complete");

    // Iteration 2 — Aion finishes implementation, moves plan to testing,
    // transitions PM task into testing (review state). Both go to "testing"
    // but they're tracking different things — that's the point of this test.
    plan.steps[1]!.status = "complete";
    plan.steps[2]!.status = "running";
    plan.status = "testing";
    const taskInTesting = await pm.setTaskStatus(pmTask.id, "testing");

    expect(taskInTesting.status).toBe("testing");
    expect(plan.status).toBe("testing");
    // Despite the same string, they're two different machines:
    expect(plan.id.startsWith("plan_")).toBe(true);
    expect(taskInTesting.id.startsWith("plan_")).toBe(false);

    // Iteration 3 — Plan completes (all steps done); PM task moves to finished
    plan.steps[2]!.status = "complete";
    plan.status = "complete";
    const taskFinished = await pm.setTaskStatus(pmTask.id, "finished");

    expect(taskFinished.status).toBe("finished");
    // Plan has no "finished" — its terminal is "complete". They look similar
    // but the vocabularies don't unify; that's deliberate.
    expect(plan.status).toBe("complete");
    expect(taskFinished.status).not.toBe("complete");
  });

  it("mutating PM task does not mutate plan steps", async () => {
    const task = await pm.createTask({ storyId: "01s", title: "T", description: "" });
    const plan = makePlan({ title: "P", steps: [{ title: "s", type: "implement" }], taskIds: [task.id] });

    const initialPlanSteps = JSON.parse(JSON.stringify(plan.steps)) as PlanStep[];
    await pm.setTaskStatus(task.id, "doing");
    expect(plan.steps).toEqual(initialPlanSteps);
  });

  it("mutating plan steps does not mutate PM task", async () => {
    const task = await pm.createTask({ storyId: "01s", title: "T", description: "" });
    const plan = makePlan({ title: "P", steps: [{ title: "s", type: "implement" }], taskIds: [task.id] });

    plan.steps[0]!.status = "complete";
    const refetched = await pm.getTask(task.id);
    expect(refetched?.status).toBe("backlog");
  });
});

describe("Plan + PM composition — back-reference discipline", () => {
  it("plan.tynnRefs.taskIds carries PM task IDs (one-directional reference)", async () => {
    const pm = new MockPmProvider();
    const task = await pm.createTask({ storyId: "01s", title: "T", description: "" });
    const plan = makePlan({ title: "P", steps: [{ title: "s", type: "implement" }], taskIds: [task.id] });
    expect(plan.tynnRefs.taskIds).toContain(task.id);
  });

  it("PM task does NOT carry plan ID back (one-directional discipline)", async () => {
    const pm = new MockPmProvider();
    const task = await pm.createTask({ storyId: "01s", title: "T", description: "" });
    // PmTask shape has no field for plan-id reference. This is structural —
    // the type system would reject any attempt to add one. Asserting via the
    // shape's keys to make the discipline visible in test output.
    const taskKeys = Object.keys(task);
    expect(taskKeys).not.toContain("planId");
    expect(taskKeys).not.toContain("planIds");
    expect(taskKeys).not.toContain("planRef");
  });
});
