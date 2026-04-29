import { test, expect } from "@playwright/test";

/**
 * /projects list view + viewMode toggle e2e (s130 t516 slice 1).
 *
 * Verifies that the new list/grid toggle renders + works, with list
 * being the new default per the projects-ux-v2 mockup.
 */

test.describe("/projects list view (s130 t516 slice 1)", () => {
  test("list is the default view; table renders with project rows", async ({ page }) => {
    await page.goto("/projects");
    // Wait for the toggle to materialize (depends on /api/projects fetch)
    const toggle = page.getByTestId("projects-view-toggle");
    await toggle.waitFor({ state: "visible", timeout: 10_000 });

    // Default = list; the list mode dataset must be visible.
    await expect(page.getByTestId("projects-list")).toBeVisible();
    await expect(page.getByTestId("projects-view-list")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("projects-view-grid")).toHaveAttribute("aria-pressed", "false");
  });

  test("clicking grid toggle switches to card layout", async ({ page }) => {
    await page.goto("/projects");
    await page.getByTestId("projects-view-toggle").waitFor({ state: "visible", timeout: 10_000 });

    await page.getByTestId("projects-view-grid").click();
    await expect(page.getByTestId("projects-view-grid")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("projects-view-list")).toHaveAttribute("aria-pressed", "false");
    // List dataset goes away; project-cards (grid mode) should appear when there are projects.
    await expect(page.getByTestId("projects-list")).not.toBeVisible();
  });

  test("toggling back to list returns the table layout", async ({ page }) => {
    await page.goto("/projects");
    await page.getByTestId("projects-view-toggle").waitFor({ state: "visible", timeout: 10_000 });

    await page.getByTestId("projects-view-grid").click();
    await page.getByTestId("projects-view-list").click();
    await expect(page.getByTestId("projects-list")).toBeVisible();
  });
});
