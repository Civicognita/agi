import { test, expect } from "@playwright/test";

/**
 * /comms/channels — per-channel behavior config (Wave 3, s230).
 *
 * Owner: "too many panels, no tabs, content too moshed up" + free-text role
 * typing + no explanations for the dials. Verifies:
 *   - Config splits into Behavior / Access & limits tabs (not stacked panels)
 *   - Info popovers exist on the adjustable controls
 *   - Role overrides render as a picker once live Discord roles are available
 */

test.describe("Comms → Channels — Wave 3 tabbed redesign", () => {
  test("renders without JS error and shows the channel-mode picker", async ({ page }) => {
    await page.goto("/comms/channels", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
    await expect(page.getByText("Mode", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("per-channel config is split into Behavior / Access & limits tabs", async ({ page }) => {
    await page.goto("/comms/channels", { waitUntil: "domcontentloaded" });
    const behaviorTab = page.getByTestId("channel-tab-behavior");
    const accessTab = page.getByTestId("channel-tab-access");
    await expect(behaviorTab).toBeVisible({ timeout: 10_000 });
    await expect(accessTab).toBeVisible();

    // Behavior is the default tab; Access & limits content is reachable via its own tab.
    await accessTab.click();
    await expect(page.getByText("Role overrides")).toBeVisible({ timeout: 5_000 });
  });

  test("info popovers explain the adjustable controls", async ({ page }) => {
    await page.goto("/comms/channels", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Mode", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Multiple InfoPopover triggers exist (mode, memory scope, tool access, etc).
    const triggers = page.getByTestId("info-popover-trigger");
    await expect(triggers.first()).toBeVisible({ timeout: 5_000 });
    expect(await triggers.count()).toBeGreaterThan(1);

    await triggers.first().click();
    await expect(page.getByTestId("info-popover-content")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/master switch for how visible Aion is here/i)).toBeVisible();
  });

  test("role overrides use a live-role picker when Discord roles are available", async ({ page }) => {
    await page.route("**/api/channels/discord/state", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          connected: true,
          user: { tag: "AionBot#0001" },
          guilds: [{
            id: "g1",
            name: "Test Guild",
            channels: [],
            roles: [
              { id: "r1", name: "Moderator", managed: false },
              { id: "r2", name: "@everyone", managed: false },
            ],
          }],
          snapshotAt: new Date(0).toISOString(),
        }),
      }),
    );

    const rolesRequest = page.waitForResponse("**/api/channels/discord/state");
    await page.goto("/comms/channels", { waitUntil: "domcontentloaded" });
    await rolesRequest;
    await page.getByTestId("channel-tab-access").click();
    await expect(page.getByText("Role overrides")).toBeVisible({ timeout: 10_000 });

    const addButton = page.getByRole("button", { name: /add.*override/i });
    if ((await addButton.count()) > 0) {
      await addButton.first().click();
      await expect(page.getByTestId("role-override-select").first()).toBeVisible({ timeout: 5_000 });
    }
  });
});
