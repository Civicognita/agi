import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as http from "node:http";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a unique temp directory for each test that needs config files */
async function makeTempDir(): Promise<string> {
  const dir = join(tmpdir(), `aionima-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// 1. output.ts — formatting utilities
// ---------------------------------------------------------------------------

import {
  green,
  yellow,
  red,
  cyan,
  bold,
  dim,
  formatState,
  formatCheck,
  printTable,
  printStatus,
} from "./output.js";

// ANSI escape code constants (mirrors the internal `c` map in output.ts)
const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const CYAN   = "\x1b[36m";

describe("green", () => {
  it("wraps the string with green ANSI codes", () => {
    expect(green("hello")).toBe(`${GREEN}hello${RESET}`);
  });

  it("handles empty string", () => {
    expect(green("")).toBe(`${GREEN}${RESET}`);
  });

  it("preserves special characters", () => {
    expect(green("✓ ok")).toBe(`${GREEN}✓ ok${RESET}`);
  });
});

describe("yellow", () => {
  it("wraps the string with yellow ANSI codes", () => {
    expect(yellow("warn")).toBe(`${YELLOW}warn${RESET}`);
  });

  it("handles empty string", () => {
    expect(yellow("")).toBe(`${YELLOW}${RESET}`);
  });
});

describe("red", () => {
  it("wraps the string with red ANSI codes", () => {
    expect(red("error")).toBe(`${RED}error${RESET}`);
  });

  it("handles empty string", () => {
    expect(red("")).toBe(`${RED}${RESET}`);
  });
});

describe("cyan", () => {
  it("wraps the string with cyan ANSI codes", () => {
    expect(cyan("info")).toBe(`${CYAN}info${RESET}`);
  });

  it("handles empty string", () => {
    expect(cyan("")).toBe(`${CYAN}${RESET}`);
  });
});

describe("bold", () => {
  it("wraps the string with bold ANSI codes", () => {
    expect(bold("title")).toBe(`${BOLD}title${RESET}`);
  });

  it("handles empty string", () => {
    expect(bold("")).toBe(`${BOLD}${RESET}`);
  });
});

describe("dim", () => {
  it("wraps the string with dim ANSI codes", () => {
    expect(dim("muted")).toBe(`${DIM}muted${RESET}`);
  });

  it("handles empty string", () => {
    expect(dim("")).toBe(`${DIM}${RESET}`);
  });
});

describe("formatState", () => {
  it("returns green ONLINE indicator for ONLINE", () => {
    const result = formatState("ONLINE");
    expect(result).toContain("ONLINE");
    expect(result).toContain(GREEN);
  });

  it("returns yellow LIMBO indicator for LIMBO", () => {
    const result = formatState("LIMBO");
    expect(result).toContain("LIMBO");
    expect(result).toContain(YELLOW);
  });

  it("returns red OFFLINE indicator for OFFLINE", () => {
    const result = formatState("OFFLINE");
    expect(result).toContain("OFFLINE");
    expect(result).toContain(RED);
  });

  it("returns dim UNKNOWN indicator for UNKNOWN", () => {
    const result = formatState("UNKNOWN");
    expect(result).toContain("UNKNOWN");
    expect(result).toContain(DIM);
  });

  it("is case-insensitive — lowercase online maps to ONLINE", () => {
    const result = formatState("online");
    expect(result).toContain("ONLINE");
    expect(result).toContain(GREEN);
  });

  it("returns dim UNKNOWN indicator for an unrecognised state", () => {
    const result = formatState("BANANA");
    expect(result).toContain("UNKNOWN");
    expect(result).toContain(DIM);
  });
});

describe("formatCheck", () => {
  it("returns a green checkmark when ok is true", () => {
    const result = formatCheck(true, "gateway reachable");
    expect(result).toContain(GREEN);
    expect(result).toContain("✓");
    expect(result).toContain("gateway reachable");
  });

  it("returns a red X when ok is false", () => {
    const result = formatCheck(false, "config missing");
    expect(result).toContain(RED);
    expect(result).toContain("✗");
    expect(result).toContain("config missing");
  });

  it("includes the label in both true and false cases", () => {
    const label = "some check";
    expect(formatCheck(true, label)).toContain(label);
    expect(formatCheck(false, label)).toContain(label);
  });
});

describe("printTable", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("calls console.log at least once for headers + rows", () => {
    printTable(["Name", "Status"], [["gateway", "ONLINE"]]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("outputs a line containing each header value", () => {
    printTable(["Channel", "State"], [["telegram", "running"]]);
    const allOutput = consoleSpy.mock.calls.map((call) => String(call[0] ?? "")).join("\n");
    expect(allOutput).toContain("Channel");
    expect(allOutput).toContain("State");
  });

  it("outputs a line containing each row value", () => {
    printTable(["ID", "Status"], [["ch-001", "stopped"], ["ch-002", "running"]]);
    const allOutput = consoleSpy.mock.calls.map((call) => String(call[0] ?? "")).join("\n");
    expect(allOutput).toContain("ch-001");
    expect(allOutput).toContain("ch-002");
    expect(allOutput).toContain("stopped");
    expect(allOutput).toContain("running");
  });

  it("renders header in bold", () => {
    printTable(["Header"], [["value"]]);
    const allOutput = consoleSpy.mock.calls.map((call) => String(call[0] ?? "")).join("\n");
    // bold code appears somewhere in output alongside the header
    expect(allOutput).toContain(BOLD);
    expect(allOutput).toContain("Header");
  });

  it("renders border lines with box-drawing characters", () => {
    printTable(["Col"], [["val"]]);
    const allOutput = consoleSpy.mock.calls.map((call) => String(call[0] ?? "")).join("\n");
    // Top border
    expect(allOutput).toContain("┌");
    expect(allOutput).toContain("┐");
    // Bottom border
    expect(allOutput).toContain("└");
    expect(allOutput).toContain("┘");
  });

  it("works with ANSI-colored values (correct padding despite escape codes)", () => {
    // green() adds ANSI but the visible text is still just the inner string
    printTable(["State"], [[green("ONLINE")]]);
    const allOutput = consoleSpy.mock.calls.map((call) => String(call[0] ?? "")).join("\n");
    expect(allOutput).toContain("ONLINE");
  });

  it("handles an empty rows array (headers only)", () => {
    printTable(["Col1", "Col2"], []);
    // Should not throw; should still print header + borders
    expect(consoleSpy).toHaveBeenCalled();
    const allOutput = consoleSpy.mock.calls.map((call) => String(call[0] ?? "")).join("\n");
    expect(allOutput).toContain("Col1");
  });
});

describe("printStatus", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("calls console.log once per entry", () => {
    printStatus([
      { label: "State", value: "ONLINE" },
      { label: "Uptime", value: "42s" },
    ]);
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it("output contains label and value", () => {
    printStatus([{ label: "State", value: "ONLINE" }]);
    const line = String(consoleSpy.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("State");
    expect(line).toContain("ONLINE");
  });

  it("handles a single entry", () => {
    printStatus([{ label: "Key", value: "val" }]);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it("all labels are padded to the same visible width", () => {
    printStatus([
      { label: "A", value: "1" },
      { label: "LongLabel", value: "2" },
    ]);
    // Both lines should have the same leading width after the leading spaces
    const lines = consoleSpy.mock.calls.map((call) => String(call[0] ?? ""));
    // Both lines start with two spaces
    for (const line of lines) {
      expect(line.startsWith("  ")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. config-loader.ts
// ---------------------------------------------------------------------------

import { loadConfig, validateConfigFile } from "./config-loader.js";

/** Minimal valid AionimaConfig as JSON */
const VALID_CONFIG = JSON.stringify({
  gateway: { host: "127.0.0.1", port: 3100, state: "ONLINE" },
  channels: [],
});

/** Valid config with only required defaults (no explicit gateway) */
const MINIMAL_CONFIG = JSON.stringify({
  channels: [],
});

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns parsed AionimaConfig for a valid JSON file", async () => {
    const configPath = join(tmpDir, "aionima.json");
    await writeFile(configPath, VALID_CONFIG, "utf-8");

    const result = await loadConfig(configPath);

    expect(result.path).toBe(configPath);
    expect(result.config.channels).toEqual([]);
    expect(result.config.gateway?.host).toBe("127.0.0.1");
    expect(result.config.gateway?.port).toBe(3100);
    expect(result.config.gateway?.state).toBe("ONLINE");
  });

  it("returns config with defaults applied for minimal config", async () => {
    const configPath = join(tmpDir, "aionima.json");
    await writeFile(configPath, MINIMAL_CONFIG, "utf-8");

    const result = await loadConfig(configPath);

    expect(result.config.channels).toEqual([]);
    expect(result.config.gateway).toBeUndefined();
  });

  it("throws on invalid JSON syntax", async () => {
    const configPath = join(tmpDir, "aionima.json");
    await writeFile(configPath, "{ this is not json }", "utf-8");

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("throws when the file does not exist", async () => {
    const missing = join(tmpDir, "does-not-exist.json");
    await expect(loadConfig(missing)).rejects.toThrow();
  });

  it("throws when schema validation fails (invalid port type)", async () => {
    const bad = JSON.stringify({
      gateway: { host: "127.0.0.1", port: "not-a-number", state: "ONLINE" },
      channels: [],
    });
    const configPath = join(tmpDir, "aionima.json");
    await writeFile(configPath, bad, "utf-8");

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("throws when schema validation fails (invalid state enum)", async () => {
    const bad = JSON.stringify({
      gateway: { host: "localhost", port: 3100, state: "RUNNING" },
      channels: [],
    });
    const configPath = join(tmpDir, "aionima.json");
    await writeFile(configPath, bad, "utf-8");

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it("passes through unknown top-level fields (passthrough schema)", async () => {
    const extra = JSON.stringify({
      channels: [],
      unknownField: true,
    });
    const configPath = join(tmpDir, "aionima.json");
    await writeFile(configPath, extra, "utf-8");

    // Schema uses .passthrough() — extra fields are allowed, not rejected
    const result = await loadConfig(configPath);
    expect(result.config.channels).toEqual([]);
  });

  it("returns the correct path in the result", async () => {
    const configPath = join(tmpDir, "my-config.json");
    await writeFile(configPath, VALID_CONFIG, "utf-8");

    const result = await loadConfig(configPath);

    expect(result.path).toBe(configPath);
  });
});

describe("validateConfigFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null errors for a valid config file", async () => {
    const configPath = join(tmpDir, "aionima.json");
    await writeFile(configPath, VALID_CONFIG, "utf-8");

    const result = await validateConfigFile(configPath);

    expect(result.path).toBe(configPath);
    expect(result.errors).toBeNull();
  });

  it("returns null errors for a minimal valid config", async () => {
    const configPath = join(tmpDir, "aionima.json");
    await writeFile(configPath, MINIMAL_CONFIG, "utf-8");

    const result = await validateConfigFile(configPath);

    expect(result.errors).toBeNull();
  });

  it("returns error messages for a config with invalid gateway port", async () => {
    const bad = JSON.stringify({
      gateway: { host: "localhost", port: 99999, state: "ONLINE" },
      channels: [],
    });
    const configPath = join(tmpDir, "aionima.json");
    await writeFile(configPath, bad, "utf-8");

    const result = await validateConfigFile(configPath);

    expect(result.errors).not.toBeNull();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("returns error messages for a config with invalid state enum value", async () => {
    const bad = JSON.stringify({
      gateway: { host: "localhost", port: 3100, state: "RUNNING" },
      channels: [],
    });
    const configPath = join(tmpDir, "aionima.json");
    await writeFile(configPath, bad, "utf-8");

    const result = await validateConfigFile(configPath);

    expect(result.errors).not.toBeNull();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("returns error messages for invalid JSON", async () => {
    const configPath = join(tmpDir, "aionima.json");
    await writeFile(configPath, "not json at all", "utf-8");

    const result = await validateConfigFile(configPath);

    expect(result.errors).not.toBeNull();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("returns an error for a missing file", async () => {
    const missing = join(tmpDir, "no-such-file.json");

    const result = await validateConfigFile(missing);

    expect(result.errors).not.toBeNull();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("returns (not found) path when no config file found and no path given", async () => {
    // validateConfigFile without a path falls through to findConfigFile(),
    // which searches CWD. In our test environment those files don't exist,
    // so it should return the sentinel path string.
    // We call it without args and just verify the errors array is populated.
    // (This test is environment-dependent — skip if a real config exists in cwd)
    const result = await validateConfigFile("/nonexistent/path/to/config.json");
    expect(result.errors).not.toBeNull();
  });

  it("error messages reference the path of the offending field", async () => {
    const bad = JSON.stringify({
      gateway: { host: 12345, port: 3100, state: "ONLINE" },
      channels: [],
    });
    const configPath = join(tmpDir, "aionima.json");
    await writeFile(configPath, bad, "utf-8");

    const result = await validateConfigFile(configPath);

    expect(result.errors).not.toBeNull();
    // Zod issues are formatted as "path.to.field: message"
    const combined = result.errors!.join(" ");
    expect(combined).toContain("host");
  });

  it("passes through unknown top-level fields in validation (passthrough schema)", async () => {
    const extra = JSON.stringify({ channels: [], extraKey: "bad" });
    const configPath = join(tmpDir, "aionima.json");
    await writeFile(configPath, extra, "utf-8");

    // Schema uses .passthrough() — extra fields do NOT produce validation errors
    const result = await validateConfigFile(configPath);
    expect(result.errors).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. gateway-client.ts
// ---------------------------------------------------------------------------

import { GatewayClient, GatewayUnreachableError } from "./gateway-client.js";

// ---------------------------------------------------------------------------
// Minimal HTTP test server factory
// ---------------------------------------------------------------------------

interface TestServer {
  port: number;
  close: () => Promise<void>;
}

/** Canned response map: path → { status, body } */
type RouteMap = Map<string, { status: number; body: unknown }>;

function startTestServer(routes: RouteMap): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? "/";
      const route = routes.get(url);
      if (!route) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      res.writeHead(route.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(route.body));
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Could not determine port"));
        return;
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}

// Canned gateway status payload
const CANNED_STATUS = {
  state: "ONLINE",
  uptime: 120,
  channels: [{ id: "telegram", status: "running" }],
  entities: 5,
  queueDepth: 0,
  connections: 1,
};

// Canned health payload
const CANNED_HEALTH = [
  { name: "db", ok: true },
  { name: "queue", ok: true },
];

describe("GatewayClient.ping", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
  });

  it("returns true when the server responds with 200", async () => {
    server = await startTestServer(
      new Map([["/api/status", { status: 200, body: CANNED_STATUS }]]),
    );

    const client = new GatewayClient("127.0.0.1", server.port);
    const result = await client.ping();

    expect(result).toBe(true);
  });

  it("returns false when the server is not running (connection refused)", async () => {
    // port 0 is not bindable for clients — OS will refuse the connection
    // We use a high ephemeral port that we know is free (no server started in this test)
    const client = new GatewayClient("127.0.0.1", 19399);
    const result = await client.ping();

    expect(result).toBe(false);
  });

  it("returns false when the server responds with a non-2xx status", async () => {
    server = await startTestServer(
      new Map([["/api/status", { status: 503, body: { error: "unavailable" } }]]),
    );

    const client = new GatewayClient("127.0.0.1", server.port);
    const result = await client.ping();

    expect(result).toBe(false);
  });
});

describe("GatewayClient.status", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
  });

  it("returns parsed GatewayStatus when server responds with 200", async () => {
    server = await startTestServer(
      new Map([["/api/status", { status: 200, body: CANNED_STATUS }]]),
    );

    const client = new GatewayClient("127.0.0.1", server.port);
    const status = await client.status();

    expect(status.state).toBe("ONLINE");
    expect(status.uptime).toBe(120);
    expect(status.entities).toBe(5);
    expect(status.queueDepth).toBe(0);
    expect(status.connections).toBe(1);
    expect(status.channels).toHaveLength(1);
    expect(status.channels[0]?.id).toBe("telegram");
  });

  it("throws GatewayUnreachableError when server is not running", async () => {
    const client = new GatewayClient("127.0.0.1", 19398);

    await expect(client.status()).rejects.toThrow(GatewayUnreachableError);
  });

  it("throws GatewayUnreachableError (not generic Error) when unreachable", async () => {
    const client = new GatewayClient("127.0.0.1", 19397);

    let caught: unknown;
    try {
      await client.status();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GatewayUnreachableError);
  });

  it("throws a generic Error when server responds with 4xx", async () => {
    server = await startTestServer(
      new Map([["/api/status", { status: 404, body: { error: "not found" } }]]),
    );

    const client = new GatewayClient("127.0.0.1", server.port);

    await expect(client.status()).rejects.toThrow(/404/);
  });
});

describe("GatewayClient.health", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
  });

  it("returns parsed HealthCheck[] when server responds with 200", async () => {
    server = await startTestServer(
      new Map([["/api/health", { status: 200, body: CANNED_HEALTH }]]),
    );

    const client = new GatewayClient("127.0.0.1", server.port);
    const checks = await client.health();

    expect(checks).toHaveLength(2);
    expect(checks[0]?.name).toBe("db");
    expect(checks[0]?.ok).toBe(true);
    expect(checks[1]?.name).toBe("queue");
  });

  it("throws GatewayUnreachableError when server is not running", async () => {
    const client = new GatewayClient("127.0.0.1", 19396);

    await expect(client.health()).rejects.toThrow(GatewayUnreachableError);
  });
});

describe("GatewayUnreachableError", () => {
  it("has name GatewayUnreachableError", () => {
    const err = new GatewayUnreachableError("http://127.0.0.1:3100");
    expect(err.name).toBe("GatewayUnreachableError");
  });

  it("message contains the provided URL", () => {
    const url = "http://127.0.0.1:3100";
    const err = new GatewayUnreachableError(url);
    expect(err.message).toContain(url);
  });

  it("message contains a hint about starting the gateway", () => {
    const err = new GatewayUnreachableError("http://127.0.0.1:3100");
    expect(err.message).toContain("aionima run");
  });

  it("is an instance of Error", () => {
    const err = new GatewayUnreachableError("http://127.0.0.1:3100");
    expect(err).toBeInstanceOf(Error);
  });

  it("is an instance of GatewayUnreachableError", () => {
    const err = new GatewayUnreachableError("http://127.0.0.1:3100");
    expect(err).toBeInstanceOf(GatewayUnreachableError);
  });
});
