import { test, expect } from "@playwright/test";

/**
 * Hearth layout e2e tests.
 *
 * The Hearth layout is always-on: a docked ChatFlyout on the left (hearth-layout
 * container) + canvas content on the right. Chat is context-aware — navigating
 * to a project sets the project context; any other route uses workspace chat.
 *
 * The old HearthChatPane (s198 stub with hearth-chat-pane/hearth-context-title/
 * hearth-back-button testids) was replaced by the real docked ChatFlyout.
 */

test.describe("HearthLayout", () => {
  // -------------------------------------------------------------------------
  // Layout always present
  // -------------------------------------------------------------------------

  test("hearth-layout container is present on project detail route", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle");

    const cards = page.getByTestId("project-card");
    if (await cards.count() === 0) { test.skip(); return; }
    await cards.first().click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9_-]+/);
    await expect(page.getByTestId("hearth-layout")).toBeVisible();
  });

  test("hearth-layout container is present on /comms/discord", async ({ page }) => {
    await page.goto("/comms/discord");
    await expect(page.getByTestId("hearth-layout")).toBeVisible();
  });

  test("hearth-layout container is present on /settings routes", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("hearth-layout")).toBeVisible();
  });

  test("hearth-layout container is present on /projects list", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByTestId("hearth-layout")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // ChatFlyout docked — visible by default (chatOpen starts true)
  // -------------------------------------------------------------------------

  test("docked ChatFlyout is visible on project detail route", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle");

    const cards = page.getByTestId("project-card");
    if (await cards.count() === 0) { test.skip(); return; }
    await cards.first().click();
    await expect(page.getByTestId("chat-flyout")).toBeVisible({ timeout: 6000 });
  });

  test("docked ChatFlyout is visible on /comms/discord", async ({ page }) => {
    await page.goto("/comms/discord");
    await expect(page.getByTestId("chat-flyout")).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // Canvas renders route content
  // -------------------------------------------------------------------------

  test("canvas renders ProjectDetail content on project route", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle");

    const cards = page.getByTestId("project-card");
    if (await cards.count() === 0) { test.skip(); return; }
    await cards.first().click();
    await expect(page.getByTestId("hearth-canvas")).toBeVisible();
    await expect(page.getByTestId("project-mode-picker")).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // Header still visible
  // -------------------------------------------------------------------------

  test("HearthTop is still visible on all routes", async ({ page }) => {
    await page.goto("/comms/discord");
    await expect(page.getByTestId("hearth-top")).toBeVisible();
  });

  test("HearthTop is visible on project detail", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle");

    const cards = page.getByTestId("project-card");
    if (await cards.count() === 0) { test.skip(); return; }
    await cards.first().click();
    await expect(page.getByTestId("hearth-top")).toBeVisible();
  });
});
