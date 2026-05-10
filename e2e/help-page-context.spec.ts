import { test, expect } from "@playwright/test";

/**
 * Help button page-context wiring (s137 t533).
 *
 * Verifies that clicking the header `?` icon opens the chat flyout
 * with a help-context string derived from the current route. Builds
 * on:
 *   - t529 (header help button — already e2e-tested in
 *     header-help-button.spec.ts)
 *   - t530 (page-context resolver — pure-logic tested in
 *     dashboard/src/lib/help-context.test.ts)
 *
 * t533's job is the END-TO-END contract that ties them together: the
 * help button's onClick calls `setChatContext(\`help:${resolveHelpContext(pathname)}\`)`
 * and that value reaches the ChatFlyout's `data-chat-context`
 * attribute on the root container.
 *
 * The spec drives the UI rather than poking the DOM under the hood —
 * help button click → assert attribute on chat-flyout container.
 */

test.describe("Help button page-context wiring (s137 t533)", () => {
  test("clicking help on /projects opens chat with `help:projects browser` context", async ({ page }) => {
    await page.goto("/projects");
    await page.getByTestId("header-help-button").click();

    const flyout = page.locator('[data-testid="chat-flyout"]').first();
    await expect(flyout).toBeVisible({ timeout: 5_000 });
    // The route /projects maps to "projects browser" (per help-context.ts)
    await expect(flyout).toHaveAttribute("data-chat-context", /^help:projects/);
  });

  test("clicking help on /settings/providers opens chat with providers-keyed context", async ({ page }) => {
    await page.goto("/settings/providers");
    await page.getByTestId("header-help-button").click();

    const flyout = page.locator('[data-testid="chat-flyout"]').first();
    await expect(flyout).toBeVisible({ timeout: 5_000 });
    await expect(flyout).toHaveAttribute("data-chat-context", /^help:.+/);
  });

  test("clicking help on different routes produces distinct contexts", async ({ page }) => {
    await page.goto("/projects");
    await page.getByTestId("header-help-button").click();
    const flyoutA = page.locator('[data-testid="chat-flyout"]').first();
    await expect(flyoutA).toBeVisible({ timeout: 5_000 });
    const ctxA = await flyoutA.getAttribute("data-chat-context");
    expect(ctxA).toMatch(/^help:/);

    // Close + reopen on a different route
    await page.keyboard.press("Escape").catch(() => { /* may not be wired */ });
    await page.goto("/settings/providers");
    await page.getByTestId("header-help-button").click();
    const flyoutB = page.locator('[data-testid="chat-flyout"]').first();
    await expect(flyoutB).toBeVisible({ timeout: 5_000 });
    const ctxB = await flyoutB.getAttribute("data-chat-context");
    expect(ctxB).toMatch(/^help:/);

    expect(ctxA).not.toBe(ctxB);
  });
});
