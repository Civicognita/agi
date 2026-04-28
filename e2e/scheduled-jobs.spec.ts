import { test, expect } from "@playwright/test";

/**
 * Settings → Scheduled Jobs page e2e (s118 t443 D2).
 *
 * System-wide cron manager — lists per-project iterative-work loops +
 * plugin-registered scheduled tasks. Defensive shape: skips checks that
 * depend on environment-specific state (no enabled IW projects, no
 * plugin tasks).
 */

test.describe("Scheduled Jobs page", () => {
  test("page renders at /settings/scheduled-jobs", async ({ page }) => {
    await page.goto("/settings/scheduled-jobs");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("scheduled-jobs-page")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /Scheduled Jobs/i }).first()).toBeVisible();
  });

  test("project IW section renders (table or empty-state)", async ({ page }) => {
    await page.goto("/settings/scheduled-jobs");
    await expect(page.getByTestId("scheduled-jobs-projects")).toBeVisible({ timeout: 10_000 });
  });

  test("plugin tasks section renders (table or empty-state)", async ({ page }) => {
    await page.goto("/settings/scheduled-jobs");
    await expect(page.getByTestId("scheduled-jobs-plugins")).toBeVisible({ timeout: 10_000 });
  });

  test("Settings sidebar exposes Scheduled Jobs entry", async ({ page }) => {
    await page.goto("/settings/gateway");
    await page.waitForLoadState("domcontentloaded");
    const sidebarLink = page.getByRole("link", { name: /Scheduled Jobs/i });
    await expect(sidebarLink).toBeVisible({ timeout: 10_000 });
    await sidebarLink.click();
    await expect(page).toHaveURL(/\/settings\/scheduled-jobs/);
  });
});
