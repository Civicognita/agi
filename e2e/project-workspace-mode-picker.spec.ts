import { test, expect, Page } from "@playwright/test";

/**
 * Project workspace mode picker e2e (s134 t517).
 *
 * Verifies the cycle-111 stack strip + cycle-112 4-mode picker render
 * on /projects/<slug> as expected:
 *   - Mode picker has 4 buttons (Develop / Operate / Coordinate / Insight)
 *     for projects with web/app/monorepo/ops categories
 *   - Default mode is "develop"
 *   - Clicking a mode button toggles the active state (aria-pressed)
 *   - Insight mode (cycle 117) shows the Activity tab + bar chart
 *
 * Uses the Projects grid-view to click into a project workspace
 * (the list-view rows in cycles 102-109 don't expose project-card
 * testids; switching to grid via the toggle is the e2e-friendly path).
 *
 * Cycle 119 (s134 t517 env follow-up): cycle-113 tests skipped silently
 * because (a) `picker.isVisible({timeout})` is a snapshot, not a wait —
 * fixed by switching to `picker.waitFor({state:"visible"})`; and (b)
 * cards.first() landed on sample-admin (administration category) which
 * hides Develop per cycle-115 category-shape — fixed by walking cards
 * to find one with all 4 modes (`navigateToFullModeProject`).
 */

/**
 * Query /api/projects to find a non-restricted (web/app/monorepo/ops)
 * project, then navigate directly to its workspace slug. Avoids the
 * goBack-clobbers-grid-view problem of walking cards in the UI.
 */
async function navigateToFullModeProject(page: Page): Promise<boolean> {
  const RESTRICTED = new Set(["literature", "media", "administration"]);

  const apiResponse = await page.request.get("/api/projects");
  if (!apiResponse.ok()) return false;
  const projects = await apiResponse.json() as Array<{
    name: string;
    path: string;
    coreForkSlug?: string | null;
    category?: string;
    projectType?: { id?: string; category?: string };
  }>;

  const candidate = projects.find((p) => {
    if (p.coreForkSlug) return false; // core fork — picker hidden
    if (p.projectType?.id === "aionima") return false;
    const cat = p.category ?? p.projectType?.category;
    if (!cat) return false;
    return !RESTRICTED.has(cat);
  });
  if (!candidate) return false;

  const slug = candidate.path.split("/").pop() ?? candidate.name;
  await page.goto(`/projects/${slug}`);
  await page.getByTestId("project-mode-picker").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("project-mode-develop").waitFor({ state: "visible", timeout: 5_000 });
  return true;
}

test.describe("Project workspace mode picker (s134 t517)", () => {
  test("mode picker renders with 4 buttons and develop is default", async ({ page }) => {
    const found = await navigateToFullModeProject(page);
    test.skip(!found, "no full-mode (web/app/monorepo/ops) project available");

    await expect(page.getByTestId("project-mode-develop")).toBeVisible();
    await expect(page.getByTestId("project-mode-operate")).toBeVisible();
    await expect(page.getByTestId("project-mode-coordinate")).toBeVisible();
    await expect(page.getByTestId("project-mode-insight")).toBeVisible();

    // Default = develop
    await expect(page.getByTestId("project-mode-develop")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("project-mode-operate")).toHaveAttribute("aria-pressed", "false");
  });

  test("Insight mode shows Activity tab (s134 t517 cycle 117)", async ({ page }) => {
    const found = await navigateToFullModeProject(page);
    test.skip(!found, "no full-mode project available");

    // Switch to Insight mode and verify Activity tab is present.
    // react-fancy Tabs doesn't forward data-testid to the rendered button,
    // so locate by role+name (the rendered <button role="tab">).
    await page.getByTestId("project-mode-insight").click();
    await expect(page.getByTestId("project-mode-insight")).toHaveAttribute("aria-pressed", "true");
    const activityTab = page.getByRole("tab", { name: "Activity" });
    await expect(activityTab).toBeVisible();

    // Click Activity tab and verify the bar chart container renders.
    await activityTab.click();
    await expect(page.getByTestId("project-activity-bars")).toBeVisible({ timeout: 10_000 });
  });

  test("clicking a mode button toggles active state", async ({ page }) => {
    const found = await navigateToFullModeProject(page);
    test.skip(!found, "no full-mode project available");

    // Click "operate" mode
    await page.getByTestId("project-mode-operate").click();
    await expect(page.getByTestId("project-mode-operate")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("project-mode-develop")).toHaveAttribute("aria-pressed", "false");

    // Click "insight" mode
    await page.getByTestId("project-mode-insight").click();
    await expect(page.getByTestId("project-mode-insight")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("project-mode-operate")).toHaveAttribute("aria-pressed", "false");
  });

  // -----------------------------------------------------------------------
  // Cycle 146 — slice 5b/5c shipped pieces verification.
  // -----------------------------------------------------------------------

  test("sub-surface label updates with active mode (slice 5a/5b)", async ({ page }) => {
    const found = await navigateToFullModeProject(page);
    test.skip(!found, "no full-mode project available");

    // Default: develop mode → label reads "develop ›"
    const label = page.getByTestId("project-sub-surface-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText(/develop/i);

    // Switch to operate; label should update.
    await page.getByTestId("project-mode-operate").click();
    await expect(label).toHaveText(/operate/i);
  });

  test("Sub-surface header reflects active tab (slice 5c phase 1, cycle 157 prefix-drop)", async ({ page }) => {
    const found = await navigateToFullModeProject(page);
    test.skip(!found, "no full-mode project available");

    // Default tab in develop mode is one of: details/files/repository/environment.
    // Owner directive cycle 157: drop the 'Canvas · ' prefix — there's only
    // one Canvas (the AgentCanvas that opens with chat), so the prefix on
    // every project sub-tab was misleading. Header now shows just the
    // sub-surface label.
    const header = page.getByTestId("project-canvas-header");
    await expect(header).toBeVisible();
    await expect(header).toHaveText(/^(Details|Editor|Repository|Environment)$/);
    // Hard regression guard: the deprecated prefix must NEVER reappear.
    await expect(header).not.toHaveText(/Canvas\s*·/);

    // Click another tab (Repository) — header should update if Repository tab exists.
    const repoTab = page.getByRole("tab", { name: "Repository" });
    if (await repoTab.count() > 0) {
      await repoTab.click();
      await expect(header).toHaveText(/^Repository$/);
    }
  });

  // -----------------------------------------------------------------------
  // Cycle 188 — mode-narrowing render verification for restricted categories
  // (literature / media / administration). The pure-logic helper at
  // `lib/project-mode-narrowing.ts` is unit-tested separately (cycle 182,
  // 12 unit tests). These e2e probes verify the helper's output actually
  // surfaces correctly in the rendered mode-picker DOM.
  //
  // Each test skips when no project of the relevant category exists — the
  // test VM's fixture set may or may not include them.
  // -----------------------------------------------------------------------

  async function findProjectByCategory(page: Page, category: string): Promise<string | null> {
    const apiResponse = await page.request.get("/api/projects");
    if (!apiResponse.ok()) return null;
    const projects = await apiResponse.json() as Array<{
      name: string;
      path: string;
      coreForkSlug?: string | null;
      category?: string;
      projectType?: { id?: string; category?: string };
    }>;
    const match = projects.find((p) => {
      if (p.coreForkSlug) return false;
      if (p.projectType?.id === "aionima") return false;
      const cat = p.category ?? p.projectType?.category;
      return cat === category;
    });
    if (!match) return null;
    return match.path.split("/").pop() ?? match.name;
  }

  test("literature project hides develop + operate modes (cycle 188)", async ({ page }) => {
    const slug = await findProjectByCategory(page, "literature");
    test.skip(!slug, "no literature-category project available in test workspace");

    await page.goto(`/projects/${String(slug)}`);
    await page.getByTestId("project-mode-picker").waitFor({ state: "visible", timeout: 15_000 });

    // Coordinate + Insight visible; Develop + Operate absent.
    await expect(page.getByTestId("project-mode-coordinate")).toBeVisible();
    await expect(page.getByTestId("project-mode-insight")).toBeVisible();
    await expect(page.getByTestId("project-mode-develop")).toHaveCount(0);
    await expect(page.getByTestId("project-mode-operate")).toHaveCount(0);
  });

  test("media project hides develop + operate modes (cycle 188)", async ({ page }) => {
    const slug = await findProjectByCategory(page, "media");
    test.skip(!slug, "no media-category project available in test workspace");

    await page.goto(`/projects/${String(slug)}`);
    await page.getByTestId("project-mode-picker").waitFor({ state: "visible", timeout: 15_000 });

    await expect(page.getByTestId("project-mode-coordinate")).toBeVisible();
    await expect(page.getByTestId("project-mode-insight")).toBeVisible();
    await expect(page.getByTestId("project-mode-develop")).toHaveCount(0);
    await expect(page.getByTestId("project-mode-operate")).toHaveCount(0);
  });

  test("administration project hides develop but keeps operate (cycle 188)", async ({ page }) => {
    const slug = await findProjectByCategory(page, "administration");
    test.skip(!slug, "no administration-category project available in test workspace");

    await page.goto(`/projects/${String(slug)}`);
    await page.getByTestId("project-mode-picker").waitFor({ state: "visible", timeout: 15_000 });

    // Develop hidden; Operate + Coordinate + Insight visible.
    await expect(page.getByTestId("project-mode-operate")).toBeVisible();
    await expect(page.getByTestId("project-mode-coordinate")).toBeVisible();
    await expect(page.getByTestId("project-mode-insight")).toBeVisible();
    await expect(page.getByTestId("project-mode-develop")).toHaveCount(0);
  });

  test("administration project default-mode auto-redirects from develop to operate (cycle 188)", async ({ page }) => {
    const slug = await findProjectByCategory(page, "administration");
    test.skip(!slug, "no administration-category project available in test workspace");

    await page.goto(`/projects/${String(slug)}`);
    await page.getByTestId("project-mode-picker").waitFor({ state: "visible", timeout: 15_000 });

    // `develop` is the component-state default, but it's hidden for this
    // category → fallbackModeForCategory redirects to `operate` (the first
    // visible mode in ALL_PROJECT_MODES order after the develop filter).
    await expect(page.getByTestId("project-mode-operate")).toHaveAttribute("aria-pressed", "true");
  });

  test("flyout-shell wraps Canvas + Chat aside (slice 5c phase 2)", async ({ page }) => {
    const found = await navigateToFullModeProject(page);
    test.skip(!found, "no full-mode project available");

    // The flyout-shell wrapper must be present.
    await expect(page.getByTestId("project-flyout-shell")).toBeVisible();

    // The chat aside is rendered (DOM-present); visibility depends on viewport
    // width because of `hidden lg:flex`. Default Playwright viewport is 1280×720
    // which is lg+, so the aside should be visible.
    const aside = page.getByTestId("project-chat-aside");
    await expect(aside).toBeAttached();
    // Aside has a "Chat" header (cycle 145) and an Open-chat affordance
    // (cycle 147 phase-3 starter — kept across copy revisions).
    await expect(aside).toContainText(/Chat/);
    await expect(page.getByTestId("project-chat-aside-open")).toBeVisible();
  });
});
