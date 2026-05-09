/**
 * NotesStore — Postgres/drizzle persistence for UserNotes (s152, 2026-05-09).
 *
 * Owner directive: "a first-class Notes surface for END USERS … Aion can
 * read these notes the same way it reads Dev Notes." Storage round-trips
 * through agi_data per the single-source-of-truth rule.
 *
 * Two scopes:
 *   - per-project notes — `projectPath` set
 *   - global notes — `projectPath` NULL
 *
 * Sort order: pinned notes first (by sortOrder asc, then createdAt desc),
 * then unpinned (sortOrder asc, then createdAt desc). Drag-to-reorder in
 * the UI mutates `sortOrder`.
 */

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@agi/db-schema/client";
import { userNotes } from "@agi/db-schema";

export interface UserNoteRecord {
  id: string;
  userEntityId: string;
  projectPath: string | null;
  title: string;
  body: string;
  sortOrder: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteInput {
  userEntityId: string;
  projectPath: string | null;
  title: string;
  body?: string;
  sortOrder?: number;
  pinned?: boolean;
}

export interface UpdateNoteInput {
  title?: string;
  body?: string;
  sortOrder?: number;
  pinned?: boolean;
}

function rowToRecord(row: typeof userNotes.$inferSelect): UserNoteRecord {
  return {
    id: row.id,
    userEntityId: row.userEntityId,
    projectPath: row.projectPath,
    title: row.title,
    body: row.body,
    sortOrder: row.sortOrder,
    pinned: row.pinned,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

export class NotesStore {
  constructor(private readonly db: Db) {}

  /**
   * List notes for a scope. When `projectPath` is undefined, returns all
   * notes for the user across both scopes. When null, returns global
   * notes only. When a string, returns notes for that project.
   *
   * Result order: pinned first, then by sortOrder asc, then createdAt desc
   * (newest-first within ties so the most recent note surfaces at top).
   */
  async list(userEntityId: string, projectPath?: string | null): Promise<UserNoteRecord[]> {
    const conds = [eq(userNotes.userEntityId, userEntityId)];
    if (projectPath === null) {
      conds.push(isNull(userNotes.projectPath));
    } else if (typeof projectPath === "string") {
      conds.push(eq(userNotes.projectPath, projectPath));
    }
    const rows = await this.db
      .select()
      .from(userNotes)
      .where(and(...conds))
      .orderBy(desc(userNotes.pinned), asc(userNotes.sortOrder), desc(userNotes.createdAt));
    return rows.map(rowToRecord);
  }

  async get(noteId: string): Promise<UserNoteRecord | null> {
    const [row] = await this.db.select().from(userNotes).where(eq(userNotes.id, noteId));
    return row ? rowToRecord(row) : null;
  }

  async create(input: CreateNoteInput): Promise<UserNoteRecord> {
    const id = `note_${ulid()}`;
    const now = new Date();
    await this.db.insert(userNotes).values({
      id,
      userEntityId: input.userEntityId,
      projectPath: input.projectPath,
      title: input.title,
      body: input.body ?? "",
      sortOrder: input.sortOrder ?? 0,
      pinned: input.pinned ?? false,
      createdAt: now,
      updatedAt: now,
    });
    const out = await this.get(id);
    if (out === null) {
      throw new Error("notes-store: create did not produce a row");
    }
    return out;
  }

  async update(noteId: string, patch: UpdateNoteInput): Promise<UserNoteRecord | null> {
    const existing = await this.get(noteId);
    if (existing === null) return null;
    const updates: Partial<typeof userNotes.$inferInsert> = { updatedAt: new Date() };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.body !== undefined) updates.body = patch.body;
    if (patch.sortOrder !== undefined) updates.sortOrder = patch.sortOrder;
    if (patch.pinned !== undefined) updates.pinned = patch.pinned;
    await this.db.update(userNotes).set(updates).where(eq(userNotes.id, noteId));
    return this.get(noteId);
  }

  async delete(noteId: string): Promise<boolean> {
    const existing = await this.get(noteId);
    if (existing === null) return false;
    await this.db.delete(userNotes).where(eq(userNotes.id, noteId));
    return true;
  }
}
