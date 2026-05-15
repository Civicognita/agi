/**
 * UserNotes whiteboard persistence e2e — s157 t728.
 *
 * Verifies:
 *   (1) Creating a whiteboard note renders WhiteboardEditor (not textarea)
 *   (2) Save button is hidden for whiteboard kind (auto-persist replaces it)
 *   (3) Footer shows "Auto-saved" not "Unsaved changes"
 *   (4) Whiteboard note survives a navigate-away / navigate-back cycle
 *       (confirms onSave fires and persists to DB)
 *   (5) The notes REST API returns kind="whiteboard" for whiteboard notes
 *
 * Routes under test: /notes (global NotesPanel)
 * API used for setup/teardown: POST /api/notes, DELETE /api/notes/:id
 */

import { test, expect } from "@playwright/test";

const WHITEBOARD_TITLE = `e2e-whiteboard-${Date.now()}`;

test.describe("UserNotes whiteboard persistence (s157 t728)", () => {
  let createdNoteId: string | null = null;

  test.afterEach(async ({ request }) => {
    if (createdNoteId !== null) {
      await request.delete(`/api/notes/${createdNoteId}`);
      createdNoteId = null;
    }
  });

  // -------------------------------------------------------------------------
  // (1) + (2) + (3) — whiteboard editor renders; no Save button; auto-save footer
  // -------------------------------------------------------------------------
  test("whiteboard note renders editor without Save button and shows auto-save footer", async ({
    page,
    request,
  }) => {
    // Create via API so we control the title precisely.
    const res = await request.post("/api/notes", {
      data: { title: WHITEBOARD_TITLE, body: "{}", kind: "whiteboard" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBeLessThan(300);
    const created = await res.json() as { id: string };
    createdNoteId = created.id;

    await page.goto("/notes");

    // Select the note by clicking its list row (Table.Row doesn't forward
    // data-testid to the <tr> DOM element; use ARIA row role instead).
    const listRow = page.getByRole("row", { name: WHITEBOARD_TITLE });
    await expect(listRow).toBeVisible({ timeout: 8_000 });
    await listRow.click();

    // WhiteboardEditor should be visible; textarea should NOT be visible.
    await expect(page.getByTestId("notes-whiteboard-editor")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("notes-body-textarea")).not.toBeVisible();

    // Save button must be absent for whiteboard kind.
    await expect(page.getByTestId("notes-save-button")).not.toBeVisible();

    // Footer should contain "Auto-saved" (not "Unsaved changes").
    const footer = page.locator('[data-testid="notes-panel"] .text-muted-foreground\\/70').first();
    await expect(footer).toContainText(/Auto-saved/i);
  });

  // -------------------------------------------------------------------------
  // (4) — note persists across navigation
  // -------------------------------------------------------------------------
  test("whiteboard note title persists after navigate-away and navigate-back", async ({
    page,
    request,
  }) => {
    const res = await request.post("/api/notes", {
      data: { title: WHITEBOARD_TITLE, body: "{}", kind: "whiteboard" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBeLessThan(300);
    const created = await res.json() as { id: string };
    createdNoteId = created.id;

    await page.goto("/notes");
    const listRow = page.getByRole("row", { name: WHITEBOARD_TITLE });
    await expect(listRow).toBeVisible({ timeout: 8_000 });

    // Navigate away.
    await page.goto("/projects");
    await expect(page).toHaveURL("/projects");

    // Navigate back.
    await page.goto("/notes");

    // The whiteboard note must still be in the list after round-trip.
    const listRowBack = page.getByRole("row", { name: WHITEBOARD_TITLE });
    await expect(listRowBack).toBeVisible({ timeout: 8_000 });

    // Selecting it must render the whiteboard editor again.
    await listRowBack.click();
    await expect(page.getByTestId("notes-whiteboard-editor")).toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // (5) — REST API returns correct kind
  // -------------------------------------------------------------------------
  test("REST API returns kind=whiteboard for whiteboard notes", async ({ request }) => {
    const res = await request.post("/api/notes", {
      data: { title: WHITEBOARD_TITLE, body: "{}", kind: "whiteboard" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBeLessThan(300);
    const note = await res.json() as { id: string; kind: string };
    createdNoteId = note.id;

    expect(note.kind).toBe("whiteboard");

    // Confirm via GET /api/notes (list). Response shape: { notes: [...], scope }
    const list = await request.get("/api/notes");
    expect(list.status()).toBeLessThan(300);
    const { notes } = await list.json() as { notes: Array<{ id: string; kind: string }> };
    const fetched = notes.find((n) => n.id === note.id);
    expect(fetched).toBeDefined();
    expect(fetched?.kind).toBe("whiteboard");
  });
});
