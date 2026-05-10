import { test, expect } from "@playwright/test";

/**
 * Issue registry e2e (Wish #21 Slice 7).
 *
 * Exercises the per-project k/issues/ HTTP surface end-to-end against a
 * live workspace project (uses the always-present `_aionima` project
 * scaffolded by s119 t701). API-driven via `page.request.*` — Slice 4's
 * dashboard tab lands separately; this spec locks the API contract in
 * before that consumer ships.
 *
 * Cycles covered:
 *   1. POST .../issues — file → returns "created"
 *   2. POST .../issues with same symptom — returns "appended" + occurrences=2
 *   3. GET .../issues — list contains the filed issue
 *   4. GET .../issues/search?q=... — token + tag filters
 *   5. GET .../issues/:id — full body fetch
 *   6. PATCH .../issues/:id — flip to fixed
 *   7. POST .../issues/raw + GET .../raw + POST .../raw/:id/promote
 *      — raw-tier capture round-trip (Slice 5)
 *
 * Cleanup is best-effort: tests use unique-per-run titles so re-running
 * the spec doesn't collide. The on-disk k/issues/ directory accumulates
 * across runs; that's intentional (it's the production dataset) — owner
 * clears via `agi issue raw clear` or by deleting individual files.
 */

const PROJECT_PATH = "/home/wishborn/_projects/_aionima";

function uniqueSymptom(): string {
  return `e2e-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
}

function projectQuery(): string {
  return `path=${encodeURIComponent(PROJECT_PATH)}`;
}

test.describe("Issue registry — API surface (Wish #21 Slice 7)", () => {
  test("POST /api/projects/issues — creates a new issue and dedups on re-file", async ({ page }) => {
    const symptom = uniqueSymptom();

    // First filing → created
    const r1 = await page.request.post(`/api/projects/issues?${projectQuery()}`, {
      data: { title: `e2e create ${symptom}`, symptom, tool: "e2e", exit_code: 1, tags: ["e2e", "slice7"] },
    });
    expect(r1.ok()).toBe(true);
    const body1 = await r1.json() as { outcome: string; id: string; occurrences: number };
    expect(body1.outcome).toBe("created");
    expect(body1.id).toMatch(/^i-\d+$/);
    expect(body1.occurrences).toBe(1);

    // Re-file with the same (symptom, tool, exit_code) → appended occurrence
    const r2 = await page.request.post(`/api/projects/issues?${projectQuery()}`, {
      data: { title: `e2e re-file ${symptom}`, symptom, tool: "e2e", exit_code: 1 },
    });
    expect(r2.ok()).toBe(true);
    const body2 = await r2.json() as { outcome: string; id: string; occurrences: number };
    expect(body2.outcome).toBe("appended");
    expect(body2.id).toBe(body1.id);
    expect(body2.occurrences).toBe(2);
  });

  test("GET /api/projects/issues — list contains filed issues", async ({ page }) => {
    const symptom = uniqueSymptom();
    const filed = await page.request.post(`/api/projects/issues?${projectQuery()}`, {
      data: { title: `e2e list ${symptom}`, symptom, tags: ["e2e"] },
    });
    expect(filed.ok()).toBe(true);
    const filedBody = await filed.json() as { id: string };

    const listed = await page.request.get(`/api/projects/issues?${projectQuery()}`);
    expect(listed.ok()).toBe(true);
    const listedBody = await listed.json() as { issues: { id: string; title: string }[] };
    const found = listedBody.issues.find((i) => i.id === filedBody.id);
    expect(found).toBeDefined();
  });

  test("GET /api/projects/issues/search — text + tag: filters narrow results", async ({ page }) => {
    const symptom = uniqueSymptom();
    const uniqueTag = `e2e-tag-${String(Date.now()).slice(-6)}`;
    await page.request.post(`/api/projects/issues?${projectQuery()}`, {
      data: { title: `e2e search ${symptom}`, symptom, tags: [uniqueTag] },
    });

    const byTag = await page.request.get(`/api/projects/issues/search?${projectQuery()}&q=${encodeURIComponent(`tag:${uniqueTag}`)}`);
    expect(byTag.ok()).toBe(true);
    const byTagBody = await byTag.json() as { hits: unknown[] };
    expect(byTagBody.hits).toHaveLength(1);

    const byText = await page.request.get(`/api/projects/issues/search?${projectQuery()}&q=${encodeURIComponent(symptom)}`);
    expect(byText.ok()).toBe(true);
    const byTextBody = await byText.json() as { hits: unknown[] };
    expect(byTextBody.hits.length).toBeGreaterThanOrEqual(1);
  });

  test("GET /api/projects/issues/:id — fetches the full body", async ({ page }) => {
    const symptom = uniqueSymptom();
    const filed = await page.request.post(`/api/projects/issues?${projectQuery()}`, {
      data: { title: `e2e show ${symptom}`, symptom },
    });
    const filedBody = await filed.json() as { id: string };

    const shown = await page.request.get(`/api/projects/issues/${filedBody.id}?${projectQuery()}`);
    expect(shown.ok()).toBe(true);
    const shownBody = await shown.json() as { issue: { title: string; body: string; status: string } };
    expect(shownBody.issue.title).toContain(symptom);
    expect(shownBody.issue.status).toBe("open");
    expect(shownBody.issue.body).toContain("## Symptom");
  });

  test("PATCH /api/projects/issues/:id — flips status to fixed + appends resolution", async ({ page }) => {
    const symptom = uniqueSymptom();
    const filed = await page.request.post(`/api/projects/issues?${projectQuery()}`, {
      data: { title: `e2e fix ${symptom}`, symptom },
    });
    const filedBody = await filed.json() as { id: string };

    const fixed = await page.request.patch(`/api/projects/issues/${filedBody.id}?${projectQuery()}`, {
      data: { status: "fixed", resolution: "Fixed via e2e — slice 7 verification" },
    });
    expect(fixed.ok()).toBe(true);

    const shown = await page.request.get(`/api/projects/issues/${filedBody.id}?${projectQuery()}`);
    const shownBody = await shown.json() as { issue: { status: string; body: string } };
    expect(shownBody.issue.status).toBe("fixed");
    expect(shownBody.issue.body).toContain("Fixed via e2e");
  });
});

test.describe("Issue registry — raw-tier round trip (Slice 5 + Slice 7)", () => {
  test("POST /api/projects/issues/raw + list + promote", async ({ page }) => {
    const summary = `raw-e2e-${String(Date.now())}`;

    // Record a raw capture
    const recorded = await page.request.post(`/api/projects/issues/raw?${projectQuery()}`, {
      data: { source: "e2e-suite", summary, details: { run: "slice7" } },
    });
    expect(recorded.ok()).toBe(true);
    const recordedBody = await recorded.json() as { entry: { id: string } };
    expect(recordedBody.entry.id).toMatch(/^r-/);

    // List captures and find ours
    const listed = await page.request.get(`/api/projects/issues/raw?${projectQuery()}`);
    expect(listed.ok()).toBe(true);
    const listedBody = await listed.json() as { captures: { id: string; summary: string }[] };
    const ours = listedBody.captures.find((c) => c.id === recordedBody.entry.id);
    expect(ours).toBeDefined();

    // Promote it to the curated tier
    const promoted = await page.request.post(
      `/api/projects/issues/raw/${recordedBody.entry.id}/promote?${projectQuery()}`,
      { data: {} },
    );
    expect(promoted.ok()).toBe(true);
    const promotedBody = await promoted.json() as { outcome: string; id: string };
    expect(promotedBody.outcome).toMatch(/created|appended/);
    expect(promotedBody.id).toMatch(/^i-\d+$/);

    // After promotion, the raw entry is removed
    const reList = await page.request.get(`/api/projects/issues/raw?${projectQuery()}`);
    const reListBody = await reList.json() as { captures: { id: string }[] };
    expect(reListBody.captures.find((c) => c.id === recordedBody.entry.id)).toBeUndefined();
  });
});
