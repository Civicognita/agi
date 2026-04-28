import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { COAChainLogger } from "@agi/coa-chain";
import {
  VaultResolver,
  VaultResolverError,
  VaultResolverNotFoundError,
  VaultResolverScopeError,
} from "./resolver.js";
import { VaultStorage, type SecretsBackend } from "./storage.js";
import { VaultAuditor } from "./audit.js";

function createMockBackend(): SecretsBackend & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    async writeSecret(name: string, value: string): Promise<void> { store.set(name, value); },
    readSecret(name: string): string | undefined { return store.get(name); },
    async deleteSecret(name: string): Promise<void> { store.delete(name); },
  };
}

describe("VaultResolver (s128 t496)", () => {
  let tmpDir: string;
  let storage: VaultStorage;
  let resolver: VaultResolver;
  let counter: number;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "vault-resolver-"));
    counter = 0;
    storage = new VaultStorage({
      vaultDir: tmpDir,
      secretsBackend: createMockBackend(),
      idGenerator: () => `01HTEST${String(++counter).padStart(4, "0")}`,
      now: () => new Date("2026-04-28T12:00:00.000Z"),
    });
    resolver = new VaultResolver(storage);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("resolve — passthrough for non-references", () => {
    it("returns plain strings unchanged", async () => {
      expect(await resolver.resolve("plain-string")).toBe("plain-string");
      expect(await resolver.resolve("https://example.com")).toBe("https://example.com");
    });

    it("returns non-string values unchanged", async () => {
      expect(await resolver.resolve(42)).toBe(42);
      expect(await resolver.resolve(true)).toBe(true);
      expect(await resolver.resolve(null)).toBeNull();
      expect(await resolver.resolve(undefined)).toBeUndefined();
      const obj = { foo: "bar" };
      expect(await resolver.resolve(obj)).toBe(obj);
    });

    it("returns case-mismatched references unchanged (case-sensitive)", async () => {
      expect(await resolver.resolve("VAULT://01H7XYZ")).toBe("VAULT://01H7XYZ");
    });
  });

  describe("resolve — gateway-scoped entries (no owningProject)", () => {
    it("returns the decrypted value for a valid reference", async () => {
      const entry = await storage.create({ name: "k", type: "key", value: "secret-v" });
      const result = await resolver.resolve(`vault://${entry.id}`);
      expect(result).toBe("secret-v");
    });

    it("works without context (gateway-scoped entries don't need projectPath)", async () => {
      await storage.create({ name: "k", type: "key", value: "value-1" });
      const result = await resolver.resolve("vault://01HTEST0001");
      expect(result).toBe("value-1");
    });

    it("works with a projectPath even when entry is gateway-scoped", async () => {
      await storage.create({ name: "k", type: "key", value: "value-1" });
      const result = await resolver.resolve("vault://01HTEST0001", {
        projectPath: "/home/wishborn/projects/sample-go",
      });
      expect(result).toBe("value-1");
    });
  });

  describe("resolve — project-scoped entries", () => {
    it("returns the value when projectPath matches owningProject", async () => {
      await storage.create({
        name: "k",
        type: "key",
        value: "scoped-v",
        owningProject: "/home/wishborn/projects/sample-go",
      });
      const result = await resolver.resolve("vault://01HTEST0001", {
        projectPath: "/home/wishborn/projects/sample-go",
      });
      expect(result).toBe("scoped-v");
    });

    it("throws VaultResolverScopeError when projectPath mismatches", async () => {
      await storage.create({
        name: "k",
        type: "key",
        value: "scoped-v",
        owningProject: "/home/wishborn/projects/sample-go",
      });
      await expect(
        resolver.resolve("vault://01HTEST0001", { projectPath: "/home/wishborn/projects/other" }),
      ).rejects.toThrow(VaultResolverScopeError);
    });

    it("throws VaultResolverScopeError when context has no projectPath", async () => {
      await storage.create({
        name: "k",
        type: "key",
        value: "scoped-v",
        owningProject: "/home/wishborn/projects/sample-go",
      });
      await expect(resolver.resolve("vault://01HTEST0001")).rejects.toThrow(VaultResolverScopeError);
    });

    it("scope error message names both the entry's owner and the caller's claim", async () => {
      await storage.create({
        name: "k",
        type: "key",
        value: "v",
        owningProject: "/home/wishborn/projects/sample-go",
      });
      try {
        await resolver.resolve("vault://01HTEST0001", { projectPath: "/home/wishborn/projects/other" });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(VaultResolverScopeError);
        expect((err as Error).message).toContain("/home/wishborn/projects/sample-go");
        expect((err as Error).message).toContain("/home/wishborn/projects/other");
      }
    });
  });

  describe("resolve — error paths", () => {
    it("throws VaultResolverNotFoundError for missing id", async () => {
      await expect(
        resolver.resolve("vault://nonexistent"),
      ).rejects.toThrow(VaultResolverNotFoundError);
    });

    it("throws VaultResolverNotFoundError for `vault://` (empty id)", async () => {
      await expect(
        resolver.resolve("vault://"),
      ).rejects.toThrow(VaultResolverNotFoundError);
    });

    it("VaultResolverScopeError extends VaultResolverError (catch-all base)", async () => {
      await storage.create({
        name: "k",
        type: "key",
        value: "v",
        owningProject: "/home/wishborn/projects/sample-go",
      });
      try {
        await resolver.resolve("vault://01HTEST0001");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(VaultResolverError);
        expect(err).toBeInstanceOf(VaultResolverScopeError);
      }
    });

    it("VaultResolverNotFoundError extends VaultResolverError (catch-all base)", async () => {
      try {
        await resolver.resolve("vault://nonexistent");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(VaultResolverError);
        expect(err).toBeInstanceOf(VaultResolverNotFoundError);
      }
    });
  });

  describe("resolveRecord", () => {
    it("substitutes references in record values", async () => {
      await storage.create({ name: "k", type: "key", value: "secret-1" });
      await storage.create({ name: "k", type: "token", value: "secret-2" });

      const result = await resolver.resolveRecord({
        plain: "literal-value",
        api_key: "vault://01HTEST0001",
        bearer: "vault://01HTEST0002",
      });

      expect(result).toEqual({
        plain: "literal-value",
        api_key: "secret-1",
        bearer: "secret-2",
      });
    });

    it("returns empty record when input is empty", async () => {
      const result = await resolver.resolveRecord({});
      expect(result).toEqual({});
    });

    it("throws on first failure (mid-record reference is missing)", async () => {
      await storage.create({ name: "k", type: "key", value: "secret-1" });
      await expect(
        resolver.resolveRecord({
          good: "vault://01HTEST0001",
          bad: "vault://nonexistent",
        }),
      ).rejects.toThrow(VaultResolverNotFoundError);
    });

    it("propagates project-scope check across the whole record", async () => {
      await storage.create({
        name: "scoped",
        type: "key",
        value: "scoped-v",
        owningProject: "/home/wishborn/projects/sample-go",
      });
      const result = await resolver.resolveRecord(
        { x: "vault://01HTEST0001" },
        { projectPath: "/home/wishborn/projects/sample-go" },
      );
      expect(result.x).toBe("scoped-v");

      await expect(
        resolver.resolveRecord(
          { x: "vault://01HTEST0001" },
          { projectPath: "/home/wishborn/projects/other" },
        ),
      ).rejects.toThrow(VaultResolverScopeError);
    });

    it("does NOT recurse into nested objects (top-level only)", async () => {
      await storage.create({ name: "k", type: "key", value: "secret-v" });
      const result = await resolver.resolveRecord({
        nested: { ref: "vault://01HTEST0001" }, // pass-through unchanged
        topLevel: "vault://01HTEST0001",        // resolved
      });
      expect(result.nested).toEqual({ ref: "vault://01HTEST0001" });
      expect(result.topLevel).toBe("secret-v");
    });
  });

  describe("audit hook (s128 t498)", () => {
    interface MockLogParams {
      workType: string;
      ref?: string;
      entityId: string;
      entityAlias?: string;
      payloadHash?: string;
    }

    function createMockLogger(): { logger: COAChainLogger; calls: MockLogParams[] } {
      const calls: MockLogParams[] = [];
      const logger = {
        log: async (params: MockLogParams): Promise<string> => {
          calls.push(params);
          return `fp-${String(calls.length)}`;
        },
      } as unknown as COAChainLogger;
      return { logger, calls };
    }

    it("does NOT audit when no auditor is wired", async () => {
      // resolver from beforeEach has no auditor — already implicit
      const mock = createMockLogger();
      await storage.create({ name: "k", type: "key", value: "v" });
      const result = await resolver.resolve("vault://01HTEST0001");
      expect(result).toBe("v");
      expect(mock.calls).toHaveLength(0);
    });

    it("does NOT audit when auditor is wired but context.audit is omitted", async () => {
      const mock = createMockLogger();
      const audited = new VaultResolver(storage, { auditor: new VaultAuditor(mock.logger) });
      await storage.create({ name: "k", type: "key", value: "v" });
      const result = await audited.resolve("vault://01HTEST0001");
      expect(result).toBe("v");
      expect(mock.calls).toHaveLength(0);
    });

    it("DOES audit when both auditor + context.audit are supplied", async () => {
      const mock = createMockLogger();
      const audited = new VaultResolver(storage, { auditor: new VaultAuditor(mock.logger) });
      await storage.create({ name: "k", type: "key", value: "v" });

      const result = await audited.resolve("vault://01HTEST0001", {
        audit: { entityId: "ent-x", entityAlias: "$A0", resourceId: "$AGI", nodeId: "@A0" },
      });
      expect(result).toBe("v");
      expect(mock.calls).toHaveLength(1);
      const call = mock.calls[0]!;
      expect(call.workType).toBe("vault_read");
      expect(call.ref).toBe("01HTEST0001");
      expect(call.entityId).toBe("ent-x");
      expect(call.entityAlias).toBe("$A0");
    });

    it("does NOT audit when resolution fails (NotFound — never had a value to log)", async () => {
      const mock = createMockLogger();
      const audited = new VaultResolver(storage, { auditor: new VaultAuditor(mock.logger) });

      await expect(
        audited.resolve("vault://nonexistent", {
          audit: { entityId: "e", resourceId: "r", nodeId: "n" },
        }),
      ).rejects.toThrow(VaultResolverNotFoundError);
      expect(mock.calls).toHaveLength(0);
    });

    it("does NOT audit when resolution fails (Scope — denied access shouldn't tag the chain as a read)", async () => {
      const mock = createMockLogger();
      const audited = new VaultResolver(storage, { auditor: new VaultAuditor(mock.logger) });
      await storage.create({
        name: "scoped",
        type: "key",
        value: "v",
        owningProject: "/home/wishborn/projects/sample-go",
      });

      await expect(
        audited.resolve("vault://01HTEST0001", {
          projectPath: "/home/wishborn/projects/other",
          audit: { entityId: "e", resourceId: "r", nodeId: "n" },
        }),
      ).rejects.toThrow(VaultResolverScopeError);
      expect(mock.calls).toHaveLength(0);
    });

    it("audit failures don't block the resolve (returns the value even if logger throws)", async () => {
      const failingLogger = {
        log: async (): Promise<string> => { throw new Error("simulated failure"); },
      } as unknown as COAChainLogger;
      const audited = new VaultResolver(storage, { auditor: new VaultAuditor(failingLogger) });
      await storage.create({ name: "k", type: "key", value: "v" });

      // Should NOT throw — the audit-side error is swallowed inside VaultAuditor.
      const result = await audited.resolve("vault://01HTEST0001", {
        audit: { entityId: "e", resourceId: "r", nodeId: "n" },
      });
      expect(result).toBe("v");
    });
  });
});
