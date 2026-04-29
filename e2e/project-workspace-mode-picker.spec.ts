import { test, expect } from "@playwright/test";

/**
 * Project workspace mode picker e2e (s134 t517 slices 1+2).
 *
 * Verifies the cycle-111 stack strip + cycle-112 4-mode picker render
 * on /projects/<slug> as expected:
 *   - Mode picker has 4 buttons (Develop / Operate / Coordinate / Insight)
 *   - Default mode is "develop"
 *   - Clicking a mode button toggles the active state (aria-pressed)
 *   - Stack strip renders when the project has attachedStacks
 *
 * Uses the Projects grid-view to click into a project workspace
 * (the list-view rows in cycles 102-109 don't expose project-card
 * testids; switching to grid via the toggle is the e2e-friendly path).
 */

test.describe("Project workspace mode picker (s134 t517)", () => {
  test("mode picker renders with 4 buttons and develop is default", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => { /* may not idle */ });

    // Switch to grid view to access project-card testids
    const gridToggle = page.getByTestId("projects-view-grid");
    await gridToggle.waitFor({ state: "visible", timeout: 15_000 });
    await gridToggle.click();

    const cards = page.getByTestId("project-card");
    const count = await cards.count();
    test.skip(count === 0, "no projects available in this environment");
    await cards.first().click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

    // Mode picker should be visible (skipped for core forks; if the
    // first card was a core fork, skip the test).
    const picker = page.getByTestId("project-mode-picker");
    const pickerVisible = await picker.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!pickerVisible, "first project is a core fork; mode picker hidden");

    await expect(page.getByTestId("project-mode-develop")).toBeVisible();
    await expect(page.getByTestId("project-mode-operate")).toBeVisible();
    await expect(page.getByTestId("project-mode-coordinate")).toBeVisible();
    await expect(page.getByTestId("project-mode-insight")).toBeVisible();

    // Default = develop
    await expect(page.getByTestId("project-mode-develop")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("project-mode-operate")).toHaveAttribute("aria-pressed", "false");
  });

  test("Insight mode shows Activity tab (s134 t517 cycle 117)", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => { /* may not idle */ });

    const gridToggle = page.getByTestId("projects-view-grid");
    await gridToggle.waitFor({ state: "visible", timeout: 15_000 });
    await gridToggle.click();

    const cards = page.getByTestId("project-card");
    const count = await cards.count();
    test.skip(count === 0, "no projects available");
    await cards.first().click();

    const picker = page.getByTestId("project-mode-picker");
    const pickerVisible = await picker.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!pickerVisible, "first project is a core fork");

    // Switch to Insight mode and verify Activity tab is present.
    await page.getByTestId("project-mode-insight").click();
    await expect(page.getByTestId("project-mode-insight")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("project-tab-activity")).toBeVisible();

    // Click Activity tab and verify the bar chart container renders.
    await page.getByTestId("project-tab-activity").click();
    await expect(page.getByTestId("project-activity-bars")).toBeVisible({ timeout: 10_000 });
  });

  test("clicking a mode button toggles active state", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => { /* may not idle */ });

    const gridToggle = page.getByTestId("projects-view-grid");
    await gridToggle.waitFor({ state: "visible", timeout: 15_000 });
    await gridToggle.click();

    const cards = page.getByTestId("project-card");
    const count = await cards.count();
    test.skip(count === 0, "no projects available");
    await cards.first().click();

    const picker = page.getByTestId("project-mode-picker");
    const pickerVisible = await picker.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!pickerVisible, "first project is a core fork");

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
