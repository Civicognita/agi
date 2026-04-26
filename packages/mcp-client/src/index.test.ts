import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * s118 t441 cycle 31 — McpClient with stdio transport + Client integration.
 *
 * Tests mock the SDK's Client class to assert McpClient's translation +
 * lifecycle logic without spawning real MCP server processes. Integration
 * tests against a real stdio MCP server land in a follow-up cycle (or
 * lift via the agi test VM when t441 is wired into TynnPmProvider in t432).
 */

// Mock the SDK before importing McpClient — vi.mock is hoisted to top of file.
const mockClientInstance = {
  connect: vi.fn(),
  close: vi.fn(),
  listTools: vi.fn(),
  listResources: vi.fn(),
  listPrompts: vi.fn(),
  callTool: vi.fn(),
  readResource: vi.fn(),
};

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn(() => mockClientInstance),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn((params) => ({ __transport: "stdio", params })),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn((url) => ({ __transport: "http", url: String(url) })),
}));

vi.mock("@modelcontextprotocol/sdk/client/websocket.js", () => ({
  WebSocketClientTransport: vi.fn((url) => ({ __transport: "websocket", url: String(url) })),
}));

import { McpClient, type McpServerConfig } from "./index.js";

describe("McpClient — server registration + lifecycle (s118 t441)", () => {
  beforeEach(() => {
    Object.values(mockClientInstance).forEach((m) => {
      if (typeof m === "function" && "mockReset" in m) m.mockReset();
    });
  });

  it("registers a server in disconnected state", async () => {
    const client = new McpClient();
    await client.registerServer({
      id: "tynn",
      transport: "stdio",
      command: ["npx", "@tynn/mcp-server"],
    });
    const servers = client.listServers();
    expect(servers.length).toBe(1);
    expect(servers[0]!.id).toBe("tynn");
    expect(servers[0]!.state).toBe("disconnected");
  });

  it("connects via stdio transport when autoConnect=true", async () => {
    mockClientInstance.connect.mockResolvedValueOnce(undefined);
    const client = new McpClient();
    await client.registerServer({
      id: "tynn",
      transport: "stdio",
      command: ["npx", "@tynn/mcp-server"],
      env: { TYNN_KEY: "test-key" },
      autoConnect: true,
    });
    expect(mockClientInstance.connect).toHaveBeenCalledTimes(1);
    expect(client.listServers()[0]!.state).toBe("connected");
  });

  it("transitions to error state when connect throws", async () => {
    mockClientInstance.connect.mockRejectedValueOnce(new Error("server unreachable"));
    const client = new McpClient();
    await expect(client.registerServer({
      id: "tynn",
      transport: "stdio",
      command: ["broken-cmd"],
      autoConnect: true,
    })).rejects.toThrow("server unreachable");
    expect(client.listServers()[0]!.state).toBe("error");
  });

  it("connects via http (Streamable HTTP) transport when url is configured", async () => {
    mockClientInstance.connect.mockResolvedValueOnce(undefined);
    const client = new McpClient();
    await client.registerServer({
      id: "remote-mcp",
      transport: "http",
      url: "https://mcp.example.com/v1",
      autoConnect: true,
    });
    expect(mockClientInstance.connect).toHaveBeenCalledTimes(1);
    expect(client.listServers()[0]!.state).toBe("connected");
  });

  it("connects via websocket transport when url is configured", async () => {
    mockClientInstance.connect.mockResolvedValueOnce(undefined);
    const client = new McpClient();
    await client.registerServer({
      id: "ws-mcp",
      transport: "websocket",
      url: "wss://mcp.example.com/v1",
      autoConnect: true,
    });
    expect(mockClientInstance.connect).toHaveBeenCalledTimes(1);
    expect(client.listServers()[0]!.state).toBe("connected");
  });

  it("rejects http transport when url is missing", async () => {
    const client = new McpClient();
    await expect(client.registerServer({
      id: "broken-http",
      transport: "http",
      autoConnect: true,
    })).rejects.toThrow(/requires url/);
  });

  it("rejects websocket transport when url is missing", async () => {
    const client = new McpClient();
    await expect(client.registerServer({
      id: "broken-ws",
      transport: "websocket",
      autoConnect: true,
    })).rejects.toThrow(/requires url/);
  });

  it("rejects stdio transport when command is missing", async () => {
    const client = new McpClient();
    await expect(client.registerServer({
      id: "broken-stdio",
      transport: "stdio",
      autoConnect: true,
    })).rejects.toThrow(/requires command/);
  });

  it("disconnect closes the client + transitions state", async () => {
    mockClientInstance.connect.mockResolvedValueOnce(undefined);
    mockClientInstance.close.mockResolvedValueOnce(undefined);
    const client = new McpClient();
    await client.registerServer({
      id: "tynn",
      transport: "stdio",
      command: ["npx"],
      autoConnect: true,
    });
    await client.disconnect("tynn");
    expect(mockClientInstance.close).toHaveBeenCalledTimes(1);
    expect(client.listServers()[0]!.state).toBe("disconnected");
  });
});

describe("McpClient — tool/resource/prompt enumeration (s118 t441)", () => {
  let client: McpClient;
  const serverConfig: McpServerConfig = {
    id: "tynn",
    transport: "stdio",
    command: ["npx", "@tynn/mcp-server"],
    autoConnect: true,
  };

  beforeEach(async () => {
    Object.values(mockClientInstance).forEach((m) => {
      if (typeof m === "function" && "mockReset" in m) m.mockReset();
    });
    mockClientInstance.connect.mockResolvedValueOnce(undefined);
    client = new McpClient();
    await client.registerServer(serverConfig);
  });

  it("lists tools translating SDK shape to McpToolDescriptor", async () => {
    mockClientInstance.listTools.mockResolvedValueOnce({
      tools: [
        { name: "next", description: "Get next task", inputSchema: { type: "object" } },
        { name: "start", description: "Start task", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
      ],
    });
    const tools = await client.listTools("tynn");
    expect(tools.length).toBe(2);
    expect(tools[0]!).toEqual({ serverId: "tynn", name: "next", description: "Get next task", inputSchema: { type: "object" } });
    expect(tools[1]!.name).toBe("start");
    expect(tools[1]!.serverId).toBe("tynn");
  });

  it("lists resources translating SDK shape to McpResourceDescriptor", async () => {
    mockClientInstance.listResources.mockResolvedValueOnce({
      resources: [
        { uri: "file://instructions/tynn-guidelines.md", name: "Tynn guidelines", description: "Workflow rules", mimeType: "text/markdown" },
      ],
    });
    const resources = await client.listResources("tynn");
    expect(resources.length).toBe(1);
    expect(resources[0]!.serverId).toBe("tynn");
    expect(resources[0]!.uri).toBe("file://instructions/tynn-guidelines.md");
    expect(resources[0]!.mimeType).toBe("text/markdown");
  });

  it("lists prompts translating SDK shape to McpPromptDescriptor", async () => {
    mockClientInstance.listPrompts.mockResolvedValueOnce({
      prompts: [
        { name: "review", description: "Code review prompt", arguments: [{ name: "diff", required: true }] },
      ],
    });
    const prompts = await client.listPrompts("tynn");
    expect(prompts.length).toBe(1);
    expect(prompts[0]!.serverId).toBe("tynn");
    expect(prompts[0]!.arguments?.[0]?.required).toBe(true);
  });

  it("callTool dispatches with name + arguments and returns structured result", async () => {
    mockClientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "task t441 started" }],
      isError: false,
    });
    const result = await client.callTool("tynn", "start", { id: "01kq5g6n87z59a3a8654re0bq4" });
    expect(mockClientInstance.callTool).toHaveBeenCalledWith({
      name: "start",
      arguments: { id: "01kq5g6n87z59a3a8654re0bq4" },
    });
    expect(result.isError).toBe(false);
    expect(result.content[0]!.type).toBe("text");
  });

  it("callTool propagates isError when SDK reports a failure", async () => {
    mockClientInstance.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "task not found" }],
      isError: true,
    });
    const result = await client.callTool("tynn", "start", { id: "missing" });
    expect(result.isError).toBe(true);
  });

  it("readResource returns contents array", async () => {
    mockClientInstance.readResource.mockResolvedValueOnce({
      contents: [{ uri: "file://x.md", text: "# Hello", mimeType: "text/markdown" }],
    });
    const result = await client.readResource("tynn", "file://x.md");
    expect(result.contents.length).toBe(1);
    expect(result.contents[0]!.text).toBe("# Hello");
  });

  it("throws when calling list/call methods on a non-connected server", async () => {
    const fresh = new McpClient();
    await fresh.registerServer({ id: "tynn", transport: "stdio", command: ["x"] });
    await expect(fresh.listTools("tynn")).rejects.toThrow(/not connected/);
  });

  it("throws when calling list/call methods on an unregistered server", async () => {
    await expect(client.listTools("ghost")).rejects.toThrow(/not registered/);
  });
});
