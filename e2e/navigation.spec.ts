import { test, expect } from "@playwright/test";

/**
 * Navigation e2e tests — Hearth shell (WorkspaceChip dropdown).
 *
 * Navigation is through the WorkspaceChip dropdown in HearthTop.
 * Main nav items are links in the "Main" tab; admin nav items are in
 * the "Admin" tab. The chip trigger has data-testid="workspace-chip";
 * the dropdown has data-testid="workspace-chip-dropdown".
 *
 * s196 — updated from sidebar-based navigation to WorkspaceChip navigation.
 */

async function openChip(page: import("@playwright/test").Page) {
  await page.getByTestId("workspace-chip").click();
  await expect(page.getByTestId("workspace-chip-dropdown")).toBeVisible();
}

async function navigateTo(page: import("@playwright/test").Page, label: string) {
  await openChip(page);
  await page.getByTestId("workspace-chip-dropdown").getByRole("link", { name: label }).click();
}

async function navigateToAdmin(page: import("@playwright/test").Page, label: string) {
  await openChip(page);
  const dropdown = page.getByTestId("workspace-chip-dropdown");
  await dropdown.getByRole("button", { name: "Admin" }).click();
  await dropdown.getByRole("link", { name: label }).click();
}

test.describe("WorkspaceChip Navigation", () => {
  test("workspace chip is visible on load", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("workspace-chip")).toBeVisible();
  });

  test("clicking chip opens dropdown", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("workspace-chip").click();
    await expect(page.getByTestId("workspace-chip-dropdown")).toBeVisible();
  });

  test("main tab shows main nav sections", async ({ page }) => {
    await page.goto("/");
    await openChip(page);
    const dropdown = page.getByTestId("workspace-chip-dropdown");
    await expect(dropdown.getByText("Overview", { exact: true })).toBeVisible();
    await expect(dropdown.getByText("Projects", { exact: true })).toBeVisible();
    await expect(dropdown.getByText("Communication", { exact: true })).toBeVisible();
    await expect(dropdown.getByText("Knowledge", { exact: true })).toBeVisible();
  });

  test("admin tab shows admin nav sections", async ({ page }) => {
    await page.goto("/");
    await openChip(page);
    const dropdown = page.getByTestId("workspace-chip-dropdown");
    await dropdown.getByRole("button", { name: "Admin" }).click();
    await expect(dropdown.getByText("Gateway", { exact: true })).toBeVisible();
    await expect(dropdown.getByText("System", { exact: true })).toBeVisible();
    await expect(dropdown.getByText("Marketplace", { exact: true })).toBeVisible();
  });

  test("clicking main nav item navigates and closes dropdown", async ({ page }) => {
    await page.goto("/");
    await navigateTo(page, "COA Explorer");
    await expect(page).toHaveURL("/coa");
    await expect(page.getByTestId("workspace-chip-dropdown")).toHaveCount(0);
  });

  test("All Projects navigates to /projects", async ({ page }) => {
    await page.goto("/");
    await navigateTo(page, "All Projects");
    await expect(page).toHaveURL("/projects");
  });

  test("All Messages navigates to /comms", async ({ page }) => {
    await page.goto("/");
    await navigateTo(page, "All Messages");
    await expect(page).toHaveURL("/comms");
  });

  test("Dashboard item navigates to /", async ({ page }) => {
    await page.goto("/coa");
    await navigateTo(page, "Dashboard");
    await expect(page).toHaveURL("/");
  });

  test("backdrop click closes dropdown", async ({ page }) => {
    await page.goto("/");
    await openChip(page);
    // Click on the backdrop div (covers full screen behind dropdown)
    await page.mouse.click(800, 400);
    await expect(page.getByTestId("workspace-chip-dropdown")).toHaveCount(0);
  });

  test("chat flyout is always visible in shell (no header button needed)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("chat-flyout")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("header-chat-button")).toHaveCount(0);
  });
});

test.describe("Admin Navigation", () => {
  test("admin tab Workflows link navigates to /gateway/workflows", async ({ page }) => {
    await page.goto("/");
    await navigateToAdmin(page, "Workflows");
    await expect(page).toHaveURL("/gateway/workflows");
  });

  test("admin tab Settings link navigates to /settings", async ({ page }) => {
    await page.goto("/");
    await navigateToAdmin(page, "Settings");
    await expect(page).toHaveURL("/settings/gateway");
  });

  test("admin tab Plugins link navigates to /gateway/marketplace", async ({ page }) => {
    await page.goto("/");
    await navigateToAdmin(page, "Plugins");
    await expect(page).toHaveURL("/gateway/marketplace");
  });
});

test.describe("Settings Navigation", () => {
  test("/settings redirects to /settings/gateway", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL("/settings/gateway");
  });

  test("old /gateway/settings redirects to /settings/gateway", async ({ page }) => {
    await page.goto("/gateway/settings");
    await expect(page).toHaveURL("/settings/gateway");
  });
});

test.describe("Communication Section", () => {
  test("Pending Identity link navigates to /identity/pending", async ({ page }) => {
    await page.goto("/");
    await navigateTo(page, "Pending Identity");
    await expect(page).toHaveURL("/identity/pending");
  });
});

test.describe("Knowledge Section", () => {
  test("Browse link navigates to /knowledge", async ({ page }) => {
    await page.goto("/");
    await navigateTo(page, "Browse");
    await expect(page).toHaveURL("/knowledge");
  });

  test("Documentation link navigates to /docs", async ({ page }) => {
    await page.goto("/");
    await navigateTo(page, "Documentation");
    await expect(page).toHaveURL("/docs");
  });
});

test.describe("Gateway Section", () => {
  test("Marketplace page shows Browse/Installed/Sources tabs", async ({ page }) => {
    await page.goto("/gateway/marketplace");
    const tablist = page.getByRole("tablist");
    await expect(tablist.getByRole("tab", { name: "Browse" })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "Installed" })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "Sources" })).toBeVisible();
  });
});

test.describe("Old Route Redirects", () => {
  test("/system/plugins redirects to /gateway/marketplace", async ({ page }) => {
    await page.goto("/system/plugins");
    await expect(page).toHaveURL("/gateway/marketplace");
  });

  test("/system/logs redirects to /gateway/logs", async ({ page }) => {
    await page.goto("/system/logs");
    await expect(page).toHaveURL("/gateway/logs");
  });

  test("/system/settings redirects to /settings/gateway", async ({ page }) => {
    await page.goto("/system/settings");
    await expect(page).toHaveURL("/settings/gateway");
  });

  test("/system/comms redirects to /comms", async ({ page }) => {
    await page.goto("/system/comms");
    await expect(page).toHaveURL("/comms");
  });

  test("catch-all redirects unknown URLs to home", async ({ page }) => {
    await page.goto("/nonexistent-page");
    await expect(page).toHaveURL("/", { timeout: 5000 });
  });
});
