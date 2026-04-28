import { test, expect } from "@playwright/test";

/**
 * Per-project MCP tab e2e (Wish #7 / s125 t479).
 *
 * Verifies: tab visible on hostable project, available templates load,
 * env keys list renders, add-server flow visible. Defensive: skips when
 * no hostable project is available.
 */

async function findHostableProject(request: import("@playwright/test").APIRequestContext): Promise<{ name: string; path: string } | undefined> {
  const res = await request.get("/api/projects").catch(() => null);
  if (!res || !res.ok()) return undefined;
  const projects = (await res.json()) as Array<{ name: string; path: string; projectType?: { hasCode?: boolean } }>;
  const hostable = projects.find((p) => p.projectType?.hasCode);
  return hostable ? { name: hostable.name, path: hostable.path } : undefined;
}

test.describe("MCP tab", () => {
  test("MCP available templates endpoint returns at least Tynn", async ({ request }) => {
    const res = await request.get("/api/projects/mcp/available");
    expect(res.ok()).toBe(true);
    const body = await res.json() as { templates: Array<{ id: string; name: string }> };
    expect(body.templates.length).toBeGreaterThan(0);
    expect(body.templates.some((t) => t.id === "tynn")).toBe(true);
  });

  test("MCP tab appears on hostable project detail page", async ({ page, request }) => {
    const project = await findHostableProject(request);
    test.skip(!project, "no hostable project available");
    await page.goto(`/projects/${project!.name}`);
    await page.waitForLoadState("domcontentloaded");
    const tab = page.getByRole("tab", { name: /^MCP$/i });
    await expect(tab).toBeVisible({ timeout: 10_000 });
  });

  test("Clicking MCP tab reveals the panel + add-server button", async ({ page, request }) => {
    const project = await findHostableProject(request);
    test.skip(!project, "no hostable project available");
    await page.goto(`/projects/${project!.name}`);
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("tab", { name: /^MCP$/i }).click();
    await expect(page.getByTestId("mcp-tab")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("mcp-add-button")).toBeVisible();
    await expect(page.getByTestId("mcp-env-keys")).toBeVisible();
  });

  test("Add-server form opens with template dropdown + key field", async ({ page, request }) => {
    const project = await findHostableProject(request);
    test.skip(!project, "no hostable project available");
    await page.goto(`/projects/${project!.name}`);
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("tab", { name: /^MCP$/i }).click();
    await page.getByTestId("mcp-add-button").click();
    await expect(page.getByTestId("mcp-add-template")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("mcp-add-save")).toBeVisible();
    // Tynn is selected by default + has authTokenKey, so key field should appear.
    await expect(page.getByTestId("mcp-add-key")).toBeVisible();
  });

  test("Save tynn server with key — env key persists, server added", async ({ page, request }) => {
    const project = await findHostableProject(request);
    test.skip(!project, "no hostable project available");
    await page.goto(`/projects/${project!.name}`);
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("tab", { name: /^MCP$/i }).click();
    await expect(page.getByTestId("mcp-tab")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("mcp-add-button").click();
    await page.getByTestId("mcp-add-key").fill("test-tynn-key-e2e-12345");
    await page.getByTestId("mcp-add-save").click();
    // Wait for the save to round-trip — config reload should re-render servers list.
    await page.waitForResponse((r) => r.url().includes("/api/projects/mcp/list"), { timeout: 15_000 }).catch(() => undefined);
    // Tynn server should now be in the list.
    await expect(page.locator("text=tynn").first()).toBeVisible({ timeout: 5_000 });
    // Env key TYNN_API_KEY should appear in the keys list (key NAME, never value).
    await expect(page.locator("text=TYNN_API_KEY").first()).toBeVisible();

    // Cleanup: remove via API to keep test idempotent.
    await request.delete(`/api/projects/mcp/server?path=${encodeURIComponent(project!.path)}&id=tynn`);
    await request.delete(`/api/projects/mcp/env?path=${encodeURIComponent(project!.path)}&key=TYNN_API_KEY`);
  });
});
