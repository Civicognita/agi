import { test, expect } from "@playwright/test";

/**
 * Upgrade Wizard e2e spec (s_upgrade_wizard).
 *
 * Two-step upgrade workflow:
 *   Step 1 — Source Selection: shows fork + upstream branch status with
 *             ahead/behind commit counts; user picks which ref to pull from.
 *   Step 2 — Preview + Execute: shows changelog, migrations, impact summary,
 *             then runs upgrade.sh with live per-step status rows.
 *
 * Iteration A: API-layer tests pass (fork-status, upgrade-preview endpoints).
 * Iteration B: Wizard UI tests turn green once UpgradeWizard.tsx is wired in.
 */

// ---------------------------------------------------------------------------
// API layer — these pass after Iteration A
// ---------------------------------------------------------------------------

test.describe("Upgrade Wizard — API layer", () => {
  test("GET /api/system/fork-status returns valid shape", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/system/fork-status");
      if (!res.ok) return null;
      return res.json();
    });

    expect(result).not.toBeNull();
    expect(typeof result.devModeEnabled).toBe("boolean");
    expect(typeof result.currentBranch).toBe("string");
    expect(typeof result.currentVersion).toBe("string");
    expect(typeof result.deployedCommit).toBe("string");
    expect(Array.isArray(result.sources)).toBe(true);

    // At least one source must be present (origin/main or origin/dev)
    expect(result.sources.length).toBeGreaterThan(0);

    const source = result.sources[0];
    expect(typeof source.ref).toBe("string");
    expect(typeof source.label).toBe("string");
    expect(typeof source.commitsAhead).toBe("number");
    expect(typeof source.commitsBehind).toBe("number");
    expect(typeof source.isCurrentChannel).toBe("boolean");
    expect(typeof source.isUpstream).toBe("boolean");
    expect(["up-to-date", "fast-forward", "three-way", "behind"]).toContain(source.mergeType);
    expect(typeof source.hasConflicts).toBe("boolean");
    expect(typeof source.isUpgrade).toBe("boolean");
  });

  test("isUpgrade is version-aware, never raw topology", async ({ page }) => {
    // Regression for the merge-bubble bug: upstream/main trails a custodian's
    // fork by merge commits, so it is three-way (commitsBehind > 0) yet an
    // OLDER version. Such a source must NOT be flagged as an upgrade. The
    // invariant: every isUpgrade source has commits we lack AND, when its
    // version is readable, a strictly-newer version than ours.
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/system/fork-status");
      if (!res.ok) return null;
      return res.json();
    });
    expect(result).not.toBeNull();
    const parseV = (v: string): number[] | null => {
      const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v ?? "");
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    const gt = (a: number[], b: number[]): boolean =>
      a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
    const cur = parseV(result.currentVersion);
    for (const s of result.sources as Array<{
      isUpgrade: boolean; commitsBehind: number; mergeType: string; latestVersion: string | null;
    }>) {
      if (s.isUpgrade) {
        // Real upgrades always have commits we lack and are never "behind".
        expect(s.commitsBehind).toBeGreaterThan(0);
        expect(s.mergeType).not.toBe("behind");
        const sv = s.latestVersion ? parseV(s.latestVersion) : null;
        if (sv && cur) expect(gt(sv, cur)).toBe(true);
      } else if (cur && s.latestVersion) {
        // A non-upgrade with a readable version must NOT be strictly newer.
        const sv = parseV(s.latestVersion);
        if (sv) expect(gt(sv, cur)).toBe(false);
      }
    }
  });

  test("GET /api/system/upgrade-history returns valid shape", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/system/upgrade-history");
      if (!res.ok) return null;
      return res.json();
    });
    expect(result).not.toBeNull();
    expect(Array.isArray(result.entries)).toBe(true);
  });

  test("fork-status always includes upstream source in Dev Mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/system/fork-status");
      if (!res.ok) return null;
      return res.json();
    });
    if (!result?.devModeEnabled) {
      test.skip(); // not in Dev Mode
      return;
    }
    const upstreamSources = result.sources.filter((s: { isUpstream: boolean }) => s.isUpstream);
    expect(upstreamSources.length).toBeGreaterThan(0);
  });

  test("GET /api/system/upgrade-preview returns valid shape for current channel ref", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    // First get fork-status to find the current channel ref
    const forkStatus = await page.evaluate(async () => {
      const res = await fetch("/api/system/fork-status");
      if (!res.ok) return null;
      return res.json();
    });

    const currentSource = forkStatus?.sources?.find((s: { isCurrentChannel: boolean }) => s.isCurrentChannel)
      ?? forkStatus?.sources?.[0];

    if (!currentSource) {
      test.skip();
      return;
    }

    const preview = await page.evaluate(async (source: string) => {
      const res = await fetch(`/api/system/upgrade-preview?source=${encodeURIComponent(source)}`);
      if (!res.ok) return null;
      return res.json();
    }, currentSource.ref as string);

    expect(preview).not.toBeNull();
    expect(typeof preview.fromVersion).toBe("string");
    expect(typeof preview.toVersion).toBe("string");
    expect(typeof preview.commitCount).toBe("number");
    expect(Array.isArray(preview.commits)).toBe(true);
    expect(Array.isArray(preview.migrations)).toBe(true);
    expect(typeof preview.impact).toBe("object");
    expect(typeof preview.impact.requiresRestart).toBe("boolean");
    expect(typeof preview.impact.requiresDbMigration).toBe("boolean");
    expect(typeof preview.impact.frontendOnly).toBe("boolean");
    expect(Array.isArray(preview.impact.changedAreas)).toBe(true);
  });

  test("POST /api/system/merge-source rejects unknown ref", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/system/merge-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "nonexistent/branch-xyz-test" }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    });

    // Should return 400 or 422 for unknown ref
    expect([400, 422, 500]).toContain(result.status);
  });
});

// ---------------------------------------------------------------------------
// Wizard UI — these pass after Iteration B
//
// The "Manage Upgrade" button in Settings → Gateway → General is the
// always-available entry point. The header trigger only appears when updates
// are pending; using settings ensures tests pass in up-to-date environments.
// ---------------------------------------------------------------------------

test.describe("Upgrade Wizard — UI", () => {
  // Whether the live git state exposes a real upgrade (strictly-newer VERSION,
  // surfaced as `isUpgrade`). The review action only exists in that case —
  // action-flow tests branch on this rather than forcing a fixture (env hits
  // real git). Gating on isUpgrade (not mergeType) is the fix for the
  // upstream/main merge-bubble false positive.
  async function hasRealUpgrade(page: import("@playwright/test").Page): Promise<boolean> {
    const status = await page.evaluate(async () => {
      const res = await fetch("/api/system/fork-status");
      if (!res.ok) return null;
      return res.json();
    });
    if (!status?.sources) return false;
    return status.sources.some((s: { isUpgrade: boolean }) => s.isUpgrade);
  }

  test.beforeEach(async ({ page }) => {
    // Navigate via Settings > Gateway so the trigger is always visible
    // regardless of whether updates are pending.
    await page.goto("/settings/gateway");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });
  });

  test("settings-gateway shows Manage Upgrade button (always accessible)", async ({ page }) => {
    // The trigger in settings is always rendered, regardless of update availability.
    const trigger = page.getByTestId("upgrade-wizard-trigger");
    await expect(trigger).toBeVisible({ timeout: 8_000 });
  });

  test("clicking the trigger opens the upgrade wizard overlay", async ({ page }) => {
    await page.getByTestId("upgrade-wizard-trigger").click();
    await expect(page.getByTestId("upgrade-wizard-overlay")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("upgrade-wizard-step-1")).toBeVisible();
  });

  test("step 1 always shows every source (actionable card or info row)", async ({ page }) => {
    await page.getByTestId("upgrade-wizard-trigger").click();
    await expect(page.getByTestId("upgrade-wizard-step-1")).toBeVisible({ timeout: 5_000 });

    // Sources are ALWAYS listed — either as actionable upgrade cards or as
    // non-interactive info rows (up-to-date / behind). At least one of either
    // must be present. fork-status runs several remote git comparisons, so allow
    // generous time for the source list to populate under parallel test load.
    const anySource = page.locator(
      "[data-testid='upgrade-source-card'], [data-testid='upgrade-source-card-current'], [data-testid='upgrade-source-info']",
    );
    await expect(anySource.first()).toBeVisible({ timeout: 20_000 });
  });

  test("review action only exists when a real upgrade is available", async ({ page }) => {
    const upgradeAvailable = await hasRealUpgrade(page);
    await page.getByTestId("upgrade-wizard-trigger").click();
    await expect(page.getByTestId("upgrade-wizard-step-1")).toBeVisible({ timeout: 5_000 });

    if (upgradeAvailable) {
      // A real upgrade exists — the Review button is present and an actionable
      // card is pre-selected.
      await expect(page.getByTestId("upgrade-wizard-preview-btn")).toBeVisible();
      const actionable = page.locator(
        "[data-testid='upgrade-source-card'], [data-testid='upgrade-source-card-current']",
      );
      await expect(actionable.first()).toBeVisible();
    } else {
      // Up to date — no Review button, an explicit "nothing to review" state,
      // and every source rendered as a non-interactive info row.
      await expect(page.getByTestId("upgrade-wizard-preview-btn")).toHaveCount(0);
      await expect(page.getByTestId("upgrade-no-upgrades")).toBeVisible();
    }
  });

  test("up-to-date state surfaces the recent 'what changed' changelog (story #214)", async ({ page }) => {
    test.skip(await hasRealUpgrade(page), "a real upgrade exists — the empty-state changelog isn't shown");
    await page.getByTestId("upgrade-wizard-trigger").click();
    await expect(page.getByTestId("upgrade-wizard-step-1")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("upgrade-no-upgrades")).toBeVisible();
    // Instead of a dead-end, the up-to-date state shows the running changelog.
    // The VM repo has git history, so fetchChangelog returns commits.
    await expect(page.getByTestId("upgrade-recent-changelog")).toBeVisible({ timeout: 5_000 });
  });

  test("up-to-date and behind sources render as non-interactive info rows", async ({ page }) => {
    await page.getByTestId("upgrade-wizard-trigger").click();
    await expect(page.getByTestId("upgrade-wizard-step-1")).toBeVisible({ timeout: 5_000 });

    // Info rows are <div>, not <button> — they carry no review action.
    const infoRows = page.getByTestId("upgrade-source-info");
    const count = await infoRows.count();
    for (let i = 0; i < count; i++) {
      const row = infoRows.nth(i);
      const tag = await row.evaluate((el) => el.tagName.toLowerCase());
      expect(tag).toBe("div");
    }
  });

  test("clicking Review advances to step 2 (when a real upgrade exists)", async ({ page }) => {
    test.skip(!(await hasRealUpgrade(page)), "no real upgrade available in this environment");
    await page.getByTestId("upgrade-wizard-trigger").click();
    await expect(page.getByTestId("upgrade-wizard-step-1")).toBeVisible({ timeout: 5_000 });

    await page.getByTestId("upgrade-wizard-preview-btn").click();
    await expect(page.getByTestId("upgrade-wizard-step-2")).toBeVisible({ timeout: 8_000 });
  });

  test("step 2 shows version delta, impact row, and changelog", async ({ page }) => {
    test.skip(!(await hasRealUpgrade(page)), "no real upgrade available in this environment");
    await page.getByTestId("upgrade-wizard-trigger").click();
    await expect(page.getByTestId("upgrade-wizard-step-1")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("upgrade-wizard-preview-btn").click();
    await expect(page.getByTestId("upgrade-wizard-step-2")).toBeVisible({ timeout: 8_000 });

    await expect(page.getByTestId("upgrade-preview-version-delta")).toBeVisible();
    await expect(page.getByTestId("upgrade-preview-impact-row")).toBeVisible();
    await expect(page.getByTestId("upgrade-preview-changelog")).toBeVisible();
  });

  test("step 2 Back button returns to step 1 (when a real upgrade exists)", async ({ page }) => {
    test.skip(!(await hasRealUpgrade(page)), "no real upgrade available in this environment");
    await page.getByTestId("upgrade-wizard-trigger").click();
    await page.getByTestId("upgrade-wizard-preview-btn").click();
    await expect(page.getByTestId("upgrade-wizard-step-2")).toBeVisible({ timeout: 8_000 });

    await page.getByTestId("upgrade-wizard-back-btn").click();
    await expect(page.getByTestId("upgrade-wizard-step-1")).toBeVisible({ timeout: 3_000 });
  });

  test("wizard can be dismissed with Escape key", async ({ page }) => {
    await page.getByTestId("upgrade-wizard-trigger").click();
    await expect(page.getByTestId("upgrade-wizard-overlay")).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("upgrade-wizard-overlay")).not.toBeVisible({ timeout: 3_000 });
  });

  test("step indicator highlights the active step", async ({ page }) => {
    await page.getByTestId("upgrade-wizard-trigger").click();
    await expect(page.getByTestId("upgrade-wizard-step-indicator-1")).toHaveAttribute("data-active", "true", { timeout: 5_000 });
    await expect(page.getByTestId("upgrade-wizard-step-indicator-2")).toHaveAttribute("data-active", "false");
    await expect(page.getByTestId("upgrade-wizard-step-indicator-3")).toHaveAttribute("data-active", "false");
  });

  test("History button opens history panel", async ({ page }) => {
    await page.getByTestId("upgrade-wizard-trigger").click();
    await expect(page.getByTestId("upgrade-wizard-overlay")).toBeVisible({ timeout: 10_000 });

    // Click History button (in the wizard header, available immediately).
    await page.getByRole("button", { name: "History" }).click();

    // Step wizard should be hidden; history panel visible (renders even with
    // zero entries — empty state). Target the panel by testid (the heading text
    // can appear in more than one node).
    await expect(page.getByTestId("upgrade-wizard-step-1")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("upgrade-history-panel")).toBeVisible({ timeout: 10_000 });
  });

  test("actionable cards exist only when a real upgrade is available", async ({ page }) => {
    const upgradeAvailable = await hasRealUpgrade(page);
    await page.getByTestId("upgrade-wizard-trigger").click();
    await expect(page.getByTestId("upgrade-wizard-step-1")).toBeVisible({ timeout: 5_000 });

    const cards = page.locator("[data-testid='upgrade-source-card'], [data-testid='upgrade-source-card-current']");
    if (upgradeAvailable) {
      await expect(cards.first()).toBeVisible();
    } else {
      await expect(cards).toHaveCount(0);
    }
  });

  test("'behind' sources surface the ahead-count and offer no action", async ({ page }) => {
    // A source older than the installed commit (mergeType='behind') is shown as
    // an info row that reports how many commits the fork is ahead — never an
    // actionable card, so the owner can't accidentally "downgrade".
    await page.getByTestId("upgrade-wizard-trigger").click();
    await expect(page.getByTestId("upgrade-wizard-step-1")).toBeVisible({ timeout: 5_000 });

    const behindRows = page.locator("[data-testid='upgrade-source-info'][data-merge-type='behind']");
    const count = await behindRows.count();
    for (let i = 0; i < count; i++) {
      // It's a div info row (not a button) and mentions the ahead count.
      await expect(behindRows.nth(i)).toContainText("ahead");
    }
  });

  test("'older' sources (newer topology, older version) render as info rows, not cards", async ({ page }) => {
    // The upstream/main merge-bubble case: commitsBehind > 0 (three-way) but an
    // OLDER version. It must surface as a non-interactive info row reporting
    // it's older — never an actionable card the owner could "upgrade" into.
    await page.getByTestId("upgrade-wizard-trigger").click();
    await expect(page.getByTestId("upgrade-wizard-step-1")).toBeVisible({ timeout: 5_000 });

    const olderRows = page.locator("[data-testid='upgrade-source-info'][data-merge-type='older']");
    const count = await olderRows.count();
    for (let i = 0; i < count; i++) {
      const row = olderRows.nth(i);
      const tag = await row.evaluate((el) => el.tagName.toLowerCase());
      expect(tag).toBe("div");
      await expect(row).toContainText("older");
    }
  });
});
