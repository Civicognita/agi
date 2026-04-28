import { describe, it, expect, vi } from "vitest";
import type { McpClient } from "@agi/mcp-client";
import type { PmProvider } from "@agi/sdk";
import { TynnPmProvider } from "./tynn-provider.js";

/**
 * s118 t432 cycle 35a — TynnPmProvider read-method tests.
 *
 * Cycle 34 shipped the skeleton. Cycle 35a (this file) tests the six read
 * methods (getProject, getNext, getTask, getStory, findTasks, getComments)
 * against a mocked McpClient. Cycle 35b will add tests for write ops
 * (setTaskStatus, addComment, updateTask, createTask, iWish, getActiveFocusProgress).
 */

function makeMockMcpClient(callToolImpl?: (serverId: string, toolName: string, args: Record<string, unknown>) => unknown) {
  const callTool = vi.fn(async (serverId: string, toolName: string, args: Record<string, unknown>) => {
    const result = callToolImpl?.(serverId, toolName, args);
    return result ?? { isError: false, content: [{ type: "text", text: "{}" }] };
  });
  return {
    callTool,
    listServers: vi.fn(() => []),
    listTools: vi.fn(),
    listResources: vi.fn(),
    listPrompts: vi.fn(),
    readResource: vi.fn(),
    registerServer: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    unregisterServer: vi.fn(),
  } as unknown as McpClient & { callTool: ReturnType<typeof vi.fn> };
}

/** Helper — wrap a JSON object as the MCP tool-call result text content. */
function mcpResult(data: unknown, isError = false) {
  return { isError, content: [{ type: "text", text: JSON.stringify(data) }] };
}

describe("TynnPmProvider — skeleton + dispatcher (s118 t432)", () => {
  it("instantiates with an McpClient", () => {
    const provider = new TynnPmProvider({ mcpClient: makeMockMcpClient() });
    expect(provider).toBeInstanceOf(TynnPmProvider);
  });

  it("uses 'tynn' as the default server id (verified via callTool args)", async () => {
    const mcp = makeMockMcpClient((_serverId, toolName) => {
      if (toolName === "project") return mcpResult({ id: "p1", name: "Aionima" });
      return mcpResult({});
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    await provider.getProject();
    // First arg is the server id — confirms default routing
    expect(mcp.callTool).toHaveBeenCalledWith("tynn", "project", {});
  });

  it("respects custom server id override", async () => {
    const mcp = makeMockMcpClient((_serverId, toolName) => {
      if (toolName === "project") return mcpResult({ id: "p1", name: "MyProject" });
      return mcpResult({});
    });
    const provider = new TynnPmProvider({ mcpClient: mcp, serverId: "tynn-custom" });
    await provider.getProject();
    expect(mcp.callTool).toHaveBeenCalledWith("tynn-custom", "project", {});
  });

  it("satisfies the PmProvider type assignment (structural typing)", () => {
    const provider: PmProvider = new TynnPmProvider({ mcpClient: makeMockMcpClient() });
    expect(provider.providerId).toBe("tynn");
  });

  it("propagates error when tynn returns isError=true", async () => {
    const mcp = makeMockMcpClient(() => mcpResult({ error: "no project configured" }, true));
    const provider = new TynnPmProvider({ mcpClient: mcp });
    await expect(provider.getProject()).rejects.toThrow(/tynn\.project failed/);
  });
});

describe("TynnPmProvider — getProject (s118 t432 cycle 35a)", () => {
  it("translates tynn project response to PmProject", async () => {
    const mcp = makeMockMcpClient((_, toolName) => {
      if (toolName === "project") {
        return mcpResult({ id: "01abc", name: "Aionima", ai_guidance: "Use the tynn workflow" });
      }
      return mcpResult({});
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const project = await provider.getProject();
    expect(project.id).toBe("01abc");
    expect(project.name).toBe("Aionima");
    expect(project.description).toBe("Use the tynn workflow");
  });
});

describe("TynnPmProvider — getNext (s118 t432 cycle 35a)", () => {
  it("translates tynn next() response to {version, topStory, tasks}", async () => {
    const mcp = makeMockMcpClient((_, toolName) => {
      if (toolName === "next") {
        return mcpResult({
          ok: true,
          active_version: { id: "v1", number: "0.4.0", title: "Alpha", status: "active" },
          top_story: {
            id: "s1",
            story_number: 118,
            version_id: "v1",
            title: "Iterative work mode",
            status: "in_progress",
          },
          tasks: [
            { id: "t1", task_number: 432, story_id: "s1", title: "PM tool surface", status: "doing" },
            { id: "t2", task_number: 441, story_id: "s1", title: "MCP client", status: "qa" },
          ],
        });
      }
      return mcpResult({});
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const result = await provider.getNext();
    expect(result.version?.number).toBe("0.4.0");
    expect(result.version?.status).toBe("active");
    expect(result.topStory?.number).toBe(118);
    expect(result.topStory?.status).toBe("in_progress");
    expect(result.tasks).toHaveLength(2);
    // Tynn's `qa` translates to PmStatus "testing" — vocabulary decoupling
    expect(result.tasks[1]?.status).toBe("testing");
    // Tynn's `doing` stays `doing`
    expect(result.tasks[0]?.status).toBe("doing");
  });

  it("returns nulls/empty when tynn next() has no active work", async () => {
    const mcp = makeMockMcpClient((_, toolName) => {
      if (toolName === "next") {
        return mcpResult({ ok: true, active_version: null, top_story: null, tasks: [] });
      }
      return mcpResult({});
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const result = await provider.getNext();
    expect(result.version).toBeNull();
    expect(result.topStory).toBeNull();
    expect(result.tasks).toEqual([]);
  });
});

describe("TynnPmProvider — getTask + getStory (s118 t432 cycle 35a)", () => {
  it("getTask by number routes to tynn show with number arg", async () => {
    const mcp = makeMockMcpClient((_, toolName, args) => {
      if (toolName === "show" && args["a"] === "task" && args["number"] === 441) {
        return mcpResult({ id: "t441", task_number: 441, story_id: "s1", title: "MCP client", status: "qa" });
      }
      return mcpResult({});
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const task = await provider.getTask(441);
    expect(task?.id).toBe("t441");
    expect(task?.status).toBe("testing"); // qa → testing translation
    expect(mcp.callTool).toHaveBeenCalledWith("tynn", "show", { a: "task", number: 441 });
  });

  it("getTask by id routes to tynn show with id arg", async () => {
    const mcp = makeMockMcpClient((_, toolName, args) => {
      if (toolName === "show" && args["a"] === "task" && args["id"] === "t441-ulid") {
        return mcpResult({ id: "t441-ulid", task_number: 441, story_id: "s1", title: "MCP client", status: "doing" });
      }
      return mcpResult({});
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const task = await provider.getTask("t441-ulid");
    expect(task?.id).toBe("t441-ulid");
    expect(mcp.callTool).toHaveBeenCalledWith("tynn", "show", { a: "task", id: "t441-ulid" });
  });

  it("getTask returns null when tynn says not found", async () => {
    const mcp = makeMockMcpClient(() => mcpResult({ error: "Task not found" }, true));
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const task = await provider.getTask("missing");
    expect(task).toBeNull();
  });

  it("getStory routes to tynn show with a:'story'", async () => {
    const mcp = makeMockMcpClient((_, toolName, args) => {
      if (toolName === "show" && args["a"] === "story") {
        return mcpResult({ id: "s118", story_number: 118, version_id: "v1", title: "Iter mode", status: "in_progress" });
      }
      return mcpResult({});
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const story = await provider.getStory(118);
    expect(story?.number).toBe(118);
    expect(story?.status).toBe("in_progress");
  });
});

describe("TynnPmProvider — findTasks (s118 t432 cycle 35a)", () => {
  it("translates filter into tynn find args + reverse-translates statuses", async () => {
    const mcp = makeMockMcpClient((_, toolName, args) => {
      if (toolName === "find" && args["a"] === "task") {
        // Verify the where clause reverse-translated PmStatus → tynn status
        const where = args["where"] as Record<string, unknown> | undefined;
        expect(where?.["story_id"]).toBe("s118");
        expect(where?.["status"]).toEqual(["doing", "qa"]); // testing → qa
        return mcpResult({
          data: [
            { id: "t1", task_number: 432, story_id: "s118", title: "x", status: "doing" },
            { id: "t2", task_number: 441, story_id: "s118", title: "y", status: "qa" },
          ],
        });
      }
      return mcpResult({});
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const tasks = await provider.findTasks({ storyId: "s118", status: ["doing", "testing"] });
    expect(tasks).toHaveLength(2);
    expect(tasks[1]?.status).toBe("testing"); // qa → testing forward-translation
  });

  it("findTasks with no filter just queries 'a:task' with empty where", async () => {
    const mcp = makeMockMcpClient((_, _toolName, args) => {
      expect(args["where"]).toBeUndefined();
      return mcpResult({ data: [] });
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    await provider.findTasks();
    expect(mcp.callTool).toHaveBeenCalledWith("tynn", "find", { a: "task" });
  });
});

describe("TynnPmProvider — getComments (s118 t432 cycle 35a)", () => {
  it("translates tynn comment list to PmComment[]", async () => {
    const mcp = makeMockMcpClient((_, toolName, args) => {
      if (toolName === "find" && args["a"] === "comment") {
        const on = args["on"] as Record<string, unknown> | undefined;
        expect(on?.["type"]).toBe("task");
        expect(on?.["id"]).toBe("t441");
        return mcpResult({
          data: [
            { id: "c1", body: "started t441 cycle 30", author: "claude", created_at: "2026-04-26T12:00:00Z" },
            { id: "c2", body: "stdio shipped", created_at: "2026-04-26T12:30:00Z" },
          ],
        });
      }
      return mcpResult({});
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const comments = await provider.getComments("task", "t441");
    expect(comments).toHaveLength(2);
    expect(comments[0]?.body).toBe("started t441 cycle 30");
    expect(comments[0]?.author).toBe("claude");
    expect(comments[1]?.author).toBeUndefined();
  });
});

describe("TynnPmProvider — setTaskStatus dispatch (s118 t432 cycle 35b)", () => {
  // Each PmStatus maps to a specific tynn op. Mock McpClient asserts which
  // op was called + that the args match the PmProvider semantic.

  function expectStatusRoutesTo(targetStatus: import("@agi/sdk").PmStatus, expectedTynnOp: string) {
    return async () => {
      const mcp = makeMockMcpClient((_, toolName, args) => {
        expect(toolName).toBe(expectedTynnOp);
        expect(args["a"]).toBe("task");
        expect(args["id"]).toBe("t1");
        return mcpResult({ id: "t1", task_number: 1, story_id: "s1", title: "x", status: "doing" });
      });
      const provider = new TynnPmProvider({ mcpClient: mcp });
      await provider.setTaskStatus("t1", targetStatus);
    };
  }

  it("'starting' → tynn starting op", expectStatusRoutesTo("starting", "starting"));
  it("'doing' → tynn start op", expectStatusRoutesTo("doing", "start"));
  it("'testing' → tynn testing op", expectStatusRoutesTo("testing", "testing"));
  it("'finished' → tynn finished op", expectStatusRoutesTo("finished", "finished"));
  it("'blocked' → tynn block op", expectStatusRoutesTo("blocked", "block"));

  it("passes note through when supplied", async () => {
    const mcp = makeMockMcpClient((_, toolName, args) => {
      expect(toolName).toBe("testing");
      expect(args["note"]).toBe("ready for QA");
      return mcpResult({ id: "t1", task_number: 1, story_id: "s1", title: "x", status: "qa" });
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const result = await provider.setTaskStatus("t1", "testing", "ready for QA");
    expect(result.status).toBe("testing"); // qa → testing translation
  });

  it("'backlog'/'archived' fall back to update op with status field", async () => {
    const mcp = makeMockMcpClient((_, toolName, args) => {
      expect(toolName).toBe("update");
      expect(args["with"]).toEqual({ status: "archived" });
      return mcpResult({ id: "t1", task_number: 1, story_id: "s1", title: "x", status: "archived" });
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const result = await provider.setTaskStatus("t1", "archived");
    expect(result.status).toBe("archived");
  });
});

describe("TynnPmProvider — createTask + addComment + updateTask (s118 t432 cycle 35b)", () => {
  it("createTask routes to tynn create with a:'task' + on:{story_id} + because", async () => {
    const mcp = makeMockMcpClient((_, toolName, args) => {
      expect(toolName).toBe("create");
      expect(args["a"]).toBe("task");
      expect(args["on"]).toEqual({ story_id: "s118" });
      expect(args["title"]).toBe("New thing");
      expect(args["because"]).toBe("It's needed");
      return mcpResult({ id: "t999", task_number: 999, story_id: "s118", title: "New thing", status: "backlog" });
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const task = await provider.createTask({
      storyId: "s118",
      title: "New thing",
      description: "It's needed",
    });
    expect(task.id).toBe("t999");
    expect(task.status).toBe("backlog");
  });

  it("createTask passes verificationSteps + codeArea via with:{}", async () => {
    const mcp = makeMockMcpClient((_, _toolName, args) => {
      expect(args["with"]).toEqual({
        verification_steps: ["Run tests", "Lint clean"],
        code_area: "packages/foo",
      });
      return mcpResult({ id: "t999", task_number: 999, story_id: "s118", title: "x", status: "backlog" });
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    await provider.createTask({
      storyId: "s118",
      title: "x",
      description: "y",
      verificationSteps: ["Run tests", "Lint clean"],
      codeArea: "packages/foo",
    });
  });

  it("addComment routes to tynn create with a:'comment' + on:{type,id}", async () => {
    const mcp = makeMockMcpClient((_, toolName, args) => {
      expect(toolName).toBe("create");
      expect(args["a"]).toBe("comment");
      expect(args["on"]).toEqual({ type: "task", id: "t441" });
      expect(args["because"]).toBe("Shipped cycle 33");
      return mcpResult({ id: "c1", body: "Shipped cycle 33", created_at: "2026-04-26T20:00:00Z" });
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const comment = await provider.addComment("task", "t441", "Shipped cycle 33");
    expect(comment.id).toBe("c1");
    expect(comment.body).toBe("Shipped cycle 33");
  });

  it("updateTask routes to tynn update with snake_case field translation", async () => {
    const mcp = makeMockMcpClient((_, toolName, args) => {
      expect(toolName).toBe("update");
      expect(args["a"]).toBe("task");
      expect(args["id"]).toBe("t1");
      expect(args["with"]).toEqual({
        title: "New title",
        verification_steps: ["check"],
        code_area: "packages/x",
      });
      return mcpResult({ id: "t1", task_number: 1, story_id: "s1", title: "New title", status: "doing" });
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    await provider.updateTask("t1", {
      title: "New title",
      verificationSteps: ["check"],
      codeArea: "packages/x",
    });
  });
});

describe("TynnPmProvider — iWish (s118 t432 cycle 35b)", () => {
  it("routes to tynn iwish with this/didnt/when fields", async () => {
    const mcp = makeMockMcpClient((_, toolName, args) => {
      expect(toolName).toBe("iwish");
      expect(args["this"]).toBe("Fix the broken thing");
      expect(args["didnt"]).toBe("computed wrong values");
      expect(args["when"]).toBe("on Sundays");
      expect(args["priority"]).toBe("high");
      return mcpResult({ id: "w1", title: "Fix the broken thing" });
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const wish = await provider.iWish({
      title: "Fix the broken thing",
      didnt: "computed wrong values",
      when: "on Sundays",
      priority: "high",
    });
    expect(wish.id).toBe("w1");
  });

  it("only sends supplied fields (no undefined keys leaked)", async () => {
    const mcp = makeMockMcpClient((_, _toolName, args) => {
      expect(Object.keys(args).sort()).toEqual(["had", "this"]);
      return mcpResult({ id: "w2", title: "Want a new feature" });
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    await provider.iWish({ title: "Want a new feature", had: "auto-save" });
  });
});

describe("TynnPmProvider — getActiveFocusProgress (s118 t432 cycle 35b — drives t439 UX)", () => {
  it("derives progress from top_story.task_status_snapshot", async () => {
    const mcp = makeMockMcpClient((_, toolName) => {
      if (toolName === "next") {
        return mcpResult({
          ok: true,
          active_version: { id: "v1", number: "0.4.0", title: "x", status: "active" },
          top_story: {
            id: "s1",
            story_number: 118,
            version_id: "v1",
            title: "x",
            status: "in_progress",
            task_status_snapshot: { backlog: 4, doing: 2, qa: 1, blocked: 0, done: 3 },
          },
          tasks: [],
        });
      }
      return mcpResult({});
    });
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const progress = await provider.getActiveFocusProgress();
    // Total = 4 + 2 + 1 + 0 + 3 = 10; done = 3; in-progress = doing+qa = 3
    expect(progress.totalTasks).toBe(10);
    expect(progress.doneTasks).toBe(3);
    expect(progress.inProgressTasks).toBe(3);
    expect(progress.blockedTasks).toBe(0);
    expect(progress.percentComplete).toBe(30); // 3/10 = 30%
  });

  it("returns zeros when no top_story or no snapshot", async () => {
    const mcp = makeMockMcpClient(() =>
      mcpResult({ ok: true, active_version: null, top_story: null, tasks: [] }),
    );
    const provider = new TynnPmProvider({ mcpClient: mcp });
    const progress = await provider.getActiveFocusProgress();
    expect(progress.totalTasks).toBe(0);
    expect(progress.percentComplete).toBe(0);
  });
});
