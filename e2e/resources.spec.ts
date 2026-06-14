import { test, expect } from "@playwright/test";

/**
 * Resource Usage e2e tests.
 *
 * Route: /system — mounts ResourcesPage (resources.tsx)
 * Page structure:
 *   - ResourceUsage component: gauge cards (CPU/RAM/Disk) + history charts (ECharts)
 *   - Card sections: Power, CPU per-core activity, GPUs, Running AI models, Database Storage
 *
 * No metric-card testids (metric-cpu/ram/disk/uptime were removed in the
 * ECharts rewrite). The only data-testid is "power-gauge" in PowerGaugeSection.
 * Section headings and history chart headings are the stable assertion surface.
 */

test.describe("Resource Usage", () => {
  test("navigate to /system — page renders without error", async ({ page }) => {
    await page.goto("/system");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10000 });
    // No unhandled error headings
    const errorHeading = page.getByRole("heading", { name: /error/i });
    await expect(errorHeading).toHaveCount(0);
  });

  test("power gauge section is present", async ({ page }) => {
    await page.goto("/system");
    // PowerGaugeSection always renders (shows "—" when RAPL/NVML unavailable on test VM)
    await expect(page.getByTestId("power-gauge")).toBeVisible({ timeout: 10000 });
  });

  test("resource history sections render from ResourceUsage component", async ({ page }) => {
    await page.goto("/system");
    // ResourceUsage renders history chart headings once data loads
    await expect(page.getByRole("heading", { name: "CPU Usage" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("heading", { name: "Memory Usage" })).toBeVisible();
  });

  test("card section headings visible", async ({ page }) => {
    await page.goto("/system");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10000 });
    // Section card headings from resources.tsx (h3 elements)
    await expect(page.getByRole("heading", { name: "Running AI models" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Database Storage" })).toBeVisible();
  });
});
