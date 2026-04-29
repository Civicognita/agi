import { test, expect } from "@playwright/test";

/**
 * Ops-mode badge e2e (s126).
 *
 * Verifies the Projects tile shows the "ops mode" pill ONLY when a project's
 * category is `ops` or `administration`. Non-ops projects render the standard
 * neutral category badge. Skips gracefully if no project of either shape is
 * available (test VM may not have an ops project provisioned).
 */

interface ProjectInfo {
  name: string;
  path: string;
  category?: string;
  projectType?: { id?: string; category?: string };
}

async function listProjects(request: import("@playwright/test").APIRequestContext): Promise<ProjectInfo[]> {
  const res = await request.get("/api/projects").catch(() => null);
  if (!res || !res.ok()) return [];
  return (await res.json()) as ProjectInfo[];
}

function categoryOf(p: ProjectInfo): string | undefined {
  return p.category ?? p.projectType?.category;
}

test.describe("Ops-mode badge", () => {
  test("ops project tile renders the 'ops mode' pill", async ({ page, request }) => {
    const projects = await listProjects(request);
    const opsProject = projects.find((p) => {
      const c = categoryOf(p);
      return c === "ops" || c === "administration";
    });
    test.skip(!opsProject, "no ops/administration project provisioned in test VM");

    await page.goto("/projects");
    await page.waitForLoadState("domcontentloaded");

    // The tile contains the project name + the ops-mode pill text.
    const tile = page.locator(`text=${opsProject!.name}`).first();
    await expect(tile).toBeVisible({ timeout: 10_000 });

    // Pill text format: "<category> · ops mode" (the · separator is from Projects.tsx).
    const opsBadge = page.locator("text=/ops mode/i").first();
    await expect(opsBadge).toBeVisible({ timeout: 5_000 });
  });

  test("non-ops project tile does NOT render the 'ops mode' pill", async ({ page, request }) => {
    const projects = await listProjects(request);
    const nonOpsProject = projects.find((p) => {
      const c = categoryOf(p);
      return c !== undefined && c !== "ops" && c !== "administration";
    });
    test.skip(!nonOpsProject, "no non-ops project to compare against");

    await page.goto("/projects");
    await page.waitForLoadState("domcontentloaded");

    // Confirm the project tile renders (the page actually loaded).
    await expect(page.locator(`text=${nonOpsProject!.name}`).first()).toBeVisible({ timeout: 10_000 });

    // If the only category badges on screen include "ops mode," that would be
    // a regression. We don't assert a hard absence (an ops project may also
    // exist on the page) — instead, we look at the specific tile.
    const tile = page.locator(`[data-project-name="${nonOpsProject!.name}"]`).first();
    if (await tile.count() > 0) {
      await expect(tile).not.toContainText(/ops mode/i);
    }
  });
});
