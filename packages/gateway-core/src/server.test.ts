/**
 * Gateway Bootstrap Integration Tests
 *
 * Tests the full startGatewayServer() lifecycle using a real HTTP server
 * on an ephemeral port (port 0). No mocking of the server layer — this
 * exercises the real HTTP handler, WebSocket server, and shutdown sequence.
 *
 * Patterns followed:
 *   - describe/it structure (matching gateway.test.ts)
 *   - createDatabase(":memory:") for in-memory SQLite (no temp files needed)
 *   - afterEach cleanup to guarantee server teardown
 *   - Real HTTP requests via node:http
 *   - Real WebSocket connections via ws
 */

import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import { WebSocket } from "ws";

import { AionimaConfigSchema } from "@aionima/config";
import type { AionimaConfig } from "@aionima/config";
import { startGatewayServer } from "./server.js";
import type { GatewayServer } from "./server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid AionimaConfig parsed through the real schema so all
 * defaults are applied. Uses ":memory:" for the entity database so no files
 * are written during tests.
 */
function makeConfig(overrides: Partial<AionimaConfig> = {}): AionimaConfig {
  return AionimaConfigSchema.parse({
    gateway: {
      host: "127.0.0.1",
      port: 0, // OS assigns an ephemeral port
      state: "OFFLINE",
    },
    entities: {
      path: ":memory:",
    },
    channels: [],
    dashboard: { enabled: false }, // skip broadcaster timer in tests
    ...overrides,
  });
}

/**
 * Start the server and return both the server handle and the assigned port.
 * The HTTP server is on port 0, so we read the actual port from the listener.
 *
 * We use a small wrapper: startGatewayServer() returns GatewayServer but does
 * not expose the port. We need the port from the httpServer. Instead of
 * reaching into internals, we start on port 0 and then probe the OS to find
 * the open ephemeral port in range — but that's unreliable.
 *
 * Better approach: run on a deterministic high port per test using a shared
 * counter, which avoids port conflicts between parallel test forks.
 */
let nextPort = 47200;

function allocPort(): number {
  return nextPort++;
}

/**
 * Make an HTTP GET request and return { statusCode, body (parsed JSON) }.
 */
function httpGet(url: string): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8");
          const body = JSON.parse(text) as unknown;
          resolve({ statusCode: res.statusCode ?? 0, body });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
  });
}

/**
 * Open a WebSocket connection and wait for it to be open.
 * Returns the WebSocket instance.
 */
function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/**
 * Close a WebSocket and wait for it to fully close.
 */
function closeWebSocket(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.once("close", () => resolve());
    ws.close();
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("startGatewayServer() — bootstrap lifecycle", () => {
  // Track servers created in each test so afterEach can clean them up even
  // if the test itself throws before calling close().
  const servers: GatewayServer[] = [];

  afterEach(async () => {
    // Close all servers in reverse order, ignoring errors
    const toClose = servers.splice(0);
    await Promise.all(
      toClose.map((s) =>
        s.close().catch(() => {
          /* already closed or errored — ignore */
        }),
      ),
    );
  });

  // -------------------------------------------------------------------------
  // 1. Boot with minimal config
  // -------------------------------------------------------------------------

  it("boots with minimal config (no channels, no auth tokens)", async () => {
    const port = allocPort();
    const config = makeConfig({ gateway: { host: "127.0.0.1", port, state: "OFFLINE" } });

    const server = await startGatewayServer(config);
    servers.push(server);

    // Server should be running — verify by hitting /health
    const { statusCode } = await httpGet(`http://127.0.0.1:${String(port)}/health`);
    expect(statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 2. /health endpoint
  // -------------------------------------------------------------------------

  it("GET /health returns JSON with ok=true and correct shape", async () => {
    const port = allocPort();
    const config = makeConfig({ gateway: { host: "127.0.0.1", port, state: "OFFLINE" } });

    const server = await startGatewayServer(config);
    servers.push(server);

    const { statusCode, body } = await httpGet(`http://127.0.0.1:${String(port)}/health`);

    expect(statusCode).toBe(200);

    const health = body as {
      ok: boolean;
      state: string;
      uptime: number;
      channels: number;
      sessions: number;
    };

    expect(health.ok).toBe(true);
    expect(health.state).toBe("OFFLINE");
    expect(typeof health.uptime).toBe("number");
    expect(health.uptime).toBeGreaterThanOrEqual(0);
    expect(health.channels).toBe(0);
    expect(health.sessions).toBe(0);
  });

  it("GET /health returns state matching config.gateway.state", async () => {
    const port = allocPort();
    const config = makeConfig({ gateway: { host: "127.0.0.1", port, state: "ONLINE" } });

    const server = await startGatewayServer(config);
    servers.push(server);

    const { body } = await httpGet(`http://127.0.0.1:${String(port)}/health`);
    const health = body as { state: string };

    expect(health.state).toBe("ONLINE");
  });

  // -------------------------------------------------------------------------
  // 3. WebSocket connections accepted
  // -------------------------------------------------------------------------

  it("accepts WebSocket connections on the same port as HTTP", async () => {
    const port = allocPort();
    const config = makeConfig({ gateway: { host: "127.0.0.1", port, state: "OFFLINE" } });

    const server = await startGatewayServer(config);
    servers.push(server);

    const ws = await openWebSocket(`ws://127.0.0.1:${String(port)}`);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    await closeWebSocket(ws);
  });

  it("WebSocket ping message receives a pong broadcast", async () => {
    const port = allocPort();
    const config = makeConfig({ gateway: { host: "127.0.0.1", port, state: "OFFLINE" } });

    const server = await startGatewayServer(config);
    servers.push(server);

    const ws = await openWebSocket(`ws://127.0.0.1:${String(port)}`);

    const pongReceived = new Promise<unknown>((resolve) => {
      ws.once("message", (data) => {
        const msg = JSON.parse(data.toString()) as { type: string };
        if (msg.type === "pong") resolve(msg);
      });
    });

    ws.send(JSON.stringify({ type: "ping" }));
    const pong = await pongReceived;
    expect((pong as { type: string }).type).toBe("pong");

    await closeWebSocket(ws);
  });

  // -------------------------------------------------------------------------
  // 4. close() shuts down cleanly
  // -------------------------------------------------------------------------

  it("close() resolves without throwing", async () => {
    const port = allocPort();
    const config = makeConfig({ gateway: { host: "127.0.0.1", port, state: "OFFLINE" } });

    const server = await startGatewayServer(config);
    // Do not push to servers[] — we call close() ourselves in this test
    await expect(server.close()).resolves.toBeUndefined();
  });

  it("after close(), the HTTP server no longer accepts connections", async () => {
    const port = allocPort();
    const config = makeConfig({ gateway: { host: "127.0.0.1", port, state: "OFFLINE" } });

    const server = await startGatewayServer(config);

    // Confirm it's up
    const before = await httpGet(`http://127.0.0.1:${String(port)}/health`);
    expect(before.statusCode).toBe(200);

    await server.close();

    // After close, new connections should be rejected
    await expect(httpGet(`http://127.0.0.1:${String(port)}/health`)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // 5. close() is idempotent (calling twice does not throw)
  // -------------------------------------------------------------------------

  it("close() is idempotent — calling twice does not throw", async () => {
    const port = allocPort();
    const config = makeConfig({ gateway: { host: "127.0.0.1", port, state: "OFFLINE" } });

    const server = await startGatewayServer(config);

    await expect(server.close()).resolves.toBeUndefined();
    await expect(server.close()).resolves.toBeUndefined(); // second call — no-op
  });

  // -------------------------------------------------------------------------
  // 6. Config defaults are applied correctly
  // -------------------------------------------------------------------------

  it("config defaults: channels list defaults to empty array", async () => {
    const port = allocPort();
    // Parse config with no channels key — schema should default to []
    const config = AionimaConfigSchema.parse({
      gateway: { host: "127.0.0.1", port, state: "OFFLINE" },
      entities: { path: ":memory:" },
      dashboard: { enabled: false },
    });

    expect(config.channels).toEqual([]);

    const server = await startGatewayServer(config);
    servers.push(server);

    const { body } = await httpGet(`http://127.0.0.1:${String(port)}/health`);
    expect((body as { channels: number }).channels).toBe(0);
  });

  it("config defaults: auth tokens default to empty (loopback access still works)", async () => {
    const port = allocPort();
    const config = AionimaConfigSchema.parse({
      gateway: { host: "127.0.0.1", port, state: "OFFLINE" },
      entities: { path: ":memory:" },
      dashboard: { enabled: false },
      // No auth section — defaults apply
    });

    expect(config.auth).toBeUndefined();

    const server = await startGatewayServer(config);
    servers.push(server);

    // Loopback should not require a token even with no tokens configured
    const { statusCode } = await httpGet(`http://127.0.0.1:${String(port)}/health`);
    expect(statusCode).toBe(200);
  });

  it("config defaults: agent.resourceId defaults to $A0", () => {
    const config = AionimaConfigSchema.parse({
      gateway: { host: "127.0.0.1", port: 3100, state: "OFFLINE" },
      entities: { path: ":memory:" },
      dashboard: { enabled: false },
    });

    // agent section is undefined (optional), server uses "?? '$A0'" fallback
    expect(config.agent).toBeUndefined();
    // Verify the schema default kicks in when agent is provided explicitly
    const configWithAgent = AionimaConfigSchema.parse({
      gateway: { host: "127.0.0.1", port: 3100, state: "OFFLINE" },
      entities: { path: ":memory:" },
      dashboard: { enabled: false },
      agent: {},
    });
    expect(configWithAgent.agent?.resourceId).toBe("$A0");
    expect(configWithAgent.agent?.nodeId).toBe("@A0");
  });

  // -------------------------------------------------------------------------
  // 7. 404 for unknown routes
  // -------------------------------------------------------------------------

  it("returns 404 JSON for unknown routes", async () => {
    const port = allocPort();
    const config = makeConfig({ gateway: { host: "127.0.0.1", port, state: "OFFLINE" } });

    const server = await startGatewayServer(config);
    servers.push(server);

    const { statusCode, body } = await httpGet(`http://127.0.0.1:${String(port)}/not-a-real-route`);
    expect(statusCode).toBe(404);
    expect((body as { error: string }).error).toBe("Not Found");
  });

  // -------------------------------------------------------------------------
  // 8. GatewayServerOptions — port override
  // -------------------------------------------------------------------------

  it("port override via GatewayServerOptions takes precedence over config.gateway.port", async () => {
    const configPort = allocPort();
    const overridePort = allocPort();

    const config = makeConfig({ gateway: { host: "127.0.0.1", port: configPort, state: "OFFLINE" } });

    // Start on overridePort instead of configPort
    const server = await startGatewayServer(config, { port: overridePort });
    servers.push(server);

    // overridePort should respond
    const { statusCode } = await httpGet(`http://127.0.0.1:${String(overridePort)}/health`);
    expect(statusCode).toBe(200);

    // configPort should not be listening
    await expect(httpGet(`http://127.0.0.1:${String(configPort)}/health`)).rejects.toThrow();
  });
});
