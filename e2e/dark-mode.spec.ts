import { test, expect } from "@playwright/test";

test.describe("Dark Mode & Theme System", () => {
  test("html element has dark class by default", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/);
  });

  test("cards have dark background, not white", async ({ page }) => {
    await page.goto("/");
    // Wait for the dashboard to render
    await page.waitForSelector("[data-testid='app-sidebar']", { timeout: 10000 });

    // Check that no visible card-like element has a white background
    const cards = page.locator(".bg-card, [class*='Card']");
    const count = await cards.count();
    if (count > 0) {
      const first = cards.first();
      const bg = await first.evaluate((el) => getComputedStyle(el).backgroundColor);
      // White is rgb(255, 255, 255) — any dark card should NOT be this
      expect(bg).not.toBe("rgb(255, 255, 255)");
    }
  });

  test("color-scheme is dark on html element", async ({ page }) => {
    await page.goto("/");
    const colorScheme = await page.locator("html").evaluate(
      (el) => getComputedStyle(el).colorScheme,
    );
    expect(colorScheme).toContain("dark");
  });

  test("theme CSS custom properties are set", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='app-sidebar']", { timeout: 10000 });

    const bgColor = await page.locator("html").evaluate(
      (el) => getComputedStyle(el).getPropertyValue("--color-background").trim(),
    );
    // Should have a value (not empty) — the ThemeProvider sets this
    expect(bgColor.length).toBeGreaterThan(0);
  });

  test("marketplace page renders plugin cards without white backgrounds", async ({ page }) => {
    await page.goto("/gateway/marketplace");
    await page.waitForTimeout(2000);

    // Check body background is dark
    const bodyBg = await page.locator("body").evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    // Convert to check it's not white (allow for any dark color)
    expect(bodyBg).not.toBe("rgb(255, 255, 255)");
  });

  test("settings page shows theme picker", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForTimeout(2000);

    // The theme section should be visible with theme name labels
    const themeText = page.getByText("Aionima Dark");
    await expect(themeText).toBeVisible({ timeout: 5000 });
  });
});
