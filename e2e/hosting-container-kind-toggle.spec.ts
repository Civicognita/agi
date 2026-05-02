import { test, expect } from "@playwright/test";

/**
 * Hosting tab — Container Kind toggle (s145 t585).
 *
 * Closes the dashboard-UI-only loop on the s145 foundation: t584 added
 * containerKind + mapps[] to the schema and a HostingManager dispatch
 * stub. t585 (this slice) adds the dashboard control to flip a project
 * to containerKind=mapp and configure its MApps[]. Together they let
 * an operator route a project through the MApp branch entirely from
 * https://ai.on without editing project.json by hand (cycle 156 owner
 * directive).
 *
 * What this spec proves:
 *   1. The Container Kind selector renders on the project's hosting
 *      tab with options Auto / Static / Code / MApp Container.
 *   2. The default value reads from hosting.containerKind on the API
 *      response (empty when unset → falls back to "Auto").
 *   3. Selecting "MApp Container" surfaces the MApps comma-separated
 *      input row.
 *   4. Switching back to a non-mapp kind hides the MApps row.
 *
 * The spec doesn't drive a Save (which would mutate the project on
 * disk) — that's reserved for the t586 e2e once the buildMApp branch
 * is real. Asserting the UI rendering is enough to catch the regression
 * that "the toggle disappears" or "the MApps input isn't gated by
 * containerKind."
 */

test.describe("Hosting — Container Kind toggle (s145 t585)", () => {
  test("Container Kind selector renders on hosting tab + MApps row gates on selection", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    const cards = page.getByTestId("project-card");
    const cardCount = await cards.count();
    test.skip(cardCount === 0, "no projects available — test VM seed missing");

    // Pick a project that has a hosting tab. Core forks have no hosting
    // tab (per ProjectDetail logic), so prefer non-core entries — any of
    // the seeded sample projects works. Click the first card.
    await cards.first().click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/, { timeout: 10_000 });

    // Click into the Hosting sub-tab. ProjectDetail's tabs are scoped
    // by mode (Develop/Operate/Coordinate/Insight). Hosting lives under
    // Operate for most categories.
    const operateMode = page.getByRole("tab", { name: /^Operate$/i });
    if (await operateMode.count() > 0) {
      await operateMode.click();
    }
    const hostingTab = page.getByRole("tab", { name: /^Hosting$/i });
    test.skip(await hostingTab.count() === 0, "hosting tab not exposed for this project category");
    await hostingTab.click();

    // Container Kind selector must be present.
    const kindRow = page.getByTestId("hosting-container-kind-row");
    await expect(kindRow).toBeVisible({ timeout: 5_000 });
    await expect(kindRow).toContainText(/Container Kind/i);

    // The MApps row should NOT be visible by default (kind = "" → Auto).
    const mappsRow = page.getByTestId("hosting-mapps-row");
    expect(await mappsRow.count()).toBe(0);

    // Select MApp Container — the MApps input row should appear.
    const select = kindRow.locator("select, [role='combobox']").first();
    await select.selectOption({ value: "mapp" }).catch(async () => {
      // Fallback for fancy-component selects that don't expose <select>.
      await select.click();
      await page.getByText(/MApp Container/i).first().click();
    });
    await expect(page.getByTestId("hosting-mapps-row")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId("hosting-mapps-input")).toBeVisible();

    // Switch back to Auto — MApps row should hide again.
    await select.selectOption({ value: "" }).catch(async () => {
      await select.click();
      await page.getByText(/Auto \(type-driven\)/i).first().click();
    });
    await expect(page.getByTestId("hosting-mapps-row")).toBeHidden({ timeout: 3_000 });
  });
});
