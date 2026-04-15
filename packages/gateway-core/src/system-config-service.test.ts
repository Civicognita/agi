/**
 * SystemConfigService Tests — validates centralized system config I/O.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SystemConfigService } from "./system-config-service.js";

describe("SystemConfigService", () => {
  let tmpDir: string;
  let configPath: string;
  let svc: SystemConfigService;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `scs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, "gateway.json");
    svc = new SystemConfigService({ configPath });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it("read() returns defaults when file does not exist", () => {
    const config = svc.read();
    expect(config.channels).toEqual([]);
  });

  it("read() loads and validates config", () => {
    writeFileSync(configPath, JSON.stringify({
      gateway: { host: "0.0.0.0", port: 3100, state: "ONLINE" },
      channels: [],
    }));
    const config = svc.read();
    expect(config.gateway?.host).toBe("0.0.0.0");
    expect(config.gateway?.port).toBe(3100);
  });

  it("readKey() traverses dot-path", () => {
    writeFileSync(configPath, JSON.stringify({
      hosting: { enabled: true, lanIp: "192.168.1.1", baseDomain: "ai.on" },
    }));
    expect(svc.readKey("hosting.lanIp")).toBe("192.168.1.1");
    expect(svc.readKey("hosting.enabled")).toBe(true);
    expect(svc.readKey("nonexistent.key")).toBeUndefined();
  });

  it("patch() updates nested key", () => {
    writeFileSync(configPath, JSON.stringify({ channels: [] }));
    svc.patch("gateway.host", "127.0.0.1");
    const config = svc.read();
    expect(config.gateway?.host).toBe("127.0.0.1");
  });

  it("onChange emits with changed keys", () => {
    writeFileSync(configPath, JSON.stringify({ channels: [] }));
    const events: Array<{ changedKeys: string[] }> = [];
    svc.on("changed", (e) => events.push(e));

    svc.patch("gateway.port", 3200);
    expect(events).toHaveLength(1);
    expect(events[0]?.changedKeys).toContain("gateway");
  });
});
