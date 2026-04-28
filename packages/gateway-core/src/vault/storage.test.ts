import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultStorage, type SecretsBackend } from "./storage.js";

/**
 * VaultStorage tests (s128 t493).
 *
 * Uses a real temp dir for metadata sidecars + an in-memory SecretsBackend
 * mock for value storage. End-to-end tests for create/read/list/delete
 * roundtrip + edge cases.
 */

function createMockBackend(): SecretsBackend & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    async writeSecret(name: string, value: string): Promise<void> {
      store.set(name, value);
    },
    readSecret(name: string): string | undefined {
      return store.get(name);
    },
    async deleteSecret(name: string): Promise<void> {
      store.delete(name);
    },
  };
}

describe("VaultStorage (s128 t493)", () => {
  let tmpDir: string;
  let backend: ReturnType<typeof createMockBackend>;
  let storage: VaultStorage;
  let counter: number;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "vault-test-"));
    backend = createMockBackend();
    counter = 0;
    storage = new VaultStorage({
      vaultDir: tmpDir,
      secretsBackend: backend,
      idGenerator: () => `01HTEST${String(++counter).padStart(4, "0")}`,
      now: () => new Date("2026-04-28T12:00:00.000Z"),
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("creates a new entry with server-assigned id + created", async () => {
      const entry = await storage.create({
        name: "Tynn API key",
        type: "key",
        value: "sk-secret-value",
      });
      expect(entry.id).toBe("01HTEST0001");
      expect(entry.name).toBe("Tynn API key");
      expect(entry.type).toBe("key");
      expect(entry.created).toBe("2026-04-28T12:00:00.000Z");
      expect(entry.lastAccessed).toBeNull();
      expect(entry.owningProject).toBeNull();
    });

    it("preserves owningProject when supplied", async () => {
      const entry = await storage.create({
        name: "project key",
        type: "key",
        value: "v",
        owningProject: "/home/wishborn/projects/sample-go",
      });
      expect(entry.owningProject).toBe("/home/wishborn/projects/sample-go");
    });

    it("preserves description when supplied", async () => {
      const entry = await storage.create({
        name: "tagged",
        type: "token",
        value: "v",
        description: "for the cron job",
      });
      expect(entry.description).toBe("for the cron job");
    });

    it("persists the encrypted value to the backend keyed by vault_<id>", async () => {
      await storage.create({ name: "k", type: "key", value: "secret" });
      expect(backend._store.get("vault_01HTEST0001")).toBe("secret");
    });

    it("persists the metadata sidecar to <vaultDir>/<id>.json", async () => {
      await storage.create({ name: "k", type: "key", value: "secret" });
      expect(existsSync(join(tmpDir, "01HTEST0001.json"))).toBe(true);
    });

    it("creates the vaultDir if missing on first call", async () => {
      const newDir = join(tmpDir, "nested-fresh");
      const fresh = new VaultStorage({
        vaultDir: newDir,
        secretsBackend: backend,
        idGenerator: () => "01HTEST0001",
        now: () => new Date("2026-04-28T12:00:00.000Z"),
      });
      expect(existsSync(newDir)).toBe(false);
      await fresh.create({ name: "k", type: "key", value: "v" });
      expect(existsSync(newDir)).toBe(true);
    });
  });

  describe("read", () => {
    it("returns null for missing id", async () => {
      const result = await storage.read("nonexistent");
      expect(result).toBeNull();
    });

    it("returns entry + value for an existing id", async () => {
      await storage.create({ name: "k", type: "key", value: "secret-v" });
      const result = await storage.read("01HTEST0001");
      expect(result).not.toBeNull();
      expect(result!.entry.name).toBe("k");
      expect(result!.value).toBe("secret-v");
    });

    it("returns null when metadata exists but backend value is missing", async () => {
      await storage.create({ name: "k", type: "key", value: "v" });
      // Simulate orphaned metadata by deleting only the backend value
      backend._store.delete("vault_01HTEST0001");
      const result = await storage.read("01HTEST0001");
      expect(result).toBeNull();
    });

    it("updates lastAccessed on each read", async () => {
      await storage.create({ name: "k", type: "key", value: "v" });

      // First read should update lastAccessed from null
      const first = await storage.read("01HTEST0001");
      expect(first!.entry.lastAccessed).toBe("2026-04-28T12:00:00.000Z");

      // Subsequent reads pick up the persisted timestamp
      const second = storage.readMetadata("01HTEST0001");
      expect(second!.lastAccessed).toBe("2026-04-28T12:00:00.000Z");
    });
  });

  describe("readMetadata", () => {
    it("returns null for missing id", () => {
      expect(storage.readMetadata("nonexistent")).toBeNull();
    });

    it("returns the parsed entry when present", async () => {
      await storage.create({ name: "k", type: "password", value: "v" });
      const meta = storage.readMetadata("01HTEST0001");
      expect(meta).not.toBeNull();
      expect(meta!.type).toBe("password");
    });

    it("does NOT update lastAccessed (metadata-only read)", async () => {
      await storage.create({ name: "k", type: "key", value: "v" });
      const before = storage.readMetadata("01HTEST0001")!.lastAccessed;
      const after = storage.readMetadata("01HTEST0001")!.lastAccessed;
      expect(before).toBeNull();
      expect(after).toBeNull();
    });

    it("returns null when metadata file is corrupt JSON", async () => {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(tmpDir, "corrupt.json"), "{ this is not json", "utf-8");
      expect(storage.readMetadata("corrupt")).toBeNull();
    });
  });

  describe("list", () => {
    it("returns empty list when vault dir is empty", () => {
      expect(storage.list()).toEqual([]);
    });

    it("returns all entries in the vault dir", async () => {
      await storage.create({ name: "first", type: "key", value: "v1" });
      await storage.create({ name: "second", type: "password", value: "v2" });
      await storage.create({ name: "third", type: "token", value: "v3" });

      const entries = storage.list();
      expect(entries).toHaveLength(3);
      expect(entries.map(e => e.name).sort()).toEqual(["first", "second", "third"]);
    });

    it("ignores non-json files in the vault dir", async () => {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(tmpDir, "stray.txt"), "not metadata", "utf-8");
      await storage.create({ name: "real", type: "key", value: "v" });
      const entries = storage.list();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.name).toBe("real");
    });

    it("skips entries with corrupt metadata sidecars", async () => {
      await storage.create({ name: "good", type: "key", value: "v" });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(tmpDir, "bad.json"), "{ corrupt", "utf-8");
      const entries = storage.list();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.name).toBe("good");
    });
  });

  describe("delete", () => {
    it("returns false for missing id", async () => {
      expect(await storage.delete("nonexistent")).toBe(false);
    });

    it("returns true and removes both metadata + value for existing id", async () => {
      await storage.create({ name: "k", type: "key", value: "v" });
      expect(await storage.delete("01HTEST0001")).toBe(true);
      expect(existsSync(join(tmpDir, "01HTEST0001.json"))).toBe(false);
      expect(backend._store.has("vault_01HTEST0001")).toBe(false);
    });

    it("subsequent read returns null", async () => {
      await storage.create({ name: "k", type: "key", value: "v" });
      await storage.delete("01HTEST0001");
      const result = await storage.read("01HTEST0001");
      expect(result).toBeNull();
    });

    it("attempts backend cleanup even when metadata is already gone", async () => {
      // Simulate orphaned backend value (metadata never written)
      backend._store.set("vault_orphan", "leaked-value");
      expect(await storage.delete("orphan")).toBe(false); // returned false because metadata didn't exist
      expect(backend._store.has("vault_orphan")).toBe(false); // but the value is still cleaned
    });
  });

  describe("create-then-read roundtrip", () => {
    it("preserves the value verbatim through encryption + decryption", async () => {
      const value = "sk-ant-test-1234567890_with_special-chars!@#$";
      await storage.create({ name: "k", type: "key", value });
      const result = await storage.read("01HTEST0001");
      expect(result!.value).toBe(value);
    });

    it("preserves multi-line values (e.g., PEM-formatted keys)", async () => {
      const pem = "-----BEGIN PRIVATE KEY-----\nABCD\nEFGH\n-----END PRIVATE KEY-----\n";
      await storage.create({ name: "ssh-key", type: "key", value: pem });
      const result = await storage.read("01HTEST0001");
      expect(result!.value).toBe(pem);
    });
  });
});
