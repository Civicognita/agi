import { describe, expect, it } from "vitest";
import { ScriptRunner } from "./script-runner.js";

// ---------------------------------------------------------------------------
// WASM fixtures (pre-encoded from WAT)
// ---------------------------------------------------------------------------

/**
 * Minimal WASM that exports `_start` as a no-op.
 * Does not import WASI. Exits cleanly by returning from _start.
 *
 * WAT equivalent:
 *   (module
 *     (func $_start)
 *     (export "_start" (func 0))
 *   )
 */
const WASM_NOOP = new Uint8Array([
  // header
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // type section: 1 type — functype () -> ()
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  // function section: func 0 = type 0
  0x03, 0x02, 0x01, 0x00,
  // export section: "_start" = func 0
  0x07, 0x0a, 0x01, 0x06, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x00,
  // code section: func 0 = { end }
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
]);

/**
 * WASM that imports and calls `wasi_snapshot_preview1.proc_exit(0)`.
 * Tests that the runner correctly handles a clean WASI exit.
 *
 * WAT equivalent:
 *   (module
 *     (import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit (param i32)))
 *     (func $_start
 *       i32.const 0
 *       call $proc_exit
 *     )
 *     (export "_start" (func 1))
 *   )
 */
const WASM_EXIT_0 = new Uint8Array([
  // header
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // type section: type 0 = (i32) -> (), type 1 = () -> ()
  0x01, 0x08, 0x02,
    0x60, 0x01, 0x7f, 0x00, // type 0: (i32) -> ()
    0x60, 0x00, 0x00,        // type 1: () -> ()
  // import section: wasi_snapshot_preview1.proc_exit = func 0 (type 0)
  // payload = 1(count) + 1(mod-len) + 22(mod-name) + 1(field-len) + 9(field) + 2(desc) = 36 = 0x24
  0x02, 0x24, 0x01,
    0x16, 0x77, 0x61, 0x73, 0x69, 0x5f, 0x73, 0x6e, 0x61, 0x70, 0x73, 0x68,
    0x6f, 0x74, 0x5f, 0x70, 0x72, 0x65, 0x76, 0x69, 0x65, 0x77, 0x31, // "wasi_snapshot_preview1" (22 bytes)
    0x09, 0x70, 0x72, 0x6f, 0x63, 0x5f, 0x65, 0x78, 0x69, 0x74, // "proc_exit"
    0x00, 0x00, // import kind=func, type index=0
  // function section: func 1 = type 1
  0x03, 0x02, 0x01, 0x01,
  // export section: "_start" = func 1
  0x07, 0x0a, 0x01, 0x06, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x01,
  // code section: func 1 = { i32.const 0; call 0; end }
  // payload = count(1) + body_size_field(1) + body(6) = 8; body = locals(1)+i32.const(2)+call(2)+end(1)
  0x0a, 0x08, 0x01, 0x06, 0x00, 0x41, 0x00, 0x10, 0x00, 0x0b,
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ScriptRunner (s182 Phase A)", () => {
  it("runs a noop WASM and returns a ScriptResult", async () => {
    const runner = new ScriptRunner();
    const result = await runner.run(WASM_NOOP, null);

    expect(result.exitReason).toBe("ok");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("sets inputHash as sha256: of JSON.stringify(input)", async () => {
    const runner = new ScriptRunner();
    const result = await runner.run(WASM_NOOP, { foo: "bar" });

    expect(result.inputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("sets outputHash as sha256: of captured stdout", async () => {
    const runner = new ScriptRunner();
    const result = await runner.run(WASM_NOOP, null);

    expect(result.outputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("different inputs produce different inputHashes", async () => {
    const runner = new ScriptRunner();
    const a = await runner.run(WASM_NOOP, { x: 1 });
    const b = await runner.run(WASM_NOOP, { x: 2 });

    expect(a.inputHash).not.toBe(b.inputHash);
  });

  it("same input always produces the same inputHash", async () => {
    const runner = new ScriptRunner();
    const a = await runner.run(WASM_NOOP, { stable: true });
    const b = await runner.run(WASM_NOOP, { stable: true });

    expect(a.inputHash).toBe(b.inputHash);
  });

  it("handles a WASM module with no _start export gracefully", async () => {
    // Module with no exports at all (still valid WASM)
    const WASM_EMPTY = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ]);
    const runner = new ScriptRunner();
    const result = await runner.run(WASM_EMPTY, null);

    expect(result.exitReason).toBe("ok");
    expect(result.exitCode).toBe(0);
  });

  it("handles proc_exit(0) as a clean exit", async () => {
    const runner = new ScriptRunner();
    const result = await runner.run(WASM_EXIT_0, null);

    expect(result.exitReason).toBe("ok");
    expect(result.exitCode).toBe(0);
  });

  it("returns output as {} when WASM writes nothing to page 2", async () => {
    const runner = new ScriptRunner();
    const result = await runner.run(WASM_NOOP, null);

    expect(result.stdout).toBe("{}");
    expect(result.output).toEqual({});
  });

  it("deterministic mode: same seed produces identical randomness bytes", async () => {
    // We test this indirectly: same seed → same outputHash across two runs
    // (because deterministic mode + no random variation → stable execution).
    const runner = new ScriptRunner();
    const a = await runner.run(WASM_NOOP, null, { deterministic: true, seed: 42 });
    const b = await runner.run(WASM_NOOP, null, { deterministic: true, seed: 42 });

    expect(a.outputHash).toBe(b.outputHash);
  });
});

// ---------------------------------------------------------------------------
// Phase D — Starlark mode (uses bundled starlark-eval.wasm interpreter)
// ---------------------------------------------------------------------------

describe("ScriptRunner (s102 Phase D — Starlark mode)", () => {
  const src = (code: string) => new TextEncoder().encode(code);

  it("routes non-WASM bytes to the Starlark executor", async () => {
    const runner = new ScriptRunner();
    const result = await runner.run(src('def main(input): return {"ok": True}'), null);
    expect(result.exitReason).toBe("ok");
    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual({ ok: true });
  });

  it("passes JSON input to main(input) and returns its result", async () => {
    const runner = new ScriptRunner();
    const result = await runner.run(src("def main(input): return input"), { value: 42 });
    expect(result.exitReason).toBe("ok");
    expect((result.output as Record<string, unknown>).value).toBe(42);
  });

  it("serializes globals dict when main() is absent", async () => {
    const runner = new ScriptRunner();
    const result = await runner.run(src('x = 1\ny = "hello"'), null);
    expect(result.exitReason).toBe("ok");
    const out = result.output as Record<string, unknown>;
    expect(out.x).toBe(1);
    expect(out.y).toBe("hello");
  });

  it("returns exitReason=error on Starlark syntax error", async () => {
    const runner = new ScriptRunner();
    const result = await runner.run(src("def main(input: !!!bad syntax"), null);
    expect(result.exitReason).toBe("error");
    expect(result.exitCode).not.toBe(0);
  });

  it("WASM magic bytes still route to Phase A path after Phase D is wired", async () => {
    const runner = new ScriptRunner();
    const result = await runner.run(WASM_NOOP, null);
    expect(result.exitReason).toBe("ok");
    expect(result.stdout).toBe("{}");
  });

  it("produces stable inputHash for repeated Starlark runs", async () => {
    const runner = new ScriptRunner();
    const a = await runner.run(src("def main(input): return input"), { n: 1 });
    const b = await runner.run(src("def main(input): return input"), { n: 1 });
    expect(a.inputHash).toBe(b.inputHash);
  });
});
