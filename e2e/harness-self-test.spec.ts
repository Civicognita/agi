import { test, expect } from "@playwright/test";

/**
 * s138 t528 — harness self-test.
 *
 * Verifies the Playwright e2e harness can drive a basic test
 * end-to-end. Runs alongside any `agi test --e2e-headed` /
 * `agi test --e2e-ui` invocation as a smoke probe: if these
 * checks fail, the harness itself is broken (browser launch,
 * BASE_URL plumbing, network reachability) before any feature
 * spec gets a chance to fail for a different reason.
 *
 * Intentionally minimal — no auth, no specific UI text, no
 * dependency on dashboard hydration timing. Only structural
 * facts about the test environment.
 */

test.describe("Harness self-test (s138 t528)", () => {
  test("BASE_URL points at a reachable target (not the localhost default)", async ({ baseURL }) => {
    expect(baseURL, "Playwright config baseURL must be set by the runner").toBeTruthy();
    expect(baseURL!.startsWith("http"), `baseURL should be an http(s) URL, got: ${baseURL}`).toBe(true);
  });

  test("page.goto on the root URL returns a successful response", async ({ page, baseURL }) => {
    const response = await page.goto(baseURL ?? "/");
    expect(response, "page.goto should return a Response object").not.toBeNull();
    expect(response!.ok(), `expected 2xx response, got ${response!.status()}`).toBe(true);
  });

  test("browser context can render and read the document", async ({ page }) => {
    await page.goto("/");
    const title = await page.title();
    expect(typeof title, "page.title() must return a string (proves Playwright→browser→DOM bridge works)").toBe("string");
  });

  test("network requests can be captured via page.waitForResponse", async ({ page }) => {
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes("/") && response.status() < 500,
      { timeout: 10_000 },
    );
    await page.goto("/");
    const response = await responsePromise;
    expect(response.status(), `network response should be < 500, got ${response.status()}`).toBeLessThan(500);
  });
});
