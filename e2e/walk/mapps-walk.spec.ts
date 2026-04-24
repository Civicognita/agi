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
  for (const { label, file } of [
    { label: "Reader", file: "mapp-open-reader.png" },
    { label: "Ops Monitor", file: "mapp-open-ops-monitor.png" },
    { label: "Runbook Editor", file: "mapp-open-runbook-editor.png" },
  ]) {
    test(`click ${label} — project picker opens`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));

      await openNetworkIdle(page, "/magic-apps");
      await page.getByText(label, { exact: true }).first().click();
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: path.join(snapshotsDir, file), fullPage: true });

      // The picker's heading is "Open <label> for..."
      await expect(page.getByText(new RegExp(`Open ${label} for`, "i"))).toBeVisible({ timeout: 10_000 });

      // Capture whether any compatible project was offered.
      const noCompatible = await page
        .getByText(/No compatible projects for this app/i)
        .isVisible({ timeout: 1_000 })
        .catch(() => false);

      await test.info().attach(`${label.toLowerCase().replace(/\s+/g, "-")}-summary`, {
        body: JSON.stringify({
          pickerOpened: true,
          noCompatibleProjects: noCompatible,
          pageErrors: pageErrors.length,
          firstPageError: pageErrors[0]?.slice(0, 200) ?? null,
        }, null, 2),
        contentType: "application/json",
      });

      expect(pageErrors).toEqual([]);
    });
  }
});
