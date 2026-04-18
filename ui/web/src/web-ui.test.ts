import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import type { Server } from "node:http";

import { PUBLIC_DIR } from "./index.js";
import { createWebChatServer, startWebChatServer } from "./static-server.js";
import { GatewayWebSocketServer } from "@agi/gateway-core";

// ---------------------------------------------------------------------------
// Port range: 19200–19299 — high range to avoid conflicts with other tests
// ---------------------------------------------------------------------------

const BASE_PORT = 19200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stop an HTTP server and resolve when it is fully closed. */
function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err !== undefined) reject(err);
      else resolve();
    });
  });
}

/** GET a URL and return { status, contentType, body }. */
async function get(url: string): Promise<{ status: number; contentType: string | null; body: string }> {
  const res = await fetch(url);
  const body = await res.text();
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    body,
  };
}

/**
 * Make a raw HTTP GET request without URL normalisation.
 * fetch() and URL objects normalise paths, removing `..` segments before they
 * reach the server.  We use Node's low-level http.request() and pass the path
 * verbatim so the server sees exactly what we send.
 */
function rawGet(host: string, port: number, rawPath: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host, port, path: rawPath, method: "GET" }, (res) => {
      res.resume(); // drain body
      resolve({ status: res.statusCode ?? 0 });
    });
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// 1. PUBLIC_DIR
// ---------------------------------------------------------------------------

describe("PUBLIC_DIR", () => {
  it("is an absolute path", () => {
    // Absolute paths start with / on Unix or a drive letter on Windows
    expect(PUBLIC_DIR).toMatch(/^(?:\/|[A-Za-z]:\\)/);
  });

  it("points to a directory that exists on disk", () => {
    expect(existsSync(PUBLIC_DIR)).toBe(true);
  });

  it("contains index.html", () => {
    expect(existsSync(join(PUBLIC_DIR, "index.html"))).toBe(true);
  });

  it("contains style.css", () => {
    expect(existsSync(join(PUBLIC_DIR, "style.css"))).toBe(true);
  });

  it("contains app.js", () => {
    expect(existsSync(join(PUBLIC_DIR, "app.js"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. createWebChatServer()
// ---------------------------------------------------------------------------

describe("createWebChatServer()", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server !== null && server.listening) {
      await stopServer(server);
      server = null;
    }
  });

  it("returns an HTTP Server instance", () => {
    // Create the server but do not start it — just inspect the returned object
    const s = createWebChatServer();
    expect(typeof s.listen).toBe("function");
    // Not assigned to `server` so afterEach does not attempt to close it
  });

  it("serves index.html at /", async () => {
    server = createWebChatServer();
    await new Promise<void>((resolve) => server!.listen(BASE_PORT, "127.0.0.1", resolve));

    const { status, contentType, body } = await get(`http://127.0.0.1:${BASE_PORT}/`);

    expect(status).toBe(200);
    expect(contentType).toContain("text/html");
    expect(body).toContain("<!DOCTYPE html>");
  });

  it("serves index.html at /index.html", async () => {
    server = createWebChatServer();
    await new Promise<void>((resolve) => server!.listen(BASE_PORT + 1, "127.0.0.1", resolve));

    const { status, contentType } = await get(`http://127.0.0.1:${BASE_PORT + 1}/index.html`);

    expect(status).toBe(200);
    expect(contentType).toContain("text/html");
  });

  it("serves style.css with text/css MIME type", async () => {
    server = createWebChatServer();
    await new Promise<void>((resolve) => server!.listen(BASE_PORT + 2, "127.0.0.1", resolve));

    const { status, contentType } = await get(`http://127.0.0.1:${BASE_PORT + 2}/style.css`);

    expect(status).toBe(200);
    expect(contentType).toContain("text/css");
  });

  it("serves app.js with application/javascript MIME type", async () => {
    server = createWebChatServer();
    await new Promise<void>((resolve) => server!.listen(BASE_PORT + 3, "127.0.0.1", resolve));

    const { status, contentType } = await get(`http://127.0.0.1:${BASE_PORT + 3}/app.js`);

    expect(status).toBe(200);
    expect(contentType).toContain("application/javascript");
  });

  it("returns 404 for a file that does not exist", async () => {
    server = createWebChatServer();
    await new Promise<void>((resolve) => server!.listen(BASE_PORT + 4, "127.0.0.1", resolve));

    const { status } = await get(`http://127.0.0.1:${BASE_PORT + 4}/does-not-exist.txt`);

    expect(status).toBe(404);
  });

  it("returns 403 for a path containing ..", async () => {
    server = createWebChatServer();
    await new Promise<void>((resolve) => server!.listen(BASE_PORT + 5, "127.0.0.1", resolve));

    // Use raw HTTP so the `..` segment is not normalised away by URL parsing
    const { status } = await rawGet("127.0.0.1", BASE_PORT + 5, "/../etc/passwd");

    expect(status).toBe(403);
  });

  it("returns 403 for a path with literal .. segment", async () => {
    server = createWebChatServer();
    await new Promise<void>((resolve) => server!.listen(BASE_PORT + 6, "127.0.0.1", resolve));

    // Verify that any path where filename.includes("..") is true gets 403
    const { status } = await rawGet("127.0.0.1", BASE_PORT + 6, "/foo/../bar");

    expect(status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 3. startWebChatServer()
// ---------------------------------------------------------------------------

describe("startWebChatServer()", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server !== null && server.listening) {
      await stopServer(server);
      server = null;
    }
  });

  it("resolves with an HTTP Server instance", async () => {
    server = await startWebChatServer({ port: BASE_PORT + 10 });
    expect(typeof server.listen).toBe("function");
  });

  it("starts listening on the specified port", async () => {
    server = await startWebChatServer({ port: BASE_PORT + 11 });

    const { status } = await get(`http://127.0.0.1:${BASE_PORT + 11}/`);
    expect(status).toBe(200);
  });

  it("accepts an optional host parameter", async () => {
    server = await startWebChatServer({ port: BASE_PORT + 12, host: "127.0.0.1" });

    const { status } = await get(`http://127.0.0.1:${BASE_PORT + 12}/`);
    expect(status).toBe(200);
  });

  it("rejects if the port is already in use", async () => {
    // Start a server on the port first
    server = await startWebChatServer({ port: BASE_PORT + 13 });

    // Attempting to start a second server on the same port should reject
    await expect(startWebChatServer({ port: BASE_PORT + 13 })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. GatewayWebSocketServer — HTTP server attachment
//
// Node 22 ships a native WebSocket global — no 'ws' package import needed.
// ---------------------------------------------------------------------------

describe("GatewayWebSocketServer with HTTP server option", () => {
  let httpServer: Server | null = null;
  let wsGateway: GatewayWebSocketServer | null = null;

  afterEach(async () => {
    if (wsGateway !== null) {
      await wsGateway.stop();
      wsGateway = null;
    }
    if (httpServer !== null && httpServer.listening) {
      await stopServer(httpServer);
      httpServer = null;
    }
  });

  it("attaches to an existing HTTP server without throwing", async () => {
    httpServer = await startWebChatServer({ port: BASE_PORT + 20 });
    wsGateway = new GatewayWebSocketServer({ server: httpServer });

    await expect(wsGateway.start()).resolves.toBeUndefined();
  });

  it("getConnectionCount returns 0 before any clients connect", async () => {
    httpServer = await startWebChatServer({ port: BASE_PORT + 21 });
    wsGateway = new GatewayWebSocketServer({ server: httpServer });
    await wsGateway.start();

    expect(wsGateway.getConnectionCount()).toBe(0);
  });

  it("accepts a WebSocket connection over the shared HTTP server port", async () => {
    const port = BASE_PORT + 22;
    httpServer = await startWebChatServer({ port });
    wsGateway = new GatewayWebSocketServer({ server: httpServer });
    await wsGateway.start();

    // Use native Node 22 WebSocket global
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.addEventListener("open", () => {
        ws.close();
        resolve();
      });
      ws.addEventListener("error", (ev) => reject(new Error(`WebSocket error: ${String(ev)}`)));
    });
  });

  it("increments connection count when a client connects", async () => {
    const port = BASE_PORT + 23;
    httpServer = await startWebChatServer({ port });
    wsGateway = new GatewayWebSocketServer({ server: httpServer });
    await wsGateway.start();

    const connectionPromise = new Promise<void>((resolve) => {
      wsGateway!.once("connection", () => resolve());
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await connectionPromise;

    expect(wsGateway.getConnectionCount()).toBe(1);

    const disconnectionPromise = new Promise<void>((resolve) => {
      wsGateway!.once("disconnection", () => resolve());
    });
    ws.close();
    await disconnectionPromise;
  });

  it("emits the 'connection' event with an id and meta when a client connects", async () => {
    const port = BASE_PORT + 24;
    httpServer = await startWebChatServer({ port });
    wsGateway = new GatewayWebSocketServer({ server: httpServer });
    await wsGateway.start();

    const eventData = await new Promise<{ id: string; meta: { connectedAt: string } }>((resolve) => {
      wsGateway!.once("connection", (id: string, meta: { connectedAt: string }) => {
        resolve({ id, meta });
      });
      void new WebSocket(`ws://127.0.0.1:${port}`);
    });

    expect(typeof eventData.id).toBe("string");
    expect(eventData.id.length).toBeGreaterThan(0);
    expect(() => new Date(eventData.meta.connectedAt)).not.toThrow();
  });

  it("HTTP static files are still served over the shared port while WebSocket is attached", async () => {
    const port = BASE_PORT + 25;
    httpServer = await startWebChatServer({ port });
    wsGateway = new GatewayWebSocketServer({ server: httpServer });
    await wsGateway.start();

    // Regular HTTP GET should still work on the same port
    const { status, contentType } = await get(`http://127.0.0.1:${port}/`);
    expect(status).toBe(200);
    expect(contentType).toContain("text/html");
  });

  it("receives a JSON message from a connected client and emits the 'message' event", async () => {
    const port = BASE_PORT + 26;
    httpServer = await startWebChatServer({ port });
    wsGateway = new GatewayWebSocketServer({ server: httpServer });
    await wsGateway.start();

    const messagePromise = new Promise<{ connectionId: string; msg: { type: string } }>((resolve) => {
      wsGateway!.once("message", (connectionId: string, msg: { type: string }) => {
        resolve({ connectionId, msg });
      });
    });

    // Open the connection then send after open
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ type: "ping", payload: { ts: Date.now() } }));
        resolve();
      });
    });

    const received = await messagePromise;
    expect(received.msg.type).toBe("ping");
  });
});
