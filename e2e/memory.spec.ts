import { test, expect } from "@playwright/test";

/**
 * Memory browser (Wave 4 s231) — app-wide "Aion's Mind" page over the global
 * memory APIs. Events are route-mocked for a deterministic assertion.
 */
test.describe("Memory browser", () => {
  test("loads at /memory with search + tabs", async ({ page }) => {
    await page.route("**/api/memory/events**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          events: [
            { id: "m1", summary: "Owner prefers concise replies, no exclamation marks.", tags: ["preference", "tone"], confidence: 0.92, createdAt: "2026-06-15T10:00:00.000Z", projectPath: null, coaFingerprint: "abc123" },
            { id: "m2", summary: "kronos_trader uses RSI signal upgrade in step_01.", tags: ["project"], confidence: 0.8, createdAt: "2026-06-16T09:00:00.000Z", projectPath: "/home/p/kronos_trader", coaFingerprint: "def456" },
          ],
        }),
      }),
    );
    await page.goto("/memory");
    await expect(page.getByTestId("memory-page")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("memory-search")).toBeVisible();
    await expect(page.getByTestId("memory-tab-events")).toBeVisible();
    await expect(page.getByTestId("memory-tab-docs")).toBeVisible();
    await expect(page.getByTestId("memory-event-row")).toHaveCount(2);
  });

  test("empty state when no memories match", async ({ page }) => {
    await page.route("**/api/memory/events**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [] }) }),
    );
    await page.goto("/memory");
    await expect(page.getByTestId("memory-empty")).toBeVisible({ timeout: 10_000 });
  });
});
