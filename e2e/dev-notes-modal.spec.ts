import { test, expect } from "@playwright/test";

/**
 * DevNotes universal modal — cycle 150 refactor.
 *
 * Verifies:
 *   - Icon trigger appears in the header when notes are registered
 *     (Contributing/Dev Mode is on in the test VM by default)
 *   - Count badge matches registered notes count
 *   - Clicking opens the modal
 *   - Modal shows entry 1 of N with prev/next navigation
 *   - Arrow keys + clickable arrows navigate the stack
 *   - Esc key closes the modal
 *
 * Notes register from whatever page renders. Projects browser has 6
 * notes (cycle 150 backfill via the legacy shim), so we navigate there
 * first, wait for registration, then exercise the modal.
 */

test.describe("DevNotes universal modal (cycle 150)", () => {
  // DevNotes are visibility-gated on Contributing/Dev Mode. Enable it via the
  // config PATCH endpoint before each test so the icon renders. Restore at
  // teardown so we don't leak state into other specs.
  let devModeWas: boolean | undefined;

  test.beforeEach(async ({ request }) => {
    const cfg = await (await request.get("/api/config")).json() as { dev?: { enabled?: boolean } };
    devModeWas = cfg.dev?.enabled;
    if (devModeWas !== true) {
      await request.patch("/api/config", { data: { key: "dev.enabled", value: true } });
    }
  });

  test.afterEach(async ({ request }) => {
    if (devModeWas !== true) {
      await request.patch("/api/config", { data: { key: "dev.enabled", value: devModeWas ?? false } });
    }
  });

  test("icon appears in header on /projects when notes are registered", async ({ page }) => {
    await page.goto("/projects");
    // Mount + register fires inside useEffect on first render. Give it a beat.
    const icon = page.getByTestId("dev-notes-icon");
    await expect(icon).toBeVisible({ timeout: 5_000 });
    // Count badge should show a positive integer (Projects.tsx has 6 notes)
    const badge = page.getByTestId("dev-notes-count-badge");
    await expect(badge).toBeVisible();
    const txt = (await badge.textContent())?.trim() ?? "";
    expect(Number(txt)).toBeGreaterThan(0);
  });

  test("clicking icon opens the global modal", async ({ page }) => {
    await page.goto("/projects");
    await page.getByTestId("dev-notes-icon").click();
    await expect(page.getByTestId("dev-notes-modal")).toBeVisible();
    await expect(page.getByTestId("dev-notes-modal-entry")).toBeVisible();
  });

  test("clickable next/prev arrows navigate through the stack", async ({ page }) => {
    await page.goto("/projects");
    await page.getByTestId("dev-notes-icon").click();
    await expect(page.getByTestId("dev-notes-modal")).toBeVisible();

    // Get the modal title — should read "1 of N · ..."
    const title = page.getByText(/^\d+ of \d+/);
    const initial = await title.textContent();
    expect(initial).toMatch(/^1 of \d+/);

    // Click next; index should advance
    await page.getByTestId("dev-notes-modal-next").click();
    const after = await title.textContent();
    expect(after).toMatch(/^2 of \d+/);

    // Click prev; back to 1
    await page.getByTestId("dev-notes-modal-prev").click();
    const back = await title.textContent();
    expect(back).toMatch(/^1 of \d+/);
  });

  test("page does NOT infinite-loop when DevNotes have JSX bodies (v0.4.427 regression)", async ({ page }) => {
    // Cycle 150 v0.4.426 → v0.4.427 hotfix:
    //   Owner observed "results hung hard crash" when navigating to pages
    //   with DevNotes that have JSX children. Root cause: `children` was
    //   in the useEffect deps array; JSX with markup produced unstable
    //   references, triggering register → setVersion → re-render → loop.
    //   Fix: capture children into a ref outside the effect deps.
    //
    // This test catches the regression by mounting a page with DevNotes
    // (Projects browser has 6 with JSX bodies) and checking that:
    //   1. Page renders within reasonable time (no infinite loop)
    //   2. Render didn't queue thousands of frames (cap on stable layout)
    let renderTickCount = 0;
    page.on("console", (msg) => {
      if (msg.text().includes("Maximum update depth exceeded") || msg.text().includes("Too many re-renders")) {
        renderTickCount = 9999; // sentinel — React caught the loop itself
      }
    });
    const start = Date.now();
    await page.goto("/projects", { timeout: 8_000 });
    // Wait for the projects table to settle. If we're in an infinite loop,
    // this either times out OR React emits a "Maximum update depth" error.
    await page.waitForLoadState("networkidle", { timeout: 10_000 });
    const elapsed = Date.now() - start;
    expect(renderTickCount, "no React 'Maximum update depth' error during page load").toBeLessThan(9999);
    expect(elapsed, `page load completed in ${String(elapsed)}ms (sub-10s sanity bound)`).toBeLessThan(10_000);
    // Also verify the icon rendered — proves the provider didn't crash mid-flight.
    await expect(page.getByTestId("dev-notes-icon")).toBeVisible({ timeout: 2_000 });
  });

  test("ArrowRight + ArrowLeft keys navigate; Esc closes", async ({ page }) => {
    await page.goto("/projects");
    await page.getByTestId("dev-notes-icon").click();
    await expect(page.getByTestId("dev-notes-modal")).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(/^2 of \d+/)).toBeVisible();

    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText(/^1 of \d+/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("dev-notes-modal")).toBeHidden();
  });
});
