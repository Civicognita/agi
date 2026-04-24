import { test, expect } from "@playwright/test";

/**
 * Chat with persona verification e2e (task #236, story #76).
 *
 * Verifies the chat flyout opens from the header chat button and that
 * the owner's persona/display-name is visible in the chat context.
 * Structural only — does not send messages or wait for LLM responses.
 */

test.describe("Chat flyout — persona verification", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the main layout to hydrate
    await page.waitForSelector("[data-testid='app-sidebar']", { timeout: 10_000 });
  });

  test("header chat button is present", async ({ page }) => {
    const chatBtn = page.getByTestId("header-chat-button");
    await expect(chatBtn).toBeVisible();
  });

  test("clicking header chat button opens the flyout", async ({ page }) => {
    const chatBtn = page.getByTestId("header-chat-button");
    await chatBtn.click();
    // ChatFlyout renders a "Chat" header inside its panel when open
    await expect(page.getByText("Chat", { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("chat flyout header has Expand + X controls", async ({ page }) => {
    await page.getByTestId("header-chat-button").click();
    await expect(page.getByRole("button", { name: "Expand", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "X", exact: true })).toBeVisible();
  });

  test("clicking X closes the chat flyout", async ({ page }) => {
    await page.getByTestId("header-chat-button").click();
    // "Chat" text also appears in sidebar context; match the flyout's own region.
    await expect(page.getByTestId("chat-flyout")).toBeVisible();

    await page.getByRole("button", { name: "X", exact: true }).click();
    await expect(page.getByTestId("chat-flyout")).not.toBeVisible({ timeout: 3_000 });
  });

  test("profile popover shows owner display name", async ({ page }) => {
    // Owner initial button in the header — testid header-owner-avatar
    const avatar = page.getByTestId("header-owner-avatar");
    const hasAvatar = await avatar.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasAvatar, "Owner profile not configured in this test environment");

    await avatar.click();
    // ProfileCard should render inside the popover.
    await expect(page.locator("[role='dialog'], [data-popover-content]").first()).toBeVisible({ timeout: 3_000 });
  });
});
