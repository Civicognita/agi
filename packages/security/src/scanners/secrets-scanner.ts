/**
 * Built-in secrets scanner — detects leaked credentials and API keys.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { randomUUID } from "node:crypto";
import type { ScanProviderDefinition, SecurityFinding, ScanConfig, ScanProviderContext } from "../types.js";

const SCANNABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".yml", ".yaml", ".toml", ".env", ".cfg", ".conf", ".ini", ".sh", ".md"]);

interface SecretPattern {
  id: string;
  title: string;
  pattern: RegExp;
  description: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { id: "SEC-AWS-KEY", title: "AWS Access Key ID", pattern: /AKIA[0-9A-Z]{16}/g, description: "AWS access key found in source code." },
  { id: "SEC-AWS-SECRET", title: "AWS Secret Access Key", pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/g, description: "AWS secret key found in source code." },
  { id: "SEC-GITHUB-TOKEN", title: "GitHub Token", pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}/g, description: "GitHub personal access or OAuth token found." },
  { id: "SEC-GITHUB-FINE", title: "GitHub Fine-Grained Token", pattern: /github_pat_[A-Za-z0-9_]{22,255}/g, description: "GitHub fine-grained personal access token found." },
  { id: "SEC-PRIVATE-KEY", title: "Private Key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, description: "Private key material found in source code." },
  { id: "SEC-JWT", title: "JSON Web Token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, description: "JWT token found in source code (may contain sensitive claims)." },
  { id: "SEC-GENERIC-SECRET", title: "Generic Secret Assignment", pattern: /(?:secret|password|passwd|token|api_key|apikey|api[-_]?secret)\s*[:=]\s*["'][^"']{8,}["']/gi, description: "Potential secret value assigned to a sensitive variable name." },
  { id: "SEC-SLACK-TOKEN", title: "Slack Token", pattern: /xox[bpors]-[A-Za-z0-9-]{10,}/g, description: "Slack API token found in source code." },
  { id: "SEC-STRIPE-KEY", title: "Stripe API Key", pattern: /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{20,}/g, description: "Stripe API key found in source code." },
];

function walkFiles(dir: string, extensions: Set<string>, excludePaths: string[] = []): string[] {
  const files: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      const rel = relative(dir, fullPath);
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "build" || entry.name === "pnpm-lock.yaml" || entry.name === "package-lock.json") continue;
      if (excludePaths.some(p => rel.startsWith(p))) continue;
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (extensions.has(extname(entry.name)) || entry.name.startsWith(".env")) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

export const secretsScanner: ScanProviderDefinition = {
  id: "built-in-secrets",
  name: "Secrets Scanner",
  description: "Detects leaked API keys, tokens, passwords, and private keys in source files",
  scanType: "secrets",
  icon: "key",
  async scan(config: ScanConfig, ctx: ScanProviderContext): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];
    const files = walkFiles(config.targetPath, SCANNABLE_EXTENSIONS, config.excludePaths);
    ctx.logger.info(`Secrets scanning ${files.length} files`);

    for (const filePath of files) {
      if (ctx.abortSignal?.aborted) break;
      let content: string;
      try { content = readFileSync(filePath, "utf-8"); }
      catch { continue; }

      const lines = content.split("\n");
      for (const sp of SECRET_PATTERNS) {
        sp.pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = sp.pattern.exec(content)) !== null) {
          const upToMatch = content.slice(0, match.index);
          const lineNum = upToMatch.split("\n").length;
          const lineContent = lines[lineNum - 1]?.trim() ?? "";

          // Redact the actual secret value in evidence
          const redacted = match[0].slice(0, 8) + "..." + match[0].slice(-4);

          findings.push({
            id: randomUUID(),
            scanId: "",
            title: sp.title,
            description: sp.description,
            checkId: sp.id,
            scanType: "secrets",
            severity: "high",
            confidence: "high",
            cwe: ["CWE-798"],
            owasp: ["A07:2021"],
            evidence: {
              file: relative(config.targetPath, filePath),
              line: lineNum,
              snippet: `[REDACTED: ${redacted}] in: ${lineContent.slice(0, 100)}`,
            },
            remediation: {
              description: "Remove the secret from source code. Use environment variables or a secrets manager.",
              effort: "low",
              slaHours: 72,
            },
            standards: {
              mitreCwe: ["CWE-798"],
              owaspTop10: ["A07:2021"],
              nistSp80053: ["IA-5"],
            },
            createdAt: new Date().toISOString(),
            status: "open",
          });
        }
      }
    }

    ctx.logger.info(`Secrets scan complete: ${findings.length} findings`);
    return findings;
  },
};
