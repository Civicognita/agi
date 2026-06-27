import { test, expect } from "@playwright/test";

/**
 * Contribute page (Wave 2 s229) — Contributing moved out of Settings → Gateway
 * into its own /contribute page with Outbound / Incoming / Repos & Mode tabs.
 */
test.describe("Contribute page", () => {
  test("loads at /contribute with the three tabs", async ({ page }) => {
    await page.goto("/contribute");
    await expect(page.getByTestId("contribute-page")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("contribute-tab-outbound")).toBeVisible();
    await expect(page.getByTestId("contribute-tab-incoming")).toBeVisible();
    await expect(page.getByTestId("contribute-tab-repos")).toBeVisible();
  });

  test("Settings → Gateway Contributing tab points to the new page", async ({ page }) => {
    await page.goto("/settings/gateway");
    await page.getByRole("tab", { name: "Contributing" }).click();
    const link = page.getByTestId("contribute-page-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/contribute");
  });
});
