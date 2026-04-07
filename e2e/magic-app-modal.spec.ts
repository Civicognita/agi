import { test, expect } from "@playwright/test";

test.describe("MagicApp Admin", () => {
  test("admin page renders", async ({ page }) => {
    await page.goto("/magic-apps/admin");
    // Wait for the heading to appear (the page renders async content)
    await expect(page.getByRole("heading", { name: "MagicApps", level: 1 })).toBeVisible({ timeout: 10_000 });
  });
});
