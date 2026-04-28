import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerVaultRoutes } from "./api.js";
import { VaultStorage, type SecretsBackend } from "./storage.js";
import type { VaultEntry } from "./types.js";

/**
 * Vault REST API tests (s128 t494). End-to-end via Fastify's inject(),
 * real temp dirs for metadata, in-memory backend for values.
 */

function createMockBackend(): SecretsBackend & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    async writeSecret(name: string, value: string): Promise<void> { store.set(name, value); },
    readSecret(name: string): string | undefined { return store.get(name); },
    async deleteSecret(name: string): Promise<void> { store.delete(name); },
  };
}

describe("vault-api (s128 t494)", () => {
  let tmpDir: string;
  let app: FastifyInstance;
  let counter: number;
  let storage: VaultStorage;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "vault-api-"));
    const backend = createMockBackend();
    counter = 0;
    storage = new VaultStorage({
      vaultDir: tmpDir,
      secretsBackend: backend,
      idGenerator: () => `01HTEST${String(++counter).padStart(4, "0")}`,
      now: () => new Date("2026-04-28T12:00:00.000Z"),
    });
    app = Fastify({ logger: false });
    registerVaultRoutes(app, { vaultStorage: storage });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // GET /api/vault — list summaries
  // ---------------------------------------------------------------------------

  describe("GET /api/vault", () => {
    it("returns empty list when no entries exist", async () => {
      const res = await app.inject({ method: "GET", url: "/api/vault" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ entries: [] });
    });

    it("returns summaries (no value, no owningProject path leakage)", async () => {
      await storage.create({ name: "a", type: "key", value: "secret-a" });
      const res = await app.inject({ method: "GET", url: "/api/vault" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { entries: Array<Record<string, unknown>> };
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0]).not.toHaveProperty("value");
      expect(body.entries[0]).not.toHaveProperty("owningProject");
      expect(body.entries[0]).toHaveProperty("ownedByProject");
    });

    it("ownedByProject reflects requestingProject query parameter", async () => {
      await storage.create({
        name: "scoped",
        type: "key",
        value: "v",
        owningProject: "/home/wishborn/projects/sample-go",
      });
      await storage.create({ name: "gateway", type: "key", value: "v" });

      const res = await app.inject({
        method: "GET",
        url: "/api/vault?requestingProject=/home/wishborn/projects/sample-go",
      });
      const body = res.json() as { entries: Array<{ name: string; ownedByProject: boolean }> };
      const scoped = body.entries.find(e => e.name === "scoped")!;
      const gateway = body.entries.find(e => e.name === "gateway")!;
      expect(scoped.ownedByProject).toBe(true);
      expect(gateway.ownedByProject).toBe(false);
    });

    it("rejects relative requestingProject paths with 400", async () => {
      const res = await app.inject({ method: "GET", url: "/api/vault?requestingProject=relative/path" });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain("absolute path");
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/vault — create
  // ---------------------------------------------------------------------------

  describe("POST /api/vault", () => {
    it("creates an entry and returns the summary (not the value)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/vault",
        payload: { name: "Tynn API key", type: "key", value: "sk-test" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { entry: Record<string, unknown> };
      expect(body.entry.name).toBe("Tynn API key");
      expect(body.entry.id).toBe("01HTEST0001");
      expect(body.entry).not.toHaveProperty("value");
    });

    it("rejects missing name", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/vault",
        payload: { type: "key", value: "v" },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain("name");
    });

    it("rejects empty value", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/vault",
        payload: { name: "n", type: "key", value: "" },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain("value");
    });

    it("rejects invalid type", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/vault",
        payload: { name: "n", type: "secret", value: "v" },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain("key|password|token");
    });

    it("rejects relative owningProject", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/vault",
        payload: { name: "n", type: "key", value: "v", owningProject: "relative/path" },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain("absolute path");
    });

    it("accepts owningProject when absolute", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/vault",
        payload: {
          name: "n",
          type: "key",
          value: "v",
          owningProject: "/home/wishborn/projects/sample-go",
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it("rejects non-object JSON body (e.g. null or array)", async () => {
      // Send a valid-JSON-but-not-object payload. Fastify parses the body
      // (no 415) and our handler should reject with a 400.
      const res = await app.inject({
        method: "POST",
        url: "/api/vault",
        headers: { "content-type": "application/json" },
        payload: "null",
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain("body must be an object");
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/vault/:id
  // ---------------------------------------------------------------------------

  describe("GET /api/vault/:id", () => {
    it("returns 404 for missing id", async () => {
      const res = await app.inject({ method: "GET", url: "/api/vault/nonexistent" });
      expect(res.statusCode).toBe(404);
    });

    it("returns { entry, value } for gateway-scoped entries (no requestingProject needed)", async () => {
      await storage.create({ name: "gateway", type: "key", value: "secret" });
      const res = await app.inject({ method: "GET", url: "/api/vault/01HTEST0001" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { entry: VaultEntry; value: string };
      expect(body.value).toBe("secret");
      expect(body.entry.owningProject).toBeNull();
    });

    it("returns 403 when project-scoped entry's owner mismatches", async () => {
      await storage.create({
        name: "scoped",
        type: "key",
        value: "v",
        owningProject: "/home/wishborn/projects/sample-go",
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/vault/01HTEST0001?requestingProject=/home/wishborn/projects/other",
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: string }).error).toContain("different project");
    });

    it("returns 403 when project-scoped entry is read with no requestingProject", async () => {
      await storage.create({
        name: "scoped",
        type: "key",
        value: "v",
        owningProject: "/home/wishborn/projects/sample-go",
      });
      const res = await app.inject({ method: "GET", url: "/api/vault/01HTEST0001" });
      expect(res.statusCode).toBe(403);
    });

    it("returns the value when project-scoped entry's owner matches", async () => {
      await storage.create({
        name: "scoped",
        type: "key",
        value: "secret-v",
        owningProject: "/home/wishborn/projects/sample-go",
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/vault/01HTEST0001?requestingProject=/home/wishborn/projects/sample-go",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { entry: VaultEntry; value: string };
      expect(body.value).toBe("secret-v");
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/vault/:id
  // ---------------------------------------------------------------------------

  describe("DELETE /api/vault/:id", () => {
    it("returns 404 for missing id", async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/vault/nonexistent" });
      expect(res.statusCode).toBe(404);
    });

    it("deletes a gateway-scoped entry", async () => {
      await storage.create({ name: "k", type: "key", value: "v" });
      const res = await app.inject({ method: "DELETE", url: "/api/vault/01HTEST0001" });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { deleted: boolean }).deleted).toBe(true);

      const followup = await app.inject({ method: "GET", url: "/api/vault/01HTEST0001" });
      expect(followup.statusCode).toBe(404);
    });

    it("returns 403 when project-scoped entry's owner mismatches", async () => {
      await storage.create({
        name: "scoped",
        type: "key",
        value: "v",
        owningProject: "/home/wishborn/projects/sample-go",
      });
      const res = await app.inject({
        method: "DELETE",
        url: "/api/vault/01HTEST0001?requestingProject=/home/wishborn/projects/other",
      });
      expect(res.statusCode).toBe(403);

      // Entry should still exist
      const stillThere = await app.inject({
        method: "GET",
        url: "/api/vault/01HTEST0001?requestingProject=/home/wishborn/projects/sample-go",
      });
      expect(stillThere.statusCode).toBe(200);
    });

    it("deletes when project-scoped entry's owner matches", async () => {
      await storage.create({
        name: "scoped",
        type: "key",
        value: "v",
        owningProject: "/home/wishborn/projects/sample-go",
      });
      const res = await app.inject({
        method: "DELETE",
        url: "/api/vault/01HTEST0001?requestingProject=/home/wishborn/projects/sample-go",
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { deleted: boolean }).deleted).toBe(true);
    });
  });
});
