/**
 * File-based memory provider — Task #141 (OFFLINE fallback)
 *
 * Stores memories as JSON files in .aionima/.mem/<entityId>/.
 * No network required. Used when STATE !== ONLINE.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import type {
  MemoryProvider,
  MemoryEntry,
  MemoryQueryParams,
  PruneParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class FileMemoryProvider implements MemoryProvider {
  readonly name = "file-memory";
  readonly requiresNetwork = false;

  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    // Ensure base directory exists
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  async store(entry: MemoryEntry): Promise<void> {
    const dir = this.entityDir(entry.entityId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const filePath = join(dir, `${entry.id}.json`);
    writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf-8");
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.store(entry);
    }
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  async query(params: MemoryQueryParams): Promise<MemoryEntry[]> {
    const entries = this.loadAllForEntity(params.entityId);

    let filtered = entries;

    // Filter by category
    if (params.categories !== undefined && params.categories.length > 0) {
      const cats = new Set(params.categories);
      filtered = filtered.filter((e) => cats.has(e.category));
    }

    // Simple keyword relevance scoring (no semantic search in file mode)
    if (params.query !== undefined && params.query.length > 0) {
      const queryLower = params.query.toLowerCase();
      const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

      filtered = filtered.map((entry) => {
        const contentLower = entry.content.toLowerCase();
        const matchCount = queryWords.filter((w) => contentLower.includes(w)).length;
        const relevance = queryWords.length > 0 ? matchCount / queryWords.length : 0;
        return { ...entry, relevanceScore: relevance };
      });

      // Filter by minimum relevance
      const minRel = params.minRelevance ?? 0;
      filtered = filtered.filter((e) => (e.relevanceScore ?? 0) >= minRel);

      // Sort by relevance descending
      filtered.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
    } else {
      // Sort by recency
      filtered.sort((a, b) =>
        new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime(),
      );
    }

    // Apply limit
    const limit = params.limit ?? 10;
    filtered = filtered.slice(0, limit);

    // Update access timestamps
    for (const entry of filtered) {
      entry.lastAccessedAt = new Date().toISOString();
      entry.accessCount++;
      await this.store(entry);
    }

    return filtered;
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  async delete(memoryId: string): Promise<void> {
    // Search all entity directories for this memory
    if (!existsSync(this.baseDir)) return;

    const entityDirs = readdirSync(this.baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const entityDir of entityDirs) {
      const filePath = join(this.baseDir, entityDir, `${memoryId}.json`);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        return;
      }
    }
  }

  async deleteAllForEntity(entityId: string): Promise<void> {
    const dir = this.entityDir(entityId);
    if (!existsSync(dir)) return;

    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      unlinkSync(join(dir, file));
    }
  }

  // ---------------------------------------------------------------------------
  // Prune
  // ---------------------------------------------------------------------------

  async prune(params: PruneParams): Promise<number> {
    let pruned = 0;
    const entityIds = params.entityId !== undefined
      ? [params.entityId]
      : this.listEntityIds();

    for (const entityId of entityIds) {
      const entries = this.loadAllForEntity(entityId);

      // Sort by access count ascending, then by age descending
      entries.sort((a, b) => a.accessCount - b.accessCount);

      for (const entry of entries) {
        let shouldPrune = false;

        if (params.olderThan !== undefined) {
          shouldPrune = new Date(entry.createdAt) < new Date(params.olderThan);
        }

        if (params.accessCountBelow !== undefined) {
          shouldPrune = shouldPrune || entry.accessCount < params.accessCountBelow;
        }

        if (shouldPrune) {
          await this.delete(entry.id);
          pruned++;
        }
      }

      // Enforce max per entity
      if (params.maxPerEntity !== undefined) {
        const remaining = this.loadAllForEntity(entityId);
        if (remaining.length > params.maxPerEntity) {
          // Remove oldest, least-accessed entries
          remaining.sort((a, b) => a.accessCount - b.accessCount);
          const toRemove = remaining.slice(0, remaining.length - params.maxPerEntity);
          for (const entry of toRemove) {
            await this.delete(entry.id);
            pruned++;
          }
        }
      }
    }

    return pruned;
  }

  // ---------------------------------------------------------------------------
  // Count / availability
  // ---------------------------------------------------------------------------

  async count(entityId: string): Promise<number> {
    const dir = this.entityDir(entityId);
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((f) => f.endsWith(".json")).length;
  }

  async isAvailable(): Promise<boolean> {
    return true; // File system is always available
  }

  // ---------------------------------------------------------------------------
  // Sync helpers (for ONLINE restore)
  // ---------------------------------------------------------------------------

  /** Get all pending memories across all entities (for sync to Cognee). */
  getAllPending(): MemoryEntry[] {
    const all: MemoryEntry[] = [];
    for (const entityId of this.listEntityIds()) {
      all.push(...this.loadAllForEntity(entityId));
    }
    return all;
  }

  /** Get count of pending sync entries. */
  getPendingSyncCount(): number {
    return this.getAllPending().length;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private entityDir(entityId: string): string {
    return join(this.baseDir, entityId);
  }

  private listEntityIds(): string[] {
    if (!existsSync(this.baseDir)) return [];
    return readdirSync(this.baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  private loadAllForEntity(entityId: string): MemoryEntry[] {
    const dir = this.entityDir(entityId);
    if (!existsSync(dir)) return [];

    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const entries: MemoryEntry[] = [];

    for (const file of files) {
      try {
        const raw = readFileSync(join(dir, file), "utf-8");
        entries.push(JSON.parse(raw) as MemoryEntry);
      } catch {
        // Skip corrupted files
      }
    }

    return entries;
  }
}
