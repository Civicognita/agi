import { test, expect } from "@playwright/test";

/**
 * /projects PAx sacred card e2e (s136 t522).
 *
 * Verifies the PAx sacred portal card renders next to the Aionima
 * sacred card on /projects when contributing-mode is on, and that
 * clicking it navigates to /settings/gateway (Contributing tab is the
 * canonical drill-down for per-fork details).
 *
 * Skips gracefully when contributing-mode isn't enabled (test VM
 * doesn't have GitHub OAuth wired).
 */

test.describe("/projects — PAx sacred card (s136 t522)", () => {
  test("renders PAx sacred card alongside Aionima card when contributing-mode is on", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const badge = page.getByText("Contributing", { exact: true });
    // Wait up to 15s for the contributing-mode badge to materialize
    // (header data depends on /api/dev/status fetch). isVisible at t=0
    // races the network round-trip.
    await badge.waitFor({ state: "visible", timeout: 15_000 }).catch(() => { /* may not be on */ });
    const devModeOn = await badge.isVisible().catch(() => false);
    test.skip(!devModeOn, "Contributing mode not enabled — skipping PAx sacred card assertion");

    await page.goto("/projects");

    // Both sacred sections should be visible.
    await expect(page.getByTestId("project-card-aionima")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("project-card-pax")).toBeVisible({ timeout: 10_000 });

    // PAx card should display the four package names in its description.
    const paxCard = page.getByTestId("project-card-pax");
    await expect(paxCard).toContainText("react-fancy");
    await expect(paxCard).toContainText("fancy-code");
    await expect(paxCard).toContainText("fancy-sheets");
    await expect(paxCard).toContainText("fancy-echarts");
  });

  test("clicking the PAx card navigates to /settings/gateway", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='app-sidebar']", { timeout: 10_000 });
    const devModeOn = await page.getByText("Contributing", { exact: true }).isVisible().catch(() => false);
    test.skip(!devModeOn, "Contributing mode not enabled");

    await page.goto("/projects");
    await page.getByTestId("project-card-pax").click();
    await expect(page).toHaveURL(/\/settings\/gateway/);
  });

  test("PAx fork projects do NOT appear as regular project tiles", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='app-sidebar']", { timeout: 10_000 });
    const devModeOn = await page.getByText("Contributing", { exact: true }).isVisible().catch(() => false);
    test.skip(!devModeOn, "Contributing mode not enabled");

    await page.goto("/projects");

    // Regular project tiles use data-testid="project-card". The PAx
    // forks (react-fancy/fancy-code/fancy-sheets/fancy-echarts) should
    // be filtered OUT of these tiles — they only appear inside the
    // PAx sacred card.
    const regularTiles = page.getByTestId("project-card");
    const tileCount = await regularTiles.count();
    for (let i = 0; i < tileCount; i++) {
      const text = await regularTiles.nth(i).textContent();
      expect(text).not.toMatch(/^react-fancy$/i);
      expect(text).not.toMatch(/^fancy-code$/i);
      expect(text).not.toMatch(/^fancy-sheets$/i);
      expect(text).not.toMatch(/^fancy-echarts$/i);
    }
  });
});
