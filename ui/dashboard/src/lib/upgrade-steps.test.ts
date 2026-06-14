import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  UPGRADE_STEPS,
  normalizeStepStatus,
  computeUpgradeStepRows,
} from "./upgrade-steps.js";

describe("upgrade-steps — model (s216 t787)", () => {
  it("normalizeStepStatus bridges upgrade.sh + merge-row vocabularies", () => {
    expect(normalizeStepStatus("done")).toBe("done");
    expect(normalizeStepStatus("ok")).toBe("done"); // merge-result rows
    expect(normalizeStepStatus("skip")).toBe("skip");
    expect(normalizeStepStatus("start")).toBe("running");
    expect(normalizeStepStatus("warn")).toBe("warn");
    expect(normalizeStepStatus("error")).toBe("error");
    expect(normalizeStepStatus("fail")).toBe("error");
    expect(normalizeStepStatus(undefined)).toBe("pending");
    expect(normalizeStepStatus("weird")).toBe("pending");
    // idempotent on canonical values
    expect(normalizeStepStatus("running")).toBe("running");
    expect(normalizeStepStatus("pending")).toBe("pending");
  });

  it("computeUpgradeStepRows returns ALL steps, pending until seen", () => {
    const rows = computeUpgradeStepRows(new Map());
    expect(rows).toHaveLength(UPGRADE_STEPS.length);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
    expect(rows[0]!.key).toBe("preflight"); // order preserved
  });

  it("flips a step to done when the script reports done", () => {
    const seen = new Map([["pull-agi", { status: "done" }]]);
    const rows = computeUpgradeStepRows(seen);
    expect(rows.find((r) => r.key === "pull-agi")!.status).toBe("done");
    // others still pending
    expect(rows.find((r) => r.key === "build")!.status).toBe("pending");
  });

  it("resolves a row by its alias (clone-prime → pull-prime row)", () => {
    const rows = computeUpgradeStepRows(new Map([["clone-prime", { status: "done" }]]));
    expect(rows.find((r) => r.key === "pull-prime")!.status).toBe("done");
  });

  it("maps warn and error through to the row", () => {
    const rows = computeUpgradeStepRows(new Map([
      ["db-push", { status: "warn" }],
      ["rebuild", { status: "error" }],
    ]));
    expect(rows.find((r) => r.key === "db-push")!.status).toBe("warn");
    expect(rows.find((r) => r.key === "rebuild")!.status).toBe("error");
  });

  // Drift guard: every UPGRADE_STEPS key (or one of its aliases) must actually
  // be emitted by scripts/upgrade.sh, so the checklist can't list phantom steps.
  it("every step key is actually emitted by scripts/upgrade.sh", () => {
    const scriptPath = fileURLToPath(new URL("../../../../scripts/upgrade.sh", import.meta.url));
    const script = readFileSync(scriptPath, "utf-8");
    const emitted = new Set(
      [...script.matchAll(/emit\s+"([a-z-]+)"/g)].map((m) => m[1]),
    );
    for (const step of UPGRADE_STEPS) {
      const candidates = [step.key, ...(step.aliases ?? [])];
      expect(
        candidates.some((k) => emitted.has(k)),
        `step "${step.key}" (or alias) is not emitted by upgrade.sh — emitted: ${[...emitted].join(", ")}`,
      ).toBe(true);
    }
  });
});
