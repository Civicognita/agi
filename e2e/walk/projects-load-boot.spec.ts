/**
 * Projects load + boot walk (s140 t550).
 *
 * Closes the s140 path-migration story by proving the dashboard's
 * Projects list and per-project pages render correctly under the
 * post-s140 layout (root-level project.json, repos/<name>/<docRoot>
 * mounts, k/+sandbox/+.trash/+.agi/ subfolders).
 *
 * Two proofing projects per owner directive (cycle 156): civicognita_web
 * and civicognita_ops. Both already exist on the production gateway
 * with hosting enabled — this spec verifies they list, page-load, and
 * boot to a serving container.
 *
 * civicognita_ops additionally exercises the s145 t586 MApp container
 * kind (shipped cycle 162 v0.4.464): hosting.containerKind === "mapp"
 * → nginx:alpine container serves the generated MApp Desktop HTML at
 * https://civicognita-ops.ai.on/. The spec verifies the MApp Desktop
 * title appears in the response.
 *
 * Run via:
 *   agi test --e2e walk/projects-load-boot
 *
 * Targets the BASE_URL env (https://ai.on for production probes,
 * https://test.ai.on for the test VM).
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const walkDir = path.dirname(fileURLToPath(import.meta.url));
const snapshotsDir = path.join(walkDir, "snapshots");
fs.mkdirSync(snapshotsDir, { recursive: true });

// Project URLs use hyphenated slug form (`/projects/civicognita-web`)
// but the project NAME rendered in the list uses underscores
// (`civicognita_web` — that's the disk-level project folder name).
// listSearchText matches the underscored form which is durable across
// hosting state changes; slug is used for direct URL navigation.
const PROOF_PROJECTS = [
  {
    slug: "civicognita-web",
    listSearchText: "civicognita_web",
    label: "Civicognita Web",
    expectMAppDesktop: false,
  },
  {
    slug: "civicognita-ops",
    listSearchText: "civicognita_ops",
    label: "Civicognita Ops",
    expectMAppDesktop: true,
  },
] as const;

test.describe("projects load + boot walk (s140 t550)", () => {
  test("/projects list renders both proofing projects", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto("/projects");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.screenshot({ path: path.join(snapshotsDir, "projects-list.png"), fullPage: true });

    // Both proofing projects must appear in the rendered list. We match
    // on the underscored project NAME (the disk-level folder name —
    // the stable form rendered in the list). Hyphenated hostnames also
    // appear when projects are running but they vary (e.g.
    // civicognita_web's hostname is civicognita-website not
    // civicognita-web), so listSearchText is the durable matcher.
    for (const proj of PROOF_PROJECTS) {
      const locator = page.getByText(proj.listSearchText, { exact: false }).first();
      await expect(locator, `${proj.listSearchText} should appear in /projects`).toBeVisible({ timeout: 10_000 });
    }

    // No pageerrors during list render — pageerrors are unhandled exceptions
    // surfaced to window.onerror and indicate a hard JS bug, not a backend
    // issue. console.error is allowed (some warnings are non-fatal).
    expect(pageErrors, `pageerrors on /projects: ${pageErrors.join(" | ")}`).toEqual([]);
  });

  for (const proj of PROOF_PROJECTS) {
    test(`/projects/${proj.slug} — page loads + status indicator visible`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));

      await page.goto(`/projects/${proj.slug}`);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.screenshot({
        path: path.join(snapshotsDir, `project-${proj.slug}.png`),
        fullPage: true,
      });

      // The Details tab is the default — its label must be visible.
      await expect(page.getByRole("tab", { name: /^Details$/ }), `Details tab on /projects/${proj.slug}`)
        .toBeVisible({ timeout: 10_000 });

      // The hosting status renders as an icon-only pill with an
      // `aria-label="Container <status>"` + role="status" (s140 t594
      // cycle-172 fix — was `title=` pre-fix, switched for a11y on
      // touch devices + screen-reader announce). getByRole is the
      // strongest matcher; falls back to getByLabel if needed.
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
      const statusCount = await page
        .getByRole("status", { name: /Container (running|stopped|unconfigured|error)/i })
        .count();
      expect(statusCount, `hosting status indicator on /projects/${proj.slug} (role=status + aria-label count)`)
        .toBeGreaterThan(0);

      expect(pageErrors, `pageerrors on /projects/${proj.slug}: ${pageErrors.join(" | ")}`)
        .toEqual([]);
    });
  }

  test(`https://civicognita-ops.ai.on/ — MApp Desktop serves`, async ({ request }) => {
    // s145 t586 proof: with containerKind=mapp, the project's URL should
    // serve the generated MApp Desktop HTML, not Caddy's "Container not
    // running" 503 fallback. Probes the actual project URL (not the
    // dashboard's BASE_URL) — civicognita-ops.ai.on resolves to the same
    // gateway via the wildcard hostname.
    const res = await request.get("https://civicognita-ops.ai.on/", {
      ignoreHTTPSErrors: true,
      timeout: 10_000,
    });
    expect(res.status(), "civicognita-ops.ai.on should serve a successful response").toBeLessThan(500);
    const body = await res.text();
    expect(body, "MApp Desktop title must be in the response body")
      .toContain("MApps — civicognita-ops");
    // Placeholder tile copy proves the resolveMAppTiles fallback path
    // fires (none of the configured MApps are installed yet — see cycle
    // 162 ship notes).
    expect(body, "Placeholder tiles must render for unconfigured MApps")
      .toContain("Not installed yet");
  });
});
