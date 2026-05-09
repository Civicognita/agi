/**
 * Project Details tab — sub-tabs walk (s140 t592 phase 1).
 *
 * Locks in the cycle-176 owner-chosen UX shape: tabbed sub-pages
 * inside the outer Details tab. Owner-clarified principle:
 * "the details tab should not show stuff that other tabs are showing".
 *
 * Pass criteria:
 *   - The 3 sub-tab triggers (Identity / Configuration / Lifecycle)
 *     render with their stable testids.
 *   - Identity sub-tab is the default landing — its content (name input
 *     + path display) is visible.
 *   - Configuration sub-tab can be activated; its content (purpose +
 *     project type selects) renders.
 *   - Lifecycle sub-tab can be activated; its Danger Zone content
 *     (Delete Project button) renders.
 *   - Switching sub-tabs hides the previous pane's content (no leakage
 *     across panes).
 *   - The Tynn token field stays absent (cycle-169 t591 fix preserved).
 *
 * Run via:
 *   agi test --e2e walk/project-details-subtabs
 */

import { test, expect } from "@playwright/test";

test.describe("Project Details — sub-tabs (s140 t592 phase 1)", () => {
  test("Identity / Configuration / Lifecycle sub-tabs render + switch", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto("/projects/civicognita-ops");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Sub-tabs container + 3 pills.
    const subTabsContainer = page.getByTestId("details-sub-tabs");
    await expect(subTabsContainer, "details-sub-tabs container must render").toBeVisible({ timeout: 10_000 });

    const idTab = page.getByTestId("details-sub-tab-identity");
    const cfgTab = page.getByTestId("details-sub-tab-configuration");
    const lcTab = page.getByTestId("details-sub-tab-lifecycle");
    await expect(idTab).toBeVisible();
    await expect(cfgTab).toBeVisible();
    await expect(lcTab).toBeVisible();

    // Default landing — Identity pane visible. Configuration + Lifecycle
    // panes NOT visible (single-pane render at a time).
    const idPane = page.getByTestId("details-sub-pane-identity");
    const cfgPane = page.getByTestId("details-sub-pane-configuration");
    const lcPane = page.getByTestId("details-sub-pane-lifecycle");

    await expect(idPane, "Identity pane is the default landing").toBeVisible();
    await expect(cfgPane, "Configuration pane is hidden initially").toHaveCount(0);
    await expect(lcPane, "Lifecycle pane is hidden initially").toHaveCount(0);

    // Identity pane content — name input + path display.
    await expect(page.getByTestId("project-name-input"), "name input is in Identity pane").toBeVisible();
    await expect(page.getByTestId("project-path-display"), "path display is in Identity pane").toBeVisible();

    // Tynn token field stays absent (cycle-169 t591 — not in any sub-tab).
    await expect(
      page.getByTestId("project-token-input"),
      "Tynn token field must NOT render in any sub-tab (owner-clarified)",
    ).toHaveCount(0);

    // Switch to Configuration.
    await cfgTab.click();
    await expect(cfgPane, "Configuration pane visible after click").toBeVisible();
    await expect(idPane, "Identity pane hidden after switch").toHaveCount(0);

    // Switch to Lifecycle.
    await lcTab.click();
    await expect(lcPane, "Lifecycle pane visible after click").toBeVisible();
    await expect(cfgPane, "Configuration pane hidden after switch").toHaveCount(0);

    // Lifecycle should expose the Delete affordance (Danger Zone).
    await expect(
      page.getByTestId("details-lifecycle-delete"),
      "Delete Project button is in Lifecycle pane",
    ).toBeVisible();

    expect(pageErrors, `pageerrors: ${pageErrors.join(" | ")}`).toEqual([]);
  });
});
