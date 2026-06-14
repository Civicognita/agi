/**
 * ScriptRegistry integration tests (s182 Phase B).
 *
 * Requires the test VM Postgres: `agi test-vm services-status`.
 * Each test gets a fresh schema; afterEach drops it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "./test-utils/db-fixture.js";
import { ScriptRegistry } from "./script-registry.js";

const hasDb =
  Boolean(process.env.AIONIMA_TEST_VM) ||
  Boolean(process.env.AGI_TEST_DATABASE_URL) ||
  Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)(
  "ScriptRegistry (s182 Phase B) — requires test VM Postgres",
  () => {
    let ctx: TestDbContext;
    let registry: ScriptRegistry;

    beforeEach(async () => {
      ctx = await createTestDb();
      registry = new ScriptRegistry(ctx.db);
    });

    afterEach(async () => {
      await ctx.close();
    });

    it("creates a script with deny-by-default enabled=false", async () => {
      const script = await registry.create({ mappId: "app.test", name: "my-packer" });
      expect(script.enabled).toBe(false);
      expect(script.isPacker).toBe(false);
      expect(script.language).toBe("starlark");
    });

    it("get returns the created script by ID", async () => {
      const created = await registry.create({ mappId: "app.test", name: "get-me" });
      const fetched = await registry.get(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
    });

    it("get returns null for unknown ID", async () => {
      const result = await registry.get("script_DOESNOTEXIST");
      expect(result).toBeNull();
    });

    it("getByName returns script matching mapp_id + name", async () => {
      await registry.create({ mappId: "app.test", name: "by-name" });
      const found = await registry.getByName("app.test", "by-name");
      expect(found).not.toBeNull();
      expect(found!.name).toBe("by-name");
    });

    it("getByName returns null for unknown name", async () => {
      const result = await registry.getByName("app.test", "no-such-script");
      expect(result).toBeNull();
    });

    it("list returns all scripts for a MApp, ordered by name", async () => {
      await registry.create({ mappId: "app.list", name: "zebra" });
      await registry.create({ mappId: "app.list", name: "alpha" });
      await registry.create({ mappId: "other.app", name: "other" });
      const scripts = await registry.list("app.list");
      expect(scripts).toHaveLength(2);
      expect(scripts[0]!.name).toBe("alpha");
      expect(scripts[1]!.name).toBe("zebra");
    });

    it("update patches name and description, returns updated record", async () => {
      const script = await registry.create({ mappId: "app.test", name: "old-name" });
      const updated = await registry.update(script.id, { name: "new-name", description: "hi" });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("new-name");
      expect(updated!.description).toBe("hi");
    });

    it("update source invalidates wasm_b64 and wasm_hash", async () => {
      const script = await registry.create({ mappId: "app.test", name: "compiler-test" });
      // Update source; registry should clear stale wasm fields (Phase D re-compiles on next run).
      const updated = await registry.update(script.id, { source: "print('hello')" });
      expect(updated!.source).toBe("print('hello')");
      expect(updated!.wasmB64).toBeNull();
      expect(updated!.wasmHash).toBeNull();
      expect(updated!.sourceHash).toBeNull();
    });

    it("setEnabled toggles the enabled flag", async () => {
      const script = await registry.create({ mappId: "app.test", name: "toggle-me" });
      expect(script.enabled).toBe(false);
      const ok = await registry.setEnabled(script.id, true);
      expect(ok).toBe(true);
      const after = await registry.get(script.id);
      expect(after!.enabled).toBe(true);
    });

    it("setEnabled returns false for unknown script", async () => {
      const ok = await registry.setEnabled("script_NOPE", true);
      expect(ok).toBe(false);
    });

    it("delete removes the script and returns true", async () => {
      const script = await registry.create({ mappId: "app.test", name: "delete-me" });
      const ok = await registry.delete(script.id);
      expect(ok).toBe(true);
      expect(await registry.get(script.id)).toBeNull();
    });

    it("delete returns false for unknown script", async () => {
      expect(await registry.delete("script_NOPE")).toBe(false);
    });

    it("getEnabledPackers returns only enabled is_packer=true scripts", async () => {
      await registry.create({ mappId: "app.pack", name: "packer-enabled", isPacker: true, enabled: true });
      await registry.create({ mappId: "app.pack", name: "packer-disabled", isPacker: true, enabled: false });
      await registry.create({ mappId: "app.pack", name: "not-a-packer", isPacker: false, enabled: true });

      const packers = await registry.getEnabledPackers("app.pack");
      expect(packers).toHaveLength(1);
      expect(packers[0]!.name).toBe("packer-enabled");
    });

    it("getEnabledPackers returns empty array when none qualify", async () => {
      await registry.create({ mappId: "app.empty", name: "disabled-packer", isPacker: true });
      const packers = await registry.getEnabledPackers("app.empty");
      expect(packers).toHaveLength(0);
    });

    it("setCompiled stores wasmB64, wasmHash, and sourceHash", async () => {
      const script = await registry.create({ mappId: "app.compile", name: "to-compile" });
      expect(script.wasmB64).toBeNull();

      const result = await registry.setCompiled(
        script.id,
        "dGVzdA==",
        "sha256:abc123",
        "sha256:def456",
      );

      expect(result).not.toBeNull();
      expect(result!.wasmB64).toBe("dGVzdA==");
      expect(result!.wasmHash).toBe("sha256:abc123");
      expect(result!.sourceHash).toBe("sha256:def456");
    });

    it("setCompiled returns null for unknown script", async () => {
      const result = await registry.setCompiled("script_NOPE", "b64", "hash1", "hash2");
      expect(result).toBeNull();
    });
  },
);
