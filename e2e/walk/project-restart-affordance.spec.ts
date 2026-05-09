/**
 * Project header Restart affordance walk (s140 t593 cycle-171).
 *
 * Locks in the cycle-171 fix: the project page now has a header-level
 * Restart button visible to ALL hosted projects, not just those with
 * project.projectType?.hasCode (the pre-fix HostingPanel gate hid it
 * from MApp containers + ops projects).
 *
 * Pass criteria:
 *   - /projects/civicognita-ops (MApp container, hasCode=false): the
 *     project-header-restart testid renders + is enabled
 *   - /projects/civicognita-web (api-service, hasCode=true): the same
 *     testid renders + is enabled (regression check — restart should
 *     still work for hasCode projects too)
 *
 * The spec does NOT click Restart — that would re-cycle production
 * containers for both proofing projects unnecessarily. Existence +
 * enabled state is the proof. Restart functionality is exercised
 * implicitly throughout the loop's manual workarounds.
 *
 * Run via:
 *   agi test --e2e walk/project-restart-affordance
 */

import { test, expect } from "@playwright/test";

const HOSTED_PROJECTS = [
  { slug: "civicognita-ops", note: "MApp container, hasCode=false" },
  { slug: "civicognita-web", note: "api-service, hasCode=true" },
] as const;

test.describe("project header Restart affordance (s140 t593)", () => {
  for (const proj of HOSTED_PROJECTS) {
    test(`/projects/${proj.slug} — header Restart button renders + enabled (${proj.note})`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));

      await page.goto(`/projects/${proj.slug}`);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      const restartBtn = page.getByTestId("project-header-restart");
      await expect(
        restartBtn,
        `project-header-restart must render when hosting is enabled (${proj.note})`,
      ).toBeVisible({ timeout: 10_000 });

      await expect(
        restartBtn,
        `project-header-restart must be enabled (${proj.note})`,
      ).toBeEnabled();

      // Confirms the button has the expected text label.
      await expect(restartBtn).toHaveText(/Restart/i);

      expect(pageErrors, `pageerrors on /projects/${proj.slug}: ${pageErrors.join(" | ")}`)
        .toEqual([]);
    });
  }
});
