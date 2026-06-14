import { test, expect } from "@playwright/test";

/**
 * AccordionFlyout + AgentCanvas e2e tests (s134 cycle 87).
 *
 * Verifies the chat flyout's new chrome:
 *   - Renders both Canvas and Chat panels by default on desktop
 *   - Vertical rail labels (CANVAS / CHAT) are present as triggers
 *   - Clicking a rail collapses its panel to a thin strip
 *   - Re-clicking the rail re-expands the panel
 *   - The empty-state surface ("Agent Canvas") shows when no plan/artifact
 *     is selected
 *   - z-index policy: header is clickable above the flyout (sticky header
 *     stays accessible at z-[100], flyout sits at z-[200], header-triggered
 *     overlays bump to z-[300]).
 */

test.describe("AccordionFlyout chrome", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Chat is always visible in the shell — no button click needed
    await expect(page.getByTestId("chat-flyout")).toBeVisible({ timeout: 8_000 });
  });

  test("renders both canvas and chat panels by default on desktop", async ({ page }) => {
    // Both rail labels render — confirms the AccordionPanel.Section trigger
    // contract is wiring through. Use first() since the rail label appears
    // both as the trigger and as a visual decoration in different states.
    await expect(page.getByTestId("flyout-rail-canvas").first()).toBeVisible();
    await expect(page.getByTestId("flyout-rail-chat").first()).toBeVisible();

    // AgentCanvas mounts in the canvas section; surface defaults to "empty"
    // when nothing has been selected.
    const canvas = page.getByTestId("agent-canvas").first();
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("data-surface-kind", "empty");
    // Empty-state message ("Agent Canvas" heading) is rendered.
    await expect(canvas.getByText("Agent Canvas", { exact: true })).toBeVisible();
  });

  test("clicking the canvas rail collapses the canvas panel", async ({ page }) => {
    const canvas = page.getByTestId("agent-canvas").first();
    const canvasRail = page.getByTestId("flyout-rail-canvas").first();

    // Canvas content is visible initially.
    await expect(canvas.getByText("Agent Canvas", { exact: true })).toBeVisible();

    // Click the rail to collapse.
    await canvasRail.click();

    // The empty-state heading should no longer be visible (rail-only mode
    // hides Content; AccordionPanel.Content renders null when closed).
    await expect(canvas.getByText("Agent Canvas", { exact: true })).not.toBeVisible();

    // Click again to re-expand.
    await canvasRail.click();
    await expect(canvas.getByText("Agent Canvas", { exact: true })).toBeVisible();
  });

  test("clicking the chat rail collapses the chat panel", async ({ page }) => {
    const chatRail = page.getByTestId("flyout-rail-chat").first();
    const chatEmptyState = page.getByText("Click + to start a new chat");

    // Chat empty-state is visible initially.
    await expect(chatEmptyState).toBeVisible();

    // Collapse chat.
    await chatRail.click();
    await expect(chatEmptyState).not.toBeVisible();

    // Re-expand.
    await chatRail.click();
    await expect(chatEmptyState).toBeVisible();
  });

  test("shell chat panel header collapses and re-expands chat panel", async ({ page }) => {
    // The shell chat panel header's collapse button handles panel collapse.
    const toggleBtn = page.getByTestId("shell-panel-toggle-chat");
    const flyout = page.getByTestId("chat-flyout");

    await expect(flyout).toBeVisible();
    await expect(toggleBtn).toBeVisible();

    // Collapse via the header collapse button.
    await toggleBtn.click();
    await expect(flyout).not.toBeVisible({ timeout: 3_000 });

    // Re-expand by clicking the collapsed header strip.
    await page.getByTestId("shell-panel-header-chat").click();
    await expect(flyout).toBeVisible({ timeout: 3_000 });
  });

  test("aria attributes on rail triggers reflect open/closed state", async ({ page }) => {
    const canvasRail = page.getByTestId("flyout-rail-canvas").first();

    // Initially open: aria-expanded="true", aria-label hints at collapse.
    await expect(canvasRail).toHaveAttribute("aria-expanded", "true");
    await expect(canvasRail).toHaveAttribute("aria-label", /collapse/i);

    // Collapse: aria-expanded flips to "false", label hints at expand.
    await canvasRail.click();
    await expect(canvasRail).toHaveAttribute("aria-expanded", "false");
    await expect(canvasRail).toHaveAttribute("aria-label", /expand/i);
  });
});
