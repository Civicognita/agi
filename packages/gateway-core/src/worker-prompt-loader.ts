/**
 * WorkerPromptLoader — dynamic discovery and loading of worker prompts.
 *
 * Scans prompts/workers/ for markdown files with YAML frontmatter,
 * parsing metadata (name, description, model, color, domain, role)
 * and exposing them as WorkerPromptEntry objects.
 *
 * Re-scans on every discover() call — no stale cache (hot-swappable).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename, dirname, relative } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerPromptEntry {
  /** Worker ID in "domain.role" format (e.g., "code.engineer"). */
  id: string;
  /** YAML `name` field (e.g., "worker-code-engineer"). */
  name: string;
  /** Worker domain (e.g., "code", "k", "ux"). */
  domain: string;
  /** Worker role within the domain (e.g., "engineer", "hacker"). */
  role: string;
  /** Human-readable description from YAML frontmatter. */
  description: string;
  /** LLM model tier (e.g., "sonnet", "haiku", "opus"). */
  model: string;
  /** Display color from YAML frontmatter. */
  color: string;
  /** Full markdown body (after frontmatter) — the worker's system prompt. */
  systemPrompt: string;
  /** Absolute path to the source .md file (for dashboard file-open). */
  filePath: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

interface FrontmatterResult {
  attrs: Record<string, string>;
  body: string;
}

function parseFrontmatter(raw: string): FrontmatterResult {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { attrs: {}, body: raw };

  const attrs: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) attrs[key] = value;
  }
  return { attrs, body: match[2]!.trim() };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export class WorkerPromptLoader {
  private readonly promptDir: string;

  constructor(promptDir: string) {
    this.promptDir = promptDir;
  }

  /** Scan the prompts directory and return all discovered worker entries. */
  discover(): WorkerPromptEntry[] {
    if (!existsSync(this.promptDir)) return [];
    const entries: WorkerPromptEntry[] = [];
    this.scanDir(this.promptDir, entries);
    return entries.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Get a specific worker by domain and role. */
  get(domain: string, role: string): WorkerPromptEntry | null {
    return this.discover().find((e) => e.domain === domain && e.role === role) ?? null;
  }

  /** Get the full system prompt for a worker. */
  getSystemPrompt(domain: string, role: string): string | null {
    return this.get(domain, role)?.systemPrompt ?? null;
  }

  /** List all workers, optionally filtered by domain. */
  list(domain?: string): WorkerPromptEntry[] {
    const all = this.discover();
    return domain ? all.filter((e) => e.domain === domain) : all;
  }

  /** List all unique domain names. */
  listDomains(): string[] {
    return [...new Set(this.discover().map((e) => e.domain))].sort();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private scanDir(dir: string, entries: WorkerPromptEntry[]): void {
    let items: string[];
    try {
      items = readdirSync(dir);
    } catch {
      return;
    }

    for (const item of items) {
      const fullPath = join(dir, item);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          this.scanDir(fullPath, entries);
        } else if (item.endsWith(".md") && item !== "worker-base.md") {
          const entry = this.loadEntry(fullPath);
          if (entry) entries.push(entry);
        }
      } catch {
        // Skip unreadable entries.
      }
    }
  }

  private loadEntry(filePath: string): WorkerPromptEntry | null {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const { attrs, body } = parseFrontmatter(raw);

      // Derive domain from parent directory name (e.g., "code", "k")
      const relPath = relative(this.promptDir, filePath);
      const parentDir = dirname(relPath);
      const fileName = basename(filePath, ".md");

      // Files in domain subdirectories: domain = parent dir, role = filename
      // Files at root level: domain = "general", role = filename
      const domain = parentDir !== "." ? parentDir : "general";
      const role = fileName;

      return {
        id: `${domain}.${role}`,
        name: attrs.name ?? `worker-${domain}-${role}`,
        domain,
        role,
        description: attrs.description ?? "",
        model: attrs.model ?? "sonnet",
        color: attrs.color ?? "blue",
        systemPrompt: body,
        filePath,
      };
    } catch {
      return null;
    }
  }
}
