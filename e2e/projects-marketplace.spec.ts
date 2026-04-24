import { test, expect } from "@playwright/test";

// Dashboard hydration + initial API calls on /projects take noticeably longer
// in the test VM (~10s) than on a dev host. The default 5s expect timeout is
// too aggressive for that environment; bump every expect in this file to 15s.
test.use({
  // Playwright's test.use doesn't expose expect timeout directly — handled
  // per-assertion below. The describe-level default test timeout stays at 30s.
});

async function openProjects(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/projects");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
    // Some dashboards keep a WS connection open — networkidle never fully
    // settles. Fall through and rely on the per-assertion waits below.
  });
}

test.describe("Projects page — Marketplace section", () => {
  test("both Marketplace tiles render with testids", async ({ page }) => {
    await openProjects(page);

    const section = page.getByTestId("marketplace-section");
    await expect(section).toBeVisible({ timeout: 15_000 });

    const plugins = page.getByTestId("marketplace-tile-plugins");
    const magicapps = page.getByTestId("marketplace-tile-magicapps");
    await expect(plugins).toBeVisible({ timeout: 15_000 });
    await expect(magicapps).toBeVisible({ timeout: 15_000 });

    await expect(plugins).toContainText("Plugins");
    await expect(magicapps).toContainText("MagicApps");

    const pluginCount = page.getByTestId("marketplace-tile-plugins-count");
    const mappCount = page.getByTestId("marketplace-tile-magicapps-count");
    await expect(pluginCount).toBeVisible({ timeout: 15_000 });
    await expect(mappCount).toBeVisible({ timeout: 15_000 });
  });

  test("clicking Plugins tile navigates to /gateway/marketplace", async ({ page }) => {
    await openProjects(page);
    // Wait for the counts useEffect to settle so the tile doesn't detach mid-click
    await expect(page.getByTestId("marketplace-tile-plugins-count")).not.toHaveText("…", { timeout: 15_000 });
    await page.getByTestId("marketplace-tile-plugins").click();
    await expect(page).toHaveURL(/\/gateway\/marketplace/);
  });

  test("clicking MagicApps tile navigates to /magic-apps", async ({ page }) => {
    await openProjects(page);
    await expect(page.getByTestId("marketplace-tile-magicapps-count")).not.toHaveText("…", { timeout: 15_000 });
    await page.getByTestId("marketplace-tile-magicapps").click();
    await expect(page).toHaveURL(/\/magic-apps(?!\/)/);
  });
});
