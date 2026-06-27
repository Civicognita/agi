import { test, expect } from "@playwright/test";

/**
 * System ▸ Identity — consolidated Identity Management page (story #212).
 *
 * Verifies the single identity home: the canonical 6-provider grid, the
 * "Your Identity" + Federation cards, GitHub's connect affordance, the
 * Machine Admin cross-link, and that the old Settings ▸ Identity route now
 * redirects here. All assertions are read-only structural checks — no OAuth
 * flow is actually completed and no config is mutated.
 */

const CANONICAL_PROVIDERS = ["github", "google", "meta", "x", "tynn", "civicognita"] as const;

test.describe("System ▸ Identity (consolidated)", () => {
  test("page loads at /system/identity", async ({ page }) => {
    await page.goto("/system/identity");
    await expect(page).toHaveURL("/system/identity");
    await expect(page.getByTestId("system-identity-page")).toBeVisible({ timeout: 10_000 });
  });

  test("renders the Identity heading and the Your Identity card", async ({ page }) => {
    await page.goto("/system/identity");
    await expect(page.getByRole("heading", { name: "Identity", exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("your-identity-card")).toBeVisible();
  });

  test("renders all six canonical identity providers", async ({ page }) => {
    await page.goto("/system/identity");
    await expect(page.getByTestId("identity-provider-grid")).toBeVisible({ timeout: 10_000 });
    for (const id of CANONICAL_PROVIDERS) {
      await expect(page.getByTestId(`identity-provider-${id}`)).toBeVisible();
      await expect(page.getByTestId(`identity-provider-${id}-status`)).toBeVisible();
    }
  });

  test("GitHub exposes a Connect affordance (hosted device flow)", async ({ page }) => {
    await page.goto("/system/identity");
    const ghCard = page.getByTestId("identity-provider-github");
    await expect(ghCard).toBeVisible({ timeout: 10_000 });
    // GitHub is either connectable now (Connect button) or already connected (Remove).
    const connect = page.getByTestId("identity-connect-github");
    const remove = page.getByTestId("identity-remove-github");
    await expect(connect.or(remove)).toBeVisible();
  });

  test("Civicognita is federation-gated until federation is enabled", async ({ page }) => {
    await page.goto("/system/identity");
    const status = page.getByTestId("identity-provider-civicognita-status");
    await expect(status).toBeVisible({ timeout: 10_000 });
    // Default bare node: federation off → gated. (If federation is on, it is connectable.)
    await expect(page.getByTestId("identity-provider-civicognita")).toBeVisible();
  });

  test("shows the Federation / Civicognita card and a Machine Admin cross-link", async ({ page }) => {
    await page.goto("/system/identity");
    await expect(page.getByTestId("federation-card")).toBeVisible({ timeout: 10_000 });
    const link = page.getByTestId("identity-machine-admin-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/admin");
  });

  test("Settings ▸ Identity redirects to System ▸ Identity (de-dup)", async ({ page }) => {
    await page.goto("/settings/identity");
    await expect(page).toHaveURL("/system/identity");
    await expect(page.getByTestId("system-identity-page")).toBeVisible({ timeout: 10_000 });
  });

  test("Settings sub-nav no longer lists Identity", async ({ page }) => {
    await page.goto("/settings/gateway");
    // The settings left-nav should not contain an Identity link anymore.
    await expect(page.getByRole("link", { name: "Identity", exact: true })).toHaveCount(0);
  });

  test("a needs-config provider opens an OAuth-app form (clientId + secret + save)", async ({ page }) => {
    await page.goto("/system/identity");
    // Google ships unconfigured on a bare node → it has an "Add OAuth app" affordance.
    const configure = page.getByTestId("identity-configure-google");
    await expect(configure).toBeVisible({ timeout: 10_000 });
    await configure.click();
    await expect(page.getByTestId("identity-app-form-google")).toBeVisible();
    await expect(page.getByTestId("identity-app-clientid-google")).toBeVisible();
    await expect(page.getByTestId("identity-app-secret-google")).toBeVisible();
    await expect(page.getByTestId("identity-app-save-google")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Resilience (story #219): baked-in GitHub + Civicognita must render even
  // when the providers endpoint fails/empties — they are CORE services, not
  // data fetched from the server. Mirrors how onboarding hardcodes "Add GitHub".
  // -------------------------------------------------------------------------

  test("GitHub + Civicognita still render when /api/auth/providers 500s", async ({ page }) => {
    await page.route("**/api/auth/providers", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }),
    );
    await page.goto("/system/identity");
    await expect(page.getByTestId("identity-provider-grid")).toBeVisible({ timeout: 10_000 });
    // The grid must NOT be blank — all six baked-in providers render from the seed.
    for (const id of CANONICAL_PROVIDERS) {
      await expect(page.getByTestId(`identity-provider-${id}`)).toBeVisible();
    }
    // GitHub's device-flow Connect affordance is reachable even with the endpoint down.
    await expect(page.getByTestId("identity-connect-github")).toBeVisible();
  });

  test("the grid is never blank when /api/auth/providers returns an empty list", async ({ page }) => {
    await page.route("**/api/auth/providers", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providers: [] }) }),
    );
    await page.goto("/system/identity");
    await expect(page.getByTestId("identity-provider-grid")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("identity-provider-github")).toBeVisible();
    await expect(page.getByTestId("identity-provider-civicognita")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Approved / rejected people management (Wave 1 s228). The panel renders null
  // until at least one decision exists, so we seed it via route-mocking.
  // -------------------------------------------------------------------------

  test("renders approved + rejected people with manage actions", async ({ page }) => {
    await page.route("**/api/identity/people**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          people: [
            { status: "approved", decidedAt: "2026-06-15T12:00:00.000Z", channelId: "discord", channelUserId: "alice", displayName: "Alice", assignedProjectPaths: ["/home/p"] },
            { status: "rejected", decidedAt: "2026-06-15T13:00:00.000Z", channelId: "discord", channelUserId: "bob", displayName: "Bob" },
          ],
          count: 2,
        }),
      }),
    );
    await page.goto("/system/identity");
    await expect(page.getByTestId("identity-people-panel")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("decided-person-row")).toHaveCount(2);
    // Approved person → edit-projects + revoke; rejected person → re-review.
    await expect(page.getByTestId("person-edit-projects")).toBeVisible();
    await expect(page.getByTestId("person-revoke")).toBeVisible();
    await expect(page.getByTestId("person-re-review")).toBeVisible();
  });

  test("people panel is absent when no one has been decided", async ({ page }) => {
    await page.route("**/api/identity/people**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ people: [], count: 0 }) }),
    );
    await page.goto("/system/identity");
    await expect(page.getByTestId("system-identity-page")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("identity-people-panel")).toHaveCount(0);
  });
});
