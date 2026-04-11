/**
 * Gateway Bootstrap Integration Tests (pruned)
 *
 * Validates the core server lifecycle: boot, health, WebSocket, shutdown.
 * Uses a SINGLE shared server instance booted in beforeAll to avoid
 * repeated full-boot overhead and per-test timeout issues.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import { WebSocket } from "ws";

import { AionimaConfigSchema } from "@aionima/config";
import { startGatewayServer } from "./server.js";
import type { GatewayServer } from "./server.js";

// ---------------------------------------------------------------------------
// Shared server — boots once before all tests
// ---------------------------------------------------------------------------

const PORT = 47300;
let server: GatewayServer;

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
        } catch (err) { reject(err); }
      });
    });
    req.on("error", reject);
  });
}

// Boot timeout: 120s — full gateway boot loads SQLite, tools, plugins, etc.
beforeAll(async () => {
  const config = AionimaConfigSchema.parse({
    gateway: { host: "127.0.0.1", port: PORT, state: "OFFLINE" },
    entities: { path: ":memory:" },
    channels: [],
    dashboard: { enabled: false },
  });
  server = await startGatewayServer(config);
}, 120_000);

afterAll(async () => {
  await server?.close().catch(() => {});
}, 30_000);

// ---------------------------------------------------------------------------
// Tests (all use the pre-booted shared server)
// ---------------------------------------------------------------------------

describe("startGatewayServer() — bootstrap lifecycle", () => {
  it("responds to /health with correct shape", async () => {
    const { statusCode, body } = await httpGet(`http://127.0.0.1:${String(PORT)}/health`);

    expect(statusCode).toBe(200);
    const health = body as { ok: boolean; state: string; uptime: number; channels: number; sessions: number };
    expect(health.ok).toBe(true);
    expect(health.state).toBe("OFFLINE");
    expect(typeof health.uptime).toBe("number");
    expect(health.channels).toBe(0);
  });

  it("accepts WebSocket connections and responds to ping", async () => {
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const w = new WebSocket(`ws://127.0.0.1:${String(PORT)}`);
      w.once("open", () => resolve(w));
      w.once("error", reject);
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);

    const pong = await new Promise<unknown>((resolve) => {
      ws.once("message", (data) => {
        const msg = JSON.parse(data.toString()) as { type: string };
        if (msg.type === "pong") resolve(msg);
      });
      ws.send(JSON.stringify({ type: "ping" }));
    });
    expect((pong as { type: string }).type).toBe("pong");

    await new Promise<void>((r) => { ws.once("close", () => r()); ws.close(); });
  });

  it("returns 404 JSON for unknown routes", async () => {
    const { statusCode, body } = await httpGet(`http://127.0.0.1:${String(PORT)}/not-a-real-route`);
    expect(statusCode).toBe(404);
    expect((body as { error: string }).error).toBe("Not Found");
  });

  it("config defaults: channels defaults to empty, agent.resourceId defaults to $A0", () => {
    const config = AionimaConfigSchema.parse({
      gateway: { host: "127.0.0.1", port: 3100, state: "OFFLINE" },
      entities: { path: ":memory:" },
      dashboard: { enabled: false },
      agent: {},
    });
    expect(config.channels).toEqual([]);
    expect(config.agent?.resourceId).toBe("$A0");
    expect(config.agent?.nodeId).toBe("@A0");
  });
});
