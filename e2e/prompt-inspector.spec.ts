import { test, expect } from "@playwright/test";

/**
 * Prompt Inspector admin page e2e tests.
 *
 * Route: /system/prompt-inspector
 * Backend: POST /api/admin/prompt-preview (private-network guarded)
 *
 * Surfaces the assembled dynamic-context system prompt for a given
 * RequestType so operators can verify what Aion sees per request.
 */

test.describe("Prompt Inspector", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/system/prompt-inspector");
  });

  test("page loads with the expected heading", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /Prompt Inspector/i })).toBeVisible();
  });

  test("request type selector is rendered with all seven types", async ({ page }) => {
    const select = page.getByTestId("prompt-inspector-request-type");
    await expect(select).toBeVisible();
    for (const type of ["chat", "project", "entity", "knowledge", "system", "worker", "taskmaster"]) {
      await expect(select.locator(`option[value="${type}"]`)).toHaveCount(1);
    }
  });

  test("defaulting to chat renders the assembled prompt and metadata", async ({ page }) => {
    const promptBlock = page.getByTestId("prompt-inspector-prompt");
    await expect(promptBlock).toBeVisible({ timeout: 10_000 });
    await expect(promptBlock).not.toBeEmpty();
    await expect(page.getByTestId("prompt-inspector-token-estimate")).toBeVisible();
    await expect(page.getByTestId("prompt-inspector-section-count")).toBeVisible();
  });

  test("changing the request type keeps the prompt visible without error", async ({ page }) => {
    // On a default install, all request types may produce the same system prompt
    // (same sections/tokens). Test that selecting a new type triggers a re-fetch
    // without crashing — prompt block remains visible, no error banner appears.
    const promptBlock = page.getByTestId("prompt-inspector-prompt");
    await expect(promptBlock).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("prompt-inspector-request-type").selectOption("worker");

    // Prompt stays visible after re-fetch (preview is kept while refreshing)
    await expect(promptBlock).toBeVisible({ timeout: 10_000 });
    // No error banner rendered
    await expect(page.locator("[class*='text-red']")).toHaveCount(0);
    // Token estimate still present (metadata block didn't disappear)
    await expect(page.getByTestId("prompt-inspector-token-estimate")).toBeVisible();
  });

  test("workspace chip admin tab has a Prompt Inspector entry", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("workspace-chip").click();
    const dropdown = page.getByTestId("workspace-chip-dropdown");
    await dropdown.getByRole("button", { name: "Admin" }).click();
    await expect(dropdown.getByRole("link", { name: "Prompt Inspector" })).toBeVisible();
  });
});
