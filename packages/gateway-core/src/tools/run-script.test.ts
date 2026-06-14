/**
 * run_script tool handler unit tests (s182 Phase C).
 *
 * Uses an in-memory stub for ScriptRegistry — no DB required.
 * The ScriptRunner is mocked to avoid WASM execution overhead.
 */

import { describe, it, expect } from "vitest";
import { createRunScriptHandler } from "./run-script.js";
import type { ScriptRegistry, MappScriptRecord } from "../script-registry.js";
import type { ScriptRunner } from "../script-runner.js";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeScript(overrides: Partial<MappScriptRecord> = {}): MappScriptRecord {
  return {
    id: "script_TEST",
    mappId: "app.test",
    name: "test-script",
    description: null,
    language: "starlark",
    source: "print('hello')",
    sourceHash: null,
    wasmB64: null,
    wasmHash: null,
    isPacker: false,
    enabled: false,
    timeoutMs: 1000,
    maxMemoryPages: 256,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRegistry(scripts: MappScriptRecord[] = []): ScriptRegistry {
  return {
    list: async (mappId: string) => scripts.filter((s) => s.mappId === mappId),
    get: async (id: string) => scripts.find((s) => s.id === id) ?? null,
    getByName: async (mappId: string, name: string) => scripts.find((s) => s.mappId === mappId && s.name === name) ?? null,
    create: async () => { throw new Error("not implemented in stub"); },
    update: async () => null,
    setEnabled: async (id: string, enabled: boolean) => {
      const s = scripts.find((s) => s.id === id);
      if (!s) return false;
      s.enabled = enabled;
      return true;
    },
    delete: async () => false,
    getEnabledPackers: async (mappId: string) => scripts.filter((s) => s.mappId === mappId && s.isPacker && s.enabled),
  } as unknown as ScriptRegistry;
}

function makeRunner(): ScriptRunner {
  return {
    run: async (_binary: Uint8Array, _input: unknown, _opts: unknown) => ({
      output: { result: "ok" },
      stdout: '{"result":"ok"}',
      exitCode: 0,
      durationMs: 5,
      inputHash: "sha256:abc",
      outputHash: "sha256:def",
      exitReason: "ok" as const,
    }),
  } as unknown as ScriptRunner;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("run_script tool handler (s182 Phase C)", () => {
  it("returns error when registry is not configured", async () => {
    const handler = createRunScriptHandler({});
    const result = JSON.parse(await handler({ action: "list", mappId: "app.x" }));
    expect(result.error).toMatch(/not available/);
  });

  it("list returns scripts for a MApp", async () => {
    const scripts = [
      makeScript({ mappId: "app.test", name: "a" }),
      makeScript({ id: "script_B", mappId: "app.test", name: "b" }),
      makeScript({ id: "script_OTHER", mappId: "other.app", name: "c" }),
    ];
    const handler = createRunScriptHandler({ scriptRegistry: makeRegistry(scripts) });
    const result = JSON.parse(await handler({ action: "list", mappId: "app.test" }));
    expect(result.scripts).toHaveLength(2);
    expect(result.scripts.map((s: { name: string }) => s.name)).toContain("a");
    expect(result.scripts.map((s: { name: string }) => s.name)).toContain("b");
  });

  it("list returns empty when no scripts for MApp", async () => {
    const handler = createRunScriptHandler({ scriptRegistry: makeRegistry([]) });
    const result = JSON.parse(await handler({ action: "list", mappId: "nobody" }));
    expect(result.scripts).toHaveLength(0);
  });

  it("list requires mappId", async () => {
    const handler = createRunScriptHandler({ scriptRegistry: makeRegistry([]) });
    const result = JSON.parse(await handler({ action: "list" }));
    expect(result.error).toMatch(/mappId/);
  });

  it("get returns script details", async () => {
    const scripts = [makeScript({ wasmB64: "BASE64" })];
    const handler = createRunScriptHandler({ scriptRegistry: makeRegistry(scripts) });
    const result = JSON.parse(await handler({ action: "get", scriptId: "script_TEST" }));
    expect(result.id).toBe("script_TEST");
    expect(result.compiled).toBe(true);
  });

  it("get returns error for unknown script", async () => {
    const handler = createRunScriptHandler({ scriptRegistry: makeRegistry([]) });
    const result = JSON.parse(await handler({ action: "get", scriptId: "script_NOPE" }));
    expect(result.error).toMatch(/not found/i);
  });

  it("enable sets enabled flag", async () => {
    const scripts = [makeScript({ enabled: false })];
    const handler = createRunScriptHandler({ scriptRegistry: makeRegistry(scripts) });
    const result = JSON.parse(await handler({ action: "enable", scriptId: "script_TEST" }));
    expect(result.ok).toBe(true);
    expect(result.enabled).toBe(true);
    expect(scripts[0]!.enabled).toBe(true);
  });

  it("disable clears enabled flag", async () => {
    const scripts = [makeScript({ enabled: true })];
    const handler = createRunScriptHandler({ scriptRegistry: makeRegistry(scripts) });
    const result = JSON.parse(await handler({ action: "disable", scriptId: "script_TEST" }));
    expect(result.enabled).toBe(false);
  });

  it("run refuses disabled scripts", async () => {
    const scripts = [makeScript({ enabled: false, wasmB64: "BASE64" })];
    const handler = createRunScriptHandler({ scriptRegistry: makeRegistry(scripts), scriptRunner: makeRunner() });
    const result = JSON.parse(await handler({ action: "run", scriptId: "script_TEST" }));
    expect(result.error).toMatch(/disabled/i);
  });

  it("run refuses uncompiled scripts with Phase D hint", async () => {
    const scripts = [makeScript({ enabled: true, wasmB64: null })];
    const handler = createRunScriptHandler({ scriptRegistry: makeRegistry(scripts), scriptRunner: makeRunner() });
    const result = JSON.parse(await handler({ action: "run", scriptId: "script_TEST" }));
    expect(result.error).toMatch(/compiled|Phase D/i);
  });

  it("run executes compiled+enabled script via ScriptRunner", async () => {
    // Minimal valid WASM no-op (WASM_NOOP bytes from script-runner.test.ts)
    const NOOP_B64 = Buffer.from(new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
      0x03, 0x02, 0x01, 0x00,
      0x07, 0x0a, 0x01, 0x06, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x00,
      0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
    ])).toString("base64");

    const scripts = [makeScript({ enabled: true, wasmB64: NOOP_B64 })];
    const handler = createRunScriptHandler({
      scriptRegistry: makeRegistry(scripts),
      scriptRunner: makeRunner(),
    });
    const result = JSON.parse(await handler({ action: "run", scriptId: "script_TEST", input: { x: 1 } }));
    expect(result.exitReason).toBe("ok");
    expect(result.scriptId).toBe("script_TEST");
  });

  it("unknown action returns error listing valid actions", async () => {
    const handler = createRunScriptHandler({ scriptRegistry: makeRegistry([]) });
    const result = JSON.parse(await handler({ action: "explode" }));
    expect(result.error).toMatch(/Unknown action/);
    expect(result.error).toMatch(/run.*list.*get.*enable.*disable/);
  });
});
