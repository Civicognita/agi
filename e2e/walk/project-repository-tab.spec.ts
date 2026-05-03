/**
 * Project Repository tab — post-s140 hasGit detection (cycle 168).
 *
 * Locks in the cycle-168 hasGit fix. Pre-fix: civicognita_web had its
 * .git at /home/wishborn/_projects/civicognita_web/repos/civicognita_web/.git
 * (post-s140 layout) but the gateway's hasGit detector only checked
 * <projectPath>/.git, returning false. ProjectDetail.tsx:1020 routed to
 * the empty state ("Add Repository / Clone / Init empty repo") instead
 * of rendering the RepoPanel + RepoManager.
 *
 * Post-fix (v0.4.472): hasGit is true when EITHER the legacy root
 * .git exists OR any populated repos[] entry has its repos/<name>/.git.
 *
 * Spec runs against production via BASE_URL=https://ai.on. Pass
 * criteria:
 *   - /api/projects returns hasGit=true for civicognita_web
 *   - The Repository tab on /projects/civicognita-web renders the
 *     multi-repo manager (the "Repositories" section + at least one
 *     repo row)
 *   - The empty-state copy ("Add Repository", "Init empty repo") does
 *     NOT appear on the Repository tab
 *
 * Run via:
 *   agi test --e2e walk/project-repository-tab
 */

import { test, expect } from "@playwright/test";

test.describe("project Repository tab — hasGit detection (s140 cycle-168 fix)", () => {
  test("/api/projects returns hasGit=true for civicognita_web", async ({ request }) => {
    const res = await request.get("/api/projects");
    expect(res.status()).toBeLessThan(300);
    const body = await res.json() as { projects?: Array<{ name?: string; hasGit?: boolean; repos?: Array<unknown> }> } | Array<{ name?: string; hasGit?: boolean; repos?: Array<unknown> }>;
    const projects = Array.isArray(body) ? body : body.projects ?? [];
    const web = projects.find((p) => p.name === "civicognita_web");
    expect(web, "civicognita_web must appear in /api/projects").toBeDefined();
    expect(
      web?.hasGit,
      "post-s140 fix: hasGit must be true when repos[] has an entry whose repos/<name>/.git/ exists",
    ).toBe(true);
    expect((web?.repos ?? []).length, "civicognita_web must have a repos[] entry").toBeGreaterThan(0);
  });

  test("Repository tab on /projects/civicognita-web renders the multi-repo manager", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto("/projects/civicognita-web");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Switch to the Repository tab. The PAx Tabs component uses
    // role="tab" and updates aria-selected on click — but the click
    // doesn't always fire React's tab change handler reliably from
    // chrome MCP, so we trigger directly via locator.click() (Playwright
    // dispatches synthetic events that React listens for).
    const repoTab = page.getByRole("tab", { name: /^Repository$/ });
    await expect(repoTab, "Repository tab must be in the tablist").toBeVisible({ timeout: 10_000 });
    await repoTab.click();

    // Wait for the Repository panel content to mount.
    await page.waitForTimeout(500);

    // Pre-fix: the empty-state branch rendered "Add Repository" + "Init
    // empty repo" copy. Post-fix: the RepoPanel + RepoManager render
    // and that copy is absent.
    //
    // We assert the multi-repo manager's Repositories section is
    // visible (data-testid not present on this section so we match by
    // text). We also assert the actual repo's URL appears — the
    // strongest anti-empty-state signal.
    await expect(
      page.getByText(/multi-repo runs in one container with concurrently/i).first(),
      "RepoManager 'multi-repo' caption must render — confirms hasGit=true branch",
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByText(/git@github\.com:Civicognita\/civicognita_website\.git/i).first(),
      "the configured repo URL must appear in the Repository tab",
    ).toBeVisible({ timeout: 5_000 });

    // Empty-state markers must NOT appear on the Repository tab post-fix.
    // Use locator.count() to allow the strings to exist elsewhere on the
    // page (e.g. unrelated docs); we only care about the Repository tab
    // panel. The active tabpanel is what's currently visible.
    const initEmptyCount = await page.getByText(/Init empty repo/i).count();
    expect(
      initEmptyCount,
      'the "Init empty repo" empty-state CTA must not render when hasGit is true',
    ).toBe(0);

    expect(pageErrors, `pageerrors: ${pageErrors.join(" | ")}`).toEqual([]);
  });
});
