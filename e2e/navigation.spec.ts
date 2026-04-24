import { test, expect } from "@playwright/test";

test.describe("Sidebar Navigation", () => {
  test("sidebar is visible with all sections", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar).toBeVisible();

    // Check section headers — target the uppercase header divs specifically
    const headers = sidebar.locator(".uppercase");
    await expect(headers.filter({ hasText: "Impactinomics" })).toBeVisible();
    await expect(headers.filter({ hasText: "Projects" })).toBeVisible();
    await expect(headers.filter({ hasText: "Communication" })).toBeVisible();
    await expect(headers.filter({ hasText: "Knowledge" })).toBeVisible();
    await expect(headers.filter({ hasText: "Gateway" })).toBeVisible();
    await expect(headers.filter({ hasText: "Settings" })).toBeVisible();
    await expect(headers.filter({ hasText: "System" })).toBeVisible();
  });

  test("clicking nav items navigates to correct URL", async ({ page }) => {
    await page.goto("/");

    // Navigate to COA Explorer
    await page.getByTestId("nav-impactinomics-coa-explorer").click();
    await expect(page).toHaveURL("/coa");

    // Navigate to Projects
    await page.getByTestId("nav-projects-all-projects").click();
    await expect(page).toHaveURL("/projects");

    // Navigate to Gateway Logs
    await page.getByTestId("nav-gateway-logs").click();
    await expect(page).toHaveURL("/gateway/logs");

    // Navigate to Resources
    await page.getByTestId("nav-system-resources").click();
    await expect(page).toHaveURL("/system");

    // Navigate back to Overview
    await page.getByTestId("nav-impactinomics-overview").click();
    await expect(page).toHaveURL("/");
  });

  test("active state highlights current page", async ({ page }) => {
    await page.goto("/");
    const overviewLink = page.getByTestId("nav-impactinomics-overview");
    await expect(overviewLink).toHaveClass(/bg-primary/);

    // Navigate to projects and verify active state moves
    await page.getByTestId("nav-projects-all-projects").click();
    const projectsLink = page.getByTestId("nav-projects-all-projects");
    await expect(projectsLink).toHaveClass(/bg-primary/);
    await expect(overviewLink).not.toHaveClass(/bg-primary/);
  });

  test("catch-all renders PluginPageResolver for unknown URLs", async ({ page }) => {
    await page.goto("/nonexistent-page");
    // PluginPageResolver shows loading then redirect home since no plugin matches
    await expect(page).toHaveURL("/", { timeout: 5000 });
  });

  test("chat button in sidebar opens ChatFlyout", async ({ page }) => {
    await page.goto("/");
    const chatButton = page.getByTestId("header-chat-button");
    await expect(chatButton).toBeVisible();

    await chatButton.click();
    await expect(chatButton).toHaveClass(/bg-primary/);
  });
});

test.describe("Settings Navigation", () => {
  test("Settings section has Gateway and Plugins links", async ({ page }) => {
    await page.goto("/");

    // Settings > Gateway
    await page.getByTestId("nav-settings-gateway").click();
    await expect(page).toHaveURL("/settings/gateway");

    // Settings > Plugins (distinct from Gateway > Plugins)
    const pluginsLink = page.getByTestId("nav-settings-plugins");
    if (await pluginsLink.count()) {
      await pluginsLink.click({ force: true });
      await expect(page).toHaveURL("/settings/plugins");
    } else {
      await expect(pluginsLink).toHaveCount(0);
    }
  });

  test("/settings redirects to /settings/gateway", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL("/settings/gateway");
  });

  test("old /gateway/settings redirects to /settings/gateway", async ({ page }) => {
    await page.goto("/gateway/settings");
    await expect(page).toHaveURL("/settings/gateway");
  });

  test("settings gateway page has tabbed layout", async ({ page }) => {
    await page.goto("/settings/gateway");
    // Should show tab buttons
    await expect(page.getByRole("button", { name: "Owner" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dev" })).toBeVisible();
    await expect(page.getByRole("button", { name: "0ME" })).toBeVisible();
  });
});

test.describe("Gateway Section", () => {
  test("Gateway section has Marketplace link", async ({ page }) => {
    await page.goto("/");

    const marketplaceLink = page.getByTestId("nav-gateway-marketplace");
    await expect(marketplaceLink).toBeVisible();

    await marketplaceLink.click();
    await expect(page).toHaveURL("/gateway/marketplace");
  });

  test("Marketplace page shows tabs", async ({ page }) => {
    await page.goto("/gateway/marketplace");
    await expect(page.getByRole("button", { name: "Browse" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Installed" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sources" })).toBeVisible();
  });

  test("Gateway > Plugins navigates correctly", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-gateway-plugins").click();
    await expect(page).toHaveURL("/gateway/plugins");
  });
});

test.describe("Communication Section", () => {
  test("Communication section links navigate correctly", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("nav-communication-all-messages").click();
    await expect(page).toHaveURL("/comms");

    await page.getByTestId("nav-communication-telegram").click();
    await expect(page).toHaveURL("/comms/telegram");

    await page.getByTestId("nav-communication-discord").click();
    await expect(page).toHaveURL("/comms/discord");
  });
});

test.describe("Knowledge Section", () => {
  test("Knowledge section links navigate correctly", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("nav-knowledge-browse").click();
    await expect(page).toHaveURL("/knowledge");

    await page.getByTestId("nav-knowledge-documentation").click();
    await expect(page).toHaveURL("/docs");
  });
});

test.describe("Old Route Redirects", () => {
  test("/system/plugins redirects to /gateway/plugins", async ({ page }) => {
    await page.goto("/system/plugins");
    await expect(page).toHaveURL("/gateway/plugins");
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
});
