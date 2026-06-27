import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guard: upgrade.sh must dispatch the post-upgrade restart in a way that
 * survives the agi.service cgroup being killed (story #221).
 *
 * The gateway spawns upgrade.sh as a CHILD, so it runs inside the agi.service
 * cgroup. A direct `systemctl restart agi` makes systemd stop the service and
 * kill the whole cgroup — including upgrade.sh and the systemctl client —
 * mid-restart, so the process never actually bounces (the stale-process bug
 * where a 3-day-old process served pre-route code across upgrades). The fix runs
 * the restart as a detached `systemd-run` transient unit OUTSIDE the cgroup.
 */

const UPGRADE_SH = fileURLToPath(new URL("../../../scripts/upgrade.sh", import.meta.url));

describe("upgrade.sh restart survives the service stop (s221)", () => {
  const src = readFileSync(UPGRADE_SH, "utf-8");

  it("dispatches the version-change restart via a detached systemd-run unit", () => {
    expect(src).toMatch(/systemd-run[^\n]*--no-block[^\n]*systemctl restart agi/);
  });

  it("keeps a direct restart only as a fallback guarded by a systemd-run availability check", () => {
    // The bare `systemctl restart agi` (no systemd-run) must live in an else
    // branch guarded by `command -v systemd-run`, not as the primary path.
    expect(src).toMatch(/command -v systemd-run/);
    // The bare restart appears (fallback), but a guard precedes it.
    expect(src).toMatch(/else\s*\n\s*sudo systemctl restart agi/);
  });
});
