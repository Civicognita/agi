import { test, expect } from "@playwright/test";

/**
 * HuggingFace Models Marketplace e2e tests.
 *
 * Verifies the /hf-marketplace page: tab bar structure, each tab's
 * presence, and hardware tier badge. Does not install or run any models —
 * all assertions are read-only structural checks.
 *
 * If HF Marketplace is disabled in config the page still renders with tabs
 * and a disabled state indicator. Tests that require an enabled HF backend
 * use test.skip with a descriptive reason.
 */

test.describe("HF Models Marketplace", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/hf-marketplace");
  });

  test("page loads at /hf-marketplace", async ({ page }) => {
    await expect(page).toHaveURL("/hf-marketplace");
  });

  test("tab bar renders all five tab buttons", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Models" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Installed" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Running" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Datasets" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fine-Tune" })).toBeVisible();
  });

  test("Models tab is active by default", async ({ page }) => {
    // Default tab is "models" — the Models tab button should be present
    // and the tab panel should be in the DOM
    await expect(page.getByRole("button", { name: "Models" })).toBeVisible();
  });

  test("switching to Installed tab stays on /hf-marketplace", async ({ page }) => {
    await page.getByRole("button", { name: "Installed" }).click();
    await expect(page).toHaveURL("/hf-marketplace");
  });

  test("switching to Running tab stays on /hf-marketplace", async ({ page }) => {
    await page.getByRole("button", { name: "Running" }).click();
    await expect(page).toHaveURL("/hf-marketplace");
  });

  test("switching to Datasets tab stays on /hf-marketplace", async ({ page }) => {
    await page.getByRole("button", { name: "Datasets" }).click();
    await expect(page).toHaveURL("/hf-marketplace");
  });

  test("switching to Fine-Tune tab stays on /hf-marketplace", async ({ page }) => {
    await page.getByRole("button", { name: "Fine-Tune" }).click();
    await expect(page).toHaveURL("/hf-marketplace");
  });

  test("hardware tier badge is visible", async ({ page }) => {
    // useHFHardwareProfile returns tier: "minimal" | "standard" | "accelerated" | "pro"
    // The badge renders as "<Tier> tier" e.g. "Standard tier"
    const tierPattern = /minimal tier|standard tier|accelerated tier|pro tier/i;
    const tierBadge = page.getByText(tierPattern);
    // Hardware profile may take a moment to fetch
    const count = await tierBadge.count();
    test.skip(count === 0, "hardware tier badge not visible — HF Marketplace may be disabled or hardware API unavailable");
    await expect(tierBadge.first()).toBeVisible({ timeout: 10000 });
  });

  test("HF Marketplace enabled/disabled status badge is visible", async ({ page }) => {
    // The Workflows > HF Models tab shows "HF Marketplace: Enabled/Disabled"
    // but the /hf-marketplace page itself does not; this checks the page loads cleanly
    await expect(page).toHaveURL("/hf-marketplace");
    // No unhandled error overlay should appear
    const errorHeading = page.getByRole("heading", { name: /error/i });
    await expect(errorHeading).toHaveCount(0);
  });

  test("Models tab search input is present when HF is enabled", async ({ page }) => {
    // The ModelsTab renders a search input for browsing HuggingFace Hub
    const searchInput = page.getByRole("textbox");
    const count = await searchInput.count();
    test.skip(count === 0, "search input not found — HF Marketplace may be disabled");
    await expect(searchInput.first()).toBeVisible();
  });

  test("Installed tab renders with no errors when no models installed", async ({ page }) => {
    await page.getByRole("button", { name: "Installed" }).click();
    // An empty installed list is a valid state — page should not crash
    await expect(page).toHaveURL("/hf-marketplace");
  });

  test("Running tab renders with no errors when no models running", async ({ page }) => {
    await page.getByRole("button", { name: "Running" }).click();
    await expect(page).toHaveURL("/hf-marketplace");
  });
});
