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

/**
 * s234 P2/P3 — the register/associate approve flow + the owner-claim card.
 * Route-mocked for deterministic assertions (no live channel adapter needed).
 */
test.describe("/identity/pending — s234 register / associate / claim", () => {
  const PENDING = {
    pending: [{ id: "p1", channelId: "discord", roomId: "room-1", channelUserId: "u-new", displayName: "NewPerson", projectPath: "", firstMessagePreview: "hello there", createdAt: "2026-07-01T10:00:00.000Z" }],
    count: 1,
  };
  const PEOPLE = { people: [{ status: "approved", decidedAt: "2026-06-01T00:00:00.000Z", entityId: "E-existing", channelId: "discord", channelUserId: "u-old", displayName: "ExistingPerson" }] };

  async function mockAll(page: import("@playwright/test").Page, opts: { claimable?: boolean } = {}): Promise<void> {
    const claimable = opts.claimable ?? false;
    await page.route("**/api/identity/people**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PEOPLE) }));
    await page.route("**/api/owner/status**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hasOwner: !claimable, ownerEntityId: claimable ? null : "E-owner", claimable }) }));
    await page.route("**/api/projects**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
    await page.route("**/api/identity/pending", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PENDING) }));
  }

  test("Approve opens the panel; register mode approves with mode=register", async ({ page }) => {
    await mockAll(page);
    let approveBody: Record<string, unknown> | null = null;
    await page.route("**/api/identity/pending/*/approve", async (r) => {
      approveBody = JSON.parse(r.request().postData() ?? "{}") as Record<string, unknown>;
      await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, approval: {} }) });
    });
    await page.goto("/identity/pending", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("identity-pending-entry-discord__u_new")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId(/^identity-pending-approve-/).first().click();
    await expect(page.getByTestId("identity-approve-panel")).toBeVisible();
    await expect(page.getByTestId("identity-register-form")).toBeVisible();
    await page.getByTestId("identity-approve-confirm").click();
    await expect.poll(() => approveBody?.mode).toBe("register");
  });

  test("Associate mode links to an existing person (mode=associate + targetEntityId)", async ({ page }) => {
    await mockAll(page);
    let approveBody: Record<string, unknown> | null = null;
    await page.route("**/api/identity/pending/*/approve", async (r) => {
      approveBody = JSON.parse(r.request().postData() ?? "{}") as Record<string, unknown>;
      await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, approval: {} }) });
    });
    await page.goto("/identity/pending", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("identity-pending-entry-discord__u_new")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId(/^identity-pending-approve-/).first().click();
    await page.getByTestId("identity-approve-mode-associate").click();
    await page.getByTestId(/^identity-associate-candidate-/).first().click();
    await page.getByTestId("identity-approve-confirm").click();
    await expect.poll(() => approveBody?.mode).toBe("associate");
    expect(approveBody?.targetEntityId).toBe("E-existing");
  });

  test("owner-claim card shows when no owner is set", async ({ page }) => {
    await mockAll(page, { claimable: true });
    await page.goto("/identity/pending", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("owner-claim-card")).toBeVisible();
    await expect(page.getByTestId("owner-claim-token")).toBeVisible();
  });

  test("owner-claim card hidden when an owner exists", async ({ page }) => {
    await mockAll(page, { claimable: false });
    await page.goto("/identity/pending", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("identity-pending-entry-discord__u_new")).toBeVisible();
    await expect(page.getByTestId("owner-claim-card")).toHaveCount(0);
  });
});
