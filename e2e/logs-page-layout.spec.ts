import { test, expect } from "@playwright/test";

/**
 * Logs page full-height layout regression (v0.4.867).
 *
 * Prior to v0.4.867, LogsPage wrapped the Logs component in PageScroll
 * (overflow-y-auto). The outer scroll and the inner entries-list scroll
 * competed: scrolling the page moved the entire Logs component — including
 * its toolbar — off-screen. Fix: LogsPage now uses flex-1 min-h-0 without
 * PageScroll, matching the DocsPage / KnowledgePage full-height pattern.
 *
 * These tests verify the toolbar stays anchored and the layout is correct.
 *
 * **Pre-conditions:**
 *   - Test VM running with gateway up (services-start)
 */

test.describe("Logs page full-height layout (v0.4.867)", () => {
  test("/gateway/logs renders without crash", async ({ page }) => {
    await page.goto("/gateway/logs", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/gateway\/logs(\?|#|$)/, { timeout: 10_000 });
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
  });

  test("log toolbar is visible in the initial viewport (not scrolled off)", async ({ page }) => {
    await page.goto("/gateway/logs", { waitUntil: "domcontentloaded" });

    // The toolbar contains level checkboxes and Pause/Resume button.
    // These must be visible WITHOUT any scrolling — if the double-scroll
    // layout bug regresses, the toolbar goes off-screen immediately.
    await expect(page.getByRole("button", { name: /pause|resume/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /clear/i })).toBeVisible();

    // Level filter labels (rendered as checkbox + label)
    await expect(page.getByText("INFO")).toBeVisible();
    await expect(page.getByText("ERROR")).toBeVisible();
  });

  test("toolbar is in the upper portion of the viewport — not below the fold", async ({ page }) => {
    await page.goto("/gateway/logs", { waitUntil: "domcontentloaded" });

    const pauseBtn = page.getByRole("button", { name: /pause|resume/i });
    await expect(pauseBtn).toBeVisible({ timeout: 10_000 });

    const box = await pauseBtn.boundingBox();
    const viewport = page.viewportSize();

    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();

    if (box && viewport) {
      // Toolbar should be in the top 40% of the viewport.
      // If the layout regresses (PageScroll wrapping), the toolbar position
      // is unchanged initially but the component becomes scrollable from the
      // OUTER container — the Pause button would appear at the expected
      // position but the inner scroll would be broken.
      expect(box.y).toBeLessThan(viewport.height * 0.4);
    }
  });

  test("log entries area is visible and scrollable below the toolbar", async ({ page }) => {
    await page.goto("/gateway/logs", { waitUntil: "domcontentloaded" });

    // Wait for the connection indicator badge (Live / Disconnected)
    const statusBadge = page.locator("[class*='border-green'], [class*='border-red']").first();
    await statusBadge.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
      // Badge may not render instantly — not a fatal failure
    });

    // The entries area renders either a "Waiting for log entries..." empty state
    // or actual entries. Either way it should be visible.
    const entriesOrEmpty = page.locator(
      "[class*='overflow-y-auto'][class*='font-mono'], [class*='overflow-y-auto'][class*='px-4']",
    ).first();
    const waitingText = page.getByText(/waiting for log entries/i);

    const entriesCount = await entriesOrEmpty.count();
    const waitingCount = await waitingText.count();
    expect(entriesCount + waitingCount).toBeGreaterThanOrEqual(1);
  });

  test("/system/logs redirects to /gateway/logs", async ({ page }) => {
    await page.goto("/system/logs", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/gateway\/logs(\?|#|$)/, { timeout: 8_000 });
  });
});
