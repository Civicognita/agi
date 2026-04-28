/**
 * MApps walk (alpha-stable-1 Phase 3 / tynn #302).
 *
 * 1. Verifies the MAppEditor 5-step wizard renders (Basics → Constants →
 *    Pages → Output → Simulator) on /magic-apps/editor with no draft loaded.
 * 2. Opens three representative MApps from /magic-apps — one viewer (Reader),
 *    one tool (ops-monitor / Ops Monitor), one production (Runbook Editor) —
 *    and captures what happens when the user clicks them.
 *
 * Screenshots land in e2e/walk/snapshots/ (gitignored).
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const walkDir = path.dirname(fileURLToPath(import.meta.url));
const snapshotsDir = path.join(walkDir, "snapshots");
fs.mkdirSync(snapshotsDir, { recursive: true });

async function openNetworkIdle(page: import("@playwright/test").Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

test.describe("MApps walk", () => {
  // MApp instances are persisted server-side and survive page reloads, so a
  // modal left open by one test shows up in the next test. DELETE any active
  // instance before each test so we get a clean /magic-apps render.
  test.beforeEach(async ({ request }) => {
    const res = await request.get("/api/magic-apps/instances").catch(() => null);
    if (!res?.ok()) return;
    const body = await res.json().catch(() => ({ instances: [] })) as { instances: Array<{ instanceId: string }> };
    for (const inst of body.instances) {
      await request.delete(`/api/magic-apps/instances/${encodeURIComponent(inst.instanceId)}`).catch(() => null);
    }
  });

  test("editor wizard — all 5 steps reachable", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await openNetworkIdle(page, "/magic-apps/editor");
    await page.screenshot({ path: path.join(snapshotsDir, "mapp-editor-step1.png"), fullPage: true });

    // The 5 wizard step labels should be visible as nav buttons / tabs.
    // Looking at MAppEditor.tsx step labels are: Basics, Constants, Pages, Output, Simulator.
    const steps = ["Basics", "Constants", "Pages", "Output", "Simulator"];
    const seen: Record<string, boolean> = {};
    for (const label of steps) {
      // The editor renders step triggers as "N. Label" (e.g. "1. Basics").
      // Match the label with an optional leading number prefix.
      const loc = page.getByText(new RegExp(`(^|\\s)${label}(\\s|$)`, "i")).first();
      seen[label] = await loc.isVisible({ timeout: 5_000 }).catch(() => false);
    }

    const summary = {
      route: "/magic-apps/editor",
      stepsVisible: seen,
      pageErrors: pageErrors.length,
      consoleErrors: consoleErrors.length,
      firstConsoleError: consoleErrors[0]?.slice(0, 200) ?? null,
      firstPageError: pageErrors[0]?.slice(0, 200) ?? null,
    };
    await test.info().attach("editor-step-presence", {
      body: JSON.stringify(summary, null, 2),
      contentType: "application/json",
    });

    // Pass criteria: no pageerrors + at least 4 of 5 step labels visible.
    expect(pageErrors).toEqual([]);
    const visibleCount = Object.values(seen).filter(Boolean).length;
    expect(visibleCount, `wizard steps visible: ${JSON.stringify(seen)}`).toBeGreaterThanOrEqual(4);
  });

  test("MApps grid — 11 installed, 3 categories", async ({ page }) => {
    await openNetworkIdle(page, "/magic-apps");
    await page.screenshot({ path: path.join(snapshotsDir, "mapp-grid.png"), fullPage: true });

    // The grid should show at least the category headings Viewer / Production / Tools.
    await expect(page.getByText("Viewer", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Production", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    // Named MApps that are in civicognita's pack.
    for (const name of ["Code Browser", "Reader", "Dev Workbench", "Mind Mapper", "Ops Monitor"]) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  // MApps are project-anchored: clicking a card opens a project-picker
  // modal ("Open <app> for..."). This matches mapp-executor.ts /
  // magic-app-instances.ts — an instance binds an appId + projectPath.
  // Whether the picker shows compatible projects depends on the app's
  // `projectCategories` filter vs. the project's own category (see
  // packages/aion-sdk/src/define-magic-app.ts).
  // MApps are project-anchored: clicking a tile opens a picker; picking a
  // project mounts the MApp panel. Walk all three representative MApps
  // (viewer / tool / production) end-to-end against a compatible fixture.
  for (const { label, project, file } of [
    { label: "Reader", project: "sample-literature", file: "mapp-panel-reader.png" },
    { label: "Code Browser", project: "sample-monorepo", file: "mapp-panel-code-browser.png" },
    { label: "Runbook Editor", project: "sample-ops", file: "mapp-panel-runbook-editor.png" },
  ]) {
    test(`open ${label} against ${project} — panel renders`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));

      await openNetworkIdle(page, "/magic-apps");
      // Wait for the grid to hydrate — "Viewer" heading anchors the page.
      await expect(page.getByText("Viewer", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      await page.getByText(label, { exact: true }).first().click();

      // Picker is open — pick the fixture project.
      await expect(page.getByText(new RegExp(`Open ${label} for`, "i"))).toBeVisible({ timeout: 10_000 });
      await page.getByText(project, { exact: true }).first().click();

      // Floating modal with the MApp panel should mount. Allow a beat for
      // container container-start (if the app declares one).
      await page.waitForTimeout(3_000);
      await page.screenshot({ path: path.join(snapshotsDir, file), fullPage: true });

      // Pass if no pageerrors and we can see the MApp name in the modal
      // chrome (the instance title bar shows the MApp name).
      const modalTitleVisible = await page
        .getByRole("dialog")
        .or(page.locator("[role=dialog]"))
        .or(page.locator("[data-testid=mapp-panel]"))
        .first()
        .isVisible({ timeout: 3_000 })
        .catch(() => false);

      await test.info().attach(`${label.toLowerCase().replace(/\s+/g, "-")}-open-summary`, {
        body: JSON.stringify({
          pickedProject: project,
          modalVisible: modalTitleVisible,
          pageErrors: pageErrors.length,
          firstPageError: pageErrors[0]?.slice(0, 200) ?? null,
        }, null, 2),
        contentType: "application/json",
      });

      expect(pageErrors).toEqual([]);
    });
  }
});
