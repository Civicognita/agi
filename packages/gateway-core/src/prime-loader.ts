/**
 * PrimeLoader — scans and indexes the .aionima/ PRIME knowledge corpus.
 *
 * Provides:
 *   - index(): scan and return entry count
 *   - loadCoreTruth(): load persona/purpose/authority from core/truth/
 *   - loadPrimeDirective(): load the PRIME directive file (prime.md at root)
 *   - search(query, limit, queryEmbedding?): full-text + optional cosine search
 *   - computeEmbeddings(engine): pre-compute entry embeddings for semantic search
 *   - getByPath(relativePath): read a specific file by relative path
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";

import { getPrimeReader } from "./prime-reader.js";
import type { PrimeReader } from "./prime-reader.js";
import type { EmbeddingEngine } from "@agi/memory";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrimeEntry {
  path: string;
  title: string;
  content: string;
  category: "truth" | "core" | "knowledge" | "lexicon" | "memory" | "other";
  embedding?: Float32Array;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function primeCosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi; na += ai * ai; nb += bi * bi;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

// ---------------------------------------------------------------------------
// PrimeLoader
// ---------------------------------------------------------------------------

export class PrimeLoader {
  private readonly primeDir: string;
  private entries: PrimeEntry[] = [];
  private indexed = false;
  /** Structured reader — the new surface; legacy methods delegate here. */
  private readonly _reader: PrimeReader;

  constructor(primeDir: string) {
    this.primeDir = primeDir;
    this._reader = getPrimeReader(primeDir);
  }

  /** Expose the structured PrimeReader for callers that need ID-based lookup,
   *  versioning, or hashing (s112 t382). */
  get reader(): PrimeReader {
    return this._reader;
  }

  private static readonly SKIP_DIRS = new Set([
    ".archive", ".ai", "node_modules", ".bak", ".git",
  ]);

  /**
   * Scan and index all .md files in the .aionima/ directory tree.
   * Skips: .archive/, .ai/, node_modules/, .bak/, .git/
   * Returns the number of entries indexed.
   */
  index(): number {
    this.entries = [];
    try {
      statSync(this.primeDir);
    } catch {
      // .aionima/ directory does not exist — return 0 gracefully
      this.indexed = true;
      return 0;
    }
    this.scanDir(this.primeDir, this.primeDir);
    this.indexed = true;
    return this.entries.length;
  }

  private scanDir(dir: string, root: string): void {
    let items: string[];
    try {
      items = readdirSync(dir);
    } catch {
      return;
    }

    for (const name of items) {
      const fullPath = join(dir, name);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (!PrimeLoader.SKIP_DIRS.has(name)) {
          this.scanDir(fullPath, root);
        }
      } else if (stat.isFile() && extname(name) === ".md") {
        try {
          const content = readFileSync(fullPath, "utf-8");
          const rel = relative(root, fullPath).replace(/\\/g, "/");
          const category = this.categorize(rel);
          const title = this.extractTitle(content, name);
          this.entries.push({ path: rel, title, content, category });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  private categorize(relPath: string): PrimeEntry["category"] {
    const lower = relPath.toLowerCase();
    if (lower.startsWith("core/truth/")) return "truth";
    if (lower.startsWith(".aionima/core/") || lower.startsWith("core/")) return "core";
    if (lower.startsWith("knowledge/")) return "knowledge";
    if (lower.startsWith("lexicon/")) return "lexicon";
    if (lower.startsWith(".mem/")) return "memory";
    return "other";
  }

  private extractTitle(content: string, filename: string): string {
    const match = /^#\s+(.+)$/m.exec(content);
    if (match !== null && match[1] !== undefined) return match[1].trim();
    return basename(filename, ".md");
  }

  /**
   * Load core truth files (persona, purpose, authority) from core/truth/.
   * Delegates to PrimeReader.getEntry() — the new structured surface —
   * so callers get the same versioned, hashed content without re-reading files.
   */
  loadCoreTruth(): { persona?: string; purpose?: string; authority?: string } {
    return {
      persona: this._reader.getEntry("persona")?.content,
      purpose: this._reader.getEntry("purpose")?.content,
      authority: this._reader.getEntry("authority")?.content,
    };
  }

  /**
   * Load the PRIME_DIRECTIVE from prime.md at the primeDir root.
   */
  loadPrimeDirective(): string | undefined {
    try {
      return readFileSync(join(this.primeDir, "prime.md"), "utf-8");
    } catch {
      return undefined;
    }
  }

  /**
   * Pre-compute and cache embeddings for all indexed entries.
   * Call once after index() when an EmbeddingEngine becomes available.
   * Non-blocking for callers — errors are silently swallowed per entry.
   */
  async computeEmbeddings(engine: EmbeddingEngine): Promise<void> {
    if (!this.indexed) this.index();
    if (!engine.isAvailable()) return;
    for (const entry of this.entries) {
      try {
        const text = `${entry.title}\n${entry.content}`;
        const emb = await engine.embed(text).catch(() => null);
        if (emb) entry.embedding = emb;
      } catch {
        // non-fatal — entry stays keyword-only
      }
    }
  }

  /**
   * Search indexed entries. Keyword scoring always runs; if `queryEmbedding`
   * is provided and entries have pre-computed embeddings, results are
   * re-ranked by cosine similarity before the keyword pass.
   */
  search(query: string, limit = 10, queryEmbedding?: Float32Array): PrimeEntry[] {
    if (!this.indexed) {
      this.index();
    }

    const q = query.toLowerCase();
    const matches: Array<{ entry: PrimeEntry; score: number }> = [];

    for (const entry of this.entries) {
      let score = 0;
      const titleLower = entry.title.toLowerCase();
      const contentLower = entry.content.toLowerCase();
      const pathLower = entry.path.toLowerCase();

      if (titleLower.includes(q)) score += 3;
      if (pathLower.includes(q)) score += 2;
      if (contentLower.includes(q)) score += 1;

      // Semantic score when both embeddings are available
      if (queryEmbedding && entry.embedding) {
        score += primeCosine(queryEmbedding, entry.embedding) * 2;
      }

      if (score > 0) matches.push({ entry, score });
    }

    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((m) => m.entry);
  }

  /**
   * Generate a compact topic index grouped by category.
   * Used to inject into the system prompt so the agent knows what knowledge
   * is available for search.
   */
  getTopicIndex(): Record<string, string[]> {
    if (!this.indexed) {
      this.index();
    }

    const grouped: Record<string, string[]> = {};
    for (const entry of this.entries) {
      // Skip truth entries — already injected as identity
      if (entry.category === "truth") continue;

      const cat = entry.category;
      if (grouped[cat] === undefined) {
        grouped[cat] = [];
      }
      grouped[cat].push(entry.title);
    }

    return grouped;
  }

  /**
   * Read a specific file from the PRIME corpus by relative path.
   * Returns the file content or undefined if not found.
   * SECURITY: path is validated to stay within primeDir.
   */
  getByPath(relativePath: string): string | undefined {
    const safe = relativePath.replace(/\\/g, "/");
    // Security: reject traversal
    if (safe.includes("..")) return undefined;

    const fullPath = join(this.primeDir, safe);
    try {
      return readFileSync(fullPath, "utf-8");
    } catch {
      return undefined;
    }
  }
}
