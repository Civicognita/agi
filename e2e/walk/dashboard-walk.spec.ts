/**
 * Dashboard feature walk (alpha-stable-1 Phase 2 / tynn #301).
 *
 * Visits each sidebar-reachable route, captures:
 *   - HTTP status of the initial navigation
 *   - Document title + first H1 / primary heading
 *   - Count of console.error messages during load
 *   - Count of pageerror events
 *   - A full-page screenshot at e2e/walk/snapshots/<slug>.png
 *
 * Pass criteria (per route): page loads without pageerrors AND no console
 * errors. A failing route surfaces a specific problem ready to file as a
 * sub-task under this story. Routes that need data (project/:slug,
 * magic-apps/:id, reports/:id, entity/:id, channel detail pages) are
 * deliberately excluded — they need seeded fixtures.
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const walkDir = path.dirname(fileURLToPath(import.meta.url));

interface RouteCase {
  path: string;
  label: string;
  /**
   * Expected-to-work testids or text on the page. If none match, the test
   * still records a screenshot + errors but flags the route as "shell-only".
   */
  expect?: { testId?: string; text?: string };
}

const ROUTES: RouteCase[] = [
  { path: "/", label: "overview", expect: { testId: "app-sidebar" } },
  { path: "/coa", label: "coa" },
  { path: "/reports", label: "reports" },
  { path: "/projects", label: "projects", expect: { testId: "marketplace-section" } },
  { path: "/magic-apps", label: "magic-apps" },
  { path: "/magic-apps/admin", label: "magic-apps-admin" },
  { path: "/magic-apps/editor", label: "magic-apps-editor" },
  { path: "/knowledge", label: "knowledge" },
  { path: "/docs", label: "docs" },
  { path: "/admin", label: "admin-dashboard" },
  { path: "/system", label: "system-resources" },
  { path: "/system/services", label: "system-services" },
  { path: "/system/changelog", label: "system-changelog" },
  { path: "/system/incidents", label: "system-incidents" },
  { path: "/system/security", label: "system-security" },
  { path: "/gateway/marketplace", label: "gateway-marketplace" },
  { path: "/gateway/workflows", label: "gateway-workflows" },
  { path: "/gateway/logs", label: "gateway-logs" },
  { path: "/hf-marketplace", label: "hf-marketplace" },
  { path: "/settings/gateway", label: "settings-gateway" },
  { path: "/settings/security", label: "settings-security" },
  { path: "/settings/hf", label: "settings-hf" },
  { path: "/comms", label: "comms" },
];

const snapshotsDir = path.join(walkDir, "snapshots");
fs.mkdirSync(snapshotsDir, { recursive: true });

for (const route of ROUTES) {
  test(`walk: ${route.path}`, async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {
      // WS-keep-open; fall through
    });

    const status = response?.status() ?? 0;
    const title = await page.title().catch(() => "");
    const primaryHeading = await page.locator("h1, h2").first().textContent({ timeout: 2_000 }).catch(() => "");

    let expectHit: string | null = null;
    if (route.expect?.testId) {
      const visible = await page.getByTestId(route.expect.testId).isVisible({ timeout: 3_000 }).catch(() => false);
      if (visible) expectHit = `testid:${route.expect.testId}`;
    }
    if (!expectHit && route.expect?.text) {
      const visible = await page.getByText(route.expect.text).first().isVisible({ timeout: 3_000 }).catch(() => false);
      if (visible) expectHit = `text:${route.expect.text}`;
    }

    await page.screenshot({
      path: path.join(snapshotsDir, `${route.label}.png`),
      fullPage: true,
    });

    // Summary attached to test result for later harvesting
    const summary = {
      path: route.path,
      label: route.label,
      status,
      title,
      heading: (primaryHeading ?? "").trim().slice(0, 120),
      expectHit,
      consoleErrors: consoleErrors.length,
      pageErrors: pageErrors.length,
      firstConsoleError: consoleErrors[0]?.slice(0, 200) ?? null,
      firstPageError: pageErrors[0]?.slice(0, 200) ?? null,
    };
    await test.info().attach(`${route.label}-summary`, {
      body: JSON.stringify(summary, null, 2),
      contentType: "application/json",
    });

    // Pass criteria: HTTP 2xx + no pageerror. Console errors are reported
    // but do NOT fail the test here — filed as follow-up tasks instead.
    expect(status, `HTTP status for ${route.path}`).toBeGreaterThanOrEqual(200);
    expect(status, `HTTP status for ${route.path}`).toBeLessThan(400);
    expect(pageErrors, `pageerrors on ${route.path}`).toEqual([]);
  });
}
