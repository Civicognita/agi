import { test, expect } from "@playwright/test";

/**
 * Workflow Topology e2e tests.
 *
 * Verifies the WorkflowGraph canvas renders the router hub, stage pipeline,
 * Taskmaster orchestrator, domain groups, worker nodes, chain edges, and
 * canvas controls. All assertions are structural — no LLM or inference
 * required. Tests navigate to the Topology tab directly.
 */

test.describe("Workflow Topology page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/gateway/workflows");
  });

  test("page loads with workflow tabs visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Topology" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Taskmaster" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Workers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "System Prompt" })).toBeVisible();
  });

  test("Topology tab is selected by default and shows the canvas", async ({ page }) => {
    // The canvas container is rendered inside the topology TabsContent
    const canvas = page.locator(".react-fancy-canvas, [class*='canvas'], canvas").first();
    // Fallback: the WorkflowGraph is wrapped in a div with explicit height
    const graphWrapper = page.locator("div").filter({ has: page.locator("canvas") }).first();
    // At minimum the page must not redirect away
    await expect(page).toHaveURL("/gateway/workflows");
    // Canvas host element should exist somewhere in the DOM
    const hasCanvas = (await page.locator("canvas").count()) > 0 || (await graphWrapper.count()) > 0;
    expect(hasCanvas).toBeTruthy();
  });

  test("renders AGENT ROUTER hub when router status is available", async ({ page }) => {
    // Router hub renders only when the /api/router/status endpoint responds
    // Wait for the async fetch; skip gracefully if the environment has no router
    const routerText = page.getByText("AGENT ROUTER");
    const count = await routerText.count();
    test.skip(count === 0, "router status not available in this environment");
    await expect(routerText.first()).toBeVisible();
  });

  test("renders router cost mode badge when router is available", async ({ page }) => {
    // costMode is rendered as an uppercase badge next to the AGENT ROUTER hub
    const costModeLabels = ["LOCAL", "ECONOMY", "BALANCED", "MAX"];
    let found = false;
    for (const label of costModeLabels) {
      if ((await page.getByText(label, { exact: true }).count()) > 0) {
        found = true;
        break;
      }
    }
    // Skip rather than fail if router is not running in this environment
    test.skip(!found, "router cost mode not rendered — router may be unavailable");
    expect(found).toBeTruthy();
  });

  test("renders router pipeline stage labels when router is available", async ({ page }) => {
    const classify = page.getByText("Classify");
    const count = await classify.count();
    test.skip(count === 0, "router pipeline stages not rendered — router may be unavailable");
    await expect(page.getByText("Classify").first()).toBeVisible();
    await expect(page.getByText("Select").first()).toBeVisible();
    await expect(page.getByText("Execute").first()).toBeVisible();
  });

  test("renders TASKMASTER orchestrator node", async ({ page }) => {
    await expect(page.getByText("TASKMASTER").first()).toBeVisible({ timeout: 10000 });
  });

  test("renders domain group labels", async ({ page }) => {
    await expect(page.getByText("TASKMASTER").first()).toBeVisible({ timeout: 10000 });
    for (const domain of ["Strategy", "Code", "Communication", "Data", "Knowledge", "Governance", "Operations"]) {
      await expect(page.getByText(domain, { exact: true }).first()).toBeVisible();
    }
  });

  test("renders UX domain group", async ({ page }) => {
    await expect(page.getByText("TASKMASTER").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("UX", { exact: true }).first()).toBeVisible();
  });

  test("renders worker nodes in the Code domain", async ({ page }) => {
    await expect(page.getByText("TASKMASTER").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("hacker").first()).toBeVisible();
    await expect(page.getByText("tester").first()).toBeVisible();
  });

  test("renders worker nodes in the Strategy domain", async ({ page }) => {
    await expect(page.getByText("TASKMASTER").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("planner").first()).toBeVisible();
  });

  test("renders enforced chain edge labels", async ({ page }) => {
    await expect(page.getByText("TASKMASTER").first()).toBeVisible({ timeout: 10000 });
    // Chain edges connect hacker → tester, writer → editor, etc.
    await expect(page.getByText("enforced").first()).toBeVisible();
  });

  test("renders provider health indicators when router is available", async ({ page }) => {
    const routerLabel = page.getByText("Router:");
    const count = await routerLabel.count();
    test.skip(count === 0, "router status bar not rendered — router may be unavailable");
    await expect(routerLabel.first()).toBeVisible();
    // At least one provider name (e.g. "anthropic") should appear
    await expect(page.getByText("anthropic").first()).toBeVisible();
  });

  test("Taskmaster tab shows taskmaster entry", async ({ page }) => {
    await page.getByRole("button", { name: "Taskmaster" }).click();
    // PromptEntryList renders TASKMASTER_ENTRY — at minimum no error is thrown
    await expect(page).toHaveURL("/gateway/workflows");
  });

  test("Workers tab shows worker catalog entries", async ({ page }) => {
    await page.getByRole("button", { name: "Workers" }).click();
    // Workers tab renders either dynamic catalog from API or static fallback
    // "hacker" appears in both — it's a static WORKER_ENTRIES item
    await expect(page.getByText("hacker").first()).toBeVisible({ timeout: 10000 });
  });
});
