import { test, expect } from "@playwright/test";

/**
 * /identity/pending — pending approval queue (s166 CHN-E).
 *
 * Verifies the approval-queue UX (v0.4.911+ — one card per person):
 *   - The page renders with heading + Refresh button
 *   - After load, either the empty-state or per-PERSON entry cards appear
 *     (each person collapses all the rooms they messaged from)
 *   - Each entry (if present) shows Approve + Reject buttons
 *
 * **Pre-conditions:**
 *   - Test VM running with the gateway up (services-start)
 *
 * **What this spec does NOT cover:**
 *   - End-to-end approve flow that verifies entity-tier promotion
 *     (requires a live channel adapter posting as an unknown user; deferred
 *     to a manual integration test).
 *   - End-to-end reject flow that verifies flagging.
 *   - The person-grouping/cascade logic itself — unit-tested in
 *     pending-approval-store.test.ts (cascade) + identity-pending render.
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

  test("shows empty-state OR per-person entries after load", async ({ page }) => {
    await openPendingPage(page);

    // Either the empty card or at least one per-person entry card renders.
    const empty = page.getByTestId("identity-pending-empty");
    // Person cards use dynamic testids (identity-pending-entry-<channel>__<user>).
    const personCards = page.getByTestId(/^identity-pending-entry-/);

    const emptyCount = await empty.count();
    const personCount = await personCards.count();

    // No error should be visible
    await expect(page.getByTestId("identity-pending-error")).not.toBeVisible();

    expect(emptyCount + personCount).toBeGreaterThanOrEqual(1);
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
