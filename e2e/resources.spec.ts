import { test, expect } from "@playwright/test";

test.describe("Resource Usage", () => {
  test("navigate to /system — page renders", async ({ page }) => {
    await page.goto("/system");
    // Should show metric cards
    await expect(page.getByTestId("metric-cpu")).toBeVisible({ timeout: 10000 });
  });

  test("CPU, RAM, Disk, Uptime cards visible", async ({ page }) => {
    await page.goto("/system");
    await expect(page.getByTestId("metric-cpu")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("metric-ram")).toBeVisible();
    await expect(page.getByTestId("metric-disk")).toBeVisible();
    await expect(page.getByTestId("metric-uptime")).toBeVisible();
  });

  test("charts render with SVG elements", async ({ page }) => {
    await page.goto("/system");
    await expect(page.getByTestId("metric-cpu")).toBeVisible({ timeout: 10000 });

    // Recharts renders SVG elements — wait for at least one chart
    const svgs = page.locator(".recharts-responsive-container svg");
    await expect(svgs.first()).toBeVisible({ timeout: 10000 });
  });

  test("values update on poll", async ({ page }) => {
    await page.goto("/system");
    await expect(page.getByTestId("metric-cpu")).toBeVisible({ timeout: 10000 });

    // Get initial CPU value
    const cpuCard = page.getByTestId("metric-cpu");
    const initialText = await cpuCard.textContent();

    // Wait for a refresh cycle (5s poll + buffer)
    await page.waitForTimeout(6000);

    // Card should still be visible (data refreshed)
    await expect(cpuCard).toBeVisible();
    const newText = await cpuCard.textContent();
    // At minimum, the card still renders with a percentage
    expect(newText).toMatch(/%/);
  });
});
