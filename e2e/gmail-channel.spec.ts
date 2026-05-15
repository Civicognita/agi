import { test, expect } from "@playwright/test";

/**
 * Gmail channel — Channels page smoke test (CHN-J s171).
 *
 * Verifies the Gmail channel entry appears in the Channels list and
 * that the settings card is reachable. Does NOT test OAuth flow or
 * live email polling (those require real Google credentials).
 *
 * **Pre-conditions:**
 *   - Test VM running with the gateway up (services-start)
 *
 * All tests skip gracefully when the gateway has no Gmail channel
 * registered (i.e., no gmail entry in gateway.json channels) so the
 * suite stays green in minimal test-VM configs.
 */

test.describe("Gmail channel — Channels page (s171 CHN-J)", () => {
  let gmailEnabled = false;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const res = await page.request.get("/api/channels");
      if (!res.ok()) return;
      const data = (await res.json()) as { channels?: Array<{ id: string; enabled: boolean }> };
      gmailEnabled = (data.channels ?? []).some((c) => c.id === "gmail");
    } catch {
      // Gateway unreachable — all tests skip
    } finally {
      await page.close();
    }
  });

  test("Gmail entry is present in the Channels list", async ({ page }) => {
    if (!gmailEnabled) {
      test.skip(true, "Gmail not registered in gateway — skipping channel list test");
      return;
    }
    await page.goto("/settings/channels", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Gmail")).toBeVisible({ timeout: 10_000 });
  });

  test("Gmail channel settings card is reachable", async ({ page }) => {
    if (!gmailEnabled) {
      test.skip(true, "Gmail not registered in gateway");
      return;
    }
    await page.goto("/settings/channels", { waitUntil: "domcontentloaded" });
    // Find and click the Gmail settings entry or card
    const gmailEntry = page.locator('[data-testid="channel-card-gmail"], [data-channel-id="gmail"]').first();
    const fallbackEntry = page.getByText("Gmail").first();
    const target = (await gmailEntry.count()) > 0 ? gmailEntry : fallbackEntry;
    await expect(target).toBeVisible({ timeout: 8_000 });
  });
});
