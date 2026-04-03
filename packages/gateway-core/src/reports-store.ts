/**
 * Reports Store — filesystem-backed immutable report store.
 *
 * Reports live at ~/.agi/reports/<sanitized-coaReqId>/ with:
 *   meta.json  — job metadata
 *   burn.md    — YAML frontmatter + markdown table
 *   *.md       — per-worker summaries
 */

import { readdirSync, readFileSync, statSync, watch } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import type { ReportSummary, ReportDetail, ReportFile, BurnData, BurnWorkerEntry } from "./dashboard-types.js";

// ---------------------------------------------------------------------------
// COA filesystem key helper (inlined from runtime-types to avoid cross-package import)
// ---------------------------------------------------------------------------

function fsToCoaFingerprint(dirName: string): string {
  const parts = dirName.split("-");
  if (parts.length < 4) return dirName;
  return `$${parts[0]}.#${parts[1]}.@${parts[2]}.${parts.slice(3).join("-")}`;
}

// ---------------------------------------------------------------------------
// LRU cache for immutable reports
// ---------------------------------------------------------------------------

class LRUCache<K, V> {
  private map = new Map<K, V>();
  constructor(private maxSize: number) {}

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      const first = this.map.keys().next();
      if (!first.done && first.value !== undefined) this.map.delete(first.value);
    }
  }
}

// ---------------------------------------------------------------------------
// Burn frontmatter parser
// ---------------------------------------------------------------------------

function parseBurnFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return {};
  const pairs: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      pairs[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// ReportsStore
// ---------------------------------------------------------------------------

export class ReportsStore extends EventEmitter {
  private reportsDir: string;
  private cache = new LRUCache<string, ReportSummary>(200);

  constructor(reportsDir?: string) {
    super();
    this.reportsDir = reportsDir ?? join(homedir(), ".agi", "reports");
  }

  list(opts?: {
    project?: string;
    since?: string;
    until?: string;
    limit?: number;
    offset?: number;
  }): { reports: ReportSummary[]; total: number } {
    const limit = opts?.limit ?? 20;
    const offset = opts?.offset ?? 0;

    let dirs: { name: string; mtime: number }[];
    try {
      dirs = readdirSync(this.reportsDir)
        .map((name) => {
          try {
            const stat = statSync(join(this.reportsDir, name));
            return stat.isDirectory() ? { name, mtime: stat.mtimeMs } : null;
          } catch {
            return null;
          }
        })
        .filter((d): d is { name: string; mtime: number } => d !== null)
        .sort((a, b) => b.mtime - a.mtime);
    } catch {
      return { reports: [], total: 0 };
    }

    // Build summaries
    let summaries: ReportSummary[] = dirs.map((d) => this.loadSummary(d.name)).filter((s): s is ReportSummary => s !== null);

    // Filter by project
    if (opts?.project) {
      const proj = opts.project;
      summaries = summaries.filter((s) => s.project?.name === proj || s.project?.path === proj);
    }

    // Filter by date range
    if (opts?.since) {
      const since = new Date(opts.since).getTime();
      summaries = summaries.filter((s) => new Date(s.createdAt).getTime() >= since);
    }
    if (opts?.until) {
      const until = new Date(opts.until).getTime();
      summaries = summaries.filter((s) => new Date(s.createdAt).getTime() <= until);
    }

    const total = summaries.length;
    return { reports: summaries.slice(offset, offset + limit), total };
  }

  get(coaReqId: string): ReportDetail | null {
    // Try both the raw coaReqId and the sanitized form as directory names
    const dirName = this.findReportDir(coaReqId);
    if (!dirName) return null;

    const dirPath = join(this.reportsDir, dirName);

    // Read meta.json
    let meta: {
      coaReqId?: string;
      project?: { path: string; name: string } | null;
      workers?: string[];
      createdAt?: string;
    };
    try {
      meta = JSON.parse(readFileSync(join(dirPath, "meta.json"), "utf-8")) as typeof meta;
    } catch {
      return null;
    }

    // Read all .md files
    const files: ReportFile[] = [];
    let gist = "";
    try {
      const entries = readdirSync(dirPath).filter((f) => f.endsWith(".md")).sort();
      for (const filename of entries) {
        const content = readFileSync(join(dirPath, filename), "utf-8");
        files.push({ filename, content });
        // Extract gist from first non-burn .md file
        if (!gist && filename !== "burn.md") {
          gist = extractGist(content);
        }
      }
    } catch {
      // Empty report
    }

    // Parse burn data
    const burn = this.parseBurnData(dirPath);

    return {
      coaReqId: meta.coaReqId ?? fsToCoaFingerprint(dirName),
      gist,
      project: meta.project ?? null,
      workers: meta.workers ?? [],
      createdAt: meta.createdAt ?? new Date().toISOString(),
      files,
      burn,
    };
  }

  watch(): void {
    try {
      watch(this.reportsDir, { persistent: false }, (eventType, filename) => {
        if (eventType === "rename" && filename) {
          this.emit("report:created", { dirName: filename });
        }
      });
    } catch {
      // Reports dir may not exist yet
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private loadSummary(dirName: string): ReportSummary | null {
    const cached = this.cache.get(dirName);
    if (cached) return cached;

    const dirPath = join(this.reportsDir, dirName);

    // Read meta.json
    let meta: {
      coaReqId?: string;
      project?: { path: string; name: string } | null;
      workers?: string[];
      createdAt?: string;
    };
    try {
      meta = JSON.parse(readFileSync(join(dirPath, "meta.json"), "utf-8")) as typeof meta;
    } catch {
      return null;
    }

    // Count .md files
    let fileCount = 0;
    let gist = "";
    try {
      const entries = readdirSync(dirPath).filter((f) => f.endsWith(".md"));
      fileCount = entries.length;
      // Read first non-burn .md for gist
      const firstReport = entries.find((f) => f !== "burn.md");
      if (firstReport) {
        const content = readFileSync(join(dirPath, firstReport), "utf-8");
        gist = extractGist(content);
      }
    } catch {
      // No files
    }

    // Parse burn frontmatter
    let totalTokens = 0;
    let costEstimate = 0;
    let durationMs = 0;
    try {
      const burnContent = readFileSync(join(dirPath, "burn.md"), "utf-8");
      const fm = parseBurnFrontmatter(burnContent);
      totalTokens = Number(fm["totalInputTokens"] ?? 0) + Number(fm["totalOutputTokens"] ?? 0);
      costEstimate = Number(fm["costEstimate"] ?? 0);
      durationMs = Number(fm["durationMs"] ?? 0);
    } catch {
      // No burn data
    }

    const summary: ReportSummary = {
      coaReqId: meta.coaReqId ?? fsToCoaFingerprint(dirName),
      gist,
      fileCount,
      project: meta.project ?? null,
      workers: meta.workers ?? [],
      totalTokens,
      costEstimate,
      durationMs,
      createdAt: meta.createdAt ?? new Date().toISOString(),
    };

    this.cache.set(dirName, summary);
    return summary;
  }

  private findReportDir(coaReqId: string): string | null {
    // Try exact match first
    try {
      const stat = statSync(join(this.reportsDir, coaReqId));
      if (stat.isDirectory()) return coaReqId;
    } catch {
      // Not found — try sanitized form
    }

    // Try scanning dirs for matching meta.json
    try {
      const dirs = readdirSync(this.reportsDir);
      for (const dir of dirs) {
        try {
          const metaPath = join(this.reportsDir, dir, "meta.json");
          const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as { coaReqId?: string };
          if (meta.coaReqId === coaReqId) return dir;
        } catch {
          continue;
        }
      }
    } catch {
      // Reports dir doesn't exist
    }

    return null;
  }

  private parseBurnData(dirPath: string): BurnData {
    try {
      const content = readFileSync(join(dirPath, "burn.md"), "utf-8");
      const fm = parseBurnFrontmatter(content);
      const inputTokens = Number(fm["totalInputTokens"] ?? 0);
      const outputTokens = Number(fm["totalOutputTokens"] ?? 0);

      // Parse worker rows from markdown table
      const workers: BurnWorkerEntry[] = [];
      const tableMatch = content.match(/\|.*\|.*\|.*\|.*\|.*\|.*\|\n\|[-| ]+\|\n([\s\S]*?)(?:\n\n|\n\*\*)/);
      if (tableMatch?.[1]) {
        for (const row of tableMatch[1].split("\n")) {
          const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
          if (cells.length >= 6) {
            workers.push({
              worker: cells[0] ?? "",
              workerTid: "",
              model: cells[1] ?? "",
              inputTokens: parseTokenCount(cells[2] ?? "0"),
              outputTokens: parseTokenCount(cells[3] ?? "0"),
              toolLoops: Number(cells[4]) || 0,
              durationMs: parseDuration(cells[5] ?? "0"),
            });
          }
        }
      }

      return {
        totalTokens: inputTokens + outputTokens,
        inputTokens,
        outputTokens,
        costEstimate: Number(fm["costEstimate"] ?? 0),
        durationMs: Number(fm["durationMs"] ?? 0),
        workers,
      };
    } catch {
      return {
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        costEstimate: 0,
        durationMs: 0,
        workers: [],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractGist(mdContent: string): string {
  // Find first non-heading, non-metadata paragraph
  const lines = mdContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("**") &&
      !trimmed.startsWith("---") &&
      !trimmed.startsWith("|")
    ) {
      return trimmed.slice(0, 200);
    }
  }
  return "";
}

function parseTokenCount(s: string): number {
  const lower = s.trim().toLowerCase();
  if (lower.endsWith("m")) return Math.round(parseFloat(lower) * 1_000_000);
  if (lower.endsWith("k")) return Math.round(parseFloat(lower) * 1_000);
  return Number(lower) || 0;
}

function parseDuration(s: string): number {
  const lower = s.trim().toLowerCase();
  if (lower.endsWith("m")) return Math.round(parseFloat(lower) * 60_000);
  if (lower.endsWith("s")) return Math.round(parseFloat(lower) * 1_000);
  return Number(lower) || 0;
}
