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

  test("changing the request type refreshes the prompt", async ({ page }) => {
    const promptBlock = page.getByTestId("prompt-inspector-prompt");
    await expect(promptBlock).toBeVisible({ timeout: 10_000 });
    const initial = await promptBlock.textContent();

    await page.getByTestId("prompt-inspector-request-type").selectOption("worker");

    await expect(async () => {
      const updated = await promptBlock.textContent();
      expect(updated).not.toEqual(initial);
    }).toPass({ timeout: 10_000 });
  });

  test("admin sidebar has a Prompt Inspector entry", async ({ page }) => {
    await expect(page.getByRole("link", { name: /Prompt Inspector/ })).toBeVisible();
  });
});
