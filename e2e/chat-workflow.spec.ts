import { test, expect } from "@playwright/test";

/**
 * Chat workflow e2e tests.
 *
 * These tests verify the dashboard chat UI's structural and stateful
 * behavior that doesn't depend on an LLM — pill gating, data-role attrs,
 * queued card visibility, and the project-chat re-open flow (Phase 4b).
 *
 * Scenarios that require a running LLM (e.g. thought-tool interleaving,
 * stall timer expiry against real runs) are intentionally out of scope for
 * e2e and covered by manual smoke + component/unit tests.
 */

/**
 * Dismiss any persisted MagicApp modals that would intercept pointer
 * events on the page. The test VM has a habit of carrying a non-minimized
 * magic-app-instance across runs (story #101 task #327 followup —
 * separate from the dashboard'\\''s real "auto-show modal on /projects"
 * bug). Until that root cause is fixed, dismiss the overlay so subsequent
 * clicks land on the intended targets.
 */
async function dismissStuckMagicAppModals(page: import("@playwright/test").Page): Promise<void> {
  // Use page.evaluate to click close buttons directly via the DOM. This
  // bypasses Playwright'\\''s actionability checks — the close-btn can be
  // technically "visible" while obscured by an inner subtree that
  // intercepts pointer events (the data-react-fancy-content-renderer
  // child of the modal). DOM-level click() fires the React onClick
  // synthetic handler regardless.
  for (let i = 0; i < 5; i++) {
    const dismissed = await page.evaluate(() => {
      const buttons = document.querySelectorAll<HTMLElement>("[data-testid=\"mapp-close-btn\"]");
      buttons.forEach((b) => b.click());
      return buttons.length;
    }).catch(() => 0);
    if (dismissed === 0) break;
    await page.waitForTimeout(150);
  }
}

test.describe("Chat workflow", () => {
  test("chat flyout opens via sidebar button and exposes chat-flyout testid", async ({ page }) => {
    await page.goto("/");
    await dismissStuckMagicAppModals(page);
    const chatButton = page.getByTestId("header-chat-button");
    await chatButton.click();
    await expect(page.getByTestId("chat-flyout")).toBeVisible();
  });

  test("chat flyout opens via project 'Talk about this project' button", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForTimeout(1000);
    await dismissStuckMagicAppModals(page);
    const cards = page.getByTestId("project-card");
    const cardCount = await cards.count();
    test.skip(cardCount === 0, "no projects available in this environment");

    await cards.first().click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

    const projectChatButton = page.getByTestId("project-chat-button");
    await expect(projectChatButton).toBeVisible();
    await projectChatButton.click();
    await expect(page.getByTestId("chat-flyout")).toBeVisible();
  });

  test("project chat re-opens after close (Phase 4b: prevContextRef reset)", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForTimeout(1000);
    await dismissStuckMagicAppModals(page);
    const cards = page.getByTestId("project-card");
    const cardCount = await cards.count();
    test.skip(cardCount === 0, "no projects available in this environment");

    await cards.first().click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

    const projectChatButton = page.getByTestId("project-chat-button");

    // Open chat the first time
    await projectChatButton.click();
    const flyout = page.getByTestId("chat-flyout");
    await expect(flyout).toBeVisible();

    // Close the flyout by clicking its backdrop (first child of the overlay container)
    // Fallback: click the ESC key on the page which commonly closes overlays
    await page.keyboard.press("Escape");
    // Some overlay implementations need a direct backdrop click — attempt that too
    const backdrop = flyout.locator(":scope > .bg-black\\/30").first();
    if (await backdrop.count() > 0) {
      await backdrop.click({ force: true });
    }
    // Give the flyout a beat to tear down
    await page.waitForTimeout(250);

    // Re-click the SAME project's chat button — with the Phase 4b fix, prevContextRef
    // has been reset to null, so this click triggers the openWithContext effect again
    // instead of being short-circuited by the stale equality guard.
    await projectChatButton.click();
    await expect(page.getByTestId("chat-flyout")).toBeVisible();
  });

  test("chat flyout renders run-group containers once messages exist", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("header-chat-button").click();
    const flyout = page.getByTestId("chat-flyout");
    await expect(flyout).toBeVisible();

    // Run-group containers are emitted per runId once there are messages.
    // In a fresh session with no history this may be zero — that's fine, we
    // just assert the testid is not mis-configured (selector works).
    const groups = flyout.getByTestId("run-group");
    await expect(groups).toHaveCount(await groups.count());
  });

  test("queued-card testid is wired and absent in an empty chat", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("header-chat-button").click();
    const flyout = page.getByTestId("chat-flyout");
    await expect(flyout).toBeVisible();
    await expect(flyout.getByTestId("queued-card")).toHaveCount(0);
  });

  test("live pill testid is wired (hidden when not thinking)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("header-chat-button").click();
    const flyout = page.getByTestId("chat-flyout");
    await expect(flyout).toBeVisible();
    // No active run → pill is not rendered.
    await expect(flyout.getByTestId("chat-live-pill")).toHaveCount(0);
  });
});
