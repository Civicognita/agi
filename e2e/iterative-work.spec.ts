import { test, expect } from "@playwright/test";

/**
 * Per-project Iterative Work tab e2e (s118 t442 D1, slice 4).
 *
 * Verifies the new ProjectDetail "Iterative Work" tab — the canonical UX
 * after the s118 redesign 2026-04-27 (replaces the obsolete
 * /settings/iterative-work page). Defensive shape: skips when no eligible
 * projects are present in the environment.
 *
 * Eligibility per s118 t445 D4:
 *   web / app / ops / administration → eligible
 *   literature / media / monorepo    → not eligible (no tab visible)
 */

/**
 * Fetch the projects list via Playwright's request fixture (inherits the
 * ignoreHTTPSErrors setting from playwright.config.ts) and pick the first
 * one whose projectType reports iterativeWorkEligible. Returns undefined
 * when no eligible project exists in the environment.
 */
async function findEligibleProject(request: import("@playwright/test").APIRequestContext): Promise<{ name: string; path: string; category: string } | undefined> {
  const res = await request.get(`/api/projects`).catch(() => null);
  if (!res || !res.ok()) return undefined;
  const projects = (await res.json()) as Array<{
    name: string;
    path: string;
    category?: string;
    projectType?: { iterativeWorkEligible?: boolean; category?: string };
  }>;
  const ELIGIBLE = new Set(["web", "app", "ops", "administration"]);
  // Effective category is the project.json `category` override OR the type's
  // category — match the gateway's PUT endpoint eligibility logic.
  const eligible = projects.filter((p) => {
    const effective = p.category ?? p.projectType?.category;
    return effective !== undefined && ELIGIBLE.has(effective);
  });
  for (const cand of eligible) {
    const statusRes = await request.get(`/api/projects/iterative-work/status?path=${encodeURIComponent(cand.path)}`).catch(() => null);
    if (statusRes && statusRes.ok()) {
      return { name: cand.name, path: cand.path, category: cand.category ?? cand.projectType?.category ?? "" };
    }
  }
  return undefined;
}

test.describe("Iterative Work tab", () => {
  test("obsolete /settings/iterative-work route does not render the old per-project list page", async ({ page }) => {
    await page.goto("/settings/iterative-work", { waitUntil: "domcontentloaded" });
    const body = await page.locator("body").innerText().catch(() => "");
    // The deleted page used to render "Iterative Work" as a heading + a
    // table of all projects. Verify those markers are NOT both present.
    const hasHeading = /^Iterative Work$/m.test(body);
    const hasProjectList = /Cron|Recent fires per project/i.test(body);
    expect(hasHeading && hasProjectList).toBe(false);
  });

  test("projects index renders", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: /Projects/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("Iterative Work tab appears on eligible project detail page", async ({ page, request }) => {
    const eligible = await findEligibleProject(request);
    test.skip(!eligible, "no eligible projects (web/app/ops/administration) in this environment");

    await page.goto(`/projects/${eligible!.name}`);
    await page.waitForLoadState("domcontentloaded");
    const tab = page.getByRole("tab", { name: /Iterative Work/i });
    await expect(tab).toBeVisible({ timeout: 10_000 });
  });

  test("clicking the Iterative Work tab reveals the tab panel", async ({ page, request }) => {
    const eligible = await findEligibleProject(request);
    test.skip(!eligible, "no eligible projects in this environment");

    await page.goto(`/projects/${eligible!.name}`);
    await page.waitForLoadState("domcontentloaded");
    const tab = page.getByRole("tab", { name: /Iterative Work/i });
    await tab.click();
    await expect(page.getByTestId("iterative-work-tab")).toBeVisible({ timeout: 10_000 });
  });

  test("Iterative Work tab exposes cadence dropdown + save button + dev-tier options", async ({ page, request }) => {
    const eligible = await findEligibleProject(request);
    test.skip(!eligible, "no eligible projects in this environment");

    await page.goto(`/projects/${eligible!.name}`);
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("tab", { name: /Iterative Work/i }).click();
    await expect(page.getByTestId("iterative-work-tab")).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId("iterative-work-toggle")).toBeAttached();
    await expect(page.getByTestId("iterative-work-cadence")).toBeAttached();
    await expect(page.getByTestId("iterative-work-save")).toBeAttached();

    // Dev-tier (web/app) cadences must be present in the dropdown.
    const select = page.getByTestId("iterative-work-cadence");
    const optionsTxt = (await select.locator("option").allTextContents()).join(" ");
    expect(/30 minutes/i.test(optionsTxt)).toBe(true);
    expect(/Every hour/i.test(optionsTxt)).toBe(true);
  });

  test("toggle + cadence save round-trip persists via API", async ({ page, request }) => {
    const eligible = await findEligibleProject(request);
    test.skip(!eligible, "no eligible projects in this environment");

    await page.goto(`/projects/${eligible!.name}`);
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("tab", { name: /Iterative Work/i }).click();
    await expect(page.getByTestId("iterative-work-tab")).toBeVisible({ timeout: 10_000 });

    // Wait for the initial /status refresh to settle — otherwise it may
    // overwrite the toggle state set by check() below.
    await page.waitForResponse((r) => r.url().includes("/api/projects/iterative-work/status"), { timeout: 10_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle").catch(() => undefined);

    // Enable + pick cadence + save.
    const toggle = page.getByTestId("iterative-work-toggle");
    await toggle.check();
    await expect(toggle).toBeChecked();
    await page.getByTestId("iterative-work-cadence").selectOption("30m");
    await page.getByTestId("iterative-work-save").click();

    // Wait for the PUT to land on the wire and refresh to complete.
    await page.waitForResponse((r) => r.url().includes("/api/projects/iterative-work/config") && r.request().method() === "PUT", { timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);

    // Verify backend state via API.
    const res = await request.get(`/api/projects/iterative-work/status?path=${encodeURIComponent(eligible!.path)}`);
    expect(res.ok()).toBe(true);
    const status = await res.json() as { enabled: boolean; cron: string | null; cadence?: string | null };
    expect(status.enabled).toBe(true);
    expect(status.cadence).toBe("30m");
    // Cron should be auto-staggered (matches `M,M+30 * * * *` shape from D3).
    expect(status.cron).toMatch(/^\d+,\d+ \* \* \* \*$/);
  });
});
