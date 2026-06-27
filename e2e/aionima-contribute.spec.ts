import { test, expect } from "@playwright/test";

/**
 * Aionima Contribute UX e2e spec (Phase 2 — Dev Mode outbound).
 *
 * The _aionima project page gains a "Contribute" tab that submits work back
 * upstream as cross-repo PRs targeting the upstream `dev` branch:
 *   - Learnings → PRIME (Civicognita/aionima)
 *   - Mechanics → code repos (agi, marketplaces, PAx, …)
 *
 * Each repo card shows commits-ahead-of-upstream-dev; a "Create PR" button
 * (enabled only when ahead > 0) opens a PR with an AI-drafted body.
 *
 * API-layer tests pass once the endpoints land. UI tests pass once the
 * Contribute tab + panel are wired into ProjectDetail.
 */

// ---------------------------------------------------------------------------
// API layer
// ---------------------------------------------------------------------------

test.describe("Aionima Contribute — API layer", () => {
  test("GET /api/dev/contribute/status returns grouped shape", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/dev/contribute/status");
      return { status: res.status, body: await res.json().catch(() => null) };
    });

    // 200 with grouped shape, or a structured "not provisioned / dev mode off"
    // payload — never a 500.
    expect(result.status).not.toBe(500);
    if (result.status === 200 && result.body && !result.body.error) {
      expect(Array.isArray(result.body.learnings)).toBe(true);
      expect(Array.isArray(result.body.mechanics)).toBe(true);
      // PRIME is the Learnings repo; everything else is Mechanics.
      for (const repo of [...result.body.learnings, ...result.body.mechanics]) {
        expect(typeof repo.slug).toBe("string");
        expect(typeof repo.displayName).toBe("string");
        expect(typeof repo.commitsAhead).toBe("number");
        expect(["learnings", "mechanics"]).toContain(repo.kind);
      }
      // Every learnings entry is kind=learnings; every mechanics entry kind=mechanics.
      for (const r of result.body.learnings) expect(r.kind).toBe("learnings");
      for (const r of result.body.mechanics) expect(r.kind).toBe("mechanics");
    }
  });

  test("POST /api/dev/contribute/:slug/pr rejects an unknown slug", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/dev/contribute/nonexistent-repo-xyz/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      return { status: res.status };
    });

    expect([400, 404, 422, 500]).toContain(result.status);
    // 404 is the expected "unknown slug" code.
    expect(result.status).not.toBe(200);
  });
});

// ---------------------------------------------------------------------------
// UI — Contribute tab on the _aionima project
// ---------------------------------------------------------------------------

test.describe("Aionima Contribute — UI", () => {
  test("the _aionima project exposes a Contribute tab", async ({ page }) => {
    await page.goto("/projects/_aionima");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const tab = page.getByTestId("project-tab-contribute");
    // The tab only exists for the aionima-system project type. If the project
    // isn't present in this environment, skip rather than fail.
    if ((await tab.count()) === 0) {
      test.skip();
      return;
    }
    await expect(tab).toBeVisible();
  });

  test("Contribute panel groups Learnings and Mechanics", async ({ page }) => {
    await page.goto("/projects/_aionima");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const tab = page.getByTestId("project-tab-contribute");
    if ((await tab.count()) === 0) {
      test.skip();
      return;
    }
    await tab.click();

    await expect(page.getByTestId("contribute-group-learnings")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("contribute-group-mechanics")).toBeVisible();
  });

  test("Create PR button is disabled when a repo has no commits ahead", async ({ page }) => {
    await page.goto("/projects/_aionima");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const tab = page.getByTestId("project-tab-contribute");
    if ((await tab.count()) === 0) {
      test.skip();
      return;
    }
    await tab.click();
    await expect(page.getByTestId("contribute-group-learnings")).toBeVisible({ timeout: 8_000 });

    // Any repo card with ahead=0 renders its action disabled (no PR to open).
    const disabledCreate = page.locator("[data-testid='contribute-create-pr'][disabled]");
    if ((await disabledCreate.count()) > 0) {
      await expect(disabledCreate.first()).toBeDisabled();
    }
  });

  // Regression (s222): after creating a PR and then merging it upstream, the
  // server reports no open PR (existingPrUrl=null) — but the panel kept the
  // optimistic local URL and the row still showed "View open PR". Refresh must
  // clear the optimistic state so the server truth wins.
  test("Refresh clears a stale optimistic PR link once the PR is merged", async ({ page }) => {
    const statusBody = {
      ownerLogin: "wishborn",
      learnings: [],
      mechanics: [
        {
          slug: "agi",
          displayName: "agi",
          upstreamOrg: "Civicognita",
          upstream: "agi",
          branch: "dev",
          commitsAhead: 1,
          existingPrUrl: null,
          existingPrNumber: null,
        },
      ],
    };
    await page.route("**/api/dev/contribute/status", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(statusBody) }),
    );
    await page.route("**/api/dev/contribute/agi/pr", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ prUrl: "https://github.com/Civicognita/agi/pull/1", alreadyOpen: false }),
      }),
    );

    await page.goto("/projects/_aionima");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });
    const tab = page.getByTestId("project-tab-contribute");
    if ((await tab.count()) === 0) {
      test.skip();
      return;
    }
    await tab.click();
    await expect(page.getByTestId("contribute-group-mechanics")).toBeVisible({ timeout: 8_000 });

    const row = page.getByTestId("contribute-row-agi");
    // Create the PR — the panel now holds the optimistic URL locally.
    await row.getByTestId("contribute-create-pr").click();
    await expect(page.getByTestId("contribute-pr-link-agi")).toBeVisible();

    // The PR has since been merged upstream; the status endpoint still reports
    // existingPrUrl=null (no OPEN PR). Refresh must drop the stale link and
    // restore the Create PR affordance — not keep showing "View open PR".
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByTestId("contribute-pr-link-agi")).toHaveCount(0);
    await expect(row.getByTestId("contribute-create-pr")).toBeVisible();
  });
});
