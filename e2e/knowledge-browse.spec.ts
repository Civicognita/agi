import { test, expect } from "@playwright/test";

/**
 * Knowledge "Browse" page (/knowledge) — read-only PRIME corpus browser.
 *
 * Regression guard: the page previously called fetchFileTree() with no root,
 * which the built-in /api/files/tree endpoint 403s (it only serves docs/), so
 * the catch swallowed it to [] and the page rendered "No files found". The fix
 * adds a read-only "knowledge" root sourced from the PRIME corpus and points the
 * page at it.
 */

test.describe("Knowledge Browse — API layer", () => {
  test("GET /api/files/tree?root=knowledge returns a tree (not 403)", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const res = await page.evaluate(async () => {
      const r = await fetch("/api/files/tree?root=knowledge");
      return { status: r.status, body: await r.json().catch(() => null) };
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.tree)).toBe(true);
  });

  test("a knowledge file reads via /api/files/read?path=knowledge/...", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    // Find the first file node anywhere in the knowledge tree.
    const firstFile = await page.evaluate(async () => {
      const r = await fetch("/api/files/tree?root=knowledge");
      if (!r.ok) return null;
      const { tree } = await r.json() as { tree: Array<{ path: string; type: string; children?: unknown[] }> };
      const walk = (nodes: Array<{ path: string; type: string; children?: unknown[] }>): string | null => {
        for (const n of nodes) {
          if (n.type === "file") return n.path;
          const c = n.children as typeof nodes | undefined;
          if (c) { const found = walk(c); if (found) return found; }
        }
        return null;
      };
      return walk(tree);
    });
    // Empty corpus (no PRIME mounted) is a valid state — skip rather than fail.
    if (!firstFile) { test.skip(); return; }

    const read = await page.evaluate(async (path: string) => {
      const r = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
      return { status: r.status, body: await r.json().catch(() => null) };
    }, firstFile);

    expect(read.status).toBe(200);
    expect(typeof read.body?.content).toBe("string");
  });

  test("path traversal out of the knowledge corpus is rejected", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const res = await page.evaluate(async () => {
      const r = await fetch(`/api/files/read?path=${encodeURIComponent("knowledge/../../../etc/passwd")}`);
      return r.status;
    });
    // 403 (outside corpus) or 404 (resolved-but-missing) — never 200.
    expect([403, 404]).toContain(res);
  });
});

test.describe("Knowledge Browse — UI", () => {
  test("/knowledge renders the corpus tree, not the empty state", async ({ page }) => {
    await page.goto("/knowledge");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    // Skip when the corpus is empty (no PRIME) — the empty state is then correct.
    // Evaluated AFTER navigation so fetch has the app origin (not about:blank).
    const hasFiles = await page.evaluate(async () => {
      const r = await fetch("/api/files/tree?root=knowledge");
      if (!r.ok) return false;
      const { tree } = await r.json() as { tree: unknown[] };
      return Array.isArray(tree) && tree.length > 0;
    }).catch(() => false);

    if (!hasFiles) { test.skip(); return; }

    // The tree rendered → the "No files found" empty state must be absent.
    await expect(page.getByText("No files found")).toHaveCount(0);
  });
});
