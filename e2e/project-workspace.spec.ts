import { test, expect } from "@playwright/test";

/**
 * Project workspace e2e tests.
 *
 * Verifies the dashboard's structural layout changes after the workspace
 * hardening shipment:
 *   - System Terminal button in main header (Phase 3)
 *   - WhoDB button opens an inline flyout, not a new tab (Phase 4)
 *   - Project detail page no longer shows a "Terminal" header button
 *   - Project action buttons expose their command via data-command attribute
 */

test.describe("Project workspace", () => {
  test("System Terminal button is in the dashboard header", async ({ page }) => {
    await page.goto("/");
    const systemBtn = page.getByTestId("system-terminal-button");
    await expect(systemBtn).toBeVisible();
  });

  test("WhoDB button opens the WhoDB flyout (not a new tab)", async ({ page, context }) => {
    await page.goto("/");
    const whodbBtn = page.getByTestId("whodb-button");
    await expect(whodbBtn).toBeVisible();

    // Ensure clicking does NOT open a new tab; assert no popup page is created.
    const pagesBefore = context.pages().length;
    await whodbBtn.click();
    await expect(page.getByTestId("whodb-flyout")).toBeVisible();
    const pagesAfter = context.pages().length;
    expect(pagesAfter).toBe(pagesBefore);
  });

  test("WhoDB flyout renders an iframe pointing at the WhoDB URL", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("whodb-button").click();
    const iframe = page.getByTestId("whodb-iframe");
    await expect(iframe).toBeAttached();
    const src = await iframe.getAttribute("src");
    expect(src).toBeTruthy();
    expect(src).toMatch(/db\.ai\.on|https?:\/\//);
  });

  test("Project detail page has no standalone 'Terminal' button (moved to header)", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForTimeout(1000);
    const cards = page.getByTestId("project-card");
    const cardCount = await cards.count();
    test.skip(cardCount === 0, "no projects available in this environment");

    await cards.first().click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

    // No legacy "Terminal" button in the project header.
    const legacyTerminalBtn = page.getByRole("button", { name: /^Terminal$/ });
    await expect(legacyTerminalBtn).toHaveCount(0);
    // Project chat button is still there alongside.
    await expect(page.getByTestId("project-chat-button")).toBeVisible();
  });

  test("Project action buttons carry the command in data-command and title", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForTimeout(1000);
    const cards = page.getByTestId("project-card");
    const cardCount = await cards.count();
    test.skip(cardCount === 0, "no projects available in this environment");

    await cards.first().click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

    // Dev commands only appear when a stack is installed. If none are visible,
    // skip rather than fail — this is a structural check that the attrs exist
    // when buttons are present, not that every project has them.
    const actionBtns = page.getByTestId("project-action-button");
    const actionCount = await actionBtns.count();
    test.skip(actionCount === 0, "project has no dev commands (no installed stack)");

    const first = actionBtns.first();
    const title = await first.getAttribute("title");
    const command = await first.getAttribute("data-command");
    expect(title).toBeTruthy();
    expect(command).toBeTruthy();
    expect((title ?? "").length).toBeGreaterThan(0);
  });
});
