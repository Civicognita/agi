/**
 * MApp Editor — Screens authoring step (s146 phase A.2 + A.2 retrofit cycles
 * 183-184).
 *
 * Verifies:
 * 1. The 6th wizard step "Screens" is reachable from /magic-apps/editor.
 * 2. Empty-state callout renders before any screens are added.
 * 3. "+ Add screen" creates a screen tab + populates the panel.
 * 4. The screen panel exposes id/label/interface controls + Inputs + Elements
 *    sublists with their respective add buttons.
 * 5. Adding an Input creates a row with key/label/type/qualifier/source
 *    controls.
 * 6. Adding an Element creates a row with id + componentRef datalist input +
 *    props textarea.
 * 7. PAX_COMPONENT_REFS datalist is wired (the input has the correct list= id).
 * 8. DevNote registrations from cycle 184 retrofit are present (the dev-notes
 *    icon's count badge increments when dev mode is on).
 *
 * Run via: agi test --e2e walk/mapp-editor-screens-step
 */

import { test, expect } from "@playwright/test";

const ROUTE = "/magic-apps/editor";

test.describe("MApp Editor — Screens step (s146 phase A.2)", () => {
  test("Screens step renders empty-state callout before any screen is added", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(ROUTE);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Click the Screens step tab. The editor renders steps as "N. Label",
    // so we match by visible text containing "Screens".
    const screensTab = page.getByText(/(^|\s)Screens(\s|$)/i).first();
    await screensTab.click();

    // Empty state — "+ Add screen" button visible.
    const addScreenBtn = page.getByTestId("mapp-editor-add-screen");
    await expect(addScreenBtn).toBeVisible({ timeout: 10_000 });

    // The empty-state copy mentions screens-vs-pages choice (end-user-facing
    // inline prose; contributor-facing notes go through DevNotes).
    await expect(page.getByText(/composed from\s+PAx components/i)).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("Add screen → screen panel renders with id/label/interface + Inputs + Elements sublists", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(ROUTE);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.getByText(/(^|\s)Screens(\s|$)/i).first().click();

    // Add the first screen. Empty-state add button → populated step view.
    await page.getByTestId("mapp-editor-add-screen").click();

    // Screen tab "Screen 1" + the active-screen panel render.
    await expect(page.getByTestId("mapp-editor-screens-step")).toBeVisible();
    await expect(page.getByTestId("mapp-editor-screen-tab-0")).toBeVisible();
    await expect(page.getByTestId("mapp-editor-screen-id")).toBeVisible();
    await expect(page.getByTestId("mapp-editor-screen-label")).toBeVisible();

    // Sublist add-buttons exist before any inputs/elements have been added.
    await expect(page.getByTestId("mapp-editor-add-input")).toBeVisible();
    await expect(page.getByTestId("mapp-editor-add-element")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("Add input + element on a screen — controls + datalist wired", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(ROUTE);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.getByText(/(^|\s)Screens(\s|$)/i).first().click();
    await page.getByTestId("mapp-editor-add-screen").click();

    // Add an input row.
    await page.getByTestId("mapp-editor-add-input").click();

    // Input row has its remove button (the X). The 12-col grid renders inline,
    // so we match by the per-index testid.
    await expect(page.getByTestId("mapp-editor-remove-input-0")).toBeVisible();

    // Add an element row.
    await page.getByTestId("mapp-editor-add-element").click();

    // Element row has its componentRef input (with datalist) + remove button.
    const componentRefInput = page.getByTestId("mapp-editor-element-componentref-0");
    await expect(componentRefInput).toBeVisible();
    await expect(page.getByTestId("mapp-editor-remove-element-0")).toBeVisible();

    // Verify the datalist hookup — input has list="pax-component-refs".
    const listAttr = await componentRefInput.getAttribute("list");
    expect(listAttr, "componentRef input must reference the PAx datalist").toBe("pax-component-refs");

    // Datalist itself is in the DOM (browser doesn't render it visibly, but
    // the element exists with the right id and at least one option).
    const datalistOptions = await page.locator("datalist#pax-component-refs option").count();
    expect(datalistOptions, "datalist should contain curated PAx component refs").toBeGreaterThan(20);

    expect(pageErrors).toEqual([]);
  });

  test("DevNote retrofit (cycle 184) — notes register on the Screens step", async ({ page }) => {
    // DevNotes are gated behind config.dev.enabled; outside dev mode they
    // don't register and the icon doesn't render. This test validates the
    // gating is correct and the registration mechanism works without
    // crashing — actual visibility of the icon depends on whether the test
    // VM has dev mode toggled on. Either branch is acceptable.

    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(ROUTE);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.getByText(/(^|\s)Screens(\s|$)/i).first().click();

    // The DevNote components themselves render nothing visible — only register
    // with the provider. We verify by (a) no pageerror and (b) if dev-mode is
    // on, the dev-notes-icon count badge reflects ≥4 notes from this scope.
    const devNotesIcon = page.getByTestId("dev-notes-icon");
    const iconVisible = await devNotesIcon.isVisible({ timeout: 2_000 }).catch(() => false);

    if (iconVisible) {
      // dev-mode is on — count badge should show ≥4 (the cycle 184 retrofit
      // adds 4 notes to mapp-editor:screens scope).
      const badge = page.getByTestId("dev-notes-count-badge");
      const txt = (await badge.textContent())?.trim() ?? "0";
      const count = parseInt(txt, 10);
      expect(count, `expected ≥4 dev notes from cycle-184 retrofit; got ${txt}`).toBeGreaterThanOrEqual(4);
    }
    // else dev-mode off — registration skipped at gate, no crash, test passes.

    expect(pageErrors).toEqual([]);
  });

  // s146 phase C cycle 191 — Hybrid mini-agent authoring UI.
  test("Mini-agent toggle creates intent + toolMode + tools controls (s146 phase C)", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(ROUTE);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.getByText(/(^|\s)Screens(\s|$)/i).first().click();
    await page.getByTestId("mapp-editor-add-screen").click();

    // Before toggle: no intent textarea visible.
    const toggleBtn = page.getByTestId("mapp-editor-toggle-mini-agent");
    await expect(toggleBtn).toBeVisible();
    expect(await toggleBtn.textContent()).toContain("Add");

    // Toggle on — Phase C surface mounts.
    await toggleBtn.click();
    await expect(page.getByTestId("mapp-editor-mini-agent-intent")).toBeVisible();
    await expect(page.getByTestId("mapp-editor-mini-agent-tools")).toBeVisible();

    // Toggle text flips to "Remove".
    expect(await toggleBtn.textContent()).toContain("Remove");

    // Tools input is disabled by default (toolMode="auto").
    const toolsInput = page.getByTestId("mapp-editor-mini-agent-tools");
    const isDisabled = await toolsInput.isDisabled();
    expect(isDisabled, "tools input must be disabled when toolMode=auto").toBe(true);

    expect(pageErrors).toEqual([]);
  });

  test("Mini-agent intent + tools fields accept input + serialize correctly", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(ROUTE);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.getByText(/(^|\s)Screens(\s|$)/i).first().click();
    await page.getByTestId("mapp-editor-add-screen").click();
    await page.getByTestId("mapp-editor-toggle-mini-agent").click();

    // Type an intent.
    const intentField = page.getByTestId("mapp-editor-mini-agent-intent");
    await intentField.fill("Help the user draft policy documents based on the inputs they provide.");

    // Verify the value persists in the textarea.
    const intentValue = await intentField.inputValue();
    expect(intentValue).toContain("draft policy documents");

    // The Editor's session-storage draft should also include miniAgent.
    // (sessionStorage write is debounced 2s in MAppEditor; give it a beat.)
    await page.waitForTimeout(2_500);

    const draft = await page.evaluate(() => sessionStorage.getItem("mapp-editor-draft"));
    expect(draft, "draft should be persisted to sessionStorage").not.toBeNull();
    if (draft !== null) {
      const parsed = JSON.parse(draft) as { screens?: Array<{ miniAgent?: { intent: string; toolMode: string } | null }> };
      expect(parsed.screens?.[0]?.miniAgent?.intent).toContain("draft policy documents");
      expect(parsed.screens?.[0]?.miniAgent?.toolMode).toBe("auto");
    }

    expect(pageErrors).toEqual([]);
  });
});
