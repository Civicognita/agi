/**
 * s152 — notes-api REST surface contract.
 *
 * Mock NotesStore — keeps the test in-process (app.inject + an in-memory
 * Map) so we can pin the route contract without spinning up Postgres.
 * The DB-backed NotesStore itself gets covered by the integration test
 * VM suite once notes-store.test.ts (DB fixture) lands.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ulid } from "ulid";

import { ALPHA_OWNER_ENTITY_ID, registerNotesRoutes } from "./notes-api.js";
import type { NotesStore, UserNoteRecord, CreateNoteInput, UpdateNoteInput } from "./notes-store.js";

class InMemoryNotesStore implements Pick<NotesStore, "list" | "get" | "create" | "update" | "delete"> {
  readonly notes = new Map<string, UserNoteRecord>();

  async list(userEntityId: string, projectPath?: string | null): Promise<UserNoteRecord[]> {
    let out = Array.from(this.notes.values()).filter((n) => n.userEntityId === userEntityId);
    if (projectPath === null) {
      out = out.filter((n) => n.projectPath === null);
    } else if (typeof projectPath === "string") {
      out = out.filter((n) => n.projectPath === projectPath);
    }
    return out.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }

  async get(id: string): Promise<UserNoteRecord | null> {
    return this.notes.get(id) ?? null;
  }

  async create(input: CreateNoteInput): Promise<UserNoteRecord> {
    const id = `note_${ulid()}`;
    const now = new Date().toISOString();
    const note: UserNoteRecord = {
      id,
      userEntityId: input.userEntityId,
      projectPath: input.projectPath,
      title: input.title,
      body: input.body ?? "",
      sortOrder: input.sortOrder ?? 0,
      pinned: input.pinned ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.notes.set(id, note);
    return note;
  }

  async update(id: string, patch: UpdateNoteInput): Promise<UserNoteRecord | null> {
    const existing = this.notes.get(id);
    if (existing === undefined) return null;
    const updated: UserNoteRecord = {
      ...existing,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.notes.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.notes.delete(id);
  }
}

describe("notes-api routes (s152)", () => {
  let app: FastifyInstance;
  let store: InMemoryNotesStore;
  const workspace = "/wsroot";
  const projectPath = "/wsroot/myproject";

  beforeEach(async () => {
    app = Fastify();
    store = new InMemoryNotesStore();
    registerNotesRoutes(app, {
      notesStore: store as unknown as NotesStore,
      workspaceProjects: [workspace],
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /api/notes", () => {
    it("creates a global note when projectPath is omitted", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/api/notes",
        payload: { title: "Global thought" },
      });
      expect(r.statusCode).toBe(201);
      const body = r.json() as UserNoteRecord;
      expect(body.title).toBe("Global thought");
      expect(body.projectPath).toBeNull();
      expect(body.userEntityId).toBe(ALPHA_OWNER_ENTITY_ID);
    });

    it("creates a per-project note when projectPath is set", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/api/notes",
        payload: { title: "Project thought", body: "## intro\n\nbody", projectPath },
      });
      expect(r.statusCode).toBe(201);
      const body = r.json() as UserNoteRecord;
      expect(body.projectPath).toBe(projectPath);
      expect(body.body).toBe("## intro\n\nbody");
    });

    it("rejects projectPath outside the workspace with 403", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/api/notes",
        payload: { title: "Outside", projectPath: "/etc/passwd" },
      });
      expect(r.statusCode).toBe(403);
    });

    it("rejects projectPath equal to the workspace root with 403", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/api/notes",
        payload: { title: "Root", projectPath: workspace },
      });
      expect(r.statusCode).toBe(403);
    });

    it("rejects empty title with 400", async () => {
      const r = await app.inject({
        method: "POST",
        url: "/api/notes",
        payload: { title: "   " },
      });
      expect(r.statusCode).toBe(400);
    });
  });

  describe("GET /api/notes", () => {
    beforeEach(async () => {
      // Seed: 1 global + 2 project notes
      await store.create({ userEntityId: ALPHA_OWNER_ENTITY_ID, projectPath: null, title: "Global A" });
      await store.create({ userEntityId: ALPHA_OWNER_ENTITY_ID, projectPath, title: "Proj A" });
      await store.create({ userEntityId: ALPHA_OWNER_ENTITY_ID, projectPath, title: "Proj B" });
    });

    it("returns global notes when no params provided", async () => {
      const r = await app.inject({ method: "GET", url: "/api/notes" });
      const body = r.json() as { notes: UserNoteRecord[]; scope: string };
      expect(body.scope).toBe("global");
      expect(body.notes.map((n) => n.title)).toEqual(["Global A"]);
    });

    it("returns per-project notes when projectPath is set", async () => {
      const r = await app.inject({
        method: "GET",
        url: `/api/notes?projectPath=${encodeURIComponent(projectPath)}`,
      });
      const body = r.json() as { notes: UserNoteRecord[]; scope: string };
      expect(body.scope).toBe("project");
      expect(new Set(body.notes.map((n) => n.title))).toEqual(new Set(["Proj A", "Proj B"]));
    });

    it("returns all notes for scope=all", async () => {
      const r = await app.inject({ method: "GET", url: "/api/notes?scope=all" });
      const body = r.json() as { notes: UserNoteRecord[]; scope: string };
      expect(body.scope).toBe("all");
      expect(body.notes).toHaveLength(3);
    });

    it("rejects projectPath outside the workspace with 403", async () => {
      const r = await app.inject({
        method: "GET",
        url: `/api/notes?projectPath=${encodeURIComponent("/elsewhere")}`,
      });
      expect(r.statusCode).toBe(403);
    });

    it("orders pinned notes first", async () => {
      const created = await store.create({ userEntityId: ALPHA_OWNER_ENTITY_ID, projectPath: null, title: "Pinned star" });
      await store.update(created.id, { pinned: true });

      const r = await app.inject({ method: "GET", url: "/api/notes" });
      const body = r.json() as { notes: UserNoteRecord[] };
      expect(body.notes[0]?.title).toBe("Pinned star");
    });
  });

  describe("GET /api/notes/:id", () => {
    it("returns the note", async () => {
      const created = await store.create({ userEntityId: ALPHA_OWNER_ENTITY_ID, projectPath: null, title: "X" });
      const r = await app.inject({ method: "GET", url: `/api/notes/${created.id}` });
      expect(r.statusCode).toBe(200);
      expect((r.json() as UserNoteRecord).id).toBe(created.id);
    });

    it("returns 404 when not found", async () => {
      const r = await app.inject({ method: "GET", url: "/api/notes/note_nope" });
      expect(r.statusCode).toBe(404);
    });

    it("returns 403 when owned by another user", async () => {
      const created = await store.create({ userEntityId: "~$U_OTHER", projectPath: null, title: "Theirs" });
      const r = await app.inject({ method: "GET", url: `/api/notes/${created.id}` });
      expect(r.statusCode).toBe(403);
    });
  });

  describe("PUT /api/notes/:id", () => {
    it("partially updates title + body", async () => {
      const created = await store.create({ userEntityId: ALPHA_OWNER_ENTITY_ID, projectPath: null, title: "Old", body: "old body" });
      const r = await app.inject({
        method: "PUT",
        url: `/api/notes/${created.id}`,
        payload: { title: "New", body: "new body" },
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as UserNoteRecord;
      expect(body.title).toBe("New");
      expect(body.body).toBe("new body");
    });

    it("toggles pinned", async () => {
      const created = await store.create({ userEntityId: ALPHA_OWNER_ENTITY_ID, projectPath: null, title: "P" });
      const r = await app.inject({
        method: "PUT",
        url: `/api/notes/${created.id}`,
        payload: { pinned: true },
      });
      expect((r.json() as UserNoteRecord).pinned).toBe(true);
    });

    it("returns 404 when not found", async () => {
      const r = await app.inject({
        method: "PUT",
        url: "/api/notes/note_nope",
        payload: { title: "x" },
      });
      expect(r.statusCode).toBe(404);
    });

    it("returns 403 when owned by another user", async () => {
      const created = await store.create({ userEntityId: "~$U_OTHER", projectPath: null, title: "Theirs" });
      const r = await app.inject({
        method: "PUT",
        url: `/api/notes/${created.id}`,
        payload: { title: "Hijack" },
      });
      expect(r.statusCode).toBe(403);
    });
  });

  describe("DELETE /api/notes/:id", () => {
    it("removes the note + returns 204", async () => {
      const created = await store.create({ userEntityId: ALPHA_OWNER_ENTITY_ID, projectPath: null, title: "Doomed" });
      const r = await app.inject({ method: "DELETE", url: `/api/notes/${created.id}` });
      expect(r.statusCode).toBe(204);
      expect(store.notes.has(created.id)).toBe(false);
    });

    it("returns 404 when not found", async () => {
      const r = await app.inject({ method: "DELETE", url: "/api/notes/note_nope" });
      expect(r.statusCode).toBe(404);
    });

    it("returns 403 when owned by another user", async () => {
      const created = await store.create({ userEntityId: "~$U_OTHER", projectPath: null, title: "Theirs" });
      const r = await app.inject({ method: "DELETE", url: `/api/notes/${created.id}` });
      expect(r.statusCode).toBe(403);
    });
  });

  describe("multi-user isolation", () => {
    it("scope=all only returns notes for the configured owner entity", async () => {
      await store.create({ userEntityId: ALPHA_OWNER_ENTITY_ID, projectPath: null, title: "Mine" });
      await store.create({ userEntityId: "~$U_OTHER", projectPath: null, title: "Theirs" });

      const r = await app.inject({ method: "GET", url: "/api/notes?scope=all" });
      const body = r.json() as { notes: UserNoteRecord[] };
      expect(body.notes.map((n) => n.title)).toEqual(["Mine"]);
    });
  });
});
