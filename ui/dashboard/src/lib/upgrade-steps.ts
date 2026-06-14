/**
 * Upgrade step checklist model (story #216).
 *
 * The single source of truth for the upgrade is `scripts/upgrade.sh`, which
 * emits progress as `emit "<key>" "<status>"`. This module mirrors that
 * script's MAIN step sequence so the wizard can show the full checklist up
 * front and flip each row green as the matching `done` lands.
 *
 * Keep `UPGRADE_STEPS` keys ⊆ the script's emitted keys — `upgrade-steps.test.ts`
 * reads upgrade.sh and fails if a step here is never emitted (drift guard).
 */

export interface UpgradeStepDef {
  key: string;
  label: string;
  /** Alternate emit keys that resolve to this same row (e.g. clone-prime ↔ pull-prime). */
  aliases?: string[];
}

/** Ordered to match upgrade.sh's execution sequence. */
export const UPGRADE_STEPS: UpgradeStepDef[] = [
  { key: "preflight", label: "Preflight checks" },
  { key: "pull-agi", label: "Pull latest AGI" },
  { key: "submodules", label: "Initialize submodules" },
  { key: "pull-prime", label: "Update PRIME corpus", aliases: ["clone-prime"] },
  { key: "protocol-check", label: "Protocol version check" },
  { key: "install", label: "Install dependencies" },
  { key: "rebuild", label: "Rebuild native modules" },
  { key: "build", label: "Build dashboard" },
  { key: "db-push", label: "Push database schema" },
  { key: "plugins-rebuild", label: "Rebuild plugins" },
  { key: "pax-sync", label: "Sync PAx packages" },
  { key: "migrate", label: "Run data migrations" },
  { key: "systemd", label: "Update services" },
  { key: "restart", label: "Restart gateway" },
];

/** Canonical status vocabulary the StepRow renders. */
export type UpgradeStepStatus = "pending" | "running" | "done" | "skip" | "warn" | "error";

/**
 * Normalize a raw emitted status to the canonical vocabulary. Bridges
 * upgrade.sh's words (done/start/warn/error/skip) AND the wizard's merge-result
 * rows (ok/start). Unknown / unseen → pending. Idempotent on canonical values.
 */
export function normalizeStepStatus(raw: string | undefined): UpgradeStepStatus {
  switch (raw) {
    case "done":
    case "ok":
      return "done";
    case "skip":
      return "skip";
    case "start":
    case "running":
      return "running";
    case "warn":
      return "warn";
    case "error":
    case "fail":
      return "error";
    default:
      return "pending";
  }
}

export interface UpgradeStepRow {
  key: string;
  label: string;
  status: UpgradeStepStatus;
}

/**
 * Build the FULL ordered step list from the seen-status map — every step is
 * always present (pending until the script reports it), so the user sees the
 * whole checklist immediately and each row greens as `done` arrives. Reads each
 * step by its key, falling back to any alias.
 */
export function computeUpgradeStepRows(
  seen: Map<string, { status: string }>,
): UpgradeStepRow[] {
  return UPGRADE_STEPS.map((step) => {
    const hit =
      seen.get(step.key) ?? step.aliases?.map((a) => seen.get(a)).find(Boolean);
    return { key: step.key, label: step.label, status: normalizeStepStatus(hit?.status) };
  });
}
