/**
 * Built-in SAST scanner — regex-based static analysis for common vulnerabilities.
 * Implements detection checks from the security audit specification.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { minimatch } from "minimatch";
import { randomUUID } from "node:crypto";
import type { ScanProviderDefinition, SecurityFinding, ScanConfig, ScanProviderContext } from "../types.js";

const TS_JS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

interface SastRule {
  id: string;
  title: string;
  pattern: RegExp;
  severity: "critical" | "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  cwe: string[];
  owasp: string[];
  description: string;
  remediation: string;
  effort: "low" | "medium" | "high";
  slaHours: number;
}

const SAST_RULES: SastRule[] = [
  {
    id: "SAST-XSS-01",
    title: "Potential XSS: dangerouslySetInnerHTML or direct DOM innerHTML",
    pattern: /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=/g,
    severity: "high",
    confidence: "medium",
    cwe: ["CWE-79"],
    owasp: ["A03:2021"],
    description: "Direct HTML injection without sanitization may allow cross-site scripting.",
    remediation: "Use textContent instead of innerHTML, or sanitize with DOMPurify.",
    effort: "low",
    slaHours: 168,
  },
  {
    id: "SAST-SQLI-01",
    title: "Potential SQL injection: string concatenation in query",
    pattern: /(?:query|exec|execute|prepare|raw)\s*\(\s*[`"'].*\$\{|(?:query|exec|execute)\s*\(\s*[^,)]*\+\s*/g,
    severity: "critical",
    confidence: "medium",
    cwe: ["CWE-89"],
    owasp: ["A03:2021"],
    description: "SQL queries constructed with string concatenation or template literals may be injectable.",
    remediation: "Use parameterized queries with placeholder values.",
    effort: "medium",
    slaHours: 72,
  },
  {
    id: "SAST-CMDI-01",
    title: "Potential command injection: child_process.exec with dynamic input",
    pattern: /exec\s*\(\s*[`"'].*\$\{|exec\s*\(\s*[^,)]*\+|execSync\s*\(\s*[`"'].*\$\{|execSync\s*\(\s*[^,)]*\+/g,
    severity: "critical",
    confidence: "medium",
    cwe: ["CWE-78"],
    owasp: ["A03:2021"],
    description: "Shell commands constructed with user input may allow command injection.",
    remediation: "Use execFile() instead of exec(), or validate/escape all inputs.",
    effort: "medium",
    slaHours: 72,
  },
  {
    id: "SAST-PATH-01",
    title: "Potential path traversal: user input in file path",
    pattern: /readFile(?:Sync)?\s*\(.*(?:req\.|params\.|query\.|body\.)|writeFile(?:Sync)?\s*\(.*(?:req\.|params\.|query\.|body\.)/g,
    severity: "high",
    confidence: "low",
    cwe: ["CWE-22"],
    owasp: ["A03:2021"],
    description: "File operations with user-controlled paths may allow directory traversal.",
    remediation: "Validate resolved paths stay within allowed directories using path.resolve() + startsWith() check.",
    effort: "low",
    slaHours: 168,
  },
  {
    id: "SAST-DESER-01",
    title: "Potential insecure deserialization",
    pattern: /JSON\.parse\s*\(\s*(?:req\.|params\.|query\.|body\.|cookie)|deserialize\s*\(/g,
    severity: "medium",
    confidence: "low",
    cwe: ["CWE-502"],
    owasp: ["A08:2021"],
    description: "Deserialization of untrusted data may lead to code execution.",
    remediation: "Validate deserialized data against a schema (e.g., Zod) before use.",
    effort: "medium",
    slaHours: 720,
  },
  {
    id: "SAST-SSRF-01",
    title: "Potential SSRF: user-controlled URL in fetch/axios",
    pattern: /fetch\s*\(\s*(?:req\.|params\.|query\.|body\.)|axios\.(?:get|post|put|delete)\s*\(\s*(?:req\.|params\.|query\.|body\.)/g,
    severity: "high",
    confidence: "medium",
    cwe: ["CWE-918"],
    owasp: ["A10:2021"],
    description: "HTTP requests with user-controlled URLs may allow SSRF.",
    remediation: "Validate URLs against an allowlist before making requests.",
    effort: "medium",
    slaHours: 168,
  },
  {
    id: "SAST-EVAL-01",
    title: "Dangerous code evaluation",
    pattern: /\beval\s*\(|new\s+Function\s*\(/g,
    severity: "critical",
    confidence: "high",
    cwe: ["CWE-94"],
    owasp: ["A03:2021"],
    description: "eval() and new Function() allow arbitrary code execution.",
    remediation: "Remove eval/Function usage; use safe alternatives (JSON.parse, template engines).",
    effort: "medium",
    slaHours: 72,
  },
  {
    id: "SAST-PROTO-01",
    title: "Potential prototype pollution",
    pattern: /Object\.assign\s*\(\s*\{\}|\.__(proto|defineGetter|defineSetter)__|(?:merge|extend|assign)\s*\(\s*(?:target|dest|obj)/g,
    severity: "medium",
    confidence: "low",
    cwe: ["CWE-1321"],
    owasp: ["A03:2021"],
    description: "Merging untrusted objects without schema validation may cause prototype pollution.",
    remediation: "Use Object.create(null) for dictionaries, or validate input schemas.",
    effort: "medium",
    slaHours: 720,
  },
];

function parseGitignore(rootDir: string): string[] {
  const gitignorePath = join(rootDir, ".gitignore");
  if (!existsSync(gitignorePath)) return [];
  try {
    return readFileSync(gitignorePath, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function isGitignored(relPath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Handle negation (!) — skip if the pattern negates a match
    if (pattern.startsWith("!")) continue;
    if (minimatch(relPath, pattern, { dot: true })) return true;
    // Also match directory patterns (e.g., ".next" should match ".next/foo")
    if (minimatch(relPath, `${pattern}/**`, { dot: true })) return true;
  }
  return false;
}

function walkFiles(dir: string, extensions: Set<string>, excludePaths: string[] = []): string[] {
  const files: string[] = [];
  const gitignorePatterns = parseGitignore(dir);
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      const rel = relative(dir, fullPath);
      // Fast-path: skip common non-source directories
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      // Honor .gitignore patterns
      if (gitignorePatterns.length > 0 && isGitignored(rel, gitignorePatterns)) continue;
      // Honor explicit excludePaths from config
      if (excludePaths.some(p => rel.startsWith(p))) continue;
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (extensions.has(extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

export const sastScanner: ScanProviderDefinition = {
  id: "built-in-sast",
  name: "SAST Scanner",
  description: "Static analysis for common vulnerability patterns (XSS, SQLi, command injection, path traversal, SSRF, eval, prototype pollution)",
  scanType: "sast",
  icon: "code",
  async scan(config: ScanConfig, ctx: ScanProviderContext): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];
    const files = walkFiles(config.targetPath, TS_JS_EXTENSIONS, config.excludePaths);
    ctx.logger.info(`SAST scanning ${files.length} files in ${config.targetPath}`);

    for (const filePath of files) {
      if (ctx.abortSignal?.aborted) break;
      let content: string;
      try { content = readFileSync(filePath, "utf-8"); }
      catch { continue; }

      const lines = content.split("\n");
      for (const rule of SAST_RULES) {
        rule.pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = rule.pattern.exec(content)) !== null) {
          // Compute line number
          const upToMatch = content.slice(0, match.index);
          const lineNum = upToMatch.split("\n").length;
          const lineContent = lines[lineNum - 1]?.trim() ?? "";

          findings.push({
            id: randomUUID(),
            scanId: "",
            title: rule.title,
            description: rule.description,
            checkId: rule.id,
            scanType: "sast",
            severity: rule.severity,
            confidence: rule.confidence,
            cwe: rule.cwe,
            owasp: rule.owasp,
            evidence: {
              file: relative(config.targetPath, filePath),
              line: lineNum,
              snippet: lineContent.slice(0, 200),
            },
            remediation: {
              description: rule.remediation,
              effort: rule.effort,
              slaHours: rule.slaHours,
            },
            standards: {
              mitreCwe: rule.cwe,
              owaspTop10: rule.owasp,
            },
            createdAt: new Date().toISOString(),
            status: "open",
          });
          // Cap per-file per-rule
          if (findings.length >= (config.maxFindings ?? 1000)) break;
        }
      }
    }

    ctx.logger.info(`SAST scan complete: ${findings.length} findings`);
    return findings;
  },
};
