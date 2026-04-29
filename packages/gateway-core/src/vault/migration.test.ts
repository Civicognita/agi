import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseEnvFile,
  findEnvReferences,
  planMigration,
  rewriteConfigReferences,
  executeMigration,
} from "./migration.js";
import { VaultStorage, type SecretsBackend } from "./storage.js";

function createMockBackend(): SecretsBackend & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    async writeSecret(name: string, value: string): Promise<void> { store.set(name, value); },
    readSecret(name: string): string | undefined { return store.get(name); },
    async deleteSecret(name: string): Promise<void> { store.delete(name); },
  };
}

describe("vault/migration (s128 t497)", () => {
  describe("parseEnvFile", () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "vault-mig-env-")); });
    afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

    it("returns null when file missing", () => {
      expect(parseEnvFile(join(tmpDir, "nonexistent"))).toBeNull();
    });

    it("parses KEY=VALUE pairs", () => {
      writeFileSync(join(tmpDir, ".env"), "FOO=bar\nBAZ=qux\n", "utf-8");
      expect(parseEnvFile(join(tmpDir, ".env"))).toEqual({ FOO: "bar", BAZ: "qux" });
    });

    it("strips double + single quotes", () => {
      writeFileSync(join(tmpDir, ".env"), 'A="quoted"\nB=\'single\'\n', "utf-8");
      expect(parseEnvFile(join(tmpDir, ".env"))).toEqual({ A: "quoted", B: "single" });
    });

    it("ignores comment lines + blank lines", () => {
      writeFileSync(join(tmpDir, ".env"), "# comment\n\nFOO=bar\n# another\n", "utf-8");
      expect(parseEnvFile(join(tmpDir, ".env"))).toEqual({ FOO: "bar" });
    });

    it("preserves = inside values", () => {
      writeFileSync(join(tmpDir, ".env"), "URL=https://example.com/?k=v\n", "utf-8");
      expect(parseEnvFile(join(tmpDir, ".env"))).toEqual({ URL: "https://example.com/?k=v" });
    });
  });

  describe("findEnvReferences", () => {
    it("finds $VAR refs in mcp.servers[].authToken", () => {
      const cfg = {
        mcp: {
          servers: [
            { id: "tynn", authToken: "$TYNN_API_KEY", url: "https://tynn.ai/mcp" },
            { id: "linear", authToken: "$LINEAR_TOKEN" },
          ],
        },
      };
      expect(findEnvReferences(cfg)).toEqual({
        TYNN_API_KEY: ["mcp.servers[0].authToken"],
        LINEAR_TOKEN: ["mcp.servers[1].authToken"],
      });
    });

    it("finds $VAR refs in mcp.servers[].env", () => {
      const cfg = {
        mcp: {
          servers: [
            { id: "x", env: { API_KEY: "$X_KEY", DEBUG: "$X_DEBUG" } },
          ],
        },
      };
      expect(findEnvReferences(cfg)).toEqual({
        X_KEY: ["mcp.servers[0].env.API_KEY"],
        X_DEBUG: ["mcp.servers[0].env.DEBUG"],
      });
    });

    it("ignores literal values + non-string fields", () => {
      const cfg = {
        mcp: {
          servers: [
            { id: "x", autoConnect: true, port: 3000, command: ["npx", "literal"] },
          ],
        },
      };
      expect(findEnvReferences(cfg)).toEqual({});
    });

    it("ignores `$` alone (length must be > 1)", () => {
      const cfg = { mcp: { servers: [{ id: "x", authToken: "$" }] } };
      expect(findEnvReferences(cfg)).toEqual({});
    });

    it("returns empty for non-object input", () => {
      expect(findEnvReferences(null)).toEqual({});
      expect(findEnvReferences("not-config")).toEqual({});
      expect(findEnvReferences(42)).toEqual({});
    });

    it("collects multiple refs to the same env key", () => {
      const cfg = {
        mcp: {
          servers: [
            { id: "a", authToken: "$SHARED_KEY" },
            { id: "b", env: { TOKEN: "$SHARED_KEY" } },
          ],
        },
      };
      expect(findEnvReferences(cfg)).toEqual({
        SHARED_KEY: ["mcp.servers[0].authToken", "mcp.servers[1].env.TOKEN"],
      });
    });
  });

  describe("planMigration", () => {
    let tmpDir: string;
    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "vault-mig-plan-"));
      mkdirSync(join(tmpDir, ".agi"));
    });
    afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

    it("returns empty candidates when no .env + no project.json", () => {
      const plan = planMigration(tmpDir);
      expect(plan.projectPath).toBe(tmpDir);
      expect(plan.candidates).toEqual([]);
    });

    it("returns empty candidates when no $VAR refs", () => {
      writeFileSync(join(tmpDir, ".env"), "FOO=bar\n", "utf-8");
      writeFileSync(join(tmpDir, ".agi", "project.json"), JSON.stringify({ mcp: { servers: [] } }), "utf-8");
      expect(planMigration(tmpDir).candidates).toEqual([]);
    });

    it("surfaces a single referenced env key as a candidate", () => {
      writeFileSync(join(tmpDir, ".env"), "TYNN_API_KEY=sk-test-123\n", "utf-8");
      writeFileSync(join(tmpDir, ".agi", "project.json"), JSON.stringify({
        mcp: { servers: [{ id: "tynn", authToken: "$TYNN_API_KEY" }] },
      }), "utf-8");

      const plan = planMigration(tmpDir);
      expect(plan.candidates).toHaveLength(1);
      const c = plan.candidates[0]!;
      expect(c.envKey).toBe("TYNN_API_KEY");
      expect(c.value).toBe("sk-test-123");
      expect(c.suggestedType).toBe("key");
      expect(c.referencedFrom).toHaveLength(1);
      expect(c.referencedFrom[0]!.path).toBe("mcp.servers[0].authToken");
    });

    it("infers type=password for *_PASSWORD keys", () => {
      writeFileSync(join(tmpDir, ".env"), "DB_PASSWORD=secret\n", "utf-8");
      writeFileSync(join(tmpDir, ".agi", "project.json"), JSON.stringify({
        mcp: { servers: [{ id: "x", env: { PW: "$DB_PASSWORD" } }] },
      }), "utf-8");
      expect(planMigration(tmpDir).candidates[0]!.suggestedType).toBe("password");
    });

    it("infers type=token for *_TOKEN / *_BEARER / *_JWT keys", () => {
      writeFileSync(join(tmpDir, ".env"), "API_TOKEN=t\nMY_BEARER=b\nSESSION_JWT=j\n", "utf-8");
      writeFileSync(join(tmpDir, ".agi", "project.json"), JSON.stringify({
        mcp: { servers: [
          { id: "a", authToken: "$API_TOKEN" },
          { id: "b", authToken: "$MY_BEARER" },
          { id: "c", authToken: "$SESSION_JWT" },
        ] },
      }), "utf-8");
      const types = planMigration(tmpDir).candidates.map(c => c.suggestedType).sort();
      expect(types).toEqual(["token", "token", "token"]);
    });

    it("skips refs with no .env value (referenced but undefined)", () => {
      writeFileSync(join(tmpDir, ".env"), "FOO=bar\n", "utf-8"); // doesn't define MISSING
      writeFileSync(join(tmpDir, ".agi", "project.json"), JSON.stringify({
        mcp: { servers: [{ id: "x", authToken: "$MISSING" }] },
      }), "utf-8");
      expect(planMigration(tmpDir).candidates).toEqual([]);
    });
  });

  describe("rewriteConfigReferences", () => {
    it("substitutes $VAR strings to vault:// per the map", () => {
      const cfg = {
        mcp: { servers: [{ id: "tynn", authToken: "$TYNN_API_KEY", url: "https://tynn.ai" }] },
      };
      const rewritten = rewriteConfigReferences(cfg, { TYNN_API_KEY: "01HXYZ" });
      expect(rewritten).toEqual({
        mcp: { servers: [{ id: "tynn", authToken: "vault://01HXYZ", url: "https://tynn.ai" }] },
      });
    });

    it("leaves $VAR strings unchanged when the var isn't in the map", () => {
      const cfg = { authToken: "$UNKNOWN" };
      expect(rewriteConfigReferences(cfg, { TYNN: "01H" })).toEqual({ authToken: "$UNKNOWN" });
    });

    it("preserves nested objects + arrays", () => {
      const cfg = {
        mcp: { servers: [{ env: { K1: "$A", K2: "$B" } }] },
      };
      const rewritten = rewriteConfigReferences(cfg, { A: "01HA", B: "01HB" });
      expect(rewritten).toEqual({
        mcp: { servers: [{ env: { K1: "vault://01HA", K2: "vault://01HB" } }] },
      });
    });

    it("does not mutate the input", () => {
      const cfg = { authToken: "$TYNN" };
      rewriteConfigReferences(cfg, { TYNN: "01H" });
      expect(cfg.authToken).toBe("$TYNN");
    });
  });

  describe("executeMigration", () => {
    let tmpDir: string;
    let storage: VaultStorage;
    let counter: number;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "vault-mig-exec-"));
      mkdirSync(join(tmpDir, ".agi"));
      counter = 0;
      storage = new VaultStorage({
        vaultDir: join(tmpDir, "vault"),
        secretsBackend: createMockBackend(),
        idGenerator: () => `01HMIG${String(++counter).padStart(4, "0")}`,
        now: () => new Date("2026-04-28T15:00:00.000Z"),
      });
    });

    afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

    it("creates a vault entry per accepted candidate", async () => {
      const result = await executeMigration({
        storage,
        projectPath: tmpDir,
        accepted: [{
          envKey: "TYNN_API_KEY",
          value: "sk-test",
          suggestedType: "key",
          referencedFrom: [{ path: "mcp.servers[0].authToken", suggestedName: "Tynn Api Key" }],
        }],
      });

      expect(result.created).toEqual({ TYNN_API_KEY: "01HMIG0001" });
      const entry = await storage.read("01HMIG0001");
      expect(entry).not.toBeNull();
      expect(entry!.entry.name).toBe("Tynn Api Key");
      expect(entry!.entry.owningProject).toBe(tmpDir);
      expect(entry!.value).toBe("sk-test");
    });

    it("rewrites project.json $VAR refs to vault:// after creating entries", async () => {
      writeFileSync(join(tmpDir, ".agi", "project.json"), JSON.stringify({
        mcp: { servers: [{ id: "tynn", authToken: "$TYNN_API_KEY" }] },
      }), "utf-8");

      const result = await executeMigration({
        storage,
        projectPath: tmpDir,
        accepted: [{
          envKey: "TYNN_API_KEY",
          value: "sk-test",
          suggestedType: "key",
          referencedFrom: [{ path: "mcp.servers[0].authToken", suggestedName: "Tynn key" }],
        }],
      });

      expect(result.configRewritten).toBe(true);
      const after = JSON.parse(readFileSync(join(tmpDir, ".agi", "project.json"), "utf-8")) as {
        mcp: { servers: Array<{ authToken: string }> };
      };
      expect(after.mcp.servers[0]!.authToken).toBe("vault://01HMIG0001");
    });

    it("reports configRewritten=false when project.json doesn't exist", async () => {
      const result = await executeMigration({
        storage,
        projectPath: tmpDir,
        accepted: [{
          envKey: "FOO",
          value: "v",
          suggestedType: "key",
          referencedFrom: [{ path: "mcp.servers[0].authToken", suggestedName: "Foo" }],
        }],
      });
      expect(result.configRewritten).toBe(false);
      // Entry was still created — migration is partial-OK
      expect(Object.keys(result.created)).toEqual(["FOO"]);
    });

    it("creates entries with project-scoped owningProject + audit description", async () => {
      await executeMigration({
        storage,
        projectPath: tmpDir,
        accepted: [{
          envKey: "K",
          value: "v",
          suggestedType: "token",
          referencedFrom: [{ path: "mcp.servers[0].env.X", suggestedName: "K" }],
        }],
      });
      const entry = storage.readMetadata("01HMIG0001")!;
      expect(entry.owningProject).toBe(tmpDir);
      expect(entry.type).toBe("token");
      expect(entry.description).toContain("Migrated from .env");
      expect(entry.description).toContain("K");
    });
  });

  describe("end-to-end: plan → execute roundtrip", () => {
    let tmpDir: string;
    let storage: VaultStorage;
    let counter: number;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "vault-mig-e2e-"));
      mkdirSync(join(tmpDir, ".agi"));
      counter = 0;
      storage = new VaultStorage({
        vaultDir: join(tmpDir, "vault"),
        secretsBackend: createMockBackend(),
        idGenerator: () => `01HE2E${String(++counter).padStart(4, "0")}`,
        now: () => new Date("2026-04-28T15:00:00.000Z"),
      });
    });

    afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

    it("end-to-end plan → executeMigration → second plan returns no candidates", async () => {
      writeFileSync(join(tmpDir, ".env"), "TYNN_KEY=secret-1\nLINEAR_TOKEN=secret-2\n", "utf-8");
      writeFileSync(join(tmpDir, ".agi", "project.json"), JSON.stringify({
        mcp: { servers: [
          { id: "tynn", authToken: "$TYNN_KEY" },
          { id: "linear", authToken: "$LINEAR_TOKEN" },
        ] },
      }), "utf-8");

      // Phase 1 — discover
      const plan1 = planMigration(tmpDir);
      expect(plan1.candidates).toHaveLength(2);

      // Phase 2 — execute (owner accepted both candidates)
      await executeMigration({ storage, projectPath: tmpDir, accepted: plan1.candidates });

      // Phase 3 — re-discover should find ZERO candidates because the
      // project.json was rewritten and no longer carries $VAR refs.
      const plan2 = planMigration(tmpDir);
      expect(plan2.candidates).toEqual([]);

      // Vault entries are real + readable + project-scoped
      const tynnEntry = await storage.read("01HE2E0001");
      const linearEntry = await storage.read("01HE2E0002");
      expect(tynnEntry!.value).toBe("secret-1");
      expect(linearEntry!.value).toBe("secret-2");
      expect(tynnEntry!.entry.owningProject).toBe(tmpDir);
      expect(linearEntry!.entry.owningProject).toBe(tmpDir);
    });
  });
});
