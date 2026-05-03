import { test, expect } from "@playwright/test";

/**
 * s137 t529 — Header help button e2e.
 *
 * Verifies the dashboard's universal help button:
 *   - Renders in the header (testid header-help-button)
 *   - Has accessible name "Open help chat"
 *   - Clicking it opens the chat flyout
 *
 * Page-context wiring (t530) and Support Canvas (t531) tests follow in
 * later slices when those pieces ship. This spec asserts the entry-point
 * shape only.
 */

test.describe("Header help button (s137 t529)", () => {
  test("help button renders in header on /projects", async ({ page }) => {
    await page.goto("/projects");
    const help = page.getByTestId("header-help-button");
    await expect(help).toBeVisible();
    await expect(help).toHaveAttribute("aria-label", "Open help chat");
  });

  test("clicking help button opens chat flyout", async ({ page }) => {
    await page.goto("/projects");
    await page.getByTestId("header-help-button").click();

    // Chat button toggles to its active state once the flyout is open
    // (cycle 87 chrome). Verify by waiting for the chat-button's active
    // styling — easier than reaching into the flyout's deep DOM.
    const chatBtn = page.getByTestId("header-chat-button");
    await expect(chatBtn).toBeVisible();
    // The active state changes the bg / text-color; assert the flyout
    // is mounted by waiting for the chat panel container.
    await expect(page.locator('[data-testid="chat-flyout"], [data-testid^="flyout-rail-"]').first()).toBeVisible({ timeout: 5_000 });
  });

  test("help button is accessible on multiple routes (root, settings)", async ({ page }) => {
    for (const path of ["/", "/settings/providers"]) {
      await page.goto(path);
      await expect(page.getByTestId("header-help-button")).toBeVisible();
    }
  });
});
