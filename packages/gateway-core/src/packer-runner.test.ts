import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createTestDb } from "./test-utils/db-fixture.js";
import { ScriptRegistry } from "./script-registry.js";
import { ScriptRunner } from "./script-runner.js";
import { runPackers } from "./packer-runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(data: string | Uint8Array): string {
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}

function encodeSource(source: string): { wasmB64: string; wasmHash: string; sourceHash: string } {
  const bytes = new TextEncoder().encode(source);
  const wasmB64 = Buffer.from(bytes).toString("base64");
  return {
    wasmB64,
    wasmHash: sha256Hex(bytes),
    sourceHash: sha256Hex(source),
  };
}

const HELLO_PACKER_SOURCE = `
def main(input):
    msg = input.get("message", "") if type(input) == "dict" else str(input)
    word_count = len(msg.split()) if msg else 0
    return {
        "packer": "hello-packer",
        "word_count": word_count,
        "has_input": input != None,
    }
`.trim();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPackers (s102 Phase E)", () => {
  it("runs a compiled packer and returns its output", async () => {
    const { db } = await createTestDb();
    const registry = new ScriptRegistry(db);
    const runner = new ScriptRunner();

    const script = await registry.create({
      mappId: "mapp_test_phase_e",
      name: "hello-packer",
      source: HELLO_PACKER_SOURCE,
      isPacker: true,
      enabled: true,
    });

    const { wasmB64, wasmHash, sourceHash } = encodeSource(HELLO_PACKER_SOURCE);
    await registry.setCompiled(script.id, wasmB64, wasmHash, sourceHash);

    const results = await runPackers(
      "mapp_test_phase_e",
      { message: "hello world" },
      { scriptRegistry: registry, scriptRunner: runner },
    );

    expect(results).toHaveLength(1);
    const [exe] = results;
    expect(exe!.result.exitReason).toBe("ok");
    const out = exe!.result.output as Record<string, unknown>;
    expect(out.packer).toBe("hello-packer");
    expect(out.word_count).toBe(2);
    expect(out.has_input).toBe(true);
  });

  it("skips packers with wasmB64=null (not compiled)", async () => {
    const { db } = await createTestDb();
    const registry = new ScriptRegistry(db);
    const runner = new ScriptRunner();

    await registry.create({
      mappId: "mapp_skip_test",
      name: "uncompiled-packer",
      source: HELLO_PACKER_SOURCE,
      isPacker: true,
      enabled: true,
      // wasmB64 not set → null
    });

    const results = await runPackers(
      "mapp_skip_test",
      null,
      { scriptRegistry: registry, scriptRunner: runner },
    );

    expect(results).toHaveLength(0);
  });

  it("skips disabled packers", async () => {
    const { db } = await createTestDb();
    const registry = new ScriptRegistry(db);
    const runner = new ScriptRunner();

    const script = await registry.create({
      mappId: "mapp_disabled_test",
      name: "disabled-packer",
      source: HELLO_PACKER_SOURCE,
      isPacker: true,
      enabled: false,
    });
    const { wasmB64, wasmHash, sourceHash } = encodeSource(HELLO_PACKER_SOURCE);
    await registry.setCompiled(script.id, wasmB64, wasmHash, sourceHash);

    const results = await runPackers(
      "mapp_disabled_test",
      null,
      { scriptRegistry: registry, scriptRunner: runner },
    );

    expect(results).toHaveLength(0);
  });

  it("returns an empty array when no packers are registered for the MApp", async () => {
    const { db } = await createTestDb();
    const registry = new ScriptRegistry(db);
    const runner = new ScriptRunner();

    const results = await runPackers(
      "mapp_nonexistent",
      { foo: "bar" },
      { scriptRegistry: registry, scriptRunner: runner },
    );

    expect(results).toHaveLength(0);
  });

  it("failFast: stops after first failing packer", async () => {
    const { db } = await createTestDb();
    const registry = new ScriptRegistry(db);
    const runner = new ScriptRunner();

    // Bad packer: syntax error → exits non-zero
    const bad = encodeSource("def main(input): !!!invalid syntax");
    const s1 = await registry.create({
      mappId: "mapp_failfast",
      name: "bad-packer",
      source: "def main(input): !!!invalid",
      isPacker: true,
      enabled: true,
    });
    await registry.setCompiled(s1.id, bad.wasmB64, bad.wasmHash, bad.sourceHash);

    // Good packer — would run second if failFast=false
    const good = encodeSource(HELLO_PACKER_SOURCE);
    const s2 = await registry.create({
      mappId: "mapp_failfast",
      name: "good-packer",
      source: HELLO_PACKER_SOURCE,
      isPacker: true,
      enabled: true,
    });
    await registry.setCompiled(s2.id, good.wasmB64, good.wasmHash, good.sourceHash);

    const results = await runPackers(
      "mapp_failfast",
      null,
      { scriptRegistry: registry, scriptRunner: runner },
      { failFast: true },
    );

    // Only the first packer ran (and it failed), second was skipped
    expect(results).toHaveLength(1);
    expect(results[0]!.result.exitReason).toBe("error");
  });
});
