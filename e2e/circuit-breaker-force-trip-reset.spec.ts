/**
 * Circuit-breaker — force-trip + reset via Services page UI (s143 t573).
 *
 * Closes the s143 story by proving the full round-trip:
 *   1. Force a synthetic service id into "open" via the test-VM-only
 *      `/api/services/circuit-breakers/force-trip` endpoint.
 *   2. Navigate to the Services page (the Aion docs link path is
 *      `/services`; the dashboard internal route is `/system/services` —
 *      both render the CircuitBreakerSection from the same component).
 *   3. Assert the synthetic id's row + status pill + Reset button render.
 *   4. Click Reset.
 *   5. Verify via API that the breaker no longer exists in state.
 *
 * The synthetic id uses the prefix `service:e2e-cb-test-` so it can never
 * be confused with a real channel/plugin/hosting/mcp breaker on the test
 * VM. The force-trip endpoint is gated on AIONIMA_TEST_VM=1 — production
 * never has this surface.
 *
 * Run via: `agi test --e2e circuit-breaker-force-trip-reset`
 */

import { test, expect } from "@playwright/test";

test.describe("Circuit breaker — force-trip + reset (s143 t573)", () => {
  test("force a synthetic breaker open, see it render on /system/services, reset via UI, verify cleared", async ({ page, request }) => {
    // Unique id per run so concurrent runs / leftover state can't clash.
    const syntheticId = `service:e2e-cb-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // ---- Step 1: force the breaker open via the test-VM endpoint --------
    const forceTripRes = await request.post("/api/services/circuit-breakers/force-trip", {
      data: { serviceId: syntheticId, failures: 3 },
      headers: { "Content-Type": "application/json" },
    });
    if (forceTripRes.status() === 404) {
      test.skip(true, "force-trip endpoint disabled — set AIONIMA_TEST_VM=1 on the gateway to enable");
      return;
    }
    expect(forceTripRes.status(), "force-trip should return 2xx").toBeLessThan(300);
    const forceTripBody = await forceTripRes.json() as {
      ok: boolean;
      serviceId: string;
      state: { status: string; failures: number } | null;
    };
    expect(forceTripBody.ok).toBe(true);
    expect(forceTripBody.state?.status, "synthetic breaker should be open after 3 failures").toBe("open");
    expect(forceTripBody.state?.failures).toBe(3);

    // ---- Step 2: API confirms the breaker is in listStates --------------
    const apiBefore = await request.get("/api/services/circuit-breakers");
    expect(apiBefore.status()).toBeLessThan(300);
    const apiBeforeBody = await apiBefore.json() as {
      states: Record<string, { status: string }>;
    };
    expect(apiBeforeBody.states[syntheticId]?.status).toBe("open");

    try {
      // ---- Step 3: render the Services page, see the row ----------------
      await page.goto("/system/services");
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      // Section visible — there's at least one tracked breaker (ours).
      const section = page.getByTestId("circuit-breakers-section");
      await expect(section, "section must render when at least one breaker is tracked").toBeVisible({ timeout: 10_000 });

      // Row for our synthetic id.
      const rowTestId = `circuit-breaker-${syntheticId}`;
      const resetTestId = `circuit-breaker-reset-${syntheticId}`;
      await expect(
        page.getByTestId(rowTestId),
        `row for synthetic id ${syntheticId} should render`,
      ).toBeVisible();

      const resetBtn = page.getByTestId(resetTestId);
      await expect(resetBtn, "reset button visible").toBeVisible();
      await expect(resetBtn, "reset button enabled").toBeEnabled();

      // ---- Step 4: click Reset ----------------------------------------
      await resetBtn.click();

      // The row should disappear from the section (CircuitBreakerSection
      // refetches on reset and re-renders). Allow a short wait for the
      // refetch + re-render cycle to settle.
      await expect(
        page.getByTestId(rowTestId),
        "row should disappear after reset",
      ).toHaveCount(0, { timeout: 10_000 });

      // ---- Step 5: API confirms the breaker is cleared ----------------
      const apiAfter = await request.get("/api/services/circuit-breakers");
      const apiAfterBody = await apiAfter.json() as {
        states: Record<string, { status: string; failures: number }>;
      };
      const after = apiAfterBody.states[syntheticId];
      // Reset writes a state with failures=0, status=closed (with
      // lastResetAt). The breaker isn't deleted — that's intentional so
      // operators can see "this was reset at <time>". Either undefined OR
      // closed/0 is acceptable; assert the latter.
      if (after !== undefined) {
        expect(after.status).toBe("closed");
        expect(after.failures).toBe(0);
      }
    } finally {
      // Cleanup: ensure no leftover synthetic state regardless of test
      // outcome. A failed assertion above shouldn't pollute future runs.
      await request.post(`/api/services/circuit-breakers/${encodeURIComponent(syntheticId)}/reset`).catch(() => {});
    }
  });
});
