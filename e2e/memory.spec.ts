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
            { id: "m1", summary: "Owner prefers concise replies, no exclamation marks.", tags: ["preference", "tone"], confidence: 0.92, createdAt: "2026-06-15T10:00:00.000Z", projectPath: null, scope: "gestalt", coaFingerprint: "abc123" },
            { id: "m2", summary: "Triage discussion in the #bugs channel.", tags: ["channel"], confidence: 0.8, createdAt: "2026-06-16T09:00:00.000Z", projectPath: "/home/p/kronos_trader", scope: "room:discord:guild-1:bugs", coaFingerprint: "def456" },
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
    // s234 — each memory shows its locality badge.
    const scopes = page.getByTestId("memory-event-scope");
    await expect(scopes).toHaveCount(2);
    await expect(scopes.filter({ hasText: "machine-wide" })).toHaveCount(1);
    await expect(scopes.filter({ hasText: "room · discord" })).toHaveCount(1);
    // Regression: createdAt must render as a real date, never "Invalid Date".
    const dates = page.getByTestId("memory-event-date");
    await expect(dates).toHaveCount(2);
    await expect(dates.filter({ hasText: "Invalid Date" })).toHaveCount(0);
    await expect(dates.first()).not.toHaveText("—");
  });

  test("renders — (not 'Invalid Date') if the API returns an unparseable createdAt", async ({ page }) => {
    // Guards the exact bug: the endpoint used to emit String(epochMs) = a numeric
    // string, which `new Date()` can't parse. The row must degrade to "—".
    await page.route("**/api/memory/events**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          events: [
            { id: "m1", summary: "Row with a legacy numeric-string timestamp.", tags: [], confidence: 0.5, createdAt: "1719792000000", projectPath: null, scope: "gestalt", coaFingerprint: "x1" },
          ],
        }),
      }),
    );
    await page.goto("/memory");
    await expect(page.getByTestId("memory-event-row")).toHaveCount(1);
    const date = page.getByTestId("memory-event-date");
    await expect(date).toHaveText("—");
    await expect(date.filter({ hasText: "Invalid Date" })).toHaveCount(0);
  });

  test("empty state when no memories match", async ({ page }) => {
    await page.route("**/api/memory/events**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [] }) }),
    );
    await page.goto("/memory");
    await expect(page.getByTestId("memory-empty")).toBeVisible({ timeout: 10_000 });
  });
});
