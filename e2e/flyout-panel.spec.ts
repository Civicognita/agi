import { test, expect } from "@playwright/test";

test.describe("FlyoutPanel", () => {
  // FlyoutPanel is used indirectly through the chat button and project detail pages.
  // These tests verify the component behavior through real usage.

  test("chat flyout opens and closes via sidebar button", async ({ page }) => {
    await page.goto("/");
    const chatButton = page.getByTestId("sidebar-chat-button");
    await chatButton.click();
    // Chat button should show active state
    await expect(chatButton).toHaveClass(/bg-primary/);

    // Click again to close
    await chatButton.click({ force: true });
    await expect(chatButton).not.toHaveClass(/bg-primary/);
  });
});
