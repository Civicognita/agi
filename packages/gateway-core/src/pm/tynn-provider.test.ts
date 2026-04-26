import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("TynnPmProvider — write methods still throw (cycle 35b pending)", () => {
  // Cycle 35b will replace these with real implementations. For now they
  // throw with the cycle pointer; pinning the contract until the next cycle.
  let provider: TynnPmProvider;
  beforeEach(() => {
    provider = new TynnPmProvider({ mcpClient: makeMockMcpClient() });
  });

  it("setTaskStatus throws cycle-pointer error", async () => {
    await expect(provider.setTaskStatus("t1", "doing")).rejects.toThrow(/cycle 35/);
  });

  it("createTask throws cycle-pointer error", async () => {
    await expect(provider.createTask({ storyId: "s1", title: "x", description: "y" })).rejects.toThrow(/cycle 35/);
  });

  it("iWish throws cycle-pointer error", async () => {
    await expect(provider.iWish({ title: "wish" })).rejects.toThrow(/cycle 35/);
  });
});
