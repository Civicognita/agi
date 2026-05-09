/**
 * MApp container — per-MApp standalone routing walk (s145 t589).
 *
 * Closes the "clicking a MApp opens it standalone" piece of the
 * cycle-156 stop condition. Tile clicks on the MApp Desktop now
 * resolve to a project-aware "Not installed yet" placeholder page
 * at /<mappId>/ instead of nginx's generic 404. When real MApps
 * arrive via the MApp Marketplace, the writer's skip-if-installed
 * branch leaves their bundles intact.
 *
 * Pass criteria:
 *   - https://civicognita-ops.ai.on/ serves the MApp Desktop with the
 *     5 configured tiles
 *   - Each tile's href links to /<mappId>/
 *   - Each /<mappId>/ route returns 2xx with placeholder copy
 *     (mappId + "Not installed yet" + "MApp Marketplace")
 *
 * Run via:
 *   agi test --e2e walk/mapp-standalone-routing
 */

import { test, expect } from "@playwright/test";

const PROJECT_HOSTNAME = "civicognita-ops";
const PROJECT_URL = `https://${PROJECT_HOSTNAME}.ai.on`;

const CONFIGURED_MAPPS = [
  "budget-tracker",
  "whitepaper-canvas",
  "prime-explorer",
  "model-training",
  "microservice-manager",
] as const;

test.describe("MApp standalone routing (s145 t589)", () => {
  test("MApp Desktop tiles link to /<mappId>/ for each configured MApp", async ({ request }) => {
    const res = await request.get(`${PROJECT_URL}/`, {
      ignoreHTTPSErrors: true,
      timeout: 10_000,
    });
    expect(res.status(), "MApp Desktop must serve").toBeLessThan(300);
    const body = await res.text();
    expect(body, "MApp Desktop title").toContain(`MApps — ${PROJECT_HOSTNAME}`);

    for (const mappId of CONFIGURED_MAPPS) {
      expect(
        body,
        `tile href for ${mappId} must point at /<mappId>/`,
      ).toContain(`href="/${mappId}/"`);
    }
  });

  for (const mappId of CONFIGURED_MAPPS) {
    test(`/${mappId}/ resolves to placeholder (not 404)`, async ({ request }) => {
      const res = await request.get(`${PROJECT_URL}/${mappId}/`, {
        ignoreHTTPSErrors: true,
        timeout: 10_000,
      });
      expect(
        res.status(),
        `/${mappId}/ should serve a 2xx response, not nginx 404`,
      ).toBeLessThan(300);

      const body = await res.text();
      expect(body, `placeholder must reference ${mappId}`).toContain(mappId);
      expect(body, `placeholder must show "Not installed yet" copy`).toContain("Not installed yet");
      expect(body, `placeholder must surface MApp Marketplace CTA`).toContain("MApp Marketplace");
      // Back-link to /
      expect(body, "placeholder must back-link to MApp Desktop").toContain('href="/"');
    });
  }

  test(`/<unknown>/ returns nginx 404 (no placeholder for non-configured ids)`, async ({ request }) => {
    // The placeholder writer only writes for tiles that the gateway
    // resolves from hosting.mapps[]. A made-up id has no slot and
    // nginx falls back to its default 404. Locks in this distinction
    // so a future change that auto-creates placeholders for ANY
    // requested id (which would mask config errors) trips this test.
    const res = await request.get(`${PROJECT_URL}/this-mapp-was-never-configured/`, {
      ignoreHTTPSErrors: true,
      timeout: 10_000,
    });
    expect(
      res.status(),
      "unconfigured mappId must 404 — only configured mapps get placeholder slots",
    ).toBe(404);
  });
});
