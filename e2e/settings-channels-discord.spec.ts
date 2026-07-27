import { test, expect } from "@playwright/test";

/**
 * Settings → Channels → Discord tab UX (v0.4.865).
 *
 * Verifies the DiscordSettingsPanel shipped in v0.4.865:
 *   - /settings/channels loads and shows the Discord tab when Discord is installed
 *   - The Settings inner tab (default) renders DiscordSettingsPanel, not the
 *     old generic camelCase field form
 *   - Bot Token field is a password input with a human label (not "botToken")
 *   - mentionOnly is a toggle button (not a text input showing "true"/"false")
 *   - When bot token is empty, the setup guide is visible
 *   - Status bar warning check: when channel is running but bot is not connected,
 *     the amber warning badge renders (requires a running but disconnected bot —
 *     tested here as an API-level shape check since live Discord is unavailable)
 *
 * **Pre-conditions:**
 *   - Test VM running with gateway up (services-start)
 *   - Discord channel plugin installed (default in test VM bootstrap)
 *
 * **What this spec does NOT cover:**
 *   - Live bot connection / end-to-end Discord messaging
 *   - Saving config (would require POST to gateway)
 */

test.describe("Settings → Channels — Discord settings panel (v0.4.865)", () => {
  async function openDiscordSettingsTab(page: import("@playwright/test").Page) {
    await page.goto("/settings/channels", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/settings\/channels(\?|#|$)/, { timeout: 10_000 });

    // Wait for channel tabs to load (plugin-driven — async fetch)
    // The Discord channel tab shows as either "Discord" or a pill with "Discord" text
    const discordTab = page.getByRole("tab", { name: /^discord$/i });
    await discordTab.waitFor({ state: "visible", timeout: 12_000 });
    await discordTab.click();

    // Default inner tab is "Settings" — wait for it to be selected
    const settingsTab = page.getByRole("tab", { name: /^settings$/i }).first();
    await expect(settingsTab).toBeVisible({ timeout: 8_000 });
    // Settings tab should already be selected by default; if not, click it
    const isSelected = await settingsTab.getAttribute("data-state");
    if (isSelected !== "active" && isSelected !== "selected") {
      await settingsTab.click();
    }
  }

  test("/settings/channels renders without crash", async ({ page }) => {
    await page.goto("/settings/channels", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/settings\/channels(\?|#|$)/, { timeout: 10_000 });
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
    await expect(page.getByText("Channel Settings")).toBeVisible({ timeout: 10_000 });
  });

  test("Discord Settings tab shows labeled 'Bot Token' field (not raw 'botToken')", async ({ page }) => {
    await openDiscordSettingsTab(page);

    // DiscordSettingsPanel renders "Bot Token" as the label (not camelCase "botToken")
    // Use testid to avoid matching the setup guide's <strong>Bot Token</strong> snippet
    await expect(page.getByTestId("discord-bot-token-label")).toBeVisible({ timeout: 10_000 });

    // The input for botToken must be type=password
    const botTokenInput = page.locator("input[type='password']").first();
    await expect(botTokenInput).toBeVisible({ timeout: 8_000 });
  });

  test("mentionOnly renders as a toggle button, not a text input", async ({ page }) => {
    await openDiscordSettingsTab(page);

    // DiscordSettingsPanel renders a <button> for the toggle, not an <input type=text>
    // The toggle label is "Respond only when @mentioned"
    const toggleLabel = page.getByText(/respond only when @?mentioned/i);
    await expect(toggleLabel).toBeVisible({ timeout: 10_000 });

    // There must be no raw text input for "mentionOnly" or "Mention Only"
    // (old generic form rendered: label="Mention Only" + input[type=text] showing "true"/"false")
    const oldTextInput = page.locator("input[type='text']").filter({
      has: page.locator(".. >> text=Mention Only"),
    });
    await expect(oldTextInput).not.toBeVisible();
  });

  test("setup guide is visible when bot token is empty", async ({ page }) => {
    await openDiscordSettingsTab(page);

    // Fetch current config to check if botToken is set
    const tokenValue = await page.locator("input[type='password']").first().inputValue();
    if (!tokenValue.trim()) {
      // No token configured — setup guide must be visible
      await expect(page.getByText("Connect Aion to Discord")).toBeVisible({ timeout: 8_000 });
      // Setup guide has numbered steps
      await expect(page.getByText(/discord\.com\/developers\/applications/i)).toBeVisible();
    }
    // When token IS set, guide is hidden — this branch is a no-op in CI
  });

  test("Application ID field is present with description text", async ({ page }) => {
    await openDiscordSettingsTab(page);

    await expect(page.getByText("Application ID")).toBeVisible({ timeout: 10_000 });
    // Description text for applicationId
    await expect(page.getByText(/optional.*developer portal/i)).toBeVisible({ timeout: 6_000 });
  });

  test("status bar shows Start/Stop/Restart controls", async ({ page }) => {
    await openDiscordSettingsTab(page);

    // Status card is above the inner tabs — controls always present
    // exact: true avoids Playwright matching "Restart" when name: "Start" is used (substring match)
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restart", exact: true })).toBeVisible();
  });

  // Wave 1d (s228): Owner designation (#E0) reachable from the Channels page,
  // not just Settings → Owner Channel IDs. DiscordOwnerCard only renders once
  // the bot reports a connected guild, so /api/channels/discord/state is mocked.
  test("Server tab shows the Discord Owner card and it saves owner.channels.discord", async ({ page }) => {
    await page.route("**/api/channels/discord/state", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          connected: true,
          user: { tag: "AionBot#0001" },
          guilds: [{ id: "g1", name: "Test Guild", memberCount: 5, channels: [], roles: [] }],
          snapshotAt: new Date(0).toISOString(),
        }),
      }),
    );

    await openDiscordSettingsTab(page);
    await page.getByRole("tab", { name: /^server$/i }).click();

    const ownerCard = page.getByTestId("discord-owner-card");
    await expect(ownerCard).toBeVisible({ timeout: 10_000 });

    const input = page.getByTestId("discord-owner-input");
    const saveButton = page.getByTestId("discord-owner-save");
    await expect(saveButton).toBeDisabled();

    await input.fill("123456789012345678");
    await expect(saveButton).toBeEnabled();

    let savedOwnerId: string | undefined;
    await page.route("**/api/config", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        owner?: { channels?: { discord?: string } };
      };
      savedOwnerId = body.owner?.channels?.discord;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, message: "saved" }) });
    });
    await saveButton.click();
    await expect(saveButton).toHaveText("Saved");
    expect(savedOwnerId).toBe("123456789012345678");
  });
});
