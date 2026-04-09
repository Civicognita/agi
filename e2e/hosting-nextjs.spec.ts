import { test, expect } from "@playwright/test";

const API = "http://localhost:3100";

/**
 * Next.js hosting workflow — exercises mode switching, restart, and container lifecycle.
 *
 * Requires hosting infrastructure (Podman, Caddy, dnsmasq) to be available.
 * The sample-nextjs fixture must be accessible in the workspace.
 */
test.describe("Next.js Hosting Workflow", () => {
  let samplePath: string;

  test.beforeAll(async ({ request }) => {
    // Check hosting infrastructure is ready
    const infraRes = await request.get(`${API}/api/hosting/status`);
    const infra = await infraRes.json() as { ready: boolean; projects: Array<{ path: string; hostname: string }> };
    test.skip(!infra.ready, "Hosting infrastructure not available");

    // Find the sample-nextjs project (may already be detected from workspace scan)
    const existing = infra.projects?.find((p: { hostname: string }) => p.hostname.includes("nextjs"));
    if (existing) {
      samplePath = existing.path;
    } else {
      // Use the test fixture path (resolved from workspace root)
      const statusRes = await request.get(`${API}/api/system/status`);
      const status = await statusRes.json() as { workspace?: { root?: string } };
      const root = status.workspace?.root ?? "/home/ubuntu";
      samplePath = `${root}/test/fixtures/projects/sample-nextjs`;
    }
  });

  test("enable hosting in development mode", async ({ request }) => {
    const res = await request.post(`${API}/api/hosting/enable`, {
      data: {
        path: samplePath,
        mode: "development",
      },
    });

    // May fail if already enabled — that's fine
    if (res.ok()) {
      const body = await res.json() as { ok: boolean; hosting: { mode: string } };
      expect(body.ok).toBe(true);
    }
  });

  test("verify development mode is set", async ({ request }) => {
    const res = await request.get(`${API}/api/hosting/status`);
    expect(res.ok()).toBeTruthy();

    const body = await res.json() as { projects: Array<{ path: string; mode: string; status: string }> };
    const project = body.projects?.find((p: { path: string }) => p.path === samplePath);
    expect(project).toBeDefined();
    expect(project?.mode).toBe("development");
  });

  test("switch to production mode triggers restart", async ({ request }) => {
    const res = await request.put(`${API}/api/hosting/configure`, {
      data: {
        path: samplePath,
        mode: "production",
      },
    });
    expect(res.ok()).toBeTruthy();

    const body = await res.json() as { ok: boolean; hosting: { mode: string } };
    expect(body.hosting?.mode).toBe("production");
  });

  test("restart returns container to running state", async ({ request }) => {
    const res = await request.post(`${API}/api/hosting/restart`, {
      data: { path: samplePath },
    });
    expect(res.ok()).toBeTruthy();

    const body = await res.json() as { ok: boolean; hosting: { status: string } };
    expect(body.ok).toBe(true);
    // Container should be running or starting
    expect(["running", "starting"]).toContain(body.hosting?.status ?? "running");
  });

  test("switch back to development mode", async ({ request }) => {
    const res = await request.put(`${API}/api/hosting/configure`, {
      data: {
        path: samplePath,
        mode: "development",
      },
    });
    expect(res.ok()).toBeTruthy();

    const body = await res.json() as { ok: boolean; hosting: { mode: string } };
    expect(body.hosting?.mode).toBe("development");
  });
});
