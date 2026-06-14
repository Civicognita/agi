import { test, expect } from "@playwright/test";

/**
 * Incoming-PR review queue — the _aionima container's "Incoming" tab.
 *
 * Verifies the inbound review surface (personal forks → upstream/dev):
 *   - GET /api/dev/incoming/status returns the grouped IncomingStatus shape
 *   - The Incoming tab renders, with either the empty-state, an error card
 *     (no GitHub token in the test VM), or per-repo PR groups
 *   - Any rendered PR row exposes a "View on GitHub" link (merge stays on GitHub)
 *
 * The test VM has no connected GitHub account, so the realistic path is the
 * token-unavailable error card; the spec tolerates all three states rather than
 * forcing a fixture.
 */

test.describe("Incoming-PR review queue — API", () => {
  test("GET /api/dev/incoming/status returns the IncomingStatus shape", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/dev/incoming/status");
      return { status: res.status, body: await res.json().catch(() => null) };
    });

    // 200 with the grouped shape, or a 403 when not admin / not private network.
    if (result.status === 403) {
      test.skip();
      return;
    }
    expect(result.status).toBe(200);
    expect(result.body).not.toBeNull();
    // ownerLogin is string|null; repos is always an array.
    expect(Array.isArray(result.body.repos)).toBe(true);
    expect("ownerLogin" in result.body).toBe(true);
    // Each repo entry (if any) carries slug + prs array.
    for (const repo of result.body.repos as Array<{ slug: string; prs: unknown[] }>) {
      expect(typeof repo.slug).toBe("string");
      expect(Array.isArray(repo.prs)).toBe(true);
    }
  });

  test("POST incoming/:slug/pr/:n/test returns the agi test-vm pr command", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/dev/incoming/agi/pr/178/test", { method: "POST" });
      return { status: res.status, body: await res.json().catch(() => null) };
    });
    if (result.status === 403) {
      test.skip();
      return;
    }
    expect(result.status).toBe(200);
    expect(result.body.supported).toBe(true);
    expect(result.body.command).toBe("agi test-vm pr agi 178");
  });

  test("POST incoming test rejects a non-numeric PR number", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/dev/incoming/agi/pr/not-a-number/test", { method: "POST" });
      return res.status;
    });
    // 400 invalid number, or 403 when not admin / not private network.
    expect([400, 403]).toContain(result);
  });
});

test.describe("Incoming-PR review queue — UI", () => {
  async function openAionimaProject(page: import("@playwright/test").Page): Promise<boolean> {
    // The _aionima container only exists in Dev/Contributing Mode. Navigate to it
    // directly; the Incoming tab is only reachable when it's provisioned.
    await page.goto("/projects/_aionima", { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 }).catch(() => undefined);
    return (await page.getByTestId("project-tab-incoming").count()) > 0;
  }

  test("Incoming tab renders the panel (empty-state, error, or PR groups)", async ({ page }) => {
    const reachable = await openAionimaProject(page);
    if (!reachable) {
      test.skip();
      return;
    }
    await page.getByTestId("project-tab-incoming").click();
    await expect(page.getByTestId("aionima-incoming-panel")).toBeVisible({ timeout: 8_000 });

    // Exactly one of: empty-state, error card, or at least one PR group.
    const empty = page.getByTestId("aionima-incoming-empty");
    const error = page.getByTestId("aionima-incoming-error");
    const groups = page.getByTestId(/^aionima-incoming-group-/);
    const total = (await empty.count()) + (await error.count()) + (await groups.count());
    expect(total).toBeGreaterThanOrEqual(1);
  });

  test("any rendered PR row links out to GitHub for merge", async ({ page }) => {
    const reachable = await openAionimaProject(page);
    if (!reachable) {
      test.skip();
      return;
    }
    await page.getByTestId("project-tab-incoming").click();
    await expect(page.getByTestId("aionima-incoming-panel")).toBeVisible({ timeout: 8_000 });

    const viewLinks = page.getByTestId(/^aionima-incoming-view-/);
    const count = await viewLinks.count();
    if (count === 0) return; // empty / error state — nothing to assert
    await expect(viewLinks.first()).toHaveAttribute("href", /github\.com/);
  });
});
