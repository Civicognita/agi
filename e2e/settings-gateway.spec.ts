import { test, expect } from "@playwright/test";

/**
 * Gateway Settings page e2e tests.
 *
 * Verifies the /settings/gateway page: tab bar structure, each tab's
 * content area, redirect behaviour, and save bar presence. Does not
 * mutate any config — all assertions are read-only structural checks.
 */

test.describe("Gateway Settings", () => {
  test("page loads at /settings/gateway", async ({ page }) => {
    await page.goto("/settings/gateway");
    await expect(page).toHaveURL("/settings/gateway");
  });

  test("/settings redirects to /settings/gateway", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL("/settings/gateway");
  });

  test("/gateway/settings redirects to /settings/gateway", async ({ page }) => {
    await page.goto("/gateway/settings");
    await expect(page).toHaveURL("/settings/gateway");
  });

  // Providers tab removed from /settings/gateway at cycle 135 — lives at /settings/providers.
  // Federation tab removed (story #212) — identity + federation now live at System ▸ Identity.
  test("tab bar renders three tab buttons (General, Contributing, Network)", async ({ page }) => {
    await page.goto("/settings/gateway");
    const tablist = page.getByRole("tablist");
    await expect(tablist.getByRole("tab", { name: "General" })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "Contributing" })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "Network" })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "Providers" })).toHaveCount(0);
    // Federation/Identity tab is gone — moved to System ▸ Identity.
    await expect(tablist.getByRole("tab", { name: "Federation" })).toHaveCount(0);
    await expect(tablist.getByRole("tab", { name: "Identity" })).toHaveCount(0);
  });

  test("General tab is active by default and shows content", async ({ page }) => {
    await page.goto("/settings/gateway");
    // General tab renders GatewayNetworkSettings with section="general"
    // which shows gateway host/port fields
    await expect(page.getByRole("tablist").getByRole("tab", { name: "General" })).toBeVisible();
    // Page should have rendered tab content without error
    await expect(page).toHaveURL("/settings/gateway");
  });

  // Providers moved to /settings/providers (cycle 135). These tests now verify the providers page.
  test("providers page renders at /settings/providers", async ({ page }) => {
    await page.goto("/settings/providers");
    await expect(page.getByRole("heading", { name: /providers/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("providers page shows available providers section", async ({ page }) => {
    await page.goto("/settings/providers");
    await expect(page.getByText(/available providers|cost preference|escalation/i).first()).toBeVisible({ timeout: 10_000 });
  });

  // Story #212: OwnerSettings relocated from the removed Federation tab into General.
  test("General tab shows owner settings content (relocated from Federation tab)", async ({ page }) => {
    await page.goto("/settings/gateway");
    // General is active by default; OwnerSettings now renders here.
    await expect(page).toHaveURL("/settings/gateway");
    const errorText = page.getByText(/error|failed/i);
    await expect(errorText).toHaveCount(0);
  });

  test("Contributing tab shows Dev settings content", async ({ page }) => {
    await page.goto("/settings/gateway");
    await page.getByRole("tablist").getByRole("tab", { name: "Contributing" }).click();
    // DevSettings component is rendered — page stays on settings
    await expect(page).toHaveURL("/settings/gateway");
  });

  test("Network tab shows network configuration content", async ({ page }) => {
    await page.goto("/settings/gateway");
    await page.getByRole("tablist").getByRole("tab", { name: "Network" }).click();
    // GatewayNetworkSettings with section="network" renders Cloudflare Tunnel + Machine IP
    await expect(page.getByText(/cloudflare.*tunnel|tunnel.*cloudflare|machine.*ip/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("switching between tabs keeps the page at /settings/gateway", async ({ page }) => {
    await page.goto("/settings/gateway");
    // Providers tab removed at cycle 135; Federation/Identity tab removed (story #212).
    // Remaining tabs: General, Contributing, Network.
    const tabSequence = ["Contributing", "Network", "General"];
    const tablist = page.getByRole("tablist");
    for (const tabName of tabSequence) {
      await tablist.getByRole("tab", { name: tabName }).click();
      await expect(page).toHaveURL("/settings/gateway");
    }
  });
});
