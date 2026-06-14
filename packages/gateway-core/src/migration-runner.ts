/**
 * Migration runner — versioned TypeScript migrations for the gateway.
 *
 * # Why this exists
 *
 * Users don't always upgrade immediately. Someone on v0.4.850 might skip ten
 * releases and land on v0.4.880 in a single `agi upgrade`. The migration
 * runner ensures ALL intermediate migrations run in order, not just the
 * ones that shipped in the final version.
 *
 * # What migrations are for
 *
 * TypeScript migrations run on gateway boot AFTER the new code is deployed.
 * They are for:
 *  - Stacking UpgradeNextSteps (user guidance, required or optional)
 *  - Cancelling/superseding steps from earlier versions
 *  - Patching gateway.json config fields that changed shape
 *  - Registering one-time boot-time data transforms
 *
 * They are NOT for:
 *  - Schema changes (those belong in migrate-db.sh, run by upgrade.sh before boot)
 *  - Filesystem operations that require root (those belong in upgrade.sh)
 *
 * # How to add a migration
 *
 * 1. Add an entry to MIGRATIONS below, ordered by version ascending.
 * 2. Give it a unique `id` (never reuse IDs — idempotency is tracked by ID).
 * 3. Return `UpgradeNextStep | null` from `run()`. Returning a step stacks it.
 *    To supersede a prior step, set `cancels: ["prior-step-id"]` on the new step.
 *    Return `null` if the migration is structural (no user action needed).
 *
 * # Version comparison
 *
 * Migrations run when `migration.version > lastMigratedVersion && migration.version <= currentVersion`.
 * The runner sorts by version before executing, so order in this file doesn't
 * matter — but keeping them sorted makes diffs easier to read.
 */

import type { UpgradeNextStep } from "./upgrade-next-steps.js";
import {
  hasMigrationRun,
  recordMigrationRun,
  readLastMigratedVersion,
  writeLastMigratedVersion,
  stackUpgradeNextStep,
  supersedeUpgradeNextStep,
} from "./upgrade-next-steps.js";
import { createComponentLogger } from "./logger.js";

const log = createComponentLogger(undefined, "migration-runner");

// ---------------------------------------------------------------------------
// Migration context (passed to each migration's run function)
// ---------------------------------------------------------------------------

export interface MigrationContext {
  /** The version the user is upgrading FROM (may be null on first install). */
  fromVersion: string | null;
  /** The version being deployed. */
  toVersion: string;
  /** Stack a post-upgrade next step. */
  stackStep: (step: Omit<UpgradeNextStep, "status" | "addedAt">) => void;
  /** Supersede a previously-stacked step by ID (marks it "superseded"). */
  cancelStep: (id: string) => void;
  /** Write a message to the gateway log. */
  log: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Migration definition
// ---------------------------------------------------------------------------

export interface Migration {
  /**
   * The gateway version that introduced this migration.
   * Format: "MAJOR.MINOR.PATCH" (e.g. "0.4.880").
   * Migrations run when version > lastMigratedVersion AND version <= currentVersion.
   */
  version: string;
  /** Unique stable ID — never reuse. Tracked in ~/.agi/migration-run-log.json. */
  id: string;
  /** Human-readable description for logs. */
  description: string;
  /** The migration body. Return void; use ctx.stackStep / ctx.cancelStep for effects. */
  run: (ctx: MigrationContext) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Version comparison helpers
// ---------------------------------------------------------------------------

/** Parse "1.2.3" into [1, 2, 3]. */
function parseVersion(v: string): number[] {
  return v.split(".").map((p) => parseInt(p, 10) || 0);
}

/** Returns true if a < b (semver-style, no pre-release parsing needed). */
export function versionLessThan(a: string, b: string): boolean {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return true;
    if (na > nb) return false;
  }
  return false; // equal
}

/** Returns true if a <= b. */
function versionLessThanOrEqual(a: string, b: string): boolean {
  return !versionLessThan(b, a);
}

// ---------------------------------------------------------------------------
// Migration registry — add new migrations here, sorted by version ascending
// ---------------------------------------------------------------------------

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  // ---------------------------------------------------------------------------
  // v0.4.880 — establish the migration system itself.
  // No user action needed; this is the bootstrap marker so subsequent
  // migrations have a known baseline to compare against.
  // ---------------------------------------------------------------------------
  {
    version: "0.4.880",
    id: "migration-system-bootstrap",
    description: "Bootstrap migration system — establish baseline",
    run: (_ctx: MigrationContext) => {
      // No-op: just marks v0.4.880 as the migration baseline.
      // All future migrations can assume this has run.
    },
  },

  // ---------------------------------------------------------------------------
  // Add new migrations below, ordered by version ascending.
  //
  // Template:
  //
  // {
  //   version: "0.4.NNN",
  //   id: "short-kebab-description-v0.4.NNN",
  //   description: "What this does and why",
  //   run: (ctx) => {
  //     // Optional: cancel a prior step that's no longer needed
  //     ctx.cancelStep("prior-step-id-v0.4.MMM");
  //
  //     // Optional: stack a new step
  //     ctx.stackStep({
  //       id: "action-needed-v0.4.NNN",
  //       title: "Short action title",
  //       description: "Why the user needs to do this.",
  //       required: false, // true = blocks acknowledgement
  //       fromVersion: "0.4.NNN",
  //       cancels: ["prior-step-id-v0.4.MMM"], // also cancel via the step itself
  //       action: { label: "Go there", kind: "navigate", target: "/settings/channels" },
  //     });
  //   },
  // },
  // ---------------------------------------------------------------------------
] as const);

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run all pending migrations between `fromVersion` (exclusive) and
 * `toVersion` (inclusive), in ascending version order.
 *
 * Idempotent: each migration is skipped if its ID is already in the run log.
 * Safe to call on every boot — it's a no-op when everything is current.
 */
export async function runPendingMigrations(
  fromVersion: string | null,
  toVersion: string,
): Promise<{ ran: number; skipped: number }> {
  const lastMigrated = readLastMigratedVersion() ?? fromVersion;
  const pending = [...MIGRATIONS]
    .filter((m) => {
      // Include if: version > lastMigrated (or lastMigrated is null) AND version <= toVersion
      if (!versionLessThanOrEqual(m.version, toVersion)) return false;
      if (lastMigrated !== null && !versionLessThan(lastMigrated, m.version)) return false;
      return true;
    })
    .sort((a, b) => versionLessThan(a.version, b.version) ? -1 : versionLessThan(b.version, a.version) ? 1 : 0);

  if (pending.length === 0) return { ran: 0, skipped: 0 };

  log.info(`migration-runner: ${String(pending.length)} migrations to run (${lastMigrated ?? "initial"} → ${toVersion})`);

  const ctx: MigrationContext = {
    fromVersion: fromVersion,
    toVersion,
    stackStep: (step) => stackUpgradeNextStep(step),
    cancelStep: (id) => supersedeUpgradeNextStep(id),
    log: (message) => log.info(`[migration ${toVersion}] ${message}`),
  };

  let ran = 0;
  let skipped = 0;

  for (const migration of pending) {
    if (hasMigrationRun(migration.id)) {
      log.debug(`migration-runner: skip already-run: ${migration.id}`);
      skipped++;
      continue;
    }
    try {
      log.info(`migration-runner: running ${migration.id} (${migration.description})`);
      await Promise.resolve(migration.run(ctx));
      recordMigrationRun(migration.id);
      ran++;
    } catch (err) {
      // Migrations must never crash the gateway. Log + continue.
      log.warn(`migration-runner: migration ${migration.id} threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Advance the last-migrated pointer to the highest version we processed
  const highestRun = pending[pending.length - 1]?.version ?? toVersion;
  writeLastMigratedVersion(highestRun);

  log.info(`migration-runner: complete — ran=${String(ran)} skipped=${String(skipped)} lastMigrated=${highestRun}`);
  return { ran, skipped };
}
