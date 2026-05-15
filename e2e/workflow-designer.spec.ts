import { test, expect } from "@playwright/test";

/**
 * Workflow Designer e2e tests (s176).
 *
 * Verifies the Designer tab renders the two-panel layout, allows creating
 * and selecting workflows, and shows the FlowEditor for a selected workflow.
 * Destructive/mutation tests use the API to clean up after themselves.
 *
 * NOTE: PAx Tabs.Tab renders as role="tab", not role="button".
 */

const DESIGNER_TAB = { name: "Designer", exact: true };

test.describe("Workflow Designer tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/gateway/workflows");
  });

  test("Designer tab trigger is visible", async ({ page }) => {
    await expect(page.getByRole("tab", DESIGNER_TAB)).toBeVisible();
  });

  test("clicking Designer tab shows the designer panel", async ({ page }) => {
    await page.getByRole("tab", DESIGNER_TAB).click();
    await expect(page.getByTestId("workflow-designer")).toBeVisible();
  });

  test("empty state shown when no workflow is selected", async ({ page }) => {
    await page.getByRole("tab", DESIGNER_TAB).click();
    await expect(page.getByTestId("workflow-empty-state")).toBeVisible();
  });

  test("can open new workflow input via + New button", async ({ page }) => {
    await page.getByRole("tab", DESIGNER_TAB).click();
    // "+ New" header button vs "+ New Workflow" empty-state button — select by exact text
    await page.getByRole("button", { name: "+ New", exact: true }).click();
    await expect(page.getByTestId("workflow-name-input")).toBeVisible();
  });

  test("can create a workflow and it appears in the list", async ({ page, request }) => {
    await page.getByRole("tab", DESIGNER_TAB).click();
    await page.getByRole("button", { name: "+ New", exact: true }).click();
    await page.getByTestId("workflow-name-input").fill("E2E Test Workflow");
    await page.getByRole("button", { name: "Create" }).click();

    // Workflow should appear in the list
    await expect(page.getByText("E2E Test Workflow")).toBeVisible();
    // Empty state should be gone — FlowEditor should be rendered
    await expect(page.getByTestId("workflow-empty-state")).not.toBeVisible();

    // Cleanup: delete via API
    const list = await request.get("/api/workflows");
    const data = await list.json() as { workflows: Array<{ id: string; name: string }> };
    const created = data.workflows.find((w) => w.name === "E2E Test Workflow");
    if (created) await request.delete(`/api/workflows/${created.id}`);
  });

  test("selecting a workflow in the list hides the empty state", async ({ page, request }) => {
    // Create a workflow via API so we don't depend on prior test state
    const created = await request.post("/api/workflows", {
      data: { name: "E2E Select Test" },
    });
    const record = await created.json() as { id: string };

    await page.reload();
    await page.getByRole("tab", DESIGNER_TAB).click();
    await expect(page.getByTestId(`workflow-item-${record.id}`)).toBeVisible();
    await page.getByTestId(`workflow-item-${record.id}`).click();
    await expect(page.getByTestId("workflow-empty-state")).not.toBeVisible();

    // Cleanup
    await request.delete(`/api/workflows/${record.id}`);
  });
});
