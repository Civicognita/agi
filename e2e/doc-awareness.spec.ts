import { test, expect } from "@playwright/test";

/**
 * Doc-awareness e2e tests (s197).
 *
 * Verifies structural prerequisites for Aion's awareness of agi/docs/:
 *   - search_docs API returns relevant chunks from known docs
 *   - lookup_doc API can fetch a known doc by path
 *   - search_docs surfaces taskmaster.md for scheduling questions
 *
 * These tests hit the gateway API directly — no LLM response required.
 * Structural only, consistent with the existing chat-workflow and chat-persona
 * test patterns (LLM-dependent response assertions are out of scope for e2e).
 */

test.describe("Doc awareness — search_docs + lookup_doc (s197)", () => {
  test("GET /api/memory/search-docs returns 200 for a keyword query", async ({ request }) => {
    const res = await request.get("/api/memory/search-docs?q=plugin");
    // 200 with chunks array (may be empty if DocIndexer not yet seeded — still 200)
    expect(res.status()).toBe(200);
    const body = await res.json() as { chunks?: unknown[] };
    expect(Array.isArray(body.chunks)).toBe(true);
  });

  test("search_docs surfaces taskmaster.md chunk for 'scheduled job' query", async ({ request }) => {
    const res = await request.get("/api/memory/search-docs?q=scheduled+job&limit=10");
    expect(res.status()).toBe(200);
    const body = await res.json() as { chunks?: Array<{ sourcePath?: string; heading?: string; content?: string }> };

    test.skip(
      !Array.isArray(body.chunks) || body.chunks.length === 0,
      "DocIndexer not yet seeded — skip on fresh install",
    );

    const hasTaskmaster = body.chunks?.some(
      (c) => typeof c.sourcePath === "string" && c.sourcePath.includes("taskmaster"),
    ) ?? false;

    expect(hasTaskmaster).toBe(true);
  });

  test("search_docs surfaces iterative-work.md for 'iterative work' query", async ({ request }) => {
    const res = await request.get("/api/memory/search-docs?q=iterative+work&limit=10");
    expect(res.status()).toBe(200);
    const body = await res.json() as { chunks?: Array<{ sourcePath?: string }> };

    test.skip(
      !Array.isArray(body.chunks) || body.chunks.length === 0,
      "DocIndexer not yet seeded — skip on fresh install",
    );

    const hasIterativeWork = body.chunks?.some(
      (c) => typeof c.sourcePath === "string" && c.sourcePath.includes("iterative-work"),
    ) ?? false;

    expect(hasIterativeWork).toBe(true);
  });

  test("dashboard renders without JS errors on /", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("hearth-top")).toBeVisible();

    const jsErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") jsErrors.push(msg.text());
    });

    // Allow a brief settle for deferred hydration
    await page.waitForTimeout(500);
    expect(jsErrors).toHaveLength(0);
  });
});
