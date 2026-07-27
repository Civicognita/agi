/**
 * `GatewayClient.chatSessions()` — unit test against a mocked `fetch`, no
 * real network/gateway needed. Added alongside `agi chat`'s workspace-scoped
 * session resume (`chat.ts` filters this method's result by `context` and
 * picks the most recently updated match) — this covers the HTTP-shape
 * contract that logic depends on.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { GatewayClient, GatewayUnreachableError } from "./gateway-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GatewayClient.chatSessions()", () => {
  it("fetches /api/chat/sessions and returns the sessions array", async () => {
    const sessions = [
      { id: "sess-1", context: "/some/project", contextLabel: "project", createdAt: "t1", updatedAt: "t2", messageCount: 3, lastPreview: "hi" },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessions }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GatewayClient("127.0.0.1", 3100);
    const result = await client.chatSessions();

    expect(result).toEqual(sessions);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/chat/sessions",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("throws GatewayUnreachableError when the gateway can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const client = new GatewayClient("127.0.0.1", 3100);
    await expect(client.chatSessions()).rejects.toThrow(GatewayUnreachableError);
  });
});
