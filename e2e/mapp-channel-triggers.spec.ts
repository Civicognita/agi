import { test, expect } from "@playwright/test";

/**
 * MagicApp Detail — Channel Triggers section (CHN-H s169).
 *
 * Verifies the ChannelTriggersSection UX shipped in v0.4.727+:
 *   - Channel Triggers heading and "+ Add binding" button are visible on the
 *     MApp detail page (/magic-apps/:id)
 *   - Adding a binding (channel + optional room/pattern/label) creates a row
 *   - Removing the binding restores the empty-state notice
 *
 * **Pre-conditions:**
 *   - Test VM running with the gateway up (services-start)
 *   - At least one MApp registered (any — used as the test subject)
 *   - /api/channels/workflow-bindings API operational (CHN-F backend)
 *
 * If no MApps are installed the first test is skipped gracefully so the
 * suite stays green in minimal test-VM configs.
 */

const TEST_CHANNEL_ID = "e2e-test-channel";
const TEST_MAPP_ID_PLACEHOLDER = "__e2e_test_mapp__";

test.describe("MApp detail — Channel Triggers (s169 CHN-H)", () => {
  let mappDetailUrl: string | null = null;
  let mappId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const res = await page.request.get("/api/magic-apps");
      if (!res.ok()) return;
      const data = (await res.json()) as { apps?: Array<{ id: string }> };
      const apps = data.apps ?? [];
      if (apps.length > 0) {
        mappId = apps[0].id;
        mappDetailUrl = `/magic-apps/${encodeURIComponent(mappId)}`;
      }
    } catch {
      // No MApps — tests will skip
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    if (!mappId) return;
    const page = await browser.newPage();
    try {
      const res = await page.request.get("/api/channels/workflow-bindings");
      if (!res.ok()) return;
      const data = (await res.json()) as { bindings: Array<{ id: string; channelId: string }> };
      for (const b of data.bindings ?? []) {
        if (b.channelId === TEST_CHANNEL_ID) {
          await page.request.delete(`/api/channels/workflow-bindings/${b.id}`);
        }
      }
    } catch {
      // best-effort cleanup
    } finally {
      await page.close();
    }
  });

  test("Channel Triggers section renders on MApp detail page", async ({ page }) => {
    if (!mappDetailUrl) {
      test.skip(true, "No MApps installed — skipping channel trigger UI test");
      return;
    }
    await page.goto(mappDetailUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Channel Triggers")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("mapp-channel-trigger-add-btn")).toBeVisible({ timeout: 6_000 });
  });

  test("empty-state notice renders when no bindings for this MApp", async ({ page }) => {
    if (!mappDetailUrl) {
      test.skip(true, "No MApps installed");
      return;
    }
    await page.goto(mappDetailUrl, { waitUntil: "domcontentloaded" });
    // Wait for initial binding load to finish (loading spinner gone or list/empty appears)
    await expect(page.getByTestId("mapp-channel-trigger-add-btn")).toBeVisible({ timeout: 6_000 });
    // Either empty-state OR an existing binding row is shown — both are valid
    const emptyNotice = page.getByText("No channel bindings yet");
    const anyRow = page.locator('[data-testid^="mapp-channel-trigger-row-"]');
    const emptyCount = await emptyNotice.count();
    const rowCount = await anyRow.count();
    expect(emptyCount + rowCount).toBeGreaterThanOrEqual(1);
  });

  test("clicking Add opens the form; filling and saving creates a binding row", async ({ page }) => {
    if (!mappDetailUrl || !mappId) {
      test.skip(true, "No MApps installed");
      return;
    }

    await page.goto(mappDetailUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("mapp-channel-trigger-add-btn")).toBeVisible({ timeout: 8_000 });

    // Open add form
    await page.getByTestId("mapp-channel-trigger-add-btn").click();
    await expect(page.getByTestId("mapp-channel-trigger-form")).toBeVisible({ timeout: 4_000 });
    await expect(page.getByTestId("mapp-channel-trigger-channel-input")).toBeVisible();
    await expect(page.getByTestId("mapp-channel-trigger-save-btn")).toBeVisible();

    // Fill required field (channelId)
    await page.getByTestId("mapp-channel-trigger-channel-input").fill(TEST_CHANNEL_ID);

    // Submit
    await page.getByTestId("mapp-channel-trigger-save-btn").click();

    // Form should close; a binding row should appear
    await expect(page.getByTestId("mapp-channel-trigger-form")).not.toBeVisible({ timeout: 6_000 });
    const rows = page.locator('[data-testid^="mapp-channel-trigger-row-"]');
    await expect(rows.first()).toBeVisible({ timeout: 6_000 });
    await expect(rows.first()).toContainText(TEST_CHANNEL_ID);
  });

  test("clicking Remove on a binding deletes it and restores empty-state", async ({ page }) => {
    if (!mappDetailUrl || !mappId) {
      test.skip(true, "No MApps installed");
      return;
    }

    await page.goto(mappDetailUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("mapp-channel-trigger-add-btn")).toBeVisible({ timeout: 8_000 });

    // Ensure at least one binding exists (the one from the previous test or create one)
    const rows = page.locator('[data-testid^="mapp-channel-trigger-row-"]');
    const rowCount = await rows.count();
    if (rowCount === 0) {
      // Create a fresh one
      await page.getByTestId("mapp-channel-trigger-add-btn").click();
      await page.getByTestId("mapp-channel-trigger-channel-input").fill(TEST_CHANNEL_ID);
      await page.getByTestId("mapp-channel-trigger-save-btn").click();
      await expect(rows.first()).toBeVisible({ timeout: 6_000 });
    }

    // Delete the row
    const deleteBtn = rows.first().getByRole("button", { name: "Remove" });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // If that was the only binding, empty-state returns
    if (rowCount <= 1) {
      await expect(page.getByText("No channel bindings yet")).toBeVisible({ timeout: 5_000 });
    }
  });

  // Placeholder for future: t742 is about the basic CRUD UI.
  // Runtime dispatch test (binding → live channel event → MApp execution)
  // requires a live channel bot + registered MApp — deferred to manual
  // integration test per workflow-bindings.spec.ts precedent.
  test("save button is disabled when channelId is empty", async ({ page }) => {
    if (!mappDetailUrl) {
      test.skip(true, "No MApps installed");
      return;
    }
    await page.goto(mappDetailUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("mapp-channel-trigger-add-btn")).toBeVisible({ timeout: 8_000 });
    await page.getByTestId("mapp-channel-trigger-add-btn").click();
    await expect(page.getByTestId("mapp-channel-trigger-form")).toBeVisible({ timeout: 4_000 });

    // Save button should be disabled with empty channelId
    const saveBtn = page.getByTestId("mapp-channel-trigger-save-btn");
    await expect(saveBtn).toBeDisabled();

    // Type something → enabled
    await page.getByTestId("mapp-channel-trigger-channel-input").fill("discord");
    await expect(saveBtn).not.toBeDisabled();

    // Clear → disabled again
    await page.getByTestId("mapp-channel-trigger-channel-input").clear();
    await expect(saveBtn).toBeDisabled();
  });
});
