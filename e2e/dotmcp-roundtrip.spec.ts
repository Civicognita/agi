import { test, expect } from "@playwright/test";

/**
 * .mcp.json round-trip e2e (s131 t684).
 *
 * Closes s131 by proving the read+write loop end-to-end against the live
 * test-VM gateway:
 *   1. Pick a hostable project (deterministic via /api/projects).
 *   2. Add a synthetic server via PUT /api/projects/mcp/server.
 *   3. Assert the server appears in /api/projects/mcp/list (dual-read
 *      pulls from .mcp.json since t682 flipped writes).
 *   4. Assert the server's transport, url, and authToken-presence flag
 *      survived the round-trip.
 *   5. Cleanup: DELETE the synthetic server. Assert it disappears.
 *
 * The synthetic id uses a `e2e-dotmcp-test-` prefix so it can never
 * collide with a real configured MCP server. Runs entirely via the API
 * surface — no UI clicks — because the existing mcp-tab.spec.ts already
 * covers the dashboard form rendering. This spec verifies the storage
 * layer that t680/t681/t682/t683 introduced.
 *
 * Run via: agi test --e2e dotmcp-roundtrip
 */

interface Project {
  name: string;
  path: string;
  projectType?: { hasCode?: boolean };
}

async function findHostableProject(
  request: import("@playwright/test").APIRequestContext,
): Promise<Project | undefined> {
  const res = await request.get("/api/projects").catch(() => null);
  if (!res || !res.ok()) return undefined;
  const projects = (await res.json()) as Project[];
  return projects.find((p) => p.projectType?.hasCode);
}

test.describe(".mcp.json round-trip via API (s131 t684)", () => {
  test("PUT /api/projects/mcp/server adds an http server, /list returns it, DELETE removes it", async ({ request }) => {
    const project = await findHostableProject(request);
    test.skip(!project, "no hostable project available — test VM seed data missing");
    if (!project) return;

    const id = `e2e-dotmcp-test-${Date.now().toString(36)}`;
    const url = `http://127.0.0.1:0/${id}`;

    // ---- Step 1: PUT the server ----
    const putRes = await request.put("/api/projects/mcp/server", {
      data: {
        path: project.path,
        server: {
          id,
          name: `e2e ${id}`,
          transport: "http",
          url,
          authToken: "$E2E_FAKE_TOKEN",
          autoConnect: false,
        },
      },
    });
    expect(putRes.status(), `PUT /api/projects/mcp/server should return 2xx (got ${String(putRes.status())})`).toBeLessThan(300);

    try {
      // ---- Step 2: /list confirms the server is registered ----
      const listRes = await request.get(`/api/projects/mcp/list?path=${encodeURIComponent(project.path)}`);
      expect(listRes.status()).toBeLessThan(300);
      const listed = (await listRes.json()) as {
        servers: Array<{ id: string; transport: string; url?: string; hasAuthToken: boolean; envKeys: string[] }>;
      };
      const found = listed.servers.find((s) => s.id === id);
      expect(found, `synthetic server "${id}" should appear in /list after PUT`).toBeDefined();
      if (!found) return;
      expect(found.transport).toBe("http");
      expect(found.url).toBe(url);
      expect(
        found.hasAuthToken,
        "hasAuthToken should be true (authToken survived the round-trip)",
      ).toBe(true);
    } finally {
      // ---- Step 3: DELETE the server ----
      const delRes = await request.delete(
        `/api/projects/mcp/server?path=${encodeURIComponent(project.path)}&id=${encodeURIComponent(id)}`,
      );
      expect(
        delRes.status(),
        `DELETE /api/projects/mcp/server should return 2xx (got ${String(delRes.status())})`,
      ).toBeLessThan(300);

      // ---- Step 4: confirm the server is gone ----
      const finalListRes = await request.get(`/api/projects/mcp/list?path=${encodeURIComponent(project.path)}`);
      expect(finalListRes.status()).toBeLessThan(300);
      const finalListed = (await finalListRes.json()) as { servers: Array<{ id: string }> };
      expect(
        finalListed.servers.find((s) => s.id === id),
        `synthetic server "${id}" should be gone after DELETE`,
      ).toBeUndefined();
    }
  });

  test("PUT to a path outside workspace.projects is rejected with 403", async ({ request }) => {
    const putRes = await request.put("/api/projects/mcp/server", {
      data: {
        path: "/tmp/not-a-workspace-project",
        server: {
          id: "e2e-rejected",
          transport: "http",
          url: "http://x",
          autoConnect: false,
        },
      },
    });
    expect(
      putRes.status(),
      "writes outside configured workspace.projects must be 403",
    ).toBe(403);
  });
});
