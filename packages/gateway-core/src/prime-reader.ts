/**
 * PrimeReader — structured, versioned access to the PRIME corpus (s112 t382).
 *
 * Provides:
 *   getEntry(id)        — look up a named PRIME concept by ID
 *   listEntries(domain) — enumerate entries filtered by domain
 *   getVersion()        — git HEAD of the PRIME repo; stable per-instance
 *
 * This is the new structured surface. PrimeLoader (legacy) gradually delegates
 * here; callers that need ID-based lookup + versioning + hashing should use
 * PrimeReader directly. The legacy primeLoader.loadCoreTruth() is preserved
 * for backward-compat and delegates to getEntry("persona") etc.
 *
 * ID scheme:
 *   Filename without extension and leading dot becomes the ID.
 *   - core/0SCALE.md             → id "0SCALE"
 *   - core/truth/.persona.md     → id "persona"
 *   - WIP/knowledge/foo.md       → id "foo"
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

export type PrimeEntryKind = "truth" | "core" | "wip" | "knowledge" | "lexicon" | "other";

export interface PrimeEntry {
  /** Stable slug derived from filename, e.g. "0SCALE", "persona", "0COA". */
  id: string;
  /** Where in the corpus this entry lives. */
  kind: PrimeEntryKind;
  /** Raw markdown content. */
  content: string;
  /** sha256:<hex> of content — for dedup + drift detection. */
  hash: string;
  /** git HEAD of the PRIME repo at read time. "unknown" if git fails. */
  version: string;
  /** Absolute path to the source file. */
  sourcePath: string;
}

const SKIP_DIRS = new Set([".archive", ".ai", "node_modules", ".bak", ".git", ".trash"]);

export class PrimeReader {
  private readonly primeDir: string;
  private _version?: string;
  private _entries?: Map<string, PrimeEntry>;

  constructor(primeDir: string) {
    this.primeDir = primeDir;
  }

  /**
   * git HEAD of the PRIME repo. Computed once, cached per-instance.
   * Falls back to "unknown" if git is unavailable or dir is not a repo.
   */
  getVersion(): string {
    if (this._version !== undefined) return this._version;
    try {
      // execFileSync (not execSync) — no shell, no injection risk.
      // argv is fully fixed; primeDir is gateway-config-supplied, not user input.
      this._version = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: this.primeDir,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 3000,
      })
        .toString()
        .trim();
    } catch {
      this._version = "unknown";
    }
    return this._version;
  }

  /**
   * Look up a PRIME entry by ID (e.g. "0SCALE", "persona", "0COA").
   * Exact match first; case-insensitive fallback so getEntry("persona")
   * finds files named ".persona.md".
   */
  getEntry(id: string): PrimeEntry | undefined {
    const entries = this._getEntries();
    return entries.get(id) ?? entries.get(id.toLowerCase());
  }

  /**
   * List all indexed PRIME entries, optionally filtered by domain:
   *   "truth" — files under core/truth/
   *   "core"  — files directly under core/ (not core/truth/)
   *   "WIP"   — files under WIP/
   *   omit    — all entries (deduplicated)
   */
  listEntries(domain?: "truth" | "core" | "WIP"): PrimeEntry[] {
    const all = Array.from(this._getEntries().values()).filter(
      (e, _i, arr) =>
        // De-dup: the map may contain lowercase-alias entries pointing to the same
        // object. Keep only the first occurrence per sourcePath.
        arr.findIndex((o) => o.sourcePath === e.sourcePath) ===
        arr.indexOf(e),
    );
    if (!domain) return all;
    const kindFilter: PrimeEntryKind = domain === "WIP" ? "wip" : (domain as PrimeEntryKind);
    return all.filter((e) => e.kind === kindFilter);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private _getEntries(): Map<string, PrimeEntry> {
    if (this._entries) return this._entries;
    const version = this.getVersion();
    this._entries = new Map();
    this._scanDir(this.primeDir, version, this._entries);
    return this._entries;
  }

  private _scanDir(dir: string, version: string, out: Map<string, PrimeEntry>): void {
    let items: string[];
    try {
      items = readdirSync(dir);
    } catch {
      return;
    }

    for (const name of items) {
      if (SKIP_DIRS.has(name)) continue;
      const fullPath = join(dir, name);
      let st;
      try {
        st = statSync(fullPath);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        this._scanDir(fullPath, version, out);
        continue;
      }
      if (extname(name) !== ".md") continue;

      const id = this._idFromPath(fullPath);
      const kind = this._kindFromPath(fullPath);
      let content: string;
      try {
        content = readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }
      const hash = "sha256:" + createHash("sha256").update(content).digest("hex");
      const entry: PrimeEntry = { id, kind, content, hash, version, sourcePath: fullPath };
      out.set(id, entry);
      // Lowercase alias so getEntry("persona") resolves ".persona.md" entry
      if (id !== id.toLowerCase()) {
        out.set(id.toLowerCase(), entry);
      }
    }
  }

  private _idFromPath(fullPath: string): string {
    let name = basename(fullPath, extname(fullPath));
    // Dotfiles: .persona.md → "persona"
    if (name.startsWith(".")) name = name.slice(1);
    return name || basename(fullPath);
  }

  private _kindFromPath(fullPath: string): PrimeEntryKind {
    const rel = relative(this.primeDir, fullPath).replace(/\\/g, "/");
    if (rel.startsWith("core/truth/")) return "truth";
    if (rel.startsWith("core/")) return "core";
    if (rel.startsWith("WIP/") || rel.startsWith("wip/")) return "wip";
    if (rel.startsWith("knowledge/")) return "knowledge";
    if (rel.startsWith("lexicon/")) return "lexicon";
    return "other";
  }
}

/**
 * Module-level singleton factory — callers sharing the same primeDir
 * reuse the scan cache without coordinating lifecycle themselves.
 */
const _readers = new Map<string, PrimeReader>();
export function getPrimeReader(primeDir: string): PrimeReader {
  let r = _readers.get(primeDir);
  if (!r) {
    r = new PrimeReader(primeDir);
    _readers.set(primeDir, r);
  }
  return r;
}
