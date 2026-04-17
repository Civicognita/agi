import { test, expect } from "@playwright/test";

/**
 * Dashboard Overview e2e tests.
 *
 * Verifies the root "/" route: default redirect, tab structure
 * (Usage & Cost / Impactinomics), admin sidebar presence, and
 * navigation to key pages from the overview. No LLM or inference
 * required — structural and navigation assertions only.
 */

test.describe("Dashboard Overview", () => {
  test("root route loads without redirect", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/");
  });

  test("sidebar is rendered", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
  });

  test("overview page renders Usage & Cost tab by default", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Usage & Cost" })).toBeVisible();
  });

  test("overview page renders Impactinomics tab", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Impactinomics" })).toBeVisible();
  });

  test("switching to Impactinomics tab stays on root route", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Impactinomics" }).click();
    await expect(page).toHaveURL("/");
  });

  test("Usage & Cost tab content renders without error", async ({ page }) => {
    await page.goto("/");
    // UsageSection renders after the overview data loads
    await expect(page).toHaveURL("/");
    // No unhandled error headings should appear
    const errorHeading = page.getByRole("heading", { name: /error/i });
    await expect(errorHeading).toHaveCount(0);
  });

  test("sidebar shows Overview section in main mode", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar).toBeVisible();
    // Main mode sidebar has "Overview" section header
    const headers = sidebar.locator(".uppercase");
    await expect(headers.filter({ hasText: "Overview" })).toBeVisible();
  });

  test("sidebar shows Projects section in main mode", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar.locator(".uppercase").filter({ hasText: "Projects" })).toBeVisible();
  });

  test("sidebar shows Communication section in main mode", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar.locator(".uppercase").filter({ hasText: "Communication" })).toBeVisible();
  });

  test("sidebar switches to admin mode when navigating to gateway", async ({ page }) => {
    await page.goto("/gateway/workflows");
    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar).toBeVisible();
    // Admin mode shows Gateway section
    const headers = sidebar.locator(".uppercase");
    await expect(headers.filter({ hasText: "Gateway" })).toBeVisible();
  });

  test("sidebar shows admin Workflows link when in admin mode", async ({ page }) => {
    await page.goto("/gateway/workflows");
    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar.getByText("Workflows")).toBeVisible();
  });

  test("sidebar shows admin Settings link when in admin mode", async ({ page }) => {
    await page.goto("/settings/gateway");
    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar.getByText("Settings")).toBeVisible();
  });

  test("COA Explorer nav item navigates to /coa", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-impactinomics-coa-explorer").click();
    await expect(page).toHaveURL("/coa");
  });

  test("overview nav item is active on root route", async ({ page }) => {
    await page.goto("/");
    const overviewLink = page.getByTestId("nav-impactinomics-overview");
    await expect(overviewLink).toHaveClass(/bg-primary/);
  });
});
