/**
 * SafemodeInvestigator — collects evidence about what happened before the
 * crash and writes a structured incident report to ~/.agi/incidents/.
 *
 * Flow:
 *   1. Collect evidence (journalctl, podman state, gateway logs, dmesg, disk)
 *   2. Classify heuristically (postgres down, OOM, disk full, unknown)
 *   3. If a local model is available, generate a narrative section with Aion
 *   4. Write markdown report
 *   5. Emit notification and mark safemode investigation complete
 *
 * The investigator always writes a report — even if the local model is
 * unavailable, the heuristic template is self-sufficient. This way safemode
 * works on first-ever boot before SmolLM2 is installed.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NotificationStore } from "@agi/entity-model";
import type { ComponentLogger } from "./logger.js";
import type { LocalModelRuntime } from "./local-model-runtime.js";
import { peekShutdownMarker } from "./boot-recovery.js";
import { safemodeState } from "./safemode-state.js";

const INCIDENTS_DIR = join(homedir(), ".agi", "incidents");
const GATEWAY_LOG_DIR = join(homedir(), ".agi", "logs");

// ---------------------------------------------------------------------------
// Evidence collectors
// ---------------------------------------------------------------------------

function safeExec(cmd: string, args: string[], timeoutMs = 8_000): string {
  try {
    const res = spawnSync(cmd, args, {
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    if (res.status === 0 && typeof res.stdout === "string") return res.stdout;
    if (typeof res.stdout === "string" && res.stdout.length > 0) return res.stdout;
    if (typeof res.stderr === "string") return res.stderr;
    return "";
  } catch {
    return "";
  }
}

function journalctl(unit: string, lines: number): string {
  return safeExec("journalctl", [
    "-u", unit,
    "--since", "30 min ago",
    "--no-pager",
    "-n", String(lines),
  ]);
}

function podmanPs(): string {
  return safeExec("podman", ["ps", "-a", "--format", "json"]);
}

function podmanLogs(name: string, lines = 100): string {
  return safeExec("podman", ["logs", "--tail", String(lines), name]);
}

function dmesgTail(lines = 100): string {
  // dmesg often requires sudo; try unprivileged first
  const out = safeExec("dmesg", ["--ctime", "--nopager"]);
  if (out.length > 0) {
    const allLines = out.split("\n");
    return allLines.slice(Math.max(0, allLines.length - lines)).join("\n");
  }
  return safeExec("sudo", ["-n", "dmesg", "--ctime", "--nopager"]).split("\n").slice(-lines).join("\n");
}

function diskFree(path: string): string {
  return safeExec("df", ["-h", path]);
}

function gatewayLogTail(lines = 300): string {
  if (!existsSync(GATEWAY_LOG_DIR)) return "";
  try {
    const files = readdirSync(GATEWAY_LOG_DIR)
      .filter((f) => f.startsWith("gateway") && f.endsWith(".log"))
      .map((f) => ({ name: f, mtime: statSync(join(GATEWAY_LOG_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) return "";
    const latest = files[0]!.name;
    const content = readFileSync(join(GATEWAY_LOG_DIR, latest), "utf8");
    const allLines = content.split("\n");
    return allLines.slice(Math.max(0, allLines.length - lines)).join("\n");
  } catch {
    return "";
  }
}

export interface Evidence {
  collectedAt: string;
  hadPriorMarker: boolean;
  gatewayJournal: string;
  idServiceJournal: string;
  gatewayLog: string;
  podmanPs: string;
  postgresLogs: string;
  dmesg: string;
  diskRoot: string;
  diskAgi: string;
}

function findPostgresContainerName(): string {
  // PostgreSQL is managed by the agi-postgres-17 plugin — the container name is
  // not hardcoded. Discover it by image ancestry at evidence-collection time.
  try {
    const out = safeExec("podman", [
      "ps", "-a",
      "--filter", "ancestor=ghcr.io/civicognita/postgres:17",
      "--format", "{{.Names}}",
    ]);
    const first = out.trim().split("\n")[0]?.trim();
    if (first && first.length > 0) return first;
  } catch {
    // fall through
  }
  // Fallback: any container whose name includes "postgres"
  try {
    const out = safeExec("podman", [
      "ps", "-a",
      "--filter", "name=postgres",
      "--format", "{{.Names}}",
    ]);
    const first = out.trim().split("\n")[0]?.trim();
    if (first && first.length > 0) return first;
  } catch {
    // fall through
  }
  return "agi-postgres-17"; // last-resort default (may produce empty logs)
}

export function collectEvidence(log: ComponentLogger): Evidence {
  log.info("collecting crash evidence...");
  const pgContainerName = findPostgresContainerName();
  return {
    collectedAt: new Date().toISOString(),
    hadPriorMarker: peekShutdownMarker() !== null,
    gatewayJournal: journalctl("aionima", 500),
    idServiceJournal: journalctl("agi-id", 200),
    gatewayLog: gatewayLogTail(300),
    podmanPs: podmanPs(),
    postgresLogs: podmanLogs(pgContainerName, 100),
    dmesg: dmesgTail(100),
    diskRoot: diskFree("/"),
    diskAgi: diskFree(join(homedir(), ".agi")),
  };
}

// ---------------------------------------------------------------------------
// Heuristic classification
// ---------------------------------------------------------------------------

export type Classification =
  | "postgres_unreachable"
  | "oom_killed"
  | "disk_full"
  | "id_service_failed"
  | "container_runtime_failure"
  | "unknown";

export interface ClassifiedIncident {
  classification: Classification;
  confidence: "high" | "medium" | "low";
  summary: string;
  autoRecoverable: boolean;
  recommendedActions: string[];
}

export function classifyIncident(e: Evidence): ClassifiedIncident {
  const combined = [e.gatewayJournal, e.gatewayLog, e.idServiceJournal].join("\n");

  // Postgres unreachable — the exact scenario that hit us today
  if (/ECONNREFUSED .*:5432|ECONNREFUSED 127\.0\.0\.1:5432|connect.*:5432.*refused/i.test(combined)) {
    return {
      classification: "postgres_unreachable",
      confidence: "high",
      summary: "Gateway couldn't reach the ID service's PostgreSQL at 127.0.0.1:5432. Likely cause: the agi-postgres-17 plugin container did not auto-restart after a host reboot.",
      autoRecoverable: true,
      recommendedActions: [
        "Click 'Recover now' — the gateway will start the agi-postgres-17 service container and agi-id.service, then re-run reconciliation.",
        "If recovery keeps failing, check the Services page in the dashboard and inspect the agi-postgres-17 plugin container logs.",
      ],
    };
  }

  // OOM
  if (/out of memory|Out of memory|Killed process/i.test([e.dmesg, e.gatewayJournal].join("\n"))) {
    return {
      classification: "oom_killed",
      confidence: "high",
      summary: "The kernel OOM killer terminated a process. The host likely ran out of memory while a model or large workload was running.",
      autoRecoverable: false,
      recommendedActions: [
        "Review which models are configured to auto-start — consider reducing max concurrent models or RAM budget.",
        "Check `dmesg` for which process was killed.",
        "Exit safemode once memory pressure is resolved.",
      ],
    };
  }

  // Disk pressure
  const diskLines = [e.diskRoot, e.diskAgi].join("\n");
  if (/(9[5-9]|100)%/.test(diskLines) || /No space left on device|ENOSPC/i.test(combined)) {
    return {
      classification: "disk_full",
      confidence: "high",
      summary: "The host is critically low on disk space. The gateway can't write logs, Postgres can't write WAL, and container starts may fail.",
      autoRecoverable: false,
      recommendedActions: [
        "Free disk space on / or ~/.agi/ before exiting safemode.",
        "Run `agi doctor` for a detailed storage breakdown.",
        "Consider uninstalling unused HF models (each can be 1-10GB).",
      ],
    };
  }

  // ID service failure
  if (/agi-id\.service.*(failed|Failed)|Start-Pre.*exited with code/i.test(e.idServiceJournal)) {
    return {
      classification: "id_service_failed",
      confidence: "medium",
      summary: "The ID service is failing to start — typically a failed drizzle-kit migration or a misconfigured databaseUrl.",
      autoRecoverable: true,
      recommendedActions: [
        "Click 'Recover now' to retry starting the ID service after reconciling externals.",
        "Check `journalctl -u agi-id -n 50` for migration errors.",
      ],
    };
  }

  // Container runtime
  if (/podman.*not found|podman.*failed|container runtime error/i.test(combined)) {
    return {
      classification: "container_runtime_failure",
      confidence: "medium",
      summary: "Podman or the container runtime reported errors during boot. Containers may be missing or in a bad state.",
      autoRecoverable: true,
      recommendedActions: [
        "Click 'Recover now' to attempt to start all managed containers.",
        "If failures persist, run `agi doctor` and inspect the podman service.",
      ],
    };
  }

  return {
    classification: "unknown",
    confidence: "low",
    summary: "No specific crash pattern matched. The gateway did not shut down gracefully — a process, host, or kernel-level event is the likely cause. Review the evidence sections below.",
    autoRecoverable: true,
    recommendedActions: [
      "Click 'Recover now' to attempt to start all managed containers.",
      "Review the Gateway Journal and Gateway Log sections below for clues.",
      "If the issue reproduces, file a detailed report with the contents of this incident.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Report composition
// ---------------------------------------------------------------------------

function truncateForReport(text: string, maxBytes = 20_000): string {
  if (text.length <= maxBytes) return text;
  return text.slice(0, maxBytes) + `\n\n... [truncated ${String(text.length - maxBytes)} bytes] ...`;
}

function composeHeuristicReport(
  evidence: Evidence,
  classified: ClassifiedIncident,
): string {
  const lines: string[] = [];
  lines.push(`# Incident Report — ${evidence.collectedAt}`);
  lines.push("");
  lines.push(`**Classification:** \`${classified.classification}\` (confidence: ${classified.confidence})`);
  lines.push(`**Auto-recoverable:** ${classified.autoRecoverable ? "yes" : "no"}`);
  lines.push(`**Prior shutdown marker:** ${evidence.hadPriorMarker ? "present (but missing at boot — race/corruption)" : "missing (confirms ungraceful exit)"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(classified.summary);
  lines.push("");
  lines.push("## Recommended actions");
  lines.push("");
  for (const a of classified.recommendedActions) lines.push(`- ${a}`);
  lines.push("");
  lines.push("## Evidence");
  lines.push("");
  lines.push("### Gateway journal (`journalctl -u aionima`)");
  lines.push("```");
  lines.push(truncateForReport(evidence.gatewayJournal, 8_000));
  lines.push("```");
  lines.push("");
  lines.push("### ID service journal (`journalctl -u agi-id`)");
  lines.push("```");
  lines.push(truncateForReport(evidence.idServiceJournal, 4_000));
  lines.push("```");
  lines.push("");
  lines.push("### Gateway log (~/.agi/logs/gateway*.log, tail)");
  lines.push("```");
  lines.push(truncateForReport(evidence.gatewayLog, 8_000));
  lines.push("```");
  lines.push("");
  lines.push("### Container state (`podman ps -a`)");
  lines.push("```");
  lines.push(truncateForReport(evidence.podmanPs, 4_000));
  lines.push("```");
  lines.push("");
  lines.push("### Postgres logs (tail)");
  lines.push("```");
  lines.push(truncateForReport(evidence.postgresLogs, 4_000));
  lines.push("```");
  lines.push("");
  lines.push("### dmesg (tail)");
  lines.push("```");
  lines.push(truncateForReport(evidence.dmesg, 3_000));
  lines.push("```");
  lines.push("");
  lines.push("### Disk free");
  lines.push("```");
  lines.push(evidence.diskRoot);
  lines.push(evidence.diskAgi);
  lines.push("```");
  return lines.join("\n");
}

function buildNarrativePrompt(evidence: Evidence, classified: ClassifiedIncident): string {
  return [
    "You are Aion, Aionima's incident-response assistant. Write a short narrative root-cause analysis for the evidence below.",
    "",
    "Classification produced by heuristic rules:",
    `- Category: ${classified.classification}`,
    `- Confidence: ${classified.confidence}`,
    `- Auto-recoverable: ${String(classified.autoRecoverable)}`,
    `- Summary: ${classified.summary}`,
    "",
    "Write 3-5 concise paragraphs covering:",
    "1. What happened (one paragraph).",
    "2. Why it happened, citing specific log lines.",
    "3. What the operator should do now.",
    "",
    "Keep it factual. Do not speculate beyond the evidence. Do not include JSON or code fences.",
    "",
    "--- EVIDENCE ---",
    truncateForReport(evidence.gatewayJournal, 3_000),
    "",
    "--- GATEWAY LOG ---",
    truncateForReport(evidence.gatewayLog, 3_000),
    "",
    "--- ID SERVICE JOURNAL ---",
    truncateForReport(evidence.idServiceJournal, 1_500),
    "",
    "--- DMESG ---",
    truncateForReport(evidence.dmesg, 1_000),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InvestigatorOptions {
  localModel?: LocalModelRuntime;
  notificationStore?: NotificationStore;
}

function incidentIdForNow(): string {
  // ISO timestamp with safe filesystem characters
  return new Date().toISOString().replace(/[:]/g, "-");
}

/**
 * Run the investigator. Writes a report to ~/.agi/incidents/<id>.md and
 * updates safemodeState with the report path. Safe to call from an async
 * task — this function handles all errors internally.
 */
export async function runInvestigator(
  log: ComponentLogger,
  opts: InvestigatorOptions,
): Promise<void> {
  safemodeState.setInvestigating();
  try {
    if (!existsSync(INCIDENTS_DIR)) mkdirSync(INCIDENTS_DIR, { recursive: true });

    const evidence = collectEvidence(log);
    const classified = classifyIncident(evidence);

    // Compose the heuristic report first — always present, even if the LLM fails.
    let report = composeHeuristicReport(evidence, classified);

    // If a local model is running, enrich with an Aion-authored narrative.
    if (opts.localModel !== undefined) {
      const available = await opts.localModel.isAvailable();
      if (available) {
        log.info(`invoking local model (${opts.localModel.getModelId()}) for narrative`);
        const narrative = await opts.localModel.complete(
          buildNarrativePrompt(evidence, classified),
          { maxTokens: 800, temperature: 0.3 },
        );
        if (narrative !== null && narrative.trim().length > 0) {
          report = `${report}\n\n## Aion's analysis\n\n${narrative.trim()}\n`;
        }
      } else {
        log.info("local model not running — report uses heuristic template only");
      }
    }

    const id = incidentIdForNow();
    const reportPath = join(INCIDENTS_DIR, `${id}.md`);
    writeFileSync(reportPath, report, "utf8");
    log.info(`incident report written: ${reportPath}`);

    safemodeState.setInvestigationComplete(reportPath, classified.autoRecoverable);

    // Emit a persistent notification so the bell icon surfaces it.
    if (opts.notificationStore !== undefined) {
      try {
        opts.notificationStore.create({
          type: "incident",
          title: `Crash detected — ${classified.classification}`,
          body: classified.summary.slice(0, 240),
          metadata: { reportPath, classification: classified.classification, incidentId: id },
        });
      } catch (err) {
        log.warn(`failed to create incident notification: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`investigator failed: ${msg}`);
    safemodeState.setInvestigationFailed(msg);
  }
}

// Helper used by the admin API to expose the investigator result
export { safemodeState };
