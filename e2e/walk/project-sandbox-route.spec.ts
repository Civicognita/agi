/**
 * Project sandbox auto-route walk (s140 t597 phase B).
 *
 * Locks in the cycle-176 ship: every project's <projectPath>/sandbox/
 * is browseable at https://<hostname>/sandbox/ via a Caddy
 * `handle_path /sandbox/* { root * <projectPath>/sandbox; file_server browse }`
 * block. Writes a probe file in the proofing project's sandbox dir,
 * fetches it through Caddy, asserts the body matches, then cleans up.
 *
 * The agi-caddy container bind-mounts $HOME/_projects:ro at runtime
 * so this Caddy route can serve from the host filesystem. If the bind-
 * mount isn't in place, file_server will return 404 (and this spec
 * will fail loudly).
 *
 * Run via:
 *   agi test --e2e walk/project-sandbox-route
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const SANDBOX_DIR = "/home/wishborn/_projects/civicognita_ops/sandbox";
const PROBE_NAME = "_e2e-sandbox-probe.html";
const PROBE_BODY = "<!DOCTYPE html><html><body><h1>e2e sandbox probe</h1></body></html>";
const SANDBOX_URL = "https://civicognita-ops.ai.on/sandbox";

test.describe("project sandbox auto-route (s140 t597 phase B)", () => {
  test.beforeAll(() => {
    fs.mkdirSync(SANDBOX_DIR, { recursive: true });
    fs.writeFileSync(path.join(SANDBOX_DIR, PROBE_NAME), PROBE_BODY, "utf-8");
  });

  test.afterAll(() => {
    try {
      fs.unlinkSync(path.join(SANDBOX_DIR, PROBE_NAME));
    } catch { /* probe already removed by another test run */ }
  });

  test("/sandbox/<probe>.html serves the on-disk file content", async ({ request }) => {
    const res = await request.get(`${SANDBOX_URL}/${PROBE_NAME}`, {
      ignoreHTTPSErrors: true,
      timeout: 10_000,
    });
    expect(res.status(), "sandbox file must serve 200 (route + bind-mount + file all in place)").toBeLessThan(300);
    const body = await res.text();
    expect(body, "served body must match the probe HTML on disk").toBe(PROBE_BODY);
  });

  test("/sandbox/ (no path) returns the directory listing", async ({ request }) => {
    // file_server browse renders an HTML directory listing for
    // requests without an index.html. Probe file landed in beforeAll,
    // so the listing should reference the probe file.
    const res = await request.get(`${SANDBOX_URL}/`, {
      ignoreHTTPSErrors: true,
      timeout: 10_000,
    });
    expect(res.status(), "directory listing must serve 200").toBeLessThan(300);
    const body = await res.text();
    expect(
      body,
      "browse listing must reference the probe file we just wrote",
    ).toContain(PROBE_NAME);
  });

  test("/sandbox/non-existent.html returns 404 (file_server, not Caddy 503)", async ({ request }) => {
    const res = await request.get(`${SANDBOX_URL}/this-file-does-not-exist.html`, {
      ignoreHTTPSErrors: true,
      timeout: 10_000,
    });
    // file_server returns 404 for missing files. The 5xx handler in
    // the project's main route doesn't fire here (handle_path scopes
    // to /sandbox/* only).
    expect(
      res.status(),
      "missing sandbox file must return 404 (not 503 from the container-offline handler)",
    ).toBe(404);
  });
});
