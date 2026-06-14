/**
 * DocIndexer — indexes agi/docs/, the global knowledge dir, and per-project
 * knowledge dirs (.ai/) into the doc_chunks table (s112 Phase 3).
 *
 * Chunking: split markdown at H1/H2/H3 boundaries, 100–800 char range.
 * Staleness: mtime-first fast path, then SHA-256 content hash (s197).
 *   mtime cache persisted to {cacheDir}/mtime-cache.json (~/.agi/doc-index/).
 * Scopes: 'global' (agi/docs/, _aionima/.ai/), 'project:<path>' (.ai/ under project root).
 *
 * EmbeddingEngine is optional; chunks without embeddings still get FTS5 indexed.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, watch } from "node:fs";
import { join, extname, relative } from "node:path";
import { ulid } from "ulid";
import { KNOWLEDGE_DIR } from "./project-config-path.js";
import type { GraphMemoryAdapter } from "@agi/memory";
import type { EmbeddingEngine } from "@agi/memory";

export interface DocIndexerOptions {
  graph: GraphMemoryAdapter;
  embeddingEngine?: EmbeddingEngine;
  /** Path to agi/ monorepo root (for docs/ subfolder discovery). */
  agiRoot: string;
  /** Path to global k/ directory (e.g. _aionima/k/). */
  globalKDir?: string;
  /** Project directories to scan for local k/ folders. */
  projectDirs?: string[];
  /**
   * Directory for the mtime+hash cache file (s197 — defaults to ~/.agi/doc-index/).
   * Set to `undefined` to disable the cache. The cache file is
   * `{cacheDir}/mtime-cache.json` mapping filePath → { mtimeMs, hash }.
   */
  cacheDir?: string;
  logger?: { info(msg: string): void; debug(msg: string): void; warn(msg: string): void };
}

interface IndexResult {
  added: number;
  updated: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

const HEADING_SPLIT = /(?=^#{1,3} )/m;
const MIN_CHUNK = 100;
const MAX_CHUNK = 800;

interface RawChunk {
  heading: string;
  content: string;
}

function chunkMarkdown(text: string): RawChunk[] {
  const parts = text.split(HEADING_SPLIT);
  const chunks: RawChunk[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length < MIN_CHUNK) continue;

    const headingMatch = trimmed.match(/^(#{1,3} .+)\n/);
    const heading = headingMatch?.[1]?.replace(/^#+\s*/, "") ?? "";
    const body = headingMatch ? trimmed.slice(headingMatch[0].length).trim() : trimmed;

    // Split oversized chunks by paragraph
    if (body.length <= MAX_CHUNK) {
      if (body.length >= MIN_CHUNK) {
        chunks.push({ heading, content: body });
      }
    } else {
      const paragraphs = body.split(/\n{2,}/);
      let acc = "";
      for (const para of paragraphs) {
        if (acc.length + para.length > MAX_CHUNK && acc.length >= MIN_CHUNK) {
          chunks.push({ heading, content: acc.trim() });
          acc = para;
        } else {
          acc = acc ? `${acc}\n\n${para}` : para;
        }
      }
      if (acc.trim().length >= MIN_CHUNK) {
        chunks.push({ heading, content: acc.trim() });
      }
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Mtime cache helpers (s197 — fast staleness pre-check)
// ---------------------------------------------------------------------------

interface MtimeCacheEntry { mtimeMs: number; hash: string }
type MtimeCache = Record<string, MtimeCacheEntry>;

// ---------------------------------------------------------------------------
// DocIndexer
// ---------------------------------------------------------------------------

export class DocIndexer {
  private readonly graph: GraphMemoryAdapter;
  private readonly embeddingEngine?: EmbeddingEngine;
  private readonly agiRoot: string;
  private readonly globalKDir?: string;
  private readonly projectDirs: string[];
  private readonly cacheFilePath?: string;
  private mtimeCache: MtimeCache = {};
  private readonly logger?: DocIndexerOptions["logger"];

  constructor(opts: DocIndexerOptions) {
    this.graph = opts.graph;
    this.embeddingEngine = opts.embeddingEngine;
    this.agiRoot = opts.agiRoot;
    this.globalKDir = opts.globalKDir;
    this.projectDirs = opts.projectDirs ?? [];
    this.logger = opts.logger;
    if (opts.cacheDir !== undefined) {
      this.cacheFilePath = join(opts.cacheDir, "mtime-cache.json");
      this._loadMtimeCache();
    }
  }

  private _loadMtimeCache(): void {
    if (!this.cacheFilePath) return;
    try {
      const raw = readFileSync(this.cacheFilePath, "utf-8");
      this.mtimeCache = JSON.parse(raw) as MtimeCache;
    } catch {
      this.mtimeCache = {};
    }
  }

  private _saveMtimeCache(): void {
    if (!this.cacheFilePath) return;
    try {
      const dir = this.cacheFilePath.slice(0, this.cacheFilePath.lastIndexOf("/"));
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.cacheFilePath, JSON.stringify(this.mtimeCache));
    } catch {
      // non-fatal — cache is a performance optimization only
    }
  }

  /** Index all sources. Skips unchanged files (content hash match). */
  async indexAll(): Promise<IndexResult> {
    const result: IndexResult = { added: 0, updated: 0, skipped: 0 };

    const sources: Array<{ dir: string; scope: string }> = [];

    // agi/docs/ — global platform documentation
    const docsDir = join(this.agiRoot, "docs");
    if (existsSync(docsDir)) {
      sources.push({ dir: docsDir, scope: "global" });
    }

    // Global k/ directory
    if (this.globalKDir && existsSync(this.globalKDir)) {
      sources.push({ dir: this.globalKDir, scope: "global" });
    }

    // Per-project knowledge (.ai/) directories
    for (const projectDir of this.projectDirs) {
      const kDir = join(projectDir, KNOWLEDGE_DIR);
      if (existsSync(kDir)) {
        sources.push({ dir: kDir, scope: `project:${projectDir}` });
      }
    }

    for (const { dir, scope } of sources) {
      await this._indexDir(dir, scope, result);
    }

    this._saveMtimeCache();
    this.logger?.info(
      `[doc-indexer] indexed — added:${String(result.added)} updated:${String(result.updated)} skipped:${String(result.skipped)}`,
    );
    return result;
  }

  /** Watch for file changes and re-index incrementally. Best-effort. */
  watchForChanges(): void {
    const dirsToWatch: string[] = [];

    const docsDir = join(this.agiRoot, "docs");
    if (existsSync(docsDir)) dirsToWatch.push(docsDir);
    if (this.globalKDir && existsSync(this.globalKDir)) dirsToWatch.push(this.globalKDir);

    for (const projectDir of this.projectDirs) {
      const kDir = join(projectDir, KNOWLEDGE_DIR);
      if (existsSync(kDir)) dirsToWatch.push(kDir);
    }

    for (const dir of dirsToWatch) {
      try {
        watch(dir, { recursive: true }, (_event, filename) => {
          if (filename && extname(filename) === ".md") {
            void this.indexAll().catch(() => { /* non-fatal */ });
          }
        });
      } catch {
        // fs.watch can fail on certain fs types — degrade silently
      }
    }
  }

  /**
   * Query doc chunks. Returns chunks matching the query, optionally filtered
   * by scope. Embedding-reranked when EmbeddingEngine is available.
   */
  async query(opts: {
    query: string;
    scope?: string;
    limit?: number;
  }): Promise<Array<{ heading: string | null; content: string; sourcePath: string; scope: string }>> {
    const limit = opts.limit ?? 5;
    const queryEmbedding = this.embeddingEngine?.isAvailable()
      ? (await this.embeddingEngine.embed(opts.query).catch(() => null)) ?? undefined
      : undefined;

    const chunks = await this.graph.queryDocChunks({
      scope: opts.scope,
      semantic: opts.query,
      limit,
      queryEmbedding,
    });

    return chunks.map((c) => ({
      heading: c.heading ?? null,
      content: c.content,
      sourcePath: c.sourcePath,
      scope: c.scope,
    }));
  }

  /**
   * Build a compact doc topic index grouped by agi/docs/ subdirectory.
   * Returns `{ "human": ["cli.md", "taskmaster.md", ...], "agents": [...] }`.
   * Used by the system prompt so Aion knows what docs exist without having
   * to search blindly. Reads the filesystem directly — no DB query needed.
   */
  getDocTopicIndex(): Record<string, string[]> {
    const docsDir = join(this.agiRoot, "docs");
    if (!existsSync(docsDir)) return {};

    const result: Record<string, string[]> = {};
    try {
      const entries = readdirSync(docsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDir = join(docsDir, entry.name);
          const files = readdirSync(subDir).filter((f) => f.endsWith(".md")).sort();
          if (files.length > 0) result[entry.name] = files;
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          (result[""] ??= []).push(entry.name);
        }
      }
    } catch {
      // Best-effort — if the filesystem can't be read, return empty
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async _indexDir(dir: string, scope: string, result: IndexResult): Promise<void> {
    const files = this._collectMdFiles(dir);
    for (const filePath of files) {
      try {
        await this._indexFile(filePath, scope, result);
      } catch (err) {
        this.logger?.warn(`[doc-indexer] failed to index ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private _collectMdFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this._collectMdFiles(full));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(full);
      }
    }
    return files;
  }

  private async _indexFile(filePath: string, scope: string, result: IndexResult): Promise<void> {
    const stat = statSync(filePath);
    if (!stat.isFile()) return;

    // mtime fast-path: if mtime matches our cache, file is unchanged — skip without reading content.
    const cached = this.mtimeCache[filePath];
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      const existingHash = await this.graph.getDocChunkHash(filePath);
      if (existingHash === cached.hash) {
        result.skipped++;
        return;
      }
    }

    const text = readFileSync(filePath, "utf-8");
    const fileHash = createHash("sha256").update(text).digest("hex");

    const chunks = chunkMarkdown(text);
    if (chunks.length === 0) return;

    // Check if file already indexed with same hash (fallback when mtime cache misses).
    const existingHash = await this.graph.getDocChunkHash(filePath);
    if (existingHash === fileHash) {
      // Update mtime cache so the next run skips the hash DB query.
      this.mtimeCache[filePath] = { mtimeMs: stat.mtimeMs, hash: fileHash };
      result.skipped++;
      return;
    }

    // Remove old chunks for this file
    await this.graph.deleteDocChunksForPath(filePath);

    // Store new chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
      const chunkText = chunk.heading ? `${chunk.heading}\n${chunk.content}` : chunk.content;

      let embedding: Float32Array | undefined;
      if (this.embeddingEngine?.isAvailable()) {
        const emb = await this.embeddingEngine.embed(chunkText).catch(() => null);
        if (emb) embedding = emb;
      }

      await this.graph.storeDocChunk({
        id: ulid(),
        sourcePath: filePath,
        scope,
        heading: chunk.heading || null,
        content: chunk.content,
        chunkIndex: i,
        contentHash: fileHash,
        indexedAt: Date.now(),
        embedding,
      });
    }

    // Update mtime cache with new hash so the next run can short-circuit.
    this.mtimeCache[filePath] = { mtimeMs: stat.mtimeMs, hash: fileHash };

    if (existingHash !== null) {
      result.updated++;
    } else {
      result.added++;
    }

    this.logger?.debug(`[doc-indexer] indexed ${relative(this.agiRoot, filePath)} (${String(chunks.length)} chunks)`);
  }
}
