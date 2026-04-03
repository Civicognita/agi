/**
 * Plugin source scanner — detects potentially dangerous patterns.
 * eval() and new Function() are always blocking (set safe = false).
 * Other patterns are warn-only unless they lack the required permission.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

export interface ScanWarning {
  pattern: string;
  file: string;
  line: number;
  snippet: string;
}

export interface ScanResult {
  warnings: ScanWarning[];
  safe: boolean;
}

interface PatternRule {
  pattern: RegExp;
  name: string;
  /** If set, only flag when the plugin lacks this permission. */
  requiresPermission?: string;
  /** If true, finding this pattern sets safe = false regardless of permissions. */
  blocking?: boolean;
}

const PATTERNS: PatternRule[] = [
  { pattern: /\beval\s*\(/, name: "eval() — arbitrary code execution", blocking: true },
  { pattern: /\bnew\s+Function\s*\(/, name: "new Function() — dynamic function construction", blocking: true },
  { pattern: /child_process/, name: "child_process usage", requiresPermission: "shell.exec" },
  { pattern: /require\s*\(\s*["']fs["']\)|import.*["']node:fs["']/, name: "filesystem access", requiresPermission: "filesystem.read" },
  { pattern: /process\.env/, name: "process.env access — potential secrets leakage", requiresPermission: "config.read" },
  { pattern: /globalThis\.__|global\.__/, name: "global namespace mutation — prototype pollution risk" },
];

export function scanPluginSource(entryPath: string, permissions: string[]): ScanResult {
  const warnings: ScanWarning[] = [];
  const dir = extname(entryPath) === ".ts" || extname(entryPath) === ".js"
    ? entryPath.substring(0, entryPath.lastIndexOf("/"))
    : entryPath;

  // Determine the source directory — prefer src/ over dist/ to avoid scanning
  // bundled third-party code which produces massive false positives.
  const srcDir = join(dir, "..", "src");
  const scanDir = existsSync(srcDir) ? srcDir : dir;

  let files: string[];
  try {
    const entries = readdirSync(scanDir, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[];
    files = entries
      .filter(e => e.isFile() && /\.(ts|js|mjs|cjs)$/.test(e.name))
      // Skip node_modules and dist directories inside the plugin
      .filter(e => {
        const parent: string = (e as unknown as { parentPath?: string; path?: string }).parentPath
          ?? (e as unknown as { path?: string }).path ?? "";
        return !parent.includes("node_modules") && !parent.includes("/dist/");
      })
      .map(e => {
        const parent: string = (e as unknown as { parentPath?: string; path?: string }).parentPath
          ?? (e as unknown as { path?: string }).path
          ?? scanDir;
        return join(parent, e.name);
      });
  } catch {
    return { warnings: [], safe: true };
  }

  let hasBlockingViolation = false;

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const rule of PATTERNS) {
        if (rule.requiresPermission && permissions.includes(rule.requiresPermission)) {
          continue; // Plugin has the required permission, skip
        }
        if (rule.pattern.test(line)) {
          warnings.push({
            pattern: rule.name,
            file: filePath,
            line: i + 1,
            snippet: line.trim().substring(0, 120),
          });
          if (rule.blocking) {
            hasBlockingViolation = true;
          }
        }
      }
    }
  }

  return { warnings, safe: !hasBlockingViolation && warnings.length === 0 };
}
