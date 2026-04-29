import { test, expect } from "@playwright/test";

/**
 * Dev-Mode PAx forks e2e (s136 t512).
 *
 * Verifies the Contributing tab now reports all 9 forks (Civicognita
 * core five + Particle-Academy PAx four) when contributing mode is on,
 * and that the /api/dev/status response shape includes the four new
 * PAx fork fields.
 *
 * Skips gracefully when contributing mode isn't enabled in the test
 * environment (test VM doesn't have GitHub OAuth wired by default).
 */

test.describe("Dev-Mode PAx forks (s136 t512)", () => {
  test("/api/dev/status response shape includes PAx fork fields when dev-mode is on", async ({ request }) => {
    const res = await request.get("/api/dev/status");

    // 403 happens when the request isn't from a private network OR the
    // session lacks admin role. Skip — the test environment doesn't
    // expose this surface for the test runner.
    if (res.status() === 403) {
      test.skip(true, "/api/dev/status not accessible in this environment");
      return;
    }

    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;

    // When dev-mode is OFF, the four PAx fields may be absent or
    // populated with "unknown" remote — both are valid. When ON, they
    // must be present.
    const enabled = body["enabled"] === true;
    if (!enabled) {
      test.skip(true, "Contributing mode not enabled — skipping PAx field assertions");
      return;
    }

    // The four PAx fork status fields must be present in the response.
    for (const key of ["reactFancy", "fancyCode", "fancySheets", "fancyEcharts"] as const) {
      expect(body[key]).toBeDefined();
      const fork = body[key] as { remote: string; branch: string };
      expect(typeof fork.remote).toBe("string");
      expect(typeof fork.branch).toBe("string");
    }
  });

  test("Contributing tab renders the Particle-Academy section heading when dev-mode is on", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='app-sidebar']", { timeout: 10_000 });

    // Skip when contributing mode isn't on — the section is only
    // rendered post-toggle.
    const badge = page.getByText("Contributing", { exact: true });
    const devModeOn = await badge.isVisible().catch(() => false);
    test.skip(!devModeOn, "Contributing mode not enabled — skipping Particle-Academy section assertion");

    // Navigate to gateway settings → Contributing tab. The exact path
    // varies by routing config; try canonical first.
    const res = await page.goto("/settings/contributing", { waitUntil: "domcontentloaded" }).catch(() => null);
    if (!(res && res.ok())) {
      await page.goto("/settings/gateway");
      // Click the Contributing tab if present
      const tab = page.getByRole("tab", { name: /contributing/i }).first();
      const tabVisible = await tab.isVisible().catch(() => false);
      if (tabVisible) await tab.click();
    }

    // Expect both group headings — "Civicognita · core platform" and
    // "Particle-Academy · ADF UI primitives (PAx)".
    await expect(page.getByText(/Civicognita · core platform/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Particle-Academy · ADF UI primitives \(PAx\)/i)).toBeVisible({ timeout: 5_000 });

    // Each PAx package name should render as a RepoCard label.
    for (const name of ["react-fancy", "fancy-code", "fancy-sheets", "fancy-echarts"]) {
      await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 3_000 });
    }
  });
});
