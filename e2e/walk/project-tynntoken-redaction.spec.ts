/**
 * Project tynnToken redaction walk (s140 t591 — SECURITY).
 *
 * Locks in the cycle-168 owner-flagged security fix: the Tynn private
 * key never leaves the gateway disk. /api/projects always returns
 * tynnToken=null with a sibling tynnTokenSet=boolean. The dashboard
 * Details tab token input is type="password" with a "Configured
 * (redacted)" indicator when the token is set.
 *
 * Pass criteria:
 *   - /api/projects: every project's tynnToken is null
 *   - /api/projects: at least one project has tynnTokenSet=true (proves
 *     the boolean is actually flipping for projects with a configured
 *     token; a blanket null-with-no-boolean would also pass the first
 *     assertion but is a regression)
 *   - The Details tab token input is type="password" (so the value, if
 *     any DOM attribute did leak it, is dotted-out)
 *   - When a project has tynnTokenSet=true, the "Configured (redacted)"
 *     indicator renders
 *   - The token input is empty on initial render (the redacted null
 *     from the API doesn't pre-fill it; user-typed value would, but
 *     this spec doesn't type)
 *
 * Run via:
 *   agi test --e2e walk/project-tynntoken-redaction
 */

import { test, expect } from "@playwright/test";

test.describe("project Tynn token — API redaction + dashboard masking (s140 t591)", () => {
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

  test("Details tab token input is type=password + shows configured indicator when set", async ({ page }) => {
    await page.goto("/projects/civicognita-web");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // The token input is on the Details tab (the default).
    const tokenInput = page.getByTestId("project-token-input");
    await expect(tokenInput, "project-token-input must render").toBeVisible({ timeout: 10_000 });

    // Type must be password — the visible-leak fix.
    await expect(
      tokenInput,
      "token input must be type=password to mask the value visually",
    ).toHaveAttribute("type", "password");

    // Initial value must be empty — the redacted null doesn't pre-fill it.
    await expect(
      tokenInput,
      "token input must start empty (the API redaction returns null, no pre-fill)",
    ).toHaveValue("");

    // civicognita_web has a token configured → indicator renders.
    await expect(
      page.getByTestId("project-token-configured-indicator"),
      "configured indicator must render when project.tynnTokenSet is true",
    ).toBeVisible({ timeout: 5_000 });
  });
});
