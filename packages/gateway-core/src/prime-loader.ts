/**
 * PrimeLoader — scans and indexes the .aionima/ PRIME knowledge corpus.
 *
 * Provides:
 *   - index(): scan and return entry count
 *   - loadCoreTruth(): load persona/purpose/authority from core/truth/
 *   - loadPrimeDirective(): load the PRIME directive file (prime.md at root)
 *   - search(query, limit): full-text search over indexed entries
 *   - getByPath(relativePath): read a specific file by relative path
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrimeEntry {
  path: string;
  title: string;
  content: string;
  category: "truth" | "core" | "knowledge" | "lexicon" | "memory" | "other";
}

// ---------------------------------------------------------------------------
// PrimeLoader
// ---------------------------------------------------------------------------

export class PrimeLoader {
  private readonly primeDir: string;
  private entries: PrimeEntry[] = [];
  private indexed = false;

  constructor(primeDir: string) {
    this.primeDir = primeDir;
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
   * Load core truth files (persona, purpose, authority) from core/truth/
   */
  loadCoreTruth(): { persona?: string; purpose?: string; authority?: string } {
    const result: { persona?: string; purpose?: string; authority?: string } = {};

    const truthDir = join(this.primeDir, "core", "truth");
    const personaPath = join(truthDir, ".persona.md");
    const purposePath = join(truthDir, ".purpose.md");
    const authorityPath = join(truthDir, "authority.md");

    try { result.persona = readFileSync(personaPath, "utf-8"); } catch { /* missing */ }
    try { result.purpose = readFileSync(purposePath, "utf-8"); } catch { /* missing */ }
    try { result.authority = readFileSync(authorityPath, "utf-8"); } catch { /* missing */ }

    return result;
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
   * Search indexed entries by keyword query.
   * Returns up to `limit` matching entries (default 10).
   */
  search(query: string, limit = 10): PrimeEntry[] {
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

      if (score > 0) {
        matches.push({ entry, score });
      }
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
