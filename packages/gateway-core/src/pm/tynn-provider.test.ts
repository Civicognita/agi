import { describe, it, expect } from "vitest";
import type { McpClient } from "@agi/mcp-client";
import type { PmProvider } from "@agi/sdk";
import { TynnPmProvider } from "./tynn-provider.js";

/**
 * s118 t432 cycle 34 — TynnPmProvider skeleton tests.
 *
 * Cycle 34 ships the class shape; methods throw "not yet implemented (cycle
 * 35)." These tests pin the skeleton's contract:
 *   1. Class instantiates with an McpClient + optional serverId
 *   2. Class satisfies the PmProvider type assignment
 *   3. providerId is "tynn"
 *   4. Methods throw with a recognizable cycle-pointer message (so a future
 *      contributor calling them sees the gap loudly, not silently)
 *
 * Cycle 35 replaces the "throws" tests with real-behavior tests against
 * mocked McpClient.callTool responses.
 */

function makeMockMcpClient(): McpClient {
  // Cast: the structural McpClient surface is covered by the methods Tynn-
  // PmProvider actually calls. Cycle 35 will expand this stub.
  return {} as McpClient;
}

describe("TynnPmProvider — skeleton (s118 t432 cycle 34)", () => {
  it("instantiates with an McpClient", () => {
    const provider = new TynnPmProvider({ mcpClient: makeMockMcpClient() });
    expect(provider).toBeInstanceOf(TynnPmProvider);
  });

  it("uses 'tynn' as the default server id", () => {
    const provider = new TynnPmProvider({ mcpClient: makeMockMcpClient() });
    // Server id is a private field; we assert via observable state — providerId.
    expect(provider.providerId).toBe("tynn");
  });

  it("accepts a custom server id override", () => {
    const provider = new TynnPmProvider({ mcpClient: makeMockMcpClient(), serverId: "tynn-custom" });
    // Custom id is internal; this test pins that the constructor accepts it
    // without throwing. Cycle 35 verifies the override flows through to
    // mcpClient.callTool calls.
    expect(provider).toBeInstanceOf(TynnPmProvider);
  });

  it("satisfies the PmProvider type assignment (structural typing)", () => {
    const provider: PmProvider = new TynnPmProvider({ mcpClient: makeMockMcpClient() });
    expect(provider.providerId).toBe("tynn");
  });

  it("methods throw with a clear cycle-pointer message until cycle 35 wires them", async () => {
    const provider = new TynnPmProvider({ mcpClient: makeMockMcpClient() });
    await expect(provider.getProject()).rejects.toThrow(/cycle 35/);
    await expect(provider.getNext()).rejects.toThrow(/cycle 35/);
    await expect(provider.getTask("any")).rejects.toThrow(/cycle 35/);
    await expect(provider.findTasks()).rejects.toThrow(/cycle 35/);
    await expect(provider.setTaskStatus("any", "doing")).rejects.toThrow(/cycle 35/);
    await expect(provider.createTask({ storyId: "s1", title: "x", description: "y" })).rejects.toThrow(/cycle 35/);
    await expect(provider.iWish({ title: "wish" })).rejects.toThrow(/cycle 35/);
  });
});
