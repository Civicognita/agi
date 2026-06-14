import { test, expect } from "@playwright/test";

/**
 * Hearth shell e2e tests — s196 acceptance criteria.
 *
 * Verifies:
 * 1. HearthTop renders on every page; AppSidebar gone
 * 2. WorkspaceChip shows workspace name + colored dot
 * 3. WorkspaceChip dropdown opens with workspace list
 * 4. All existing routes navigable; no 404s or broken nav
 */

const ROUTES = [
  "/",
  "/projects",
  "/comms",
  "/knowledge",
  "/docs",
  "/notes",
  "/reports",
  "/coa",
  "/gateway/marketplace",
  "/gateway/workflows",
  "/gateway/logs",
  "/system",
  "/system/services",
  "/system/changelog",
  "/system/incidents",
  "/system/vendors",
  "/system/backups",
  "/system/security",
  "/system/identity",
  "/system/admin",
  "/system/prompt-inspector",
  "/settings/gateway",
  "/settings/providers",
  "/identity/pending",
  "/magic-apps",
  "/hf-marketplace",
];

test.describe("Hearth Shell — HearthTop", () => {
  test("HearthTop renders on root route", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("hearth-top")).toBeVisible();
  });

  test("HearthTop renders on /projects route", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByTestId("hearth-top")).toBeVisible();
  });

  test("HearthTop renders on /settings/gateway route", async ({ page }) => {
    await page.goto("/settings/gateway");
    await expect(page.getByTestId("hearth-top")).toBeVisible();
  });

  test("HearthTop renders on /system route", async ({ page }) => {
    await page.goto("/system");
    await expect(page.getByTestId("hearth-top")).toBeVisible();
  });

  test("no AppSidebar on any page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  });

  test("HearthTop contains Aionima brand text", async ({ page }) => {
    await page.goto("/");
    const top = page.getByTestId("hearth-top");
    await expect(top.getByText("Aionima")).toBeVisible();
  });
});

test.describe("Hearth Shell — WorkspaceChip", () => {
  test("workspace chip is visible with workspace name", async ({ page }) => {
    await page.goto("/");
    const chip = page.getByTestId("workspace-chip");
    await expect(chip).toBeVisible();
    // Default workspace is "Home"
    await expect(chip.getByText("Home")).toBeVisible();
  });

  test("workspace chip shows colored dot (first letter badge)", async ({ page }) => {
    await page.goto("/");
    const chip = page.getByTestId("workspace-chip");
    // The colored initial badge renders a span with first letter of workspace name
    const badge = chip.locator("span").first();
    await expect(badge).toBeVisible();
  });

  test("workspace chip dropdown opens on click", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("workspace-chip").click();
    await expect(page.getByTestId("workspace-chip-dropdown")).toBeVisible();
  });

  test("dropdown shows workspace list", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("workspace-chip").click();
    const dropdown = page.getByTestId("workspace-chip-dropdown");
    // Workspace section header
    await expect(dropdown.getByText("Workspace")).toBeVisible();
    // "Home" workspace entry with "active" label
    await expect(dropdown.getByText("active")).toBeVisible();
  });

  test("dropdown has Main and Admin nav tabs", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("workspace-chip").click();
    const dropdown = page.getByTestId("workspace-chip-dropdown");
    await expect(dropdown.getByRole("button", { name: "Main" })).toBeVisible();
    await expect(dropdown.getByRole("button", { name: "Admin" })).toBeVisible();
  });

  test("dropdown closes when backdrop is clicked", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("workspace-chip").click();
    await expect(page.getByTestId("workspace-chip-dropdown")).toBeVisible();
    await page.mouse.click(800, 400);
    await expect(page.getByTestId("workspace-chip-dropdown")).toHaveCount(0);
  });

  test("nav item click closes dropdown", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("workspace-chip").click();
    await page.getByTestId("workspace-chip-dropdown").getByRole("link", { name: "All Projects" }).click();
    await expect(page.getByTestId("workspace-chip-dropdown")).toHaveCount(0);
  });
});

test.describe("Hearth Shell — Route Accessibility", () => {
  for (const route of ROUTES) {
    test(`${route} loads without error`, async ({ page }) => {
      await page.goto(route);
      // HearthTop must be present — verifies shell renders on every route
      await expect(page.getByTestId("hearth-top")).toBeVisible();
      // No unhandled error headings
      await expect(page.getByRole("heading", { name: /error/i })).toHaveCount(0);
    });
  }
});
