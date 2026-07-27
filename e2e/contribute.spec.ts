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

  // Wave 2b (s229): contribution metrics strip — merged/open/repos/total.
  test("metrics strip renders merged/open/repos/total counts", async ({ page }) => {
    await page.route("**/api/dev/contribute/metrics", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ownerLogin: "wishborn",
          repos: [
            { slug: "agi", displayName: "agi", merged: 3, open: 1, total: 4 },
            { slug: "prime", displayName: "prime", merged: 0, open: 0, total: 0 },
          ],
          totals: { merged: 3, open: 1, total: 4 },
        }),
      }),
    );

    await page.goto("/contribute");
    await expect(page.getByTestId("contribute-page")).toBeVisible({ timeout: 10_000 });

    const strip = page.getByTestId("contribute-metrics");
    await expect(strip).toBeVisible({ timeout: 8_000 });
    await expect(strip).toContainText("3"); // Accepted (merged)
    await expect(strip).toContainText("1"); // Open PRs
    await expect(strip).toContainText("4"); // Total PRs
    await expect(strip).toContainText("Repos contributed");
  });
});
