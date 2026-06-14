import { test, expect } from "@playwright/test";

test.describe("Projects — direct navigation regression (v0.4.864)", () => {
  // Regression: /projects/:slug crashed with ReferenceError when projectActivity
  // was in ProjectDetailProps but missing from function destructuring (v0.4.863).
  // These tests bypass the card-click path and navigate directly to the URL.

  test("direct navigation to /projects/sample-monorepo does not crash", async ({ page }) => {
    await page.goto("/projects/sample-monorepo", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/projects\/sample-monorepo(\?|#|$)/, { timeout: 10_000 });

    // ErrorBoundary renders "Something went wrong" on a crash — must NOT appear
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible({ timeout: 8_000 });

    // ProjectDetail renders — back button is the cheapest structural check
    await expect(page.getByText("Back to Projects")).toBeVisible({ timeout: 10_000 });
  });

  test("project detail page renders without JS errors on direct load", async ({ page }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (err) => jsErrors.push(err.message));

    await page.goto("/projects/sample-monorepo", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/projects\/sample-monorepo(\?|#|$)/);

    // Filter to ReferenceErrors which were the failure mode (projectActivity not defined)
    const refErrors = jsErrors.filter((m) => /ReferenceError/i.test(m));
    expect(refErrors).toHaveLength(0);
  });
});

test.describe("Projects", () => {
  test("projects grid renders compact cards", async ({ page }) => {
    await page.goto("/projects");

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

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
    await page.waitForLoadState("networkidle");

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
    await page.waitForLoadState("networkidle");

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
    await page.waitForLoadState("networkidle");

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
    await page.waitForLoadState("networkidle");

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
    await page.waitForLoadState("networkidle");

    const cards = page.getByTestId("project-card");
    const cardCount = await cards.count();
    if (cardCount > 0) {
      await cards.first().click();
      await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

      await expect(page.getByText("Talk about this project")).toBeVisible();
    }
  });
});
