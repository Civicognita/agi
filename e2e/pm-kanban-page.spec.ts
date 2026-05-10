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

  test("Phase 3 — view-mode toggle swaps between Kanban + List", async ({ page }) => {
    await page.goto("/pm/kanban", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("pm-kanban-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Default: kanban view; List variant not rendered
    expect(await page.getByTestId("pm-kanban-list").count()).toBe(0);

    // Click List → table renders
    await page.getByTestId("view-mode-list").click();
    await expect(page.getByTestId("pm-kanban-list")).toBeVisible();

    // Click Kanban → table goes away
    await page.getByTestId("view-mode-kanban").click();
    expect(await page.getByTestId("pm-kanban-list").count()).toBe(0);
  });
});

/**
 * s139 t542 — kanban e2e from per-project Operate sub-surface.
 *
 * The /pm/kanban system-aggregate page is already covered above. This
 * suite drives the same panel from inside a project's coordinate-mode
 * tab strip (s139 t538 wired the PM tab there). Skips when no project
 * with the PM tab visible exists in the test environment.
 */
test.describe("PM kanban from per-project Operate tab (s139 t542)", () => {
  test("Operate → PM tab renders the kanban panel", async ({ page }) => {
    const apiR = await page.request.get("/api/projects");
    if (!apiR.ok()) test.skip(true, "API not reachable");
    const list = await apiR.json() as { name: string }[] | { projects?: { name: string }[] };
    const projects = Array.isArray(list) ? list : (list.projects ?? []);
    if (projects.length === 0) test.skip(true, "No projects in workspace");

    const firstProject = projects[0]?.name;
    if (!firstProject) test.skip(true, "No project name available");
    await page.goto(`/projects/${firstProject}`, { waitUntil: "domcontentloaded" });

    const pmTab = page.getByTestId("project-tab-pm");
    if (!(await pmTab.isVisible({ timeout: 5_000 }).catch(() => false))) {
      const coordinateMode = page.locator('[aria-pressed]').filter({ hasText: /coordinate/i }).first();
      if (await coordinateMode.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await coordinateMode.click();
      }
    }
    if (!(await pmTab.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, "PM tab not visible on this project (mode/category restrictions)");
    }
    await pmTab.click();
    await expect(page.getByTestId("pm-kanban-panel")).toBeVisible({ timeout: 10_000 });
  });
});
