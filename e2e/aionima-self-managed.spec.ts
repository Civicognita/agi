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

  // Regression for v0.4.664 fix (Wish #22/#23) — the existing "click navigates
  // to URL" test passes even when ProjectDetail can't resolve the slug back
  // to a project. The owner-reported bug was: click → URL `/projects/_aionima`
  // → ProjectDetail fallback to 404 because `projectSlug()` regex stripped the
  // leading underscore. This test asserts the FULL roundtrip: click → URL →
  // ProjectDetail actually renders (Details tab visible).
  test("clicking Sacred card renders ProjectDetail end-to-end (slug roundtrip regression)", async ({ page }) => {
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await page.getByTestId("project-card-aionima").click();
    await expect(page).toHaveURL(/\/projects\/_aionima(\?|#|$)/, { timeout: 10_000 });
    await expect(page.getByRole("tab", { name: /Details/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  // Regression for v0.4.664 filter fix — `_aionima/` is the meta-project and
  // must NEVER appear in the regular projects list (only as the Sacred card).
  // Pre-fix: `_aionima` enumerated with auto-detected type "static-site",
  // bypassed the isAionimaProject filter, and rendered as a regular row.
  test("_aionima must not appear in the regular projects list/grid", async ({ page }) => {
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("project-card-aionima")).toBeVisible({ timeout: 10_000 });
    // No regular project tile/row should carry an _aionima slug. The list view
    // emits stable testids `project-repos-{slug}`, `project-stacks-{slug}`,
    // etc. — none of those should appear for `_aionima`.
    expect(await page.getByTestId("project-repos-_aionima").count()).toBe(0);
    expect(await page.getByTestId("project-stacks-_aionima").count()).toBe(0);
    expect(await page.getByTestId("project-tynn-_aionima").count()).toBe(0);
  });
});
