/**
 * Formats a SecurityFinding into a natural-language prompt that instructs
 * the agent to create a fix plan for user approval before making changes.
 */

import type { SecurityFinding } from "@/types";

export function formatSecurityFixPrompt(finding: SecurityFinding): string {
  const lines: string[] = [
    "I need you to create a plan to fix this security vulnerability:",
    "",
    `**${finding.title}**`,
    `Severity: ${finding.severity.toUpperCase()} | Confidence: ${finding.confidence} | Check: ${finding.checkId}`,
    "",
  ];

  if (finding.description) {
    lines.push(finding.description, "");
  }

  // Evidence
  const ev = finding.evidence;
  if (ev.file || ev.dependency) {
    lines.push("**Evidence:**");
    if (ev.file) {
      lines.push(`- File: \`${ev.file}${ev.line ? `:${String(ev.line)}` : ""}\``);
    }
    if (ev.snippet) {
      lines.push("- Code:", "```", ev.snippet, "```");
    }
    if (ev.dependency) {
      let depLine = `- Dependency: ${ev.dependency}@${ev.installedVersion ?? "unknown"}`;
      if (ev.fixedVersion) depLine += ` (fix available: ${ev.fixedVersion})`;
      lines.push(depLine);
    }
    if (ev.cveId) {
      lines.push(`- CVE: ${ev.cveId}`);
    }
    lines.push("");
  }

  // Standards
  if (finding.cwe?.length || finding.owasp?.length) {
    const tags: string[] = [];
    if (finding.cwe?.length) tags.push(`CWE: ${finding.cwe.join(", ")}`);
    if (finding.owasp?.length) tags.push(`OWASP: ${finding.owasp.join(", ")}`);
    lines.push(tags.join(" | "), "");
  }

  // Remediation guidance
  if (finding.remediation?.description) {
    lines.push(`**Recommended fix:** ${finding.remediation.description}`);
    lines.push(`Effort: ${finding.remediation.effort} | SLA: ${String(finding.remediation.slaHours)}h`);
    lines.push("");
  }

  lines.push(
    "Analyze this vulnerability and create a detailed plan to fix it. " +
    "Consider the evidence, remediation guidance, and CWE/OWASP classifications. " +
    "Present the plan for my review before making any changes.",
  );

  return lines.join("\n");
}

const GITHUB_REPO = "Civicognita/agi";

/**
 * Builds a GitHub new-issue URL pre-filled with finding details.
 * Used for the "Report this" button when dev mode is off (production).
 */
export function formatSecurityIssueUrl(finding: SecurityFinding): string {
  const title = `[Security] ${finding.severity.toUpperCase()}: ${finding.title}`;

  const bodyLines: string[] = [
    `## Security Finding`,
    "",
    `**Check:** ${finding.checkId}`,
    `**Severity:** ${finding.severity} | **Confidence:** ${finding.confidence}`,
    `**Scan Type:** ${finding.scanType}`,
    "",
    finding.description,
    "",
  ];

  if (finding.evidence.file) {
    bodyLines.push(`**File:** \`${finding.evidence.file}${finding.evidence.line ? `:${String(finding.evidence.line)}` : ""}\``);
  }
  if (finding.evidence.dependency) {
    bodyLines.push(`**Dependency:** ${finding.evidence.dependency}@${finding.evidence.installedVersion ?? "unknown"}`);
    if (finding.evidence.fixedVersion) bodyLines.push(`**Fixed in:** ${finding.evidence.fixedVersion}`);
  }
  if (finding.cwe?.length) bodyLines.push(`**CWE:** ${finding.cwe.join(", ")}`);
  if (finding.owasp?.length) bodyLines.push(`**OWASP:** ${finding.owasp.join(", ")}`);

  bodyLines.push("", `**Remediation:** ${finding.remediation?.description ?? "See CWE reference."}`);
  bodyLines.push("", "---", "*Reported by Aionima Security Scanner*");

  const params = new URLSearchParams({
    title,
    body: bodyLines.join("\n"),
    labels: "security",
  });

  return `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;
}
