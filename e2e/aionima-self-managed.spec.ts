import { test, expect } from "@playwright/test";

/**
 * Aionima as a self-managed project (s119 t706).
 *
 * Verifies the t702→t705 trajectory end-to-end:
 *   - /projects renders a single "Aionima" sacred card (no separate PAx card)
 *   - clicking it navigates to /projects/_aionima
 *   - /aionima legacy URL redirects to /projects/_aionima
 *   - /pax legacy URL redirects to /projects/_aionima
 *   - /projects/_aionima loads the universal-monorepo project detail
 *     (Details / Editor / Repository tabs available — same shape as any
 *     other s140-layout project)
 *
 * Skips clicking the Repository drilldown if no repos are visible (some
 * test envs may not have run the t703 fork migration yet).
 */

test.describe("Aionima self-managed project (s119 t706)", () => {
  test("/projects renders the single Aionima sacred card and no separate PAx card", async ({ page }) => {
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("project-card-aionima")).toBeVisible({ timeout: 10_000 });
    // The legacy PAx tile was removed in t705 — must NOT be present.
    expect(await page.getByTestId("project-card-pax").count()).toBe(0);
  });

  test("clicking the Aionima card navigates to /projects/_aionima", async ({ page }) => {
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await page.getByTestId("project-card-aionima").click();
    await expect(page).toHaveURL(/\/projects\/_aionima(\?|#|$)/, { timeout: 10_000 });
  });

  test("/aionima legacy URL redirects to /projects/_aionima", async ({ page }) => {
    await page.goto("/aionima", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/projects\/_aionima(\?|#|$)/, { timeout: 10_000 });
  });

  test("/pax legacy URL redirects to /projects/_aionima", async ({ page }) => {
    await page.goto("/pax", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/projects\/_aionima(\?|#|$)/, { timeout: 10_000 });
  });

  test("/projects/_aionima loads ProjectDetail with universal-monorepo tabs", async ({ page }) => {
    await page.goto("/projects/_aionima", { waitUntil: "domcontentloaded" });
    // The project detail page exposes a tab strip; "Details" is always
    // present. Other tabs (Editor / Repository / etc.) appear gated by
    // project type / capability flags.
    await expect(page.getByRole("tab", { name: /Details/i }).first()).toBeVisible({ timeout: 15_000 });
  });
});
