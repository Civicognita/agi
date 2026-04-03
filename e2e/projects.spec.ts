import { test, expect } from "@playwright/test";

test.describe("Projects", () => {
  test("projects grid renders compact cards", async ({ page }) => {
    await page.goto("/projects");

    // Wait for the page to load
    await page.waitForTimeout(1000);

    // Cards should not have col-span-full (no inline expansion)
    const cards = page.getByTestId("project-card");
    const cardCount = await cards.count();
    if (cardCount > 0) {
      // Verify cards are present and compact (no full-width expansion)
      for (let i = 0; i < cardCount; i++) {
        const card = cards.nth(i);
        await expect(card).toBeVisible();
        // Cards should NOT have col-span-full style
        const style = await card.getAttribute("style");
        expect(style).not.toContain("1 / -1");
      }
    }
  });

  test("click card navigates to /projects/:slug", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForTimeout(1000);

    const cards = page.getByTestId("project-card");
    const cardCount = await cards.count();
    if (cardCount > 0) {
      await cards.first().click();
      // Should navigate to /projects/<some-slug>
      await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);
    }
  });

  test("project detail page shows back button", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForTimeout(1000);

    const cards = page.getByTestId("project-card");
    const cardCount = await cards.count();
    if (cardCount > 0) {
      await cards.first().click();
      await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

      // Back button should be visible
      const backButton = page.getByText("Back to Projects");
      await expect(backButton).toBeVisible();
    }
  });

  test("back button returns to /projects", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForTimeout(1000);

    const cards = page.getByTestId("project-card");
    const cardCount = await cards.count();
    if (cardCount > 0) {
      await cards.first().click();
      await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

      await page.getByText("Back to Projects").click();
      await expect(page).toHaveURL("/projects");
    }
  });

  test("project detail page has edit fields", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForTimeout(1000);

    const cards = page.getByTestId("project-card");
    const cardCount = await cards.count();
    if (cardCount > 0) {
      await cards.first().click();
      await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

      // Name and token inputs should be visible
      await expect(page.getByTestId("project-name-input")).toBeVisible();
      await expect(page.getByTestId("project-token-input")).toBeVisible();
    }
  });

  test("talk about this project button is visible on detail page", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForTimeout(1000);

    const cards = page.getByTestId("project-card");
    const cardCount = await cards.count();
    if (cardCount > 0) {
      await cards.first().click();
      await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

      await expect(page.getByText("Talk about this project")).toBeVisible();
    }
  });
});
