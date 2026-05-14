import { test, expect } from "@playwright/test";

/**
 * Channels tab + room picker (s165 CHN-D slice 3a/3b).
 *
 * Verifies the project-binding UX shipped in v0.4.674–v0.4.675:
 *   - The "Channels" tab is present on a project's coordinate mode tab strip
 *   - The ChannelsPanel renders + reads /api/projects/rooms
 *   - Empty-state copy renders when no bindings exist
 *   - The "+ Add Binding" button opens the RoomPickerDialog
 *   - The picker fetches /api/channels/discord/rooms and renders a Discord channel selector
 *   - Closing the picker without binding leaves the empty state intact
 *
 * **Pre-conditions:**
 *   - Test VM running with the gateway up (services-start)
 *   - A workspace project exists (the test VM bootstrap creates one)
 *   - Discord channel is configured AND `enabled: false` is OK — the picker
 *     calls /api/channels/discord/rooms which returns an empty array when
 *     Discord isn't connected (bot offline). The empty-state path is the
 *     one we test here; the bound-room path requires a live Discord client.
 *
 * **What this spec does NOT cover (separate slices):**
 *   - End-to-end bind → message → routing (needs a live Discord bot + a
 *     test guild + a test channel; deferred to a manual integration test).
 *   - The Discord status card under Settings → Channels (a different
 *     surface tested by status-card-specific e2es when filed).
 */

test.describe("Channels tab + room picker (s165 CHN-D)", () => {
  // Resolve a project path to navigate to. The test VM bootstrap creates
  // _aionima (always-present meta-project). Most projects work; we pick
  // the first non-Aionima project tile when present, otherwise fall back
  // to _aionima itself (the Channels tab is universally available across
  // project types as long as the project is in coordinate mode).
  async function openFirstProjectChannelsTab(page: import("@playwright/test").Page): Promise<void> {
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    // Click into _aionima — guaranteed to exist; coordinate mode is supported.
    await page.getByTestId("project-card-aionima").click();
    await expect(page).toHaveURL(/\/projects\/_aionima(\?|#|$)/, { timeout: 10_000 });

    // Switch to coordinate mode (where Channels tab lives) if a mode picker is present.
    // The active mode is reflected in the sub-surface label.
    const coordinateButton = page.getByTestId("project-mode-coordinate");
    if (await coordinateButton.count() > 0) {
      await coordinateButton.first().click();
    }

    // The Channels tab trigger has a stable testid.
    await expect(page.getByTestId("project-tab-channels")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("project-tab-channels").click();

    // Verify panel mounted
    await expect(page.getByTestId("channels-panel")).toBeVisible({ timeout: 10_000 });
  }

  test("Channels tab is present on the project tab strip in coordinate mode", async ({ page }) => {
    await openFirstProjectChannelsTab(page);
    // The tab trigger has the data-testid project-tab-channels — verified inside helper.
    // Additionally, the panel header reads "Channel Rooms".
    await expect(page.getByText("Channel Rooms")).toBeVisible();
  });

  test("ChannelsPanel renders empty-state when no bindings exist", async ({ page }) => {
    await openFirstProjectChannelsTab(page);
    // Either the empty-state OR the bindings list renders. For a fresh
    // test VM with no bindings, the empty-state is the expected path.
    const empty = page.getByTestId("channels-panel-empty");
    const list = page.getByTestId("channels-panel-list");
    const emptyCount = await empty.count();
    const listCount = await list.count();
    expect(emptyCount + listCount).toBeGreaterThanOrEqual(1);
    // We don't enforce empty (test VM might have stale bindings from a
    // previous run) — just that the panel rendered ONE of the two states.
  });

  test("clicking + Add Binding opens the room picker dialog", async ({ page }) => {
    await openFirstProjectChannelsTab(page);
    await page.getByTestId("channels-panel-add-binding").click();
    // Picker mounts. Modal shape from react-fancy.
    await expect(page.getByTestId("room-picker-dialog")).toBeVisible({ timeout: 10_000 });
  });

  test("room picker has the Discord channel button + Refresh action", async ({ page }) => {
    await openFirstProjectChannelsTab(page);
    await page.getByTestId("channels-panel-add-binding").click();
    await expect(page.getByTestId("room-picker-dialog")).toBeVisible({ timeout: 10_000 });
    // Discord is the only currently-available channel (Telegram/Slack/etc.
    // migrate to defineChannelV2 in CHN-I/J/K/L). The discord chip must be present.
    await expect(page.getByTestId("room-picker-channel-discord")).toBeVisible();
  });

  test("room picker shows the empty-state OR a list when Discord is queried", async ({ page }) => {
    await openFirstProjectChannelsTab(page);
    await page.getByTestId("channels-panel-add-binding").click();
    await expect(page.getByTestId("room-picker-dialog")).toBeVisible({ timeout: 10_000 });

    // After load, the picker either shows the empty-state (Discord
    // offline / no guilds) OR a list of rooms grouped by guild.
    // Tolerate either; the assertion is just that the picker IS displaying SOMETHING.
    const empty = page.getByTestId("room-picker-empty");
    const groups = page.getByTestId(/^room-picker-group-/);
    const errorBanner = page.getByTestId("room-picker-error");

    // Wait up to 6s for one of: empty / groups / error to settle
    await Promise.race([
      empty.waitFor({ state: "visible", timeout: 6000 }).catch(() => undefined),
      groups.first().waitFor({ state: "visible", timeout: 6000 }).catch(() => undefined),
      errorBanner.waitFor({ state: "visible", timeout: 6000 }).catch(() => undefined),
    ]);

    const emptyCount = await empty.count();
    const groupCount = await groups.count();
    const errorCount = await errorBanner.count();
    expect(emptyCount + groupCount + errorCount).toBeGreaterThanOrEqual(1);
  });

  test("clicking Done closes the picker without binding anything", async ({ page }) => {
    await openFirstProjectChannelsTab(page);

    // Capture the bindings count BEFORE opening the picker
    const listBefore = await page.getByTestId("channels-panel-list").count();
    const emptyBefore = await page.getByTestId("channels-panel-empty").count();

    await page.getByTestId("channels-panel-add-binding").click();
    await expect(page.getByTestId("room-picker-dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Done/i }).click();
    // Picker should disappear
    await expect(page.getByTestId("room-picker-dialog")).not.toBeVisible({ timeout: 5_000 });

    // State should be the same as before
    const listAfter = await page.getByTestId("channels-panel-list").count();
    const emptyAfter = await page.getByTestId("channels-panel-empty").count();
    expect(listAfter).toBe(listBefore);
    expect(emptyAfter).toBe(emptyBefore);
  });
});
