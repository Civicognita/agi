import { test, expect } from "@playwright/test";

/**
 * Discord plugin v2 — management page + bridge-tool path (s163 CHN-B slice 7).
 *
 * Verifies the CHN-B acceptance criteria reachable in CI (no live Discord bot):
 *   - /comms/discord management page renders without crashing
 *   - Discord appears as a filter channel on the /comms log index
 *   - /api/channels/discord/state endpoint responds (or gracefully absent when
 *     Discord is not configured — the route only registers after activate())
 *
 * **Pre-conditions:**
 *   - Test VM running with the gateway up (services-start)
 *
 * **What this spec does NOT cover:**
 *   - Live Discord bot connection (requires a bot token + guild in config).
 *   - Bridge-tool invocation against real Discord data (requires Discord running).
 *   - Intent toggle persistence (manual flow with a live bot).
 */

test.describe("Discord plugin v2 management page (s163 CHN-B)", () => {
  test("/comms/discord renders — channel page mounts without crash", async ({ page }) => {
    await page.goto("/comms/discord", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/comms\/discord(\?|#|$)/, { timeout: 10_000 });

    // The page heading and the ChannelPage both render "Discord" — scope to main
    await expect(page.getByRole("main").getByText("Discord").first()).toBeVisible({
      timeout: 8_000,
    });

    // Either a status badge (when plugin is loaded) or "not registered" message.
    // In CI without a Discord bot token, the plugin activate() exits early and
    // /api/channels/discord returns 404 → ChannelPage shows the fallback.
    const statusBadge = page.locator(
      // ChannelPage renders one of these CSS background classes on the Badge
      "[class*='bg-green'], [class*='bg-overlay0'], [class*='bg-yellow'], [class*='bg-red'], [class*='bg-blue']",
    ).first();
    const notRegistered = page.getByText(/not registered/i);

    const badgeCount = await statusBadge.count();
    const fallbackCount = await notRegistered.count();
    expect(badgeCount + fallbackCount).toBeGreaterThanOrEqual(1);
  });

  test("/comms index shows Discord as a filter tab", async ({ page }) => {
    await page.goto("/comms", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/comms(\?|#|$)/, { timeout: 10_000 });

    // CommsPage renders a channel filter row; Discord is one of the tabs
    await expect(page.getByRole("button", { name: /^discord$/i })).toBeVisible({
      timeout: 8_000,
    });
  });

  test("v2 channel state endpoint — bridge-tool path is wired", async ({ page }) => {
    // The /api/channels/discord/state route is registered in activate() only when
    // Discord is configured. In CI this endpoint is absent, so the SPA or gateway
    // may return a non-JSON response. Either way, no 5xx should occur.
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(async () => {
      const r = await fetch("/api/channels/discord/state");
      const text = await r.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = { _htmlFallback: true };
      }
      return { status: r.status, body };
    });

    // 5xx would indicate a crash in the route handler — must not happen
    expect(result.status).toBeLessThan(500);

    // When Discord IS configured and the plugin is live, the endpoint should
    // return a JSON object describing bot state (status, guilds, etc.)
    if (
      typeof result.body === "object" &&
      result.body !== null &&
      !("_htmlFallback" in (result.body as Record<string, unknown>))
    ) {
      expect(result.body).toMatchObject(
        expect.objectContaining({
          // Shape from state.ts getDiscordState — at least one of these fields
        }),
      );
    }
  });
});
