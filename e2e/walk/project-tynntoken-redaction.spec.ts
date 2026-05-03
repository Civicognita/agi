/**
 * Project tynnToken — API redaction + Details tab non-presence (s140 t591).
 *
 * Owner directive cycle 169 (clarified): "the tynn token is set by the
 * tynn mcp server settings plugin ux ... tynn token is not shown in
 * the dashboard details page at all". The Details tab does NOT show
 * the Tynn token field — token configuration is owned by the Tynn MCP
 * plugin settings UX, single source of truth.
 *
 * Pass criteria:
 *   - /api/projects: every project's tynnToken is null (the secret
 *     never leaves disk)
 *   - /api/projects: at least one project has tynnTokenSet=true
 *     (proves the flag actually flips for configured projects)
 *   - The Details tab does NOT render the project-token-input testid
 *     (the input was removed in v0.4.476 per owner clarification)
 *   - The Details tab does NOT render the configured-indicator testid
 *     (no token presence is hinted at on the Details tab at all)
 *
 * Run via:
 *   agi test --e2e walk/project-tynntoken-redaction
 */

import { test, expect } from "@playwright/test";

test.describe("project Tynn token — API redaction + Details tab non-presence (s140 t591)", () => {
  test("/api/projects redacts tynnToken (always null) + ships tynnTokenSet", async ({ request }) => {
    const res = await request.get("/api/projects");
    expect(res.status()).toBeLessThan(300);
    const body = await res.json() as { projects?: Array<{ tynnToken?: unknown; tynnTokenSet?: unknown; name?: string }> } | Array<{ tynnToken?: unknown; tynnTokenSet?: unknown; name?: string }>;
    const projects = Array.isArray(body) ? body : body.projects ?? [];
    expect(projects.length, "API must return at least one project").toBeGreaterThan(0);

    // Every project's tynnToken must be null. Non-null is a regression.
    for (const p of projects) {
      expect(
        p.tynnToken,
        `${p.name} — tynnToken must be null over the wire (the secret never leaves disk)`,
      ).toBeNull();
    }

    // At least one project must have tynnTokenSet=true. Proves the
    // boolean actually flips (otherwise blanket null-with-no-boolean
    // would silently pass).
    const anyConfigured = projects.some((p) => p.tynnTokenSet === true);
    expect(
      anyConfigured,
      "at least one project must have tynnTokenSet=true (no projects configured = something else broke)",
    ).toBe(true);
  });

  test("Details tab does NOT render the Tynn token input or indicator", async ({ page }) => {
    await page.goto("/projects/civicognita-web");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // The Details tab is the default — assert it's loaded by checking
    // the project-name-input testid that DOES render here.
    await expect(
      page.getByTestId("project-name-input"),
      "Details tab must be the active tab (project-name-input is its anchor)",
    ).toBeVisible({ timeout: 10_000 });

    // The Tynn token input must NOT render on this page anymore.
    // Owner: "tynn token is not shown in the dashboard details page
    // at all". Token configuration moved to the Tynn MCP plugin UX.
    const tokenInputCount = await page.getByTestId("project-token-input").count();
    expect(
      tokenInputCount,
      "project-token-input must NOT render on Details tab (owner cycle-169 clarification)",
    ).toBe(0);

    // The "Configured (redacted)" indicator from the prior shape also
    // must not render — the entire token block is gone.
    const indicatorCount = await page.getByTestId("project-token-configured-indicator").count();
    expect(
      indicatorCount,
      "project-token-configured-indicator must NOT render (whole token block removed)",
    ).toBe(0);
  });
});
