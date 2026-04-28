/**
 * MApp Security Scanner — validates MApp definitions before install.
 *
 * Scans for:
 * - Schema validity
 * - Dangerous container configurations
 * - Prompt injection patterns
 * - Suspicious shell commands in workflows
 * - Permission analysis
 */

import { MAppDefinitionSchema } from "@agi/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MAppScanResult {
  safe: boolean;
  score: number;
  findings: MAppFinding[];
  permissions: Array<{ id: string; reason: string; required: boolean; risk: "low" | "medium" | "high" }>;
  recommendation: "approve" | "review" | "reject";
}

export interface MAppFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: "prompt-injection" | "container" | "network" | "filesystem" | "permissions" | "schema" | "workflow";
  message: string;
  path?: string;
}

// ---------------------------------------------------------------------------
// Dangerous patterns
// ---------------------------------------------------------------------------

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?prior/i,
  /you\s+are\s+now\s+(?:a|an)\s+(?:unrestricted|unfiltered)/i,
  /bypass\s+(?:safety|security|restrictions)/i,
  /reveal\s+(?:your|the)\s+(?:system|original)\s+prompt/i,
  /exfiltrate|steal\s+data|send\s+to\s+external/i,
];

const DANGEROUS_SHELL_PATTERNS = [
  /rm\s+-rf\s+[/~]/,
  /curl\s+.*\|\s*(?:bash|sh|zsh)/,
  /wget\s+.*\|\s*(?:bash|sh|zsh)/,
  /mkfs\./,
  /dd\s+if=/,
  />\s*\/dev\/sd/,
  /chmod\s+777/,
  /eval\s*\(/,
];

const TRUSTED_REGISTRIES = [
  "docker.io",
  "ghcr.io",
  "registry.hub.docker.com",
  "nginx",
  "node",
  "python",
  "php",
  "alpine",
  "ubuntu",
  "debian",
];

const HIGH_RISK_PERMISSIONS = new Set([
  "network.outbound",
  "fs.write",
  "workflow.shell",
]);

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

export function scanMApp(raw: unknown): MAppScanResult {
  const findings: MAppFinding[] = [];
  let score = 100;

  // 1. Schema validation
  const parsed = MAppDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push({
        severity: "critical",
        category: "schema",
        message: `${issue.path.join(".")}: ${issue.message}`,
        path: issue.path.join("."),
      });
    }
    return { safe: false, score: 0, findings, permissions: [], recommendation: "reject" };
  }

  const def = parsed.data;

  // 2. Container checks
  if (def.container) {
    const img = def.container.image.toLowerCase();
    const isTrusted = TRUSTED_REGISTRIES.some((r) => img.startsWith(r) || img.includes(`/${r}`));
    if (!isTrusted) {
      findings.push({
        severity: "high",
        category: "container",
        message: `Container image "${def.container.image}" is not from a trusted registry`,
        path: "container.image",
      });
      score -= 20;
    }

    // Check volume mounts for escapes
    for (const vol of def.container.volumeMounts) {
      if (vol.includes("..") || vol.match(/^\/(?:etc|root|proc|sys|dev)\b/)) {
        findings.push({
          severity: "critical",
          category: "filesystem",
          message: `Volume mount "${vol}" may escape project directory`,
          path: "container.volumeMounts",
        });
        score -= 30;
      }
    }

    // Check commands
    if (def.container.command) {
      const cmdStr = def.container.command.join(" ");
      if (cmdStr.includes("--privileged") || cmdStr.includes("--cap-add")) {
        findings.push({
          severity: "critical",
          category: "container",
          message: "Container command includes privilege escalation flags",
          path: "container.command",
        });
        score -= 30;
      }
    }
  }

  // 3. Prompt injection scan
  if (def.prompts) {
    for (const prompt of def.prompts) {
      for (const pattern of PROMPT_INJECTION_PATTERNS) {
        if (pattern.test(prompt.systemPrompt)) {
          findings.push({
            severity: "critical",
            category: "prompt-injection",
            message: `Agent prompt "${prompt.id}" contains injection pattern: ${pattern.source}`,
            path: `prompts.${prompt.id}.systemPrompt`,
          });
          score -= 25;
        }
      }

      // Excessive prompt length
      if (prompt.systemPrompt.length > 10_000) {
        findings.push({
          severity: "medium",
          category: "prompt-injection",
          message: `Agent prompt "${prompt.id}" is unusually long (${String(prompt.systemPrompt.length)} chars)`,
          path: `prompts.${prompt.id}.systemPrompt`,
        });
        score -= 5;
      }
    }
  }

  // 4. Workflow shell command scan
  if (def.workflows) {
    for (const wf of def.workflows) {
      for (const step of wf.steps) {
        if (step.type === "shell" && step.config.command) {
          const cmd = String(step.config.command);
          for (const pattern of DANGEROUS_SHELL_PATTERNS) {
            if (pattern.test(cmd)) {
              findings.push({
                severity: "critical",
                category: "workflow",
                message: `Workflow "${wf.id}" step "${step.id}" has dangerous shell command`,
                path: `workflows.${wf.id}.steps.${step.id}.config.command`,
              });
              score -= 20;
            }
          }
        }

        if (step.type === "api" && step.config.endpoint) {
          const endpoint = String(step.config.endpoint);
          if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
            findings.push({
              severity: "medium",
              category: "network",
              message: `Workflow "${wf.id}" step "${step.id}" calls external URL: ${endpoint}`,
              path: `workflows.${wf.id}.steps.${step.id}.config.endpoint`,
            });
            score -= 5;
          }
        }
      }
    }
  }

  // 5. Permission analysis
  const permissions = def.permissions.map((p) => ({
    ...p,
    risk: HIGH_RISK_PERMISSIONS.has(p.id) ? "high" as const : p.id.startsWith("agent.") ? "medium" as const : "low" as const,
  }));

  const hasHighRisk = permissions.some((p) => p.risk === "high");
  if (hasHighRisk) {
    score -= 10;
  }

  // 6. Info findings
  if (!def.license) {
    findings.push({
      severity: "info",
      category: "schema",
      message: "No license specified",
      path: "license",
    });
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  const recommendation: MAppScanResult["recommendation"] =
    score >= 80 ? "approve" :
    score >= 50 ? "review" :
    "reject";

  return {
    safe: score >= 50 && !findings.some((f) => f.severity === "critical"),
    score,
    findings,
    permissions,
    recommendation,
  };
}
