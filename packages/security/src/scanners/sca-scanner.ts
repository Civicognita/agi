/**
 * Built-in SCA scanner — dependency vulnerability detection.
 * Parses lockfiles and checks for known-vulnerable patterns.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ScanProviderDefinition, SecurityFinding, ScanConfig, ScanProviderContext } from "../types.js";

// Known vulnerable package patterns (subset — real implementation would use advisory DB)
const KNOWN_VULNERABILITIES: Array<{
  package: string;
  vulnerableRange: string;
  cve: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  fixedVersion?: string;
}> = [
  { package: "lodash", vulnerableRange: "<4.17.21", cve: "CVE-2021-23337", severity: "high", title: "Prototype Pollution in lodash", fixedVersion: "4.17.21" },
  { package: "minimist", vulnerableRange: "<1.2.6", cve: "CVE-2021-44906", severity: "critical", title: "Prototype Pollution in minimist", fixedVersion: "1.2.6" },
  { package: "json5", vulnerableRange: "<2.2.2", cve: "CVE-2022-46175", severity: "high", title: "Prototype Pollution in json5", fixedVersion: "2.2.2" },
  { package: "semver", vulnerableRange: "<7.5.2", cve: "CVE-2022-25883", severity: "medium", title: "ReDoS in semver", fixedVersion: "7.5.2" },
  { package: "tough-cookie", vulnerableRange: "<4.1.3", cve: "CVE-2023-26136", severity: "medium", title: "Prototype Pollution in tough-cookie", fixedVersion: "4.1.3" },
  { package: "ua-parser-js", vulnerableRange: "<0.7.33", cve: "CVE-2021-27292", severity: "critical", title: "Supply chain compromise in ua-parser-js", fixedVersion: "0.7.33" },
  { package: "node-fetch", vulnerableRange: "<2.6.7", cve: "CVE-2022-0235", severity: "high", title: "Exposure of Sensitive Information in node-fetch", fixedVersion: "2.6.7" },
  { package: "express", vulnerableRange: "<4.19.2", cve: "CVE-2024-29041", severity: "medium", title: "Open Redirect in express", fixedVersion: "4.19.2" },
];

function parsePackageJson(targetPath: string): Record<string, string> {
  const deps: Record<string, string> = {};
  const pkgPath = join(targetPath, "package.json");
  if (!existsSync(pkgPath)) return deps;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    Object.assign(deps, pkg.dependencies ?? {}, pkg.devDependencies ?? {});
  } catch { /* ignore parse errors */ }
  return deps;
}

function simpleSemverLt(installed: string, threshold: string): boolean {
  // Very basic version comparison for the advisory check
  const normalize = (v: string) => v.replace(/^[^0-9]*/, "").split(".").map(Number);
  const inst = normalize(installed);
  const thresh = normalize(threshold.replace(/^</, ""));
  for (let i = 0; i < 3; i++) {
    if ((inst[i] ?? 0) < (thresh[i] ?? 0)) return true;
    if ((inst[i] ?? 0) > (thresh[i] ?? 0)) return false;
  }
  return false;
}

export const scaScanner: ScanProviderDefinition = {
  id: "built-in-sca",
  name: "SCA Scanner",
  description: "Supply chain analysis — checks dependencies for known vulnerabilities",
  scanType: "sca",
  icon: "package",
  async scan(config: ScanConfig, ctx: ScanProviderContext): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];
    const deps = parsePackageJson(config.targetPath);
    ctx.logger.info(`SCA scanning ${Object.keys(deps).length} dependencies`);

    for (const [name, versionSpec] of Object.entries(deps)) {
      if (ctx.abortSignal?.aborted) break;
      const version = versionSpec.replace(/^[\^~>=<]/, "");
      for (const vuln of KNOWN_VULNERABILITIES) {
        if (vuln.package === name) {
          const thresholdVersion = vuln.vulnerableRange.replace(/^</, "");
          if (simpleSemverLt(version, thresholdVersion)) {
            findings.push({
              id: randomUUID(),
              scanId: "",
              title: vuln.title,
              description: `${name}@${version} is affected by ${vuln.cve}`,
              checkId: `SCA-${vuln.cve}`,
              scanType: "sca",
              severity: vuln.severity,
              confidence: "high",
              cwe: ["CWE-1395"],
              owasp: ["A06:2021"],
              evidence: {
                dependency: name,
                installedVersion: version,
                fixedVersion: vuln.fixedVersion,
                cveId: vuln.cve,
                file: "package.json",
              },
              remediation: {
                description: `Update ${name} to ${vuln.fixedVersion ?? "latest"}.`,
                effort: "low",
                slaHours: vuln.severity === "critical" ? 72 : vuln.severity === "high" ? 168 : 720,
              },
              standards: {
                mitreCwe: ["CWE-1395"],
                owaspTop10: ["A06:2021"],
              },
              createdAt: new Date().toISOString(),
              status: "open",
            });
          }
        }
      }
    }

    ctx.logger.info(`SCA scan complete: ${findings.length} findings`);
    return findings;
  },
};
