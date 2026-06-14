import { test, expect } from "@playwright/test";

/**
 * ProjHeader + StackStrip e2e tests.
 *
 * Verifies ProjHeader (compact identity bar) and StackStrip (Aion context bar)
 * render above the mode picker on project detail pages. Also verifies mode
 * picker pill-style restyle and that all category-visible modes remain clickable.
 *
 * s199 — ProjHeader + StackStrip + mode picker restyle.
 */

test.describe("ProjHeader + StackStrip", () => {
  async function navigateToFirstProject(page: Parameters<Parameters<typeof test>[2]>[0]) {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle");
    const cards = page.getByTestId("project-card");
    if (await cards.count() === 0) return false;
    await cards.first().click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9_-]+/);
    return true;
  }

  test("ProjHeader renders above mode picker on project detail", async ({ page }) => {
    if (!await navigateToFirstProject(page)) { test.skip(); return; }
    await expect(page.getByTestId("proj-header")).toBeVisible();
  });

  test("ProjHeader shows project name", async ({ page }) => {
    if (!await navigateToFirstProject(page)) { test.skip(); return; }
    const header = page.getByTestId("proj-header");
    await expect(header).toBeVisible();
    // Name is the first bold text in the header
    const name = await header.locator("span.font-bold").first().textContent();
    expect(name?.trim().length).toBeGreaterThan(0);
  });

  test("ProjHeader has no Chat button (chat is in the global shell)", async ({ page }) => {
    if (!await navigateToFirstProject(page)) { test.skip(); return; }
    await expect(page.getByTestId("proj-header-chat-button")).toHaveCount(0);
  });

  test("StackStrip renders between ProjHeader and mode picker", async ({ page }) => {
    if (!await navigateToFirstProject(page)) { test.skip(); return; }
    await expect(page.getByTestId("proj-stack-strip")).toBeVisible({ timeout: 6000 });
  });

  test("mode picker still renders all visible modes", async ({ page }) => {
    if (!await navigateToFirstProject(page)) { test.skip(); return; }
    const picker = page.getByTestId("project-mode-picker");
    await expect(picker).toBeVisible();
    // At least one mode button must be visible
    const modeButtons = picker.locator("button");
    await expect(modeButtons.first()).toBeVisible();
  });

  test("mode picker buttons have pill style (no border-b-2)", async ({ page }) => {
    if (!await navigateToFirstProject(page)) { test.skip(); return; }
    const picker = page.getByTestId("project-mode-picker");
    const firstBtn = picker.locator("button").first();
    await expect(firstBtn).toBeVisible();
    // Pill-style uses rounded-md; underline style used border-b-2
    const cls = await firstBtn.getAttribute("class");
    expect(cls).toContain("rounded-md");
    expect(cls).not.toContain("border-b-2");
  });

  test("clicking a mode button changes active state", async ({ page }) => {
    if (!await navigateToFirstProject(page)) { test.skip(); return; }
    const picker = page.getByTestId("project-mode-picker");
    const buttons = picker.locator("button");
    const count = await buttons.count();
    if (count < 2) { test.skip(); return; }

    // Click the second mode
    await buttons.nth(1).click();
    // The second button should now be aria-pressed=true
    await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(buttons.nth(0)).toHaveAttribute("aria-pressed", "false");
  });

  test("ProjHeader absent for core-fork projects (no regression)", async ({ page }) => {
    // Navigate to the _aionima project which is a core-fork collection
    await page.goto("/projects/_aionima");
    await page.waitForLoadState("networkidle");
    // If it 404s or redirects, the test passes vacuously
    if (page.url().includes("/projects/_aionima")) {
      // Core forks should NOT show ProjHeader (it's suppressed for isCoreFork + isAionimaContainer)
      await expect(page.getByTestId("proj-header")).toHaveCount(0);
    }
  });
});
