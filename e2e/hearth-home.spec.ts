import { test, expect } from "@playwright/test";

/**
 * HearthHome e2e tests.
 *
 * Verifies the "/" route HearthHome: greeting, suggestion chips,
 * composer input, and right NeedsYouDrawer structure.
 * No LLM required — structural and interaction assertions only.
 *
 * s197 — Hearth Home.
 */

test.describe("HearthHome", () => {
  test("renders hearth-home container on root route", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("hearth-home")).toBeVisible();
  });

  test("renders greeting with time-of-day prefix", async ({ page }) => {
    await page.goto("/");
    const greeting = page.getByTestId("hearth-greeting");
    await expect(greeting).toBeVisible();
    // Greeting starts with one of the time-of-day phrases
    const text = await greeting.textContent();
    const validPrefixes = ["Good morning", "Good afternoon", "Good evening", "Good night"];
    expect(validPrefixes.some((p) => text?.startsWith(p))).toBe(true);
  });

  test("renders 'Aion is ready' calm state message", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Aion is ready/)).toBeVisible();
  });

  test("renders suggestion chips", async ({ page }) => {
    await page.goto("/");
    const chips = page.getByTestId("hearth-suggestion-chips");
    await expect(chips).toBeVisible();
    await expect(chips.getByText("What's on this week?")).toBeVisible();
    await expect(chips.getByText("Aionima status")).toBeVisible();
    await expect(chips.getByText("Review security scan")).toBeVisible();
  });

  test("suggestion chip click is interactive (no crash)", async ({ page }) => {
    await page.goto("/");
    const chip = page.getByTestId("hearth-suggestion-chips").getByText("What's on this week?");
    await expect(chip).toBeVisible();
    // Clicking opens chat — just assert no error heading appears
    await chip.click();
    await expect(page.getByRole("heading", { name: /error/i })).toHaveCount(0);
  });

  test("composer input is rendered and accepts text", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("hearth-composer-input");
    await expect(input).toBeVisible();
    await input.fill("test message");
    await expect(input).toHaveValue("test message");
  });

  test("composer input Enter key triggers chat (no crash)", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("hearth-composer-input");
    await input.fill("hello Aion");
    await input.press("Enter");
    await expect(page.getByRole("heading", { name: /error/i })).toHaveCount(0);
  });

  test("NeedsYouDrawer renders on root route", async ({ page }) => {
    await page.goto("/");
    // Use exact match — "/Needs you/i" regex also matches "needs your" in the all-clear body text
    await expect(page.getByText("Needs you", { exact: true })).toBeVisible();
  });

  test("NeedsYouDrawer has Today section", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Today", { exact: true })).toBeVisible();
  });

  test("NeedsYouDrawer shows all-clear or findings after load", async ({ page }) => {
    await page.goto("/");
    const drawer = page.locator('[data-testid="hearth-home"]');
    // Use toBeVisible() so Playwright retries until the async fetch settles —
    // count() is a one-shot snapshot that races with React state updates.
    await expect(
      drawer.getByText("All clear — nothing needs your attention right now.", { exact: false })
        .or(drawer.getByText(/Security —/))
        .first()
    ).toBeVisible({ timeout: 8000 });
  });

  test("HearthTop is still rendered on home page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("hearth-top")).toBeVisible();
  });

  test("no AppSidebar present on home page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  });
});
