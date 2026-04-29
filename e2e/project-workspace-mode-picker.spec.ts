import { test, expect, Page } from "@playwright/test";

/**
 * Project workspace mode picker e2e (s134 t517).
 *
 * Verifies the cycle-111 stack strip + cycle-112 4-mode picker render
 * on /projects/<slug> as expected:
 *   - Mode picker has 4 buttons (Develop / Operate / Coordinate / Insight)
 *     for projects with web/app/monorepo/ops categories
 *   - Default mode is "develop"
 *   - Clicking a mode button toggles the active state (aria-pressed)
 *   - Insight mode (cycle 117) shows the Activity tab + bar chart
 *
 * Uses the Projects grid-view to click into a project workspace
 * (the list-view rows in cycles 102-109 don't expose project-card
 * testids; switching to grid via the toggle is the e2e-friendly path).
 *
 * Cycle 119 (s134 t517 env follow-up): cycle-113 tests skipped silently
 * because (a) `picker.isVisible({timeout})` is a snapshot, not a wait —
 * fixed by switching to `picker.waitFor({state:"visible"})`; and (b)
 * cards.first() landed on sample-admin (administration category) which
 * hides Develop per cycle-115 category-shape — fixed by walking cards
 * to find one with all 4 modes (`navigateToFullModeProject`).
 */

async function navigateToFullModeProject(page: Page, maxAttempts = 5): Promise<boolean> {
  await page.goto("/projects");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => { /* may not idle */ });

  const gridToggle = page.getByTestId("projects-view-grid");
  await gridToggle.waitFor({ state: "visible", timeout: 15_000 });
  await gridToggle.click();

  const cards = page.getByTestId("project-card");
  const count = await cards.count();
  if (count === 0) return false;

  // Walk the first N cards until we find one with all 4 mode buttons
  // visible (web/app/monorepo/ops categories). Skip core forks + restricted
  // categories (literature/media/administration).
  const tries = Math.min(count, maxAttempts);
  for (let i = 0; i < tries; i++) {
    await cards.nth(i).click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

    const picker = page.getByTestId("project-mode-picker");
    const pickerVisible = await picker.waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true).catch(() => false);
    if (!pickerVisible) {
      // core fork — back to projects list
      await page.goBack();
      await page.getByTestId("projects-view-grid").waitFor({ state: "visible", timeout: 10_000 });
      continue;
    }

    const developVisible = await page.getByTestId("project-mode-develop")
      .isVisible().catch(() => false);
    if (developVisible) {
      return true; // landed on a project with all 4 modes
    }

    // restricted category — try next card
    await page.goBack();
    await page.getByTestId("projects-view-grid").waitFor({ state: "visible", timeout: 10_000 });
  }
  return false;
}

test.describe("Project workspace mode picker (s134 t517)", () => {
  test("mode picker renders with 4 buttons and develop is default", async ({ page }) => {
    const found = await navigateToFullModeProject(page);
    test.skip(!found, "no full-mode (web/app/monorepo/ops) project available");

    await expect(page.getByTestId("project-mode-develop")).toBeVisible();
    await expect(page.getByTestId("project-mode-operate")).toBeVisible();
    await expect(page.getByTestId("project-mode-coordinate")).toBeVisible();
    await expect(page.getByTestId("project-mode-insight")).toBeVisible();

    // Default = develop
    await expect(page.getByTestId("project-mode-develop")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("project-mode-operate")).toHaveAttribute("aria-pressed", "false");
  });

  test("Insight mode shows Activity tab (s134 t517 cycle 117)", async ({ page }) => {
    const found = await navigateToFullModeProject(page);
    test.skip(!found, "no full-mode project available");

    // Switch to Insight mode and verify Activity tab is present.
    await page.getByTestId("project-mode-insight").click();
    await expect(page.getByTestId("project-mode-insight")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("project-tab-activity")).toBeVisible();

    // Click Activity tab and verify the bar chart container renders.
    await page.getByTestId("project-tab-activity").click();
    await expect(page.getByTestId("project-activity-bars")).toBeVisible({ timeout: 10_000 });
  });

  test("clicking a mode button toggles active state", async ({ page }) => {
    const found = await navigateToFullModeProject(page);
    test.skip(!found, "no full-mode project available");

    // Click "operate" mode
    await page.getByTestId("project-mode-operate").click();
    await expect(page.getByTestId("project-mode-operate")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("project-mode-develop")).toHaveAttribute("aria-pressed", "false");

    // Click "insight" mode
    await page.getByTestId("project-mode-insight").click();
    await expect(page.getByTestId("project-mode-insight")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("project-mode-operate")).toHaveAttribute("aria-pressed", "false");
  });
});
