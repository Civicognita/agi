import { test, expect } from "@playwright/test";

/**
 * Providers tab e2e tests — Settings > Gateway > Providers.
 *
 * Tests the redesigned layout:
 *   1. Default Provider & Model (top)
 *   2. Routing Mode
 *   3. Providers (collapsible accordion rows with status dots, or empty state)
 *   4. Worker Provider Overrides (bottom)
 *
 * HF models appear as provider entries — no separate "HuggingFace Local Models" card.
 */

test.describe("Providers tab — layout and structure", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings/gateway");
    await page.getByRole("button", { name: "Providers" }).click();
    await page.waitForTimeout(1000);
  });

  test("Default Provider & Model heading appears before Routing Mode", async ({ page }) => {
    const body = await page.textContent("body");
    const dpIdx = body?.indexOf("Default Provider & Model") ?? -1;
    const rmIdx = body?.indexOf("Routing Mode") ?? -1;
    expect(dpIdx).toBeGreaterThan(-1);
    expect(rmIdx).toBeGreaterThan(-1);
    expect(dpIdx).toBeLessThan(rmIdx);
  });

  test("Routing Mode card is rendered", async ({ page }) => {
    await expect(page.getByText("Routing Mode")).toBeVisible();
  });

  test("all four routing mode options are rendered", async ({ page }) => {
    await expect(page.getByText("Local Only")).toBeVisible();
    await expect(page.getByText("Economy", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Balanced.*Route by/ })).toBeVisible();
    await expect(page.getByText("Max Quality")).toBeVisible();
  });

  test("routing mode cost labels are rendered", async ({ page }) => {
    await expect(page.getByText("Free")).toBeVisible();
    await expect(page.getByText("$$$")).toBeVisible();
  });

  test("Providers section heading is rendered", async ({ page }) => {
    await expect(page.getByText("Providers", { exact: true }).first()).toBeVisible();
  });

  test("providers section shows accordion or empty state", async ({ page }) => {
    const accordion = page.getByTestId("provider-accordion");
    const emptyMsg = page.getByText("No providers registered");
    const hasAccordion = await accordion.isVisible().catch(() => false);
    const hasEmpty = await emptyMsg.isVisible().catch(() => false);
    expect(hasAccordion || hasEmpty).toBe(true);
  });

  test("if providers exist, rows have status dots", async ({ page }) => {
    const accordion = page.getByTestId("provider-accordion");
    if (await accordion.isVisible().catch(() => false)) {
      const dots = page.getByTestId("provider-status-dot");
      await expect(dots.first()).toBeVisible();
    }
  });

  test("if providers exist, clicking a row expands its content", async ({ page }) => {
    const accordion = page.getByTestId("provider-accordion");
    if (await accordion.isVisible().catch(() => false)) {
      const trigger = page.locator("[data-react-fancy-accordion-trigger]").first();
      await trigger.click();
      const content = page.locator("[data-react-fancy-accordion-content]").first();
      await expect(content).toBeVisible();
    }
  });

  test("Default Provider & Model card has Active Provider dropdown", async ({ page }) => {
    await expect(page.getByText("Active Provider")).toBeVisible();
  });

  test("Default Provider & Model card has Model dropdown", async ({ page }) => {
    await expect(page.getByText("Model", { exact: true }).first()).toBeVisible();
  });

  test("model quick-switch chips are rendered", async ({ page }) => {
    const chips = page.getByTestId("model-quick-switch");
    await expect(chips).toBeVisible();
  });

  test("Worker Provider Overrides section is rendered", async ({ page }) => {
    await expect(page.getByText("Worker Provider Overrides")).toBeVisible();
  });

  test("no separate HuggingFace Local Models card exists", async ({ page }) => {
    await expect(page.getByText("HuggingFace Local Models")).not.toBeVisible();
  });

  test("clicking Local Only mode does not navigate away", async ({ page }) => {
    await page.getByText("Local Only").click();
    await expect(page).toHaveURL(/\/settings\/gateway/);
  });

  test("escalation checkbox appears for economy/balanced modes", async ({ page }) => {
    await page.getByText("Economy", { exact: true }).click();
    await expect(page.getByText("Enable escalation")).toBeVisible();
  });
});
