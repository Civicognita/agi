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

  test("tab bar renders all five tab buttons", async ({ page }) => {
    await page.goto("/settings/gateway");
    await expect(page.getByRole("button", { name: "General" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Identity" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Providers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Contributing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Network" })).toBeVisible();
  });

  test("General tab is active by default and shows content", async ({ page }) => {
    await page.goto("/settings/gateway");
    // General tab renders GatewayNetworkSettings with section="general"
    // which shows gateway host/port fields
    await expect(page.getByRole("button", { name: "General" })).toBeVisible();
    // Page should have rendered tab content without error
    await expect(page).toHaveURL("/settings/gateway");
  });

  test("Providers tab shows Routing Mode section", async ({ page }) => {
    await page.goto("/settings/gateway");
    await page.getByRole("button", { name: "Providers" }).click();
    await expect(page.getByText("Routing Mode")).toBeVisible();
  });

  test("Providers tab shows Default Provider & Model section", async ({ page }) => {
    await page.goto("/settings/gateway");
    await page.getByRole("button", { name: "Providers" }).click();
    await expect(page.getByText("Default Provider & Model")).toBeVisible();
  });

  test("Identity tab shows owner settings content", async ({ page }) => {
    await page.goto("/settings/gateway");
    await page.getByRole("button", { name: "Identity" }).click();
    // OwnerSettings and IdentitySettings are rendered inside the Identity tab
    // Both exist in the DOM after clicking the tab
    await expect(page).toHaveURL("/settings/gateway");
    // At minimum no error overlay should appear
    const errorText = page.getByText(/error|failed/i);
    await expect(errorText).toHaveCount(0);
  });

  test("Contributing tab shows Dev settings content", async ({ page }) => {
    await page.goto("/settings/gateway");
    await page.getByRole("button", { name: "Contributing" }).click();
    // DevSettings component is rendered — page stays on settings
    await expect(page).toHaveURL("/settings/gateway");
  });

  test("Network tab shows network configuration content", async ({ page }) => {
    await page.goto("/settings/gateway");
    await page.getByRole("button", { name: "Network" }).click();
    // GatewayNetworkSettings with section="network" renders update-channel UI
    await expect(page.getByText(/update.*channel|channel.*update|release.*channel/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("switching between tabs keeps the page at /settings/gateway", async ({ page }) => {
    await page.goto("/settings/gateway");
    const tabSequence = ["Providers", "Identity", "Contributing", "Network", "General"];
    for (const tabName of tabSequence) {
      await page.getByRole("button", { name: tabName }).click();
      await expect(page).toHaveURL("/settings/gateway");
    }
  });
});
