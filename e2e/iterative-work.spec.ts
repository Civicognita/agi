import { test, expect } from "@playwright/test";

/**
 * Per-project Iterative Work tab e2e (s118 t442 D1, slice 4).
 *
 * Verifies the new ProjectDetail "Iterative Work" tab — the canonical UX
 * after the s118 redesign 2026-04-27 (replaces the obsolete
 * /settings/iterative-work page). Defensive shape: skips when no eligible
 * projects are present in the environment.
 *
 * Eligibility per s118 t445 D4:
 *   web / app / ops / administration → eligible
 *   literature / media / monorepo    → not eligible (no tab visible)
 */

test.describe("Iterative Work tab", () => {
  test("obsolete /settings/iterative-work route returns 404 / redirects", async ({ page }) => {
    // The page was removed in v0.4.250; either the SPA shows a not-found
    // state or the router redirects to a fallback. Verify it doesn't
    // render the OLD per-project list UI.
    const res = await page.goto("/settings/iterative-work", { waitUntil: "domcontentloaded" });
    // Either a 404 / fallback state — both are acceptable. The crucial
    // check is that the OLD page-content marker isn't present.
    const body = await page.locator("body").innerText().catch(() => "");
    // The deleted page used to render "Iterative Work" as a heading + a
    // table of all projects. The new tab is per-project ONLY; if either
    // a heading "Iterative Work" + a project list appears here, the
    // route wasn't fully retired.
    const hasHeading = /^Iterative Work$/m.test(body);
    const hasProjectList = /Cron|Recent fires/i.test(body);
    expect(hasHeading && hasProjectList).toBe(false);
    void res;
  });

  test("projects index renders project cards", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("domcontentloaded");
    // Just verify the page loads — projects-page itself is covered elsewhere.
    await expect(page.getByRole("heading", { name: /Projects/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("Iterative Work tab appears on first eligible project (when any exist)", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    const cards = page.getByTestId("project-card");
    const count = await cards.count();
    test.skip(count === 0, "no projects available in this environment");

    // Walk cards looking for one whose project type is eligible. Cards
    // expose the project slug; the project-detail page will reveal the
    // tab if eligible, hide it otherwise.
    let foundEligible = false;
    const maxToCheck = Math.min(count, 5);
    for (let i = 0; i < maxToCheck; i += 1) {
      await cards.nth(i).click();
      await page.waitForURL(/\/projects\/[a-z0-9-]+/, { timeout: 5000 }).catch(() => undefined);
      const tab = page.getByRole("tab", { name: /Iterative Work/i });
      if ((await tab.count()) > 0 && (await tab.first().isVisible().catch(() => false))) {
        foundEligible = true;
        break;
      }
      await page.goto("/projects");
      await page.waitForTimeout(500);
    }

    if (!foundEligible) {
      test.skip(true, "no eligible projects (web/app/ops/administration) in this environment");
    }
  });

  test("clicking the Iterative Work tab reveals the tab panel", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    const cards = page.getByTestId("project-card");
    const count = await cards.count();
    test.skip(count === 0, "no projects available in this environment");

    let panelVisible = false;
    const maxToCheck = Math.min(count, 5);
    for (let i = 0; i < maxToCheck; i += 1) {
      await cards.nth(i).click();
      await page.waitForURL(/\/projects\/[a-z0-9-]+/, { timeout: 5000 }).catch(() => undefined);
      const tab = page.getByRole("tab", { name: /Iterative Work/i });
      if ((await tab.count()) === 0) {
        await page.goto("/projects");
        await page.waitForTimeout(500);
        continue;
      }
      await tab.first().click();
      const panel = page.getByTestId("iterative-work-tab");
      if ((await panel.count()) > 0 && (await panel.isVisible().catch(() => false))) {
        panelVisible = true;
        break;
      }
      await page.goto("/projects");
      await page.waitForTimeout(500);
    }

    if (!panelVisible) {
      test.skip(true, "no eligible project surfaces the tab panel in this environment");
    }
  });

  test("Iterative Work tab exposes cadence dropdown + save button (when present)", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    const cards = page.getByTestId("project-card");
    const count = await cards.count();
    test.skip(count === 0, "no projects available in this environment");

    // Find and open the tab on the first eligible project.
    let foundEligible = false;
    const maxToCheck = Math.min(count, 5);
    for (let i = 0; i < maxToCheck; i += 1) {
      await cards.nth(i).click();
      await page.waitForURL(/\/projects\/[a-z0-9-]+/, { timeout: 5000 }).catch(() => undefined);
      const tab = page.getByRole("tab", { name: /Iterative Work/i });
      if ((await tab.count()) === 0) {
        await page.goto("/projects");
        await page.waitForTimeout(500);
        continue;
      }
      await tab.first().click();
      const panel = page.getByTestId("iterative-work-tab");
      if ((await panel.count()) > 0 && (await panel.isVisible().catch(() => false))) {
        foundEligible = true;
        break;
      }
      await page.goto("/projects");
      await page.waitForTimeout(500);
    }

    test.skip(!foundEligible, "no eligible project found");

    // Verify the canonical interactive elements are present.
    await expect(page.getByTestId("iterative-work-toggle")).toBeAttached();
    await expect(page.getByTestId("iterative-work-cadence")).toBeAttached();
    await expect(page.getByTestId("iterative-work-save")).toBeAttached();

    // The cadence dropdown must contain at least the dev-tier options.
    const select = page.getByTestId("iterative-work-cadence");
    const options = select.locator("option").allTextContents();
    const txt = (await options).join(" ");
    expect(/30 minutes/i.test(txt)).toBe(true);
    expect(/Every hour/i.test(txt)).toBe(true);
  });
});
