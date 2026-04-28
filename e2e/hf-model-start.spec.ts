import { test, expect } from "@playwright/test";

/**
 * HF Model lifecycle e2e tests — installed view, start/stop, clear-cache.
 *
 * Runs against the test VM with a tiny model (sshleifer/tiny-gpt2, ~2.5MB).
 * Tests are idempotent — they handle model being in any state.
 */

test.describe("HF Model lifecycle", () => {
  test.setTimeout(120_000);

  test("Installed tab shows tiny-gpt2", async ({ page }) => {
    await page.goto("/hf-marketplace");
    await page.getByRole("button", { name: "Installed" }).click();
    await expect(page.getByText("tiny-gpt2")).toBeVisible({ timeout: 10_000 });
  });

  test("installed model has Start or Stop button", async ({ page }) => {
    await page.goto("/hf-marketplace");
    await page.getByRole("button", { name: "Installed" }).click();
    await expect(page.getByText("tiny-gpt2")).toBeVisible({ timeout: 10_000 });
    const startBtn = page.getByRole("button", { name: "Start" });
    const stopBtn = page.getByRole("button", { name: "Stop" });
    const hasStart = await startBtn.isVisible().catch(() => false);
    const hasStop = await stopBtn.isVisible().catch(() => false);
    expect(hasStart || hasStop).toBe(true);
  });

  test("model shows a status indicator", async ({ page }) => {
    await page.goto("/hf-marketplace");
    await page.getByRole("button", { name: "Installed" }).click();
    await expect(page.getByText("tiny-gpt2")).toBeVisible({ timeout: 10_000 });
    const body = await page.textContent("body");
    const hasStatus = body?.includes("Ready to start") ||
      body?.includes("Running") ||
      body?.includes("Starting") ||
      body?.includes("ready") ||
      body?.includes("running");
    expect(hasStatus).toBe(true);
  });

  test("Running tab loads without errors", async ({ page }) => {
    await page.goto("/hf-marketplace");
    await page.getByRole("button", { name: "Running" }).click();
    await expect(page).toHaveURL("/hf-marketplace");
    const errorOverlay = page.getByRole("heading", { name: /error/i });
    await expect(errorOverlay).toHaveCount(0);
  });

  test("clear-cache API returns ok", async ({ request }) => {
    const res = await request.post("/api/hf/models/sshleifer%2Ftiny-gpt2/clear-cache");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("model install API returns model with correct filePath", async ({ request }) => {
    const res = await request.get("/api/hf/models");
    expect(res.status()).toBe(200);
    const models = await res.json() as Array<{ id: string; filePath: string }>;
    const tiny = models.find(m => m.id === "sshleifer/tiny-gpt2");
    expect(tiny).toBeDefined();
    expect(tiny!.filePath).toContain("/snapshots/");
  });
});
