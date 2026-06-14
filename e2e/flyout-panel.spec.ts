import { test, expect } from "@playwright/test";

/**
 * Shell layout — chat panel is always visible.
 *
 * Chat lives in the 3-panel AccordionPanel shell (Canvas | Chat | Workspace).
 * There is no toggle button; chat is open by default on every route.
 */

test.describe("Shell — chat panel", () => {
  test("chat flyout is always visible without clicking any button", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });
    // Chat panel renders immediately — no button click required
    await expect(page.getByTestId("chat-flyout")).toBeVisible({ timeout: 8_000 });
  });

  test("header chat toggle button is absent (chat is always on)", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });
    await expect(page.getByTestId("header-chat-button")).toHaveCount(0);
  });

  test("shell panel headers are present (workspace / chat)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("shell-panel-header-workspace")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("shell-panel-header-chat")).toBeVisible({ timeout: 8_000 });
  });
});
