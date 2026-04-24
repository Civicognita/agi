import { test, expect } from "@playwright/test";

test.describe("Projects page — Marketplace section", () => {
  test("both Marketplace tiles render with testids", async ({ page }) => {
    await page.goto("/projects");

    const section = page.getByTestId("marketplace-section");
    await expect(section).toBeVisible();

    const plugins = page.getByTestId("marketplace-tile-plugins");
    const magicapps = page.getByTestId("marketplace-tile-magicapps");
    await expect(plugins).toBeVisible();
    await expect(magicapps).toBeVisible();

    await expect(plugins).toContainText("Plugins");
    await expect(magicapps).toContainText("MagicApps");

    const pluginCount = page.getByTestId("marketplace-tile-plugins-count");
    const mappCount = page.getByTestId("marketplace-tile-magicapps-count");
    await expect(pluginCount).toBeVisible();
    await expect(mappCount).toBeVisible();
  });

  test("clicking Plugins tile navigates to /gateway/marketplace", async ({ page }) => {
    await page.goto("/projects");
    await page.getByTestId("marketplace-tile-plugins").click();
    await expect(page).toHaveURL(/\/gateway\/marketplace/);
  });

  test("clicking MagicApps tile navigates to /magic-apps", async ({ page }) => {
    await page.goto("/projects");
    await page.getByTestId("marketplace-tile-magicapps").click();
    await expect(page).toHaveURL(/\/magic-apps(?!\/)/);
  });
});
