import { test, expect } from "@playwright/test";

/**
 * /sync-conflicts page (s155 t672 Phase 5b).
 *
 * Drives the dashboard route to verify it renders + either shows the
 * empty-state copy or the populated conflicts table. Both states are
 * valid (the conflict log is empty until layered-writes is enabled
 * AND the sync-replay worker detects divergence).
 */

test.describe("/sync-conflicts page (s155 t672 Phase 5b)", () => {
  test("renders heading + either empty-state or conflicts panel", async ({ page }) => {
    await page.goto("/sync-conflicts", { waitUntil: "domcontentloaded" });

    await expect(page.locator("h1", { hasText: "Sync Conflicts" })).toBeVisible({ timeout: 10_000 });

    const emptyState = page.locator("text=No conflicts yet");
    const panel = page.getByTestId("sync-conflicts-panel");
    const eitherVisible = await Promise.race([
      emptyState.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false),
      panel.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false),
    ]);
    expect(eitherVisible).toBe(true);
  });

  test("populated panel shows conflict-row entries when API returns data", async ({ page }) => {
    const apiR = await page.request.get("/api/pm/sync-conflicts");
    if (!apiR.ok()) test.skip(true, "API not reachable in this environment");
    const body = await apiR.json() as { conflicts: { id: string }[] };
    if (body.conflicts.length === 0) {
      test.skip(true, "No conflicts to assert against — empty log");
    }

    await page.goto("/sync-conflicts", { waitUntil: "domcontentloaded" });
    const rows = page.getByTestId("conflict-row");
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
  });
});
