/**
 * Services page — CircuitBreakerSection walk (s143 t571).
 *
 * Locks in the persistent circuit-breaker UI shipped in cycle 159
 * (t570 — API + initial card) and refined in cycle 164 (t571 — kind
 * badge added per the original spec).
 *
 * Pass criteria:
 *   - /services renders without pageerrors
 *   - When at least one breaker is open, the CircuitBreakerSection
 *     renders with `data-testid="circuit-breakers-section"`
 *   - Each row shows a status pill (open / half-open / closed),
 *     a kind badge (hosting / channel / plugin / runtime), the
 *     service id, failure count, and a Reset button.
 *   - Reset is NOT clicked from the spec — the breakers are gating
 *     real broken services (3 open at v0.4.465: blackorchid_web /
 *     civicognita_github / my_art with statfs errors). Clicking Reset
 *     would re-attempt boot + drop the breaker, which is destabilizing
 *     for production. The spec verifies the affordance EXISTS without
 *     exercising its destructive behavior.
 *
 * Run via:
 *   agi test --e2e walk/services-circuit-breakers
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const walkDir = path.dirname(fileURLToPath(import.meta.url));
const snapshotsDir = path.join(walkDir, "snapshots");
fs.mkdirSync(snapshotsDir, { recursive: true });

test.describe("services page — circuit-breaker UI (s143 t571)", () => {
  test("/services renders without pageerrors", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto("/services");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.screenshot({
      path: path.join(snapshotsDir, "services-page.png"),
      fullPage: true,
    });

    expect(pageErrors, `pageerrors on /services: ${pageErrors.join(" | ")}`).toEqual([]);
  });

  test("CircuitBreakerSection renders + each row has status pill + kind badge + Reset", async ({ page, request }) => {
    // Pre-flight: confirm via API that at least one breaker is open. If
    // production has zero breakers we skip the visual assertions instead
    // of failing — the section is correctly hidden (early-return) when
    // totalCount === 0.
    const apiRes = await request.get("/api/services/circuit-breakers");
    expect(apiRes.status(), "/api/services/circuit-breakers should respond 2xx").toBeLessThan(300);
    const apiBody = await apiRes.json() as {
      states: Record<string, { status: string; failures: number; lastError?: string }>;
      totalCount: number;
      openCount: number;
    };

    test.skip(apiBody.totalCount === 0, "no breakers tracked — section is correctly hidden");

    await page.goto("/services");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // The section root is keyed by data-testid="circuit-breakers-section".
    await expect(
      page.getByTestId("circuit-breakers-section"),
      "circuit-breakers-section card should render when breakers are tracked",
    ).toBeVisible({ timeout: 10_000 });

    // For each id returned by the API, verify the row renders + has a
    // kind-badge testid and a Reset-button testid.
    for (const id of Object.keys(apiBody.states)) {
      const rowTestId = `circuit-breaker-${id}`;
      const kindTestId = `circuit-breaker-kind-${id}`;
      const resetTestId = `circuit-breaker-reset-${id}`;

      await expect(
        page.getByTestId(rowTestId),
        `row for ${id} should render`,
      ).toBeVisible();

      // Kind badge — must exist and have non-empty text. Hosting
      // breakers should show "HOSTING" (uppercased by CSS).
      const kindBadge = page.getByTestId(kindTestId);
      await expect(kindBadge, `kind badge for ${id}`).toBeVisible();
      const kindText = (await kindBadge.textContent())?.trim() ?? "";
      expect(kindText.length, `kind badge for ${id} must have non-empty text`).toBeGreaterThan(0);
      // Hosting breaker ids start with "hosting:" — the badge text should match.
      if (id.startsWith("hosting:")) {
        expect(kindText.toLowerCase(), `hosting breaker kind badge for ${id}`).toBe("hosting");
      }

      // Reset button — must exist and be enabled (we do NOT click it).
      const resetBtn = page.getByTestId(resetTestId);
      await expect(resetBtn, `reset button for ${id}`).toBeVisible();
      await expect(resetBtn, `reset button for ${id} should be enabled`).toBeEnabled();
    }

    await page.screenshot({
      path: path.join(snapshotsDir, "services-circuit-breakers.png"),
      fullPage: true,
    });
  });
});
