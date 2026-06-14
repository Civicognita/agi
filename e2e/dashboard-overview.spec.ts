import { test, expect } from "@playwright/test";

/**
 * Dashboard Overview e2e tests.
 *
 * Verifies the root "/" route: HearthTop shell, tab structure
 * (Usage & Cost / Impactinomics), and navigation. No LLM or inference
 * required — structural and navigation assertions only.
 *
 * s196 — updated from sidebar-based shell to HearthTop shell.
 */

test.describe("Dashboard Overview", () => {
  test("root route loads without redirect", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/");
  });

  test("HearthTop bar is rendered on every page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("hearth-top")).toBeVisible();
  });

  test("no AppSidebar present after Hearth shell migration", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  });

  test("overview page renders Usage & Cost tab by default", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("tab", { name: "Usage & Cost" })).toBeVisible();
  });

  test("overview page renders Impactinomics tab", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("tab", { name: "Impactinomics" })).toBeVisible();
  });

  test("switching to Impactinomics tab stays on root route", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "Impactinomics" }).click();
    await expect(page).toHaveURL("/");
  });

  test("Usage & Cost tab content renders without error", async ({ page }) => {
    await page.goto("/");
    const errorHeading = page.getByRole("heading", { name: /error/i });
    await expect(errorHeading).toHaveCount(0);
  });

  test("workspace chip shows main nav sections in dropdown", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("workspace-chip").click();
    const dropdown = page.getByTestId("workspace-chip-dropdown");
    await expect(dropdown.getByText("Overview", { exact: true })).toBeVisible();
    await expect(dropdown.getByText("Projects", { exact: true })).toBeVisible();
    await expect(dropdown.getByText("Communication", { exact: true })).toBeVisible();
    await expect(dropdown.getByText("Knowledge", { exact: true })).toBeVisible();
    // Admin sections must not appear in Main tab
    await expect(dropdown.getByText("Gateway", { exact: true })).toHaveCount(0);
    await expect(dropdown.getByText("System", { exact: true })).toHaveCount(0);
  });

  test("workspace chip admin tab shows gateway + system sections", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("workspace-chip").click();
    const dropdown = page.getByTestId("workspace-chip-dropdown");
    await dropdown.getByRole("button", { name: "Admin" }).click();
    await expect(dropdown.getByText("Gateway", { exact: true })).toBeVisible();
    await expect(dropdown.getByText("System", { exact: true })).toBeVisible();
  });

  test("COA Explorer nav item navigates to /coa", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("workspace-chip").click();
    await page.getByTestId("workspace-chip-dropdown").getByRole("link", { name: "COA Explorer" }).click();
    await expect(page).toHaveURL("/coa");
  });

  test("COA Explorer nav item has active styling on /coa route", async ({ page }) => {
    await page.goto("/coa");
    await page.getByTestId("workspace-chip").click();
    const coaLink = page.getByTestId("workspace-chip-dropdown").getByRole("link", { name: "COA Explorer" });
    await expect(coaLink).toHaveClass(/bg-primary/);
  });
});
