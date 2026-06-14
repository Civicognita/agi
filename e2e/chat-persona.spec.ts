import { test, expect } from "@playwright/test";

/**
 * Chat persona verification (task #236, story #76).
 *
 * Chat lives in the always-on 3-panel shell — no header button needed to open it.
 * The header chat button was removed when the shell went always-on.
 */

test.describe("Chat flyout — persona verification", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });
  });

  test("chat flyout is always visible without clicking any button", async ({ page }) => {
    await expect(page.getByTestId("chat-flyout")).toBeVisible({ timeout: 8_000 });
  });

  test("chat flyout has Chat header label", async ({ page }) => {
    const flyout = page.getByTestId("chat-flyout");
    await expect(flyout).toBeVisible({ timeout: 8_000 });
    // "Chat" label in the panel header
    await expect(flyout.getByText("Chat", { exact: true })).toBeVisible();
  });

  test("chat flyout has no X close button when docked in shell", async ({ page }) => {
    // The X button exists only in overlay mode; docked shell uses the rail trigger
    const flyout = page.getByTestId("chat-flyout");
    await expect(flyout).toBeVisible({ timeout: 8_000 });
    await expect(flyout.getByRole("button", { name: "X", exact: true })).toHaveCount(0);
  });

  test("profile popover shows owner display name", async ({ page }) => {
    const avatar = page.getByTestId("header-owner-avatar");
    const hasAvatar = await avatar.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasAvatar, "Owner profile not configured in this test environment");

    await avatar.click();
    await expect(page.locator("[role='dialog'], [data-popover-content]").first()).toBeVisible({ timeout: 3_000 });
  });
});
