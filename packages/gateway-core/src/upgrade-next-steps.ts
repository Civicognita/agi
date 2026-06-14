/**
 * UpgradeNextSteps — post-upgrade interactive task queue.
 *
 * Migrations and upgrade.sh can stack items here. Required items block the
 * "upgrade complete" acknowledgement in the dashboard; optional items can be
 * dismissed. Steps persist in ~/.agi/upgrade-next-steps.json until actioned.
 *
 * The upgrade script writes to ~/.agi/upgrade-next-steps-pending.ndjson;
 * importPendingSteps() reads + merges them on gateway boot so bash scripts
 * don't need to call a live API.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type UpgradeNextStepStatus = "pending" | "done" | "dismissed" | "superseded";
export type UpgradeNextStepActionKind = "navigate" | "external-url" | "chat";

export interface UpgradeNextStepAction {
  label: string;
  kind: UpgradeNextStepActionKind;
  /** Route path, URL, or chat context string depending on kind. */
  target: string;
}

export interface UpgradeNextStep {
  /** Stable unique ID — use kebab-case + version suffix (e.g. "pax-conflict-react-fancy-v0.4.879"). */
  id: string;
  title: string;
  description: string;
  /** true = blocks "upgrade acknowledged" until completed. */
  required: boolean;
  status: UpgradeNextStepStatus;
  /** ISO timestamp when the step was stacked. */
  addedAt: string;
  /** Gateway semver that stacked this step. */
  fromVersion: string;
  /** Optional dashboard action the user can take from the panel. */
  action?: UpgradeNextStepAction;
  /**
   * IDs of previously-stacked steps this step supersedes. When this step is
   * stacked, every listed step is atomically marked "superseded" so users who
   * skipped several upgrades only see the current guidance, not outdated steps
   * from intermediate versions.
   *
   * Example: v0.4.872 auto-fixed the Discord config issue that v0.4.860 asked
   * the user to fix manually. v0.4.872's migration sets
   * `cancels: ["discord-config-manual-v0.4.860"]` so the old required step
   * disappears when the user upgrades.
   */
  cancels?: string[];
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const AGI_DIR = join(homedir(), ".agi");
const STEPS_PATH = join(AGI_DIR, "upgrade-next-steps.json");
const PENDING_PATH = join(AGI_DIR, "upgrade-next-steps-pending.ndjson");
/** Written by upgrade.sh after a successful deploy; read on boot to detect new versions. */
export const DEPLOYED_VERSION_PATH = join(AGI_DIR, "deployed-version.txt");
/** Last version the gateway acknowledged (emitted system:upgraded for). */
export const SEEN_VERSION_PATH = join(AGI_DIR, "seen-version.txt");
/** Tracks which migration IDs have already run — idempotency guard. */
const MIGRATION_LOG_PATH = join(AGI_DIR, "migration-run-log.json");
/** Records the highest version whose migrations have been applied. */
export const LAST_MIGRATED_VERSION_PATH = join(AGI_DIR, "last-migrated-version.txt");

function ensureDir(): void {
  if (!existsSync(AGI_DIR)) mkdirSync(AGI_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function readSteps(): UpgradeNextStep[] {
  if (!existsSync(STEPS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(STEPS_PATH, "utf-8")) as UpgradeNextStep[];
  } catch {
    return [];
  }
}

function writeSteps(steps: UpgradeNextStep[]): void {
  ensureDir();
  writeFileSync(STEPS_PATH, JSON.stringify(steps, null, 2));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Stack a new step. Idempotent by ID — existing step with same ID is kept unchanged.
 * If the new step declares `cancels: [...]`, those existing steps are atomically
 * marked "superseded" so the user only sees the current guidance.
 */
export function stackUpgradeNextStep(step: Omit<UpgradeNextStep, "status" | "addedAt"> & { addedAt?: string }): void {
  const steps = readSteps();
  if (steps.some((s) => s.id === step.id)) return;
  // Supersede any steps this one cancels
  if (step.cancels && step.cancels.length > 0) {
    const cancelSet = new Set(step.cancels);
    for (const s of steps) {
      if (cancelSet.has(s.id) && s.status === "pending") {
        s.status = "superseded";
      }
    }
  }
  steps.push({ ...step, status: "pending", addedAt: step.addedAt ?? new Date().toISOString() });
  writeSteps(steps);
}

/** Directly supersede a step by ID (used by migration runner for programmatic cancellation). */
export function supersedeUpgradeNextStep(id: string): void {
  const steps = readSteps();
  const step = steps.find((s) => s.id === id);
  if (step && step.status === "pending") {
    step.status = "superseded";
    writeSteps(steps);
  }
}

/** List all steps. Pass `filter="pending"` to get only actionable ones. */
export function listUpgradeNextSteps(filter?: "pending" | "all"): UpgradeNextStep[] {
  const steps = readSteps();
  if (filter === "pending") return steps.filter((s) => s.status === "pending");
  return steps;
}

/** Mark a step done. */
export function completeUpgradeNextStep(id: string): boolean {
  const steps = readSteps();
  const step = steps.find((s) => s.id === id);
  if (!step) return false;
  step.status = "done";
  writeSteps(steps);
  return true;
}

/** Dismiss an optional step. Required steps cannot be dismissed. */
export function dismissUpgradeNextStep(id: string): boolean | "required" {
  const steps = readSteps();
  const step = steps.find((s) => s.id === id);
  if (!step) return false;
  if (step.required) return "required";
  step.status = "dismissed";
  writeSteps(steps);
  return true;
}

/** True when any pending step is marked required (blocks acknowledgement). */
export function hasPendingRequiredSteps(): boolean {
  // "superseded" is treated as resolved — it never blocks
  return readSteps().some((s) => s.status === "pending" && s.required);
}

// ---------------------------------------------------------------------------
// Pending import — upgrade.sh writes to the .ndjson file, gateway boot merges
// ---------------------------------------------------------------------------

/**
 * Read upgrade-next-steps-pending.ndjson written by upgrade.sh and merge
 * each line into the main steps store. Clears the pending file after import.
 * Call once on gateway boot before emitting system:upgraded.
 */
export function importPendingSteps(): number {
  if (!existsSync(PENDING_PATH)) return 0;
  const raw = readFileSync(PENDING_PATH, "utf-8").trim();
  if (!raw) return 0;
  let count = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const step = JSON.parse(line) as Omit<UpgradeNextStep, "status" | "addedAt"> & { addedAt?: string };
      stackUpgradeNextStep(step);
      count++;
    } catch {
      // Malformed line — skip
    }
  }
  writeFileSync(PENDING_PATH, ""); // clear after import
  return count;
}

/**
 * Append a step to the pending NDJSON file. Used from upgrade.sh via
 * `node -e` inline calls so bash doesn't need to call a live API.
 */
export function appendPendingStep(step: Omit<UpgradeNextStep, "status" | "addedAt">): void {
  ensureDir();
  appendFileSync(PENDING_PATH, JSON.stringify({ ...step, addedAt: new Date().toISOString() }) + "\n");
}

// ---------------------------------------------------------------------------
// Version tracking
// ---------------------------------------------------------------------------

export function readDeployedVersion(): string | null {
  if (!existsSync(DEPLOYED_VERSION_PATH)) return null;
  return readFileSync(DEPLOYED_VERSION_PATH, "utf-8").trim() || null;
}

export function readSeenVersion(): string | null {
  if (!existsSync(SEEN_VERSION_PATH)) return null;
  return readFileSync(SEEN_VERSION_PATH, "utf-8").trim() || null;
}

export function writeSeenVersion(version: string): void {
  ensureDir();
  writeFileSync(SEEN_VERSION_PATH, version);
}

export function readLastMigratedVersion(): string | null {
  if (!existsSync(LAST_MIGRATED_VERSION_PATH)) return null;
  return readFileSync(LAST_MIGRATED_VERSION_PATH, "utf-8").trim() || null;
}

export function writeLastMigratedVersion(version: string): void {
  ensureDir();
  writeFileSync(LAST_MIGRATED_VERSION_PATH, version);
}

// ---------------------------------------------------------------------------
// Migration run-log — idempotency guard
// ---------------------------------------------------------------------------

function readMigrationLog(): Set<string> {
  if (!existsSync(MIGRATION_LOG_PATH)) return new Set();
  try {
    const ids = JSON.parse(readFileSync(MIGRATION_LOG_PATH, "utf-8")) as string[];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function writeMigrationLog(log: Set<string>): void {
  ensureDir();
  writeFileSync(MIGRATION_LOG_PATH, JSON.stringify([...log], null, 2));
}

/** Returns true if this migration ID has already been applied. */
export function hasMigrationRun(migrationId: string): boolean {
  return readMigrationLog().has(migrationId);
}

/** Record that a migration has been applied. Idempotent. */
export function recordMigrationRun(migrationId: string): void {
  const log = readMigrationLog();
  log.add(migrationId);
  writeMigrationLog(log);
}
