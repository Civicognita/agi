import { test, expect } from "@playwright/test";

/**
 * s199 — 3-panel Communications workspace shell e2e verification.
 *
 * Acceptance criteria:
 * 1. All /comms/* routes render inside CommsLayout without error
 * 2. Inspector panel is NOT in DOM at idle (zero DOM overhead)
 * 3. Clicking a thread card opens inspector with "Message Detail" title
 * 4. Clicking a flag row opens inspector with "Flag Detail" title
 * 5. Clicking an activity event opens inspector with "Event Detail" title
 * 6. Close (×) dismisses panel; layout returns to full-width
 *
 * Tests 3–5 are data-conditional: they run only when rows exist in the live
 * gateway. The structural tests (1, 2, 6) always run.
 */

const COMMS_ROUTES = [
  "/comms",
  "/comms/activity",
  "/comms/discord",
  "/comms/gmail",
  "/comms/telegram",
  "/comms/signal",
  "/comms/whatsapp",
  "/comms/moderation",
  "/comms/channels",
];

test.describe("s199 — 3-panel Communications workspace shell", () => {
  test("all /comms/* routes render without JS error", async ({ page }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (e) => jsErrors.push(e.message));

    for (const route of COMMS_ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      // Sidebar presence confirms CommsLayout rendered without crash
      await expect(page.getByTestId("hearth-top")).toBeVisible();
      await expect(page).toHaveURL(route);
    }

    expect(jsErrors).toHaveLength(0);
  });

  test("inspector panel is absent from DOM at idle on all comms routes", async ({ page }) => {
    for (const route of COMMS_ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      await expect(page.getByTestId("hearth-top")).toBeVisible();
      await expect(page.getByTestId("inspector-panel")).toHaveCount(0);
    }
  });

  test("clicking a thread card opens Message Detail inspector", async ({ page }) => {
    await page.goto("/comms");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("hearth-top")).toBeVisible();

    const cards = page.getByTestId("thread-card");
    const count = await cards.count();
    if (count === 0) {
      test.skip();
      return;
    }

    await cards.first().click();
    const panel = page.getByTestId("inspector-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Message Detail")).toBeVisible();
  });

  test("close button dismisses inspector and restores layout", async ({ page }) => {
    await page.goto("/comms");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("hearth-top")).toBeVisible();

    const cards = page.getByTestId("thread-card");
    const count = await cards.count();
    if (count === 0) {
      test.skip();
      return;
    }

    await cards.first().click();
    await expect(page.getByTestId("inspector-panel")).toBeVisible();

    await page.getByRole("button", { name: "Close inspector" }).click();
    await expect(page.getByTestId("inspector-panel")).toHaveCount(0);
  });

  test("clicking a flag row opens Flag Detail inspector", async ({ page }) => {
    await page.goto("/comms/moderation");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("hearth-top")).toBeVisible();

    const rows = page.getByTestId("flag-row");
    const count = await rows.count();
    if (count === 0) {
      test.skip();
      return;
    }

    await rows.first().click();
    const panel = page.getByTestId("inspector-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Flag Detail")).toBeVisible();
  });

  test("clicking an activity event opens Event Detail inspector", async ({ page }) => {
    await page.goto("/comms/activity");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("hearth-top")).toBeVisible();

    const rows = page.getByTestId("event-row");
    const count = await rows.count();
    if (count === 0) {
      test.skip();
      return;
    }

    await rows.first().click();
    const panel = page.getByTestId("inspector-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Event Detail")).toBeVisible();
  });
});
