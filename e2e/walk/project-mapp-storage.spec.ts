/**
 * MApp storage API walk (s140 t599 phase 3).
 *
 * Locks in the cycle-178 ship: project-scoped MApp storage at
 *   /api/projects/<slug>/k/mapps/<id>/...        (persistent)
 *   /api/projects/<slug>/sandbox/mapps/<id>/...  (generated)
 *
 * Verifies the round-trip and key safety guarantees:
 *   - PUT writes bytes to <projectPath>/sandbox/mapps/<id>/<filepath>
 *   - GET reads them back identically
 *   - GET on the bare mapp dir lists entries
 *   - DELETE removes the file
 *   - Path-traversal `..` is rejected at the wildcard validator
 *   - Unknown project slugs return 404
 *
 * Uses an isolated probe mappId so it can't collide with the
 * `admin-editor` probe MApp deployed at `civicognita_ops/sandbox/mapps/`.
 *
 * Run via:
 *   agi test --e2e walk/project-mapp-storage
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const PROJECT_PATH = "/home/wishborn/_projects/civicognita_ops";
const SLUG = "civicognita_ops";
const MAPP_ID = "_e2e-storage-probe";
const FILE_NAME = "round-trip.json";
const API_BASE = "https://192.168.0.144:3100";

const PAYLOAD = { value: "hello phase 3", n: 42 };

test.describe("MApp storage API (s140 t599 phase 3)", () => {
  test.afterAll(() => {
    // The PUT route creates the dir; tear down at end so re-runs start clean.
    try {
      fs.rmSync(path.join(PROJECT_PATH, "sandbox", "mapps", MAPP_ID), {
        recursive: true,
        force: true,
      });
    } catch { /* dir may not exist if a test failed early */ }
  });

  test("PUT → GET round-trips JSON content under sandbox/mapps", async ({ request }) => {
    const url = `${API_BASE}/api/projects/${SLUG}/sandbox/mapps/${MAPP_ID}/${FILE_NAME}`;
    const putRes = await request.put(url, {
      ignoreHTTPSErrors: true,
      timeout: 10_000,
      headers: { "content-type": "application/json" },
      data: PAYLOAD,
    });
    expect(putRes.status(), "PUT must succeed").toBeLessThan(300);
    const putJson = await putRes.json();
    expect(putJson.area).toBe("sandbox");
    expect(putJson.mappId).toBe(MAPP_ID);
    expect(putJson.path).toBe(FILE_NAME);
    expect(putJson.bytes).toBeGreaterThan(0);

    const getRes = await request.get(url, {
      ignoreHTTPSErrors: true,
      timeout: 10_000,
    });
    expect(getRes.status(), "GET must succeed after PUT").toBeLessThan(300);
    const text = await getRes.text();
    const parsed = JSON.parse(text) as typeof PAYLOAD;
    expect(parsed.value).toBe(PAYLOAD.value);
    expect(parsed.n).toBe(PAYLOAD.n);
  });

  test("GET on bare mapp dir lists the round-tripped file", async ({ request }) => {
    const url = `${API_BASE}/api/projects/${SLUG}/sandbox/mapps/${MAPP_ID}/`;
    const res = await request.get(url, { ignoreHTTPSErrors: true, timeout: 10_000 });
    expect(res.status()).toBeLessThan(300);
    const j = (await res.json()) as { entries: { name: string; kind: string }[] };
    const names = j.entries.map((e) => e.name);
    expect(names, "directory listing must include the round-trip file").toContain(FILE_NAME);
  });

  test("DELETE removes the file and subsequent GET 404s", async ({ request }) => {
    const url = `${API_BASE}/api/projects/${SLUG}/sandbox/mapps/${MAPP_ID}/${FILE_NAME}`;
    const delRes = await request.delete(url, { ignoreHTTPSErrors: true, timeout: 10_000 });
    expect(delRes.status()).toBeLessThan(300);

    const getRes = await request.get(url, { ignoreHTTPSErrors: true, timeout: 10_000 });
    expect(getRes.status(), "deleted file must 404 on subsequent GET").toBe(404);
  });

  test("path traversal via .. is rejected", async ({ request }) => {
    const url = `${API_BASE}/api/projects/${SLUG}/sandbox/mapps/${MAPP_ID}/..%2F..%2Fetc%2Fpasswd`;
    const res = await request.get(url, { ignoreHTTPSErrors: true, timeout: 10_000 });
    expect(
      res.status(),
      "filepath containing `..` segments must be rejected (400) — never escape the mapp dir",
    ).toBe(400);
  });

  test("unknown project slug returns 404", async ({ request }) => {
    const url = `${API_BASE}/api/projects/_no_such_project_slug_/sandbox/mapps/${MAPP_ID}/x.json`;
    const res = await request.get(url, { ignoreHTTPSErrors: true, timeout: 10_000 });
    expect(res.status()).toBe(404);
  });
});
