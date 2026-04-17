import { test, expect } from "@playwright/test";

/**
 * Router / Providers settings e2e tests.
 *
 * Verifies Settings > Gateway > Providers tab structural content:
 * routing mode selector, provider API key section, default provider & model
 * dropdowns, and worker provider overrides. No actual API keys are touched —
 * tests are read-only structural assertions.
 */

test.describe("Router Settings — Providers tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings/gateway");
    // Navigate to Providers tab (rendered as <button> in the custom tab bar)
    await page.getByRole("button", { name: "Providers" }).click();
  });

  test("Providers tab content is visible after click", async ({ page }) => {
    await expect(page.getByText("Routing Mode")).toBeVisible();
  });

  test("routing mode section heading is present", async ({ page }) => {
    await expect(page.getByText("Routing Mode")).toBeVisible();
  });

  test("all four routing mode options are rendered", async ({ page }) => {
    await expect(page.getByText("Local Only")).toBeVisible();
    await expect(page.getByText("Economy")).toBeVisible();
    await expect(page.getByText("Balanced")).toBeVisible();
    await expect(page.getByText("Max Quality")).toBeVisible();
  });

  test("routing mode option cost labels are rendered", async ({ page }) => {
    // Each mode card shows a cost indicator: Free, $, $$, $$$
    await expect(page.getByText("Free")).toBeVisible();
    await expect(page.getByText("$", { exact: true }).first()).toBeVisible();
  });

  test("provider API keys section heading is present", async ({ page }) => {
    await expect(page.getByText("Provider API Keys")).toBeVisible();
  });

  test("Anthropic provider row is rendered", async ({ page }) => {
    await expect(page.getByText("Anthropic")).toBeVisible();
  });

  test("OpenAI provider row is rendered", async ({ page }) => {
    await expect(page.getByText("OpenAI")).toBeVisible();
  });

  test("Ollama provider shows no-key-needed label", async ({ page }) => {
    await expect(page.getByText("No key needed")).toBeVisible();
  });

  test("default provider and model section heading is present", async ({ page }) => {
    await expect(page.getByText("Default Provider & Model")).toBeVisible();
  });

  test("Active Provider label is rendered", async ({ page }) => {
    await expect(page.getByText("Active Provider")).toBeVisible();
  });

  test("Model label is rendered", async ({ page }) => {
    await expect(page.getByText("Model", { exact: true })).toBeVisible();
  });

  test("worker provider overrides section is rendered", async ({ page }) => {
    await expect(page.getByText("Worker Provider Overrides")).toBeVisible();
  });

  test("HuggingFace local models section is rendered", async ({ page }) => {
    await expect(page.getByText("HuggingFace Local Models")).toBeVisible();
  });

  test("clicking Local Only mode button does not navigate away", async ({ page }) => {
    await page.getByText("Local Only").click();
    await expect(page).toHaveURL("/settings/gateway");
  });
});
