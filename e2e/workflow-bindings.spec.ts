import { test, expect } from "@playwright/test";

/**
 * Settings → Channels → Workflow Bindings block (s167 CHN-F).
 *
 * The WorkflowBindingsBlock moved from Settings → Gateway → Channels tab
 * (removed Cycle 262, DevNote "Channels tab removed from this page") to
 * Settings → Channels → [channel card] → Settings inner tab.
 *
 * Navigation: /settings/channels → Discord channel tab (first, default) →
 *   inner Settings tab (default) → workflow-bindings-block testid.
 *
 * **Pre-conditions:**
 *   - Test VM running with the gateway up (services-start)
 *   - At least one channel plugin installed (Discord is installed by default)
 *   - /api/channels/workflow-bindings API operational (CHN-F backend)
 */

const TEST_MAPP_ID = "e2e-test-binding";

test.describe("Settings → Channels → Workflow Bindings (s167 CHN-F)", () => {
  async function openBindingsBlock(page: import("@playwright/test").Page): Promise<void> {
    await page.goto("/settings/channels", { waitUntil: "domcontentloaded" });
    // Channels are fetched async; wait for the tab bar to render
    // Discord is first; inner tab defaults to Settings which renders WorkflowBindingsBlock
    await expect(page.getByTestId("workflow-bindings-block")).toBeVisible({ timeout: 12_000 });
  }

  // Clean up any e2e test binding left over from a previous run.
  async function cleanupTestBinding(page: import("@playwright/test").Page): Promise<void> {
    try {
      const res = await page.request.get("/api/channels/workflow-bindings?channelId=discord");
      if (!res.ok()) return;
      const data = (await res.json()) as { bindings: Array<{ id: string; mappId: string }> };
      for (const b of data.bindings ?? []) {
        if (b.mappId === TEST_MAPP_ID) {
          await page.request.delete(`/api/channels/workflow-bindings/${b.id}`);
        }
      }
    } catch {
      // best-effort cleanup — don't fail the test
    }
  }

  test("workflow-bindings-block is visible on Settings → Channels", async ({ page }) => {
    await openBindingsBlock(page);
    await expect(page.getByTestId("workflow-bindings-block")).toBeVisible();
  });

  test("workflow-bindings-block shows empty-state OR list after load", async ({ page }) => {
    await openBindingsBlock(page);

    // After mount the component fetches bindings. Wait for the loading text to disappear.
    await expect(page.getByText("Loading…")).not.toBeVisible({ timeout: 6_000 });

    const empty = page.getByTestId("binding-empty");
    const list = page.getByTestId("binding-list");
    const emptyCount = await empty.count();
    const listCount = await list.count();
    expect(emptyCount + listCount).toBeGreaterThanOrEqual(1);
  });

  test("clicking Add opens the add form with all fields", async ({ page }) => {
    await openBindingsBlock(page);

    const block = page.getByTestId("workflow-bindings-block");
    await block.getByRole("button", { name: "Add" }).click();

    // Form fields must appear
    await expect(page.getByTestId("binding-mapp-id")).toBeVisible({ timeout: 4_000 });
    await expect(page.getByTestId("binding-label")).toBeVisible();
    await expect(page.getByTestId("binding-room-id")).toBeVisible();
    await expect(page.getByTestId("binding-role-id")).toBeVisible();
    await expect(page.getByTestId("binding-pattern")).toBeVisible();
    await expect(page.getByTestId("binding-add-submit")).toBeVisible();
  });

  test("submitting a binding adds a row; deleting it restores empty-state", async ({ page }) => {
    await cleanupTestBinding(page);
    await openBindingsBlock(page);

    // Wait for initial load
    await expect(page.getByText("Loading…")).not.toBeVisible({ timeout: 6_000 });

    const block = page.getByTestId("workflow-bindings-block");

    // Open add form
    await block.getByRole("button", { name: "Add" }).click();
    await expect(page.getByTestId("binding-mapp-id")).toBeVisible({ timeout: 4_000 });

    // Fill MApp ID (only required field)
    await page.getByTestId("binding-mapp-id").fill(TEST_MAPP_ID);

    // Submit
    await page.getByTestId("binding-add-submit").click();

    // Form should close and list should appear with our binding
    await expect(page.getByTestId("binding-list")).toBeVisible({ timeout: 6_000 });
    await expect(page.getByTestId("binding-mapp-id")).not.toBeVisible();

    // The binding row should contain our mappId text
    const rows = page.getByTestId("binding-row");
    await expect(rows.first()).toContainText(TEST_MAPP_ID);

    // Delete the binding
    await rows.first().getByTestId("binding-delete").click();

    // List should disappear; if it was the only binding, empty-state returns
    await expect(page.getByTestId("binding-list")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("binding-empty")).toBeVisible({ timeout: 5_000 });
  });
});
