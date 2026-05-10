import { test, expect } from "@playwright/test";

/**
 * /issues system-aggregate page (Wish #21 Slice 4 Phase 1).
 *
 * Drives the dashboard route to verify it renders without error and
 * either shows the empty-state message or the populated issues table.
 * Both states are valid (the registry may be empty on a fresh test
 * VM); spec asserts shape, not specific content.
 */

test.describe("/issues page (Wish #21 Slice 4 Phase 1)", () => {
  test("renders heading + either empty-state or issues panel", async ({ page }) => {
    await page.goto("/issues", { waitUntil: "domcontentloaded" });

    // Page heading present
    await expect(page.locator("h1", { hasText: "Issues" })).toBeVisible({ timeout: 10_000 });

    // Either empty-state copy OR the issues-panel data-testid renders
    const emptyState = page.locator("text=No issues yet");
    const panel = page.getByTestId("issues-panel");
    const eitherVisible = await Promise.race([
      emptyState.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false),
      panel.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false),
    ]);
    expect(eitherVisible).toBe(true);
  });

  test("populated panel shows issue rows when /api/issues returns data", async ({ page }) => {
    // Pre-load API; if the registry has any issues, the populated panel
    // should expose `issue-row` rows. If empty, this test is a no-op.
    const apiR = await page.request.get("/api/issues");
    if (!apiR.ok()) test.skip(true, "API not reachable in this environment");
    const body = await apiR.json() as { issues: { id: string }[] };
    if (body.issues.length === 0) {
      test.skip(true, "No issues to assert against — empty registry");
    }

    await page.goto("/issues", { waitUntil: "domcontentloaded" });
    const rows = page.getByTestId("issue-row");
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
  });
});
