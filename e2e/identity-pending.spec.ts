import { test, expect } from "@playwright/test";

/**
 * /identity/pending — pending approval queue (s166 CHN-E).
 *
 * Verifies the approval-queue UX shipped in v0.4.707+:
 *   - The page renders with heading + Refresh button
 *   - After load, either the empty-state or project-grouped entries appear
 *   - Each entry (if present) shows Approve + Reject buttons
 *
 * **Pre-conditions:**
 *   - Test VM running with the gateway up (services-start)
 *
 * **What this spec does NOT cover:**
 *   - End-to-end approve flow that verifies Local-ID promotion
 *     (requires a live Discord bot posting as an unknown user + Local-ID
 *     promotion sequence; deferred to a manual integration test).
 *   - End-to-end reject flow that verifies flagging.
 */

test.describe("/identity/pending — CHN-E approval queue (s166)", () => {
  async function openPendingPage(page: import("@playwright/test").Page): Promise<void> {
    await page.goto("/identity/pending", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/identity\/pending(\?|#|$)/, { timeout: 10_000 });

    // Wait for heading
    await expect(page.getByRole("heading", { name: "Pending Identity Approvals" })).toBeVisible({
      timeout: 10_000,
    });

    // Wait for the fetch to settle — Refresh button text flips from "Loading…" to "Refresh"
    await page
      .getByTestId("identity-pending-refresh")
      .filter({ hasText: "Refresh" })
      .waitFor({ state: "visible", timeout: 8_000 });
  }

  test("page renders heading + Refresh button", async ({ page }) => {
    await openPendingPage(page);
    await expect(page.getByRole("heading", { name: "Pending Identity Approvals" })).toBeVisible();
    await expect(page.getByTestId("identity-pending-refresh")).toBeVisible();
  });

  test("shows empty-state OR project entries after load", async ({ page }) => {
    await openPendingPage(page);

    // Either the empty card or at least one project-grouped card renders.
    const empty = page.getByTestId("identity-pending-empty");
    // Project cards use dynamic testids; match any of them with regex.
    const projectCards = page.getByTestId(/^identity-pending-project-/);

    const emptyCount = await empty.count();
    const projectCount = await projectCards.count();

    // No error should be visible
    await expect(page.getByTestId("identity-pending-error")).not.toBeVisible();

    expect(emptyCount + projectCount).toBeGreaterThanOrEqual(1);
  });

  test("each entry (if any) has Approve + Reject buttons", async ({ page }) => {
    await openPendingPage(page);

    const entries = page.getByTestId(/^identity-pending-entry-/);
    const entryCount = await entries.count();

    if (entryCount === 0) {
      // Fresh VM — no Discord bot posting — empty state expected. Skip button assertions.
      await expect(page.getByTestId("identity-pending-empty")).toBeVisible();
      return;
    }

    // For each entry, both approve and reject buttons must be present.
    // We only verify the first entry to keep the spec fast.
    const firstEntry = entries.first();
    // Approve button is inside the entry div with data-testid matching identity-pending-approve-*
    await expect(firstEntry.getByRole("button", { name: /Approve/i })).toBeVisible();
    await expect(firstEntry.getByRole("button", { name: /Reject/i })).toBeVisible();
  });
});
