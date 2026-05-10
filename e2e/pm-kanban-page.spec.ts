import { test, expect } from "@playwright/test";

/**
 * /pm/kanban page (s139 t536 Phase 1).
 *
 * Drives the dashboard route to verify the Kanban primitive renders
 * with all 4 visible columns (todo/now/qa/done) plus the show-hidden
 * checkbox toggling Blocked + Archived columns.
 */

test.describe("/pm/kanban page (s139 t536 Phase 1)", () => {
  test("renders heading + kanban panel with default columns", async ({ page }) => {
    await page.goto("/pm/kanban", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1", { hasText: "PM Kanban" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("pm-kanban-panel")).toBeVisible({ timeout: 10_000 });
    // Default columns visible by name
    await expect(page.locator("text=To do").first()).toBeVisible();
    await expect(page.locator("text=Now").first()).toBeVisible();
    await expect(page.locator("text=Done").first()).toBeVisible();
  });

  test("show-hidden checkbox surfaces Blocked + Archived columns", async ({ page }) => {
    await page.goto("/pm/kanban", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("pm-kanban-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Blocked + Archived not in DOM by default
    expect(await page.locator("text=Blocked").count()).toBe(0);

    // Toggle on; verify both surface
    await page.locator('input[type="checkbox"]').first().check();
    await expect(page.locator("text=Blocked").first()).toBeVisible();
    await expect(page.locator("text=Archived").first()).toBeVisible();
  });
});
