/**
 * Notes API — UserNotes REST surface (s152, 2026-05-09).
 *
 * Per-project + global markdown notes with the s152 contract:
 *   - GET    /api/notes?projectPath=...          list (per-project when set, global when omitted)
 *   - GET    /api/notes/:id                       single fetch
 *   - POST   /api/notes                           create
 *   - PUT    /api/notes/:id                       update (partial — title/body/sortOrder/pinned)
 *   - DELETE /api/notes/:id                       remove
 *
 * Single-owner alpha: every note is owned by `~$U0` (the local owner).
 * Multi-user support comes via Hive-ID; the userEntityId column already
 * exists for that future. workspace-projects guard on the projectPath
 * input rejects paths outside the configured workspace, mirroring the
 * pm-api / projects-api pattern.
 */

import type { FastifyInstance } from "fastify";
import type { NotesStore, CreateNoteInput, UpdateNoteInput, UserNoteRecord } from "./notes-store.js";

/** Single-owner alpha — every note is owned by this entity id. */
export const ALPHA_OWNER_ENTITY_ID = "~$U0";

export interface NotesApiDeps {
  notesStore: NotesStore;
  /** Workspace project paths — projectPath query param must lie inside one
   *  of these (or be empty for global scope). */
  workspaceProjects: string[];
  /** Optional hook for resolving the owner entity id (multi-user future).
   *  Defaults to `ALPHA_OWNER_ENTITY_ID` when omitted. */
  resolveOwnerEntityId?: () => string;
}

function isInsideWorkspace(projectPath: string, workspaceProjects: readonly string[]): boolean {
  const normalize = (p: string): string => (p.endsWith("/") ? p : `${p}/`);
  const targetPrefix = normalize(projectPath);
  for (const ws of workspaceProjects) {
    const wsPrefix = normalize(ws);
    if (targetPrefix === wsPrefix) return false; // workspace root itself isn't a project
    if (projectPath.startsWith(wsPrefix)) return true;
  }
  return false;
}

export function registerNotesRoutes(app: FastifyInstance, deps: NotesApiDeps): void {
  const ownerEntityId = (): string => deps.resolveOwnerEntityId?.() ?? ALPHA_OWNER_ENTITY_ID;

  /**
   * GET /api/notes
   *   - no params              → global notes (projectPath null)
   *   - ?projectPath=/abs/path → notes for that project
   *   - ?scope=all             → all notes for the user, both scopes
   */
  app.get("/api/notes", async (request, reply) => {
    const query = request.query as { projectPath?: string; scope?: string };
    const userId = ownerEntityId();
    if (query.scope === "all") {
      const all = await deps.notesStore.list(userId);
      return { notes: all, scope: "all" };
    }
    if (typeof query.projectPath === "string" && query.projectPath.length > 0) {
      if (!isInsideWorkspace(query.projectPath, deps.workspaceProjects)) {
        return reply.code(403).send({ error: "projectPath is not inside a configured workspace.projects directory" });
      }
      const notes = await deps.notesStore.list(userId, query.projectPath);
      return { notes, scope: "project", projectPath: query.projectPath };
    }
    const globals = await deps.notesStore.list(userId, null);
    return { notes: globals, scope: "global" };
  });

  /** GET /api/notes/:id */
  app.get<{ Params: { id: string } }>("/api/notes/:id", async (request, reply) => {
    const { id } = request.params;
    const note = await deps.notesStore.get(id);
    if (note === null) {
      return reply.code(404).send({ error: `note ${id} not found` });
    }
    if (note.userEntityId !== ownerEntityId()) {
      return reply.code(403).send({ error: "note is owned by another user" });
    }
    return note;
  });

  /**
   * POST /api/notes
   * Body: { projectPath?: string|null; title: string; body?: string; pinned?: boolean; sortOrder?: number }
   * - omit projectPath OR set to null → global note
   * - set projectPath to absolute path → per-project note (must be inside workspace)
   */
  app.post("/api/notes", async (request, reply) => {
    const body = request.body as Partial<CreateNoteInput> & { projectPath?: string | null };
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return reply.code(400).send({ error: "title is required" });
    }
    let projectPath: string | null = null;
    if (typeof body.projectPath === "string" && body.projectPath.length > 0) {
      if (!isInsideWorkspace(body.projectPath, deps.workspaceProjects)) {
        return reply.code(403).send({ error: "projectPath is not inside a configured workspace.projects directory" });
      }
      projectPath = body.projectPath;
    }
    const created: UserNoteRecord = await deps.notesStore.create({
      userEntityId: ownerEntityId(),
      projectPath,
      title: body.title.trim(),
      body: typeof body.body === "string" ? body.body : "",
      ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
      ...(typeof body.sortOrder === "number" ? { sortOrder: body.sortOrder } : {}),
    });
    return reply.code(201).send(created);
  });

  /**
   * PUT /api/notes/:id
   * Body: { title?: string; body?: string; sortOrder?: number; pinned?: boolean }
   * Partial update — only provided fields change. projectPath cannot be
   * changed via PUT (delete + recreate to switch scopes).
   */
  app.put<{ Params: { id: string } }>("/api/notes/:id", async (request, reply) => {
    const { id } = request.params;
    const note = await deps.notesStore.get(id);
    if (note === null) {
      return reply.code(404).send({ error: `note ${id} not found` });
    }
    if (note.userEntityId !== ownerEntityId()) {
      return reply.code(403).send({ error: "note is owned by another user" });
    }
    const body = request.body as UpdateNoteInput;
    const patch: UpdateNoteInput = {};
    if (typeof body.title === "string") patch.title = body.title.trim();
    if (typeof body.body === "string") patch.body = body.body;
    if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;
    if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
    const updated = await deps.notesStore.update(id, patch);
    return updated;
  });

  /** DELETE /api/notes/:id */
  app.delete<{ Params: { id: string } }>("/api/notes/:id", async (request, reply) => {
    const { id } = request.params;
    const note = await deps.notesStore.get(id);
    if (note === null) {
      return reply.code(404).send({ error: `note ${id} not found` });
    }
    if (note.userEntityId !== ownerEntityId()) {
      return reply.code(403).send({ error: "note is owned by another user" });
    }
    await deps.notesStore.delete(id);
    return reply.code(204).send();
  });
}
