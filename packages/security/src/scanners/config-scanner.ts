/**
 * Built-in configuration scanner — checks for hardening issues.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ScanProviderDefinition, SecurityFinding, ScanConfig, ScanProviderContext } from "../types.js";

interface ConfigCheck {
  id: string;
  title: string;
  check: (targetPath: string) => SecurityFinding | null;
}

const CONFIG_CHECKS: ConfigCheck[] = [
  {
    id: "CFG-ENV-EXPOSED",
    title: ".env file present in project root",
    check(targetPath) {
      const envPath = join(targetPath, ".env");
      if (!existsSync(envPath)) return null;
      // Check if .gitignore includes .env
      const gitignorePath = join(targetPath, ".gitignore");
      const gitignored = existsSync(gitignorePath) && readFileSync(gitignorePath, "utf-8").includes(".env");
      if (gitignored) return null;
      return {
        id: randomUUID(), scanId: "", title: ".env file not in .gitignore",
        description: ".env file exists but is not listed in .gitignore — secrets may be committed.",
        checkId: "CFG-ENV-EXPOSED", scanType: "config", severity: "high", confidence: "high",
        cwe: ["CWE-200"], owasp: ["A05:2021"],
        evidence: { file: ".env" },
        remediation: { description: "Add .env to .gitignore and remove from git history if committed.", effort: "low", slaHours: 72 },
        standards: { mitreCwe: ["CWE-200"], owaspTop10: ["A05:2021"] },
        createdAt: new Date().toISOString(), status: "open",
      };
    },
  },
  {
    id: "CFG-DEBUG-MODE",
    title: "Debug mode enabled in configuration",
    check(targetPath) {
      const configPaths = [
        join(targetPath, "aionima.json"),
        join(targetPath, ".aionima.json"),
      ];
      for (const cp of configPaths) {
        if (!existsSync(cp)) continue;
        try {
          const cfg = JSON.parse(readFileSync(cp, "utf-8"));
          if (cfg.debug === true || cfg.dev?.debug === true) {
            return {
              id: randomUUID(), scanId: "", title: "Debug mode enabled",
              description: "Debug mode is enabled in configuration — may expose verbose errors and internal state.",
              checkId: "CFG-DEBUG-MODE", scanType: "config", severity: "medium", confidence: "high",
              cwe: ["CWE-200"], owasp: ["A05:2021"],
              evidence: { file: cp.replace(targetPath + "/", "") },
              remediation: { description: "Disable debug mode for production deployments.", effort: "low", slaHours: 720 },
              standards: { mitreCwe: ["CWE-200"], owaspTop10: ["A05:2021"] },
              createdAt: new Date().toISOString(), status: "open",
            };
          }
        } catch { /* ignore parse errors */ }
      }
      return null;
    },
  },
  {
    id: "CFG-DOCKERFILE-ROOT",
    title: "Dockerfile runs as root",
    check(targetPath) {
      const dockerfilePath = join(targetPath, "Dockerfile");
      if (!existsSync(dockerfilePath)) return null;
      const content = readFileSync(dockerfilePath, "utf-8");
      // Check if there's a USER instruction (non-root)
      const hasUserInstruction = /^USER\s+(?!root)/m.test(content);
      if (hasUserInstruction) return null;
      return {
        id: randomUUID(), scanId: "", title: "Dockerfile runs as root user",
        description: "No non-root USER instruction found in Dockerfile — container will run as root.",
        checkId: "CFG-DOCKERFILE-ROOT", scanType: "config", severity: "medium", confidence: "high",
        cwe: ["CWE-250"], owasp: ["A05:2021"],
        evidence: { file: "Dockerfile" },
        remediation: { description: "Add a USER instruction to run as a non-root user.", effort: "low", slaHours: 720 },
        standards: { mitreCwe: ["CWE-250"], owaspTop10: ["A05:2021"], nistSp80053: ["CM-6"] },
        createdAt: new Date().toISOString(), status: "open",
      };
    },
  },
  {
    id: "CFG-LOCKFILE-MISSING",
    title: "Missing lockfile",
    check(targetPath) {
      const lockfiles = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"];
      const pkgPath = join(targetPath, "package.json");
      if (!existsSync(pkgPath)) return null;
      const hasLockfile = lockfiles.some(l => existsSync(join(targetPath, l)));
      if (hasLockfile) return null;
      return {
        id: randomUUID(), scanId: "", title: "No lockfile found",
        description: "package.json exists but no lockfile was found — builds may use different dependency versions.",
        checkId: "CFG-LOCKFILE-MISSING", scanType: "config", severity: "medium", confidence: "high",
        cwe: ["CWE-1395"], owasp: ["A08:2021"],
        evidence: { file: "package.json" },
        remediation: { description: "Run your package manager to generate a lockfile and commit it.", effort: "low", slaHours: 720 },
        standards: { mitreCwe: ["CWE-1395"], owaspTop10: ["A08:2021"] },
        createdAt: new Date().toISOString(), status: "open",
      };
    },
  },
];

export const configScanner: ScanProviderDefinition = {
  id: "built-in-config",
  name: "Config Scanner",
  description: "Checks configuration files for security hardening issues",
  scanType: "config",
  icon: "settings",
  async scan(config: ScanConfig, ctx: ScanProviderContext): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];
    ctx.logger.info(`Config scanning ${config.targetPath}`);

    for (const check of CONFIG_CHECKS) {
      if (ctx.abortSignal?.aborted) break;
      const finding = check.check(config.targetPath);
      if (finding) findings.push(finding);
    }

    ctx.logger.info(`Config scan complete: ${findings.length} findings`);
    return findings;
  },
};
