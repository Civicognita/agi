/**
 * ScriptRegistry — per-MApp Starlark script persistence (s182 Phase B).
 *
 * Wraps the `mapp_scripts` Drizzle table with typed CRUD. Mirrors the
 * NotesStore shape (constructor-injected Db, rowToRecord helper, prefixed
 * ULID PKs). Deny-by-default: scripts are created with enabled=false and
 * must be explicitly enabled before the agent pipeline will run them.
 *
 * WASM fields (wasmB64 / wasmHash) are null until Phase D's Starlark→WASM
 * compiler populates them; the registry intentionally exposes them as
 * nullable so callers handle the "not yet compiled" case explicitly.
 */

import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@agi/db-schema/client";
import { mappScripts } from "@agi/db-schema";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ScriptLanguage = "starlark";

export interface MappScriptRecord {
  id: string;
  mappId: string;
  name: string;
  description: string | null;
  language: ScriptLanguage;
  source: string | null;
  sourceHash: string | null;
  /** Base64-encoded WASM binary. Null until Phase D compiles the script. */
  wasmB64: string | null;
  /** sha256:<hex> of the decoded WASM. Null until Phase D. */
  wasmHash: string | null;
  isPacker: boolean;
  enabled: boolean;
  timeoutMs: number;
  maxMemoryPages: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScriptInput {
  mappId: string;
  name: string;
  description?: string;
  language?: ScriptLanguage;
  source?: string;
  isPacker?: boolean;
  /** Explicit override — defaults to false (deny-by-default). */
  enabled?: boolean;
  timeoutMs?: number;
  maxMemoryPages?: number;
}

export interface UpdateScriptInput {
  name?: string;
  description?: string;
  source?: string;
  isPacker?: boolean;
  timeoutMs?: number;
  maxMemoryPages?: number;
}

// ---------------------------------------------------------------------------
// Row → record projection
// ---------------------------------------------------------------------------

function rowToRecord(row: typeof mappScripts.$inferSelect): MappScriptRecord {
  return {
    id: row.id,
    mappId: row.mappId,
    name: row.name,
    description: row.description,
    language: "starlark",
    source: row.source,
    sourceHash: row.sourceHash,
    wasmB64: row.wasmB64,
    wasmHash: row.wasmHash,
    isPacker: row.isPacker,
    enabled: row.enabled,
    timeoutMs: row.timeoutMs,
    maxMemoryPages: row.maxMemoryPages,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ScriptRegistry {
  constructor(private readonly db: Db) {}

  /** List all scripts for a MApp, ordered by name. */
  async list(mappId: string): Promise<MappScriptRecord[]> {
    const rows = await this.db
      .select()
      .from(mappScripts)
      .where(eq(mappScripts.mappId, mappId));
    return rows.map(rowToRecord).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Get a single script by ID. Returns null when not found. */
  async get(id: string): Promise<MappScriptRecord | null> {
    const [row] = await this.db
      .select()
      .from(mappScripts)
      .where(eq(mappScripts.id, id));
    return row ? rowToRecord(row) : null;
  }

  /** Get a script by MApp ID + name. Returns null when not found. */
  async getByName(mappId: string, name: string): Promise<MappScriptRecord | null> {
    const [row] = await this.db
      .select()
      .from(mappScripts)
      .where(and(eq(mappScripts.mappId, mappId), eq(mappScripts.name, name)));
    return row ? rowToRecord(row) : null;
  }

  /** Create a new script. Enabled defaults to false (deny-by-default). */
  async create(input: CreateScriptInput): Promise<MappScriptRecord> {
    const id = `script_${ulid()}`;
    const now = new Date();
    await this.db.insert(mappScripts).values({
      id,
      mappId: input.mappId,
      name: input.name,
      description: input.description ?? null,
      language: input.language ?? "starlark",
      source: input.source ?? null,
      sourceHash: null,
      wasmB64: null,
      wasmHash: null,
      isPacker: input.isPacker ?? false,
      enabled: input.enabled ?? false,
      timeoutMs: input.timeoutMs ?? 1000,
      maxMemoryPages: input.maxMemoryPages ?? 256,
      createdAt: now,
      updatedAt: now,
    });
    const out = await this.get(id);
    if (out === null) throw new Error("script-registry: create did not produce a row");
    return out;
  }

  /** Patch mutable script fields. Returns null when the script doesn't exist. */
  async update(id: string, patch: UpdateScriptInput): Promise<MappScriptRecord | null> {
    const existing = await this.get(id);
    if (existing === null) return null;
    const updates: Partial<typeof mappScripts.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.source !== undefined) {
      updates.source = patch.source;
      // Invalidate compiled WASM when source changes (Phase D will re-compile).
      updates.wasmB64 = null;
      updates.wasmHash = null;
      updates.sourceHash = null;
    }
    if (patch.isPacker !== undefined) updates.isPacker = patch.isPacker;
    if (patch.timeoutMs !== undefined) updates.timeoutMs = patch.timeoutMs;
    if (patch.maxMemoryPages !== undefined) updates.maxMemoryPages = patch.maxMemoryPages;
    await this.db.update(mappScripts).set(updates).where(eq(mappScripts.id, id));
    return this.get(id);
  }

  /** Enable or disable a script. */
  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const existing = await this.get(id);
    if (existing === null) return false;
    await this.db
      .update(mappScripts)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(mappScripts.id, id));
    return true;
  }

  /** Delete a script. Returns false when not found. */
  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (existing === null) return false;
    await this.db.delete(mappScripts).where(eq(mappScripts.id, id));
    return true;
  }

  /**
   * Store compiled artifact for a script.
   * For Starlark mode (Phase D), wasmB64 is the base64 of the UTF-8 source bytes;
   * the starlark-eval.wasm interpreter runs the source at invocation time.
   * Returns null when the script doesn't exist.
   */
  async setCompiled(
    id: string,
    wasmB64: string,
    wasmHash: string,
    sourceHash: string,
  ): Promise<MappScriptRecord | null> {
    const existing = await this.get(id);
    if (existing === null) return null;
    await this.db
      .update(mappScripts)
      .set({ wasmB64, wasmHash, sourceHash, updatedAt: new Date() })
      .where(eq(mappScripts.id, id));
    return this.get(id);
  }

  /**
   * Return enabled packer scripts for a MApp.
   * Used by the agent pipeline to inject active packers (Phase F wiring).
   * Only scripts with is_packer=true AND enabled=true AND wasmB64 non-null
   * can actually execute — callers check wasmB64 before passing to ScriptRunner.
   */
  async getEnabledPackers(mappId: string): Promise<MappScriptRecord[]> {
    const rows = await this.db
      .select()
      .from(mappScripts)
      .where(
        and(
          eq(mappScripts.mappId, mappId),
          eq(mappScripts.isPacker, true),
          eq(mappScripts.enabled, true),
        ),
      );
    return rows.map(rowToRecord);
  }
}
