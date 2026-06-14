/**
 * screenshot.ts unit tests — readiness probe behavior (s198).
 *
 * Playwright launch is not exercised (requires browser binary + real URLs).
 * These tests verify the readiness probe logic in isolation by controlling
 * what fetch() returns via a simple HTTP server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the probe indirectly by checking captureProjectScreenshot's log
// output and return value when given a URL that is or isn't ready.
// Since we can't mock `fetch` at the module level (it's global), we spin up
// a tiny http server and point the probe at it.

import * as http from "node:http";
import * as net from "node:net";
import { captureProjectScreenshot } from "./screenshot.js";

function makeTempServer(handler: http.RequestListener): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        url,
        close: () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
    server.on("error", reject);
  });
}

describe("captureProjectScreenshot — readiness probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proceeds immediately when probe=0 (disabled)", async () => {
    const logs: string[] = [];
    // With probe disabled, function should attempt Playwright (which will fail
    // without a browser binary — that's fine, we just want null back quickly).
    const result = await captureProjectScreenshot({
      hostingUrl: "http://127.0.0.1:1",  // unreachable — Playwright will fail
      readinessProbeMs: 0,               // skip probe entirely
      timeoutMs: 500,
      log: (m) => logs.push(m),
    });
    // No probe log, just Playwright failure
    expect(logs.some((m) => m.includes("readiness probe"))).toBe(false);
    expect(result).toBeNull();
  });

  it("proceeds after probe succeeds on first attempt", async () => {
    const { url, close } = await makeTempServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    const logs: string[] = [];
    const result = await captureProjectScreenshot({
      hostingUrl: url,
      readinessProbeMs: 5_000,
      probeIntervalMs: 200,
      timeoutMs: 500,
      log: (m) => logs.push(m),
    });

    await close();
    // No retry logs — succeeded on attempt 1
    expect(logs.some((m) => m.includes("retrying"))).toBe(false);
    // Playwright will fail (no browser binary in unit test env) but probe passed
    expect(result).toBeNull();
  });

  it("retries probe until server becomes ready", async () => {
    let callCount = 0;
    const { url, close } = await makeTempServer((_req, res) => {
      callCount++;
      if (callCount < 3) {
        res.writeHead(503);
        res.end("not ready");
      } else {
        res.writeHead(200);
        res.end("ok");
      }
    });

    const logs: string[] = [];
    await captureProjectScreenshot({
      hostingUrl: url,
      readinessProbeMs: 10_000,
      probeIntervalMs: 100,
      timeoutMs: 500,
      log: (m) => logs.push(m),
    });

    await close();
    // Should have retried twice before succeeding
    expect(logs.filter((m) => m.includes("retrying")).length).toBe(2);
    expect(logs.some((m) => m.includes("succeeded after 3 attempts"))).toBe(true);
  });

  it("proceeds after probe timeout (does not return null early)", async () => {
    // Server always returns 503 — probe will time out
    const { url, close } = await makeTempServer((_req, res) => {
      res.writeHead(503);
      res.end("not ready");
    });

    const logs: string[] = [];
    const result = await captureProjectScreenshot({
      hostingUrl: url,
      readinessProbeMs: 300,   // very short timeout for test speed
      probeIntervalMs: 100,
      timeoutMs: 500,
      log: (m) => logs.push(m),
    });

    await close();
    // Probe timed out but function still tried (and failed due to no browser binary)
    expect(logs.some((m) => m.includes("timed out"))).toBe(true);
    expect(result).toBeNull();
  });
});
