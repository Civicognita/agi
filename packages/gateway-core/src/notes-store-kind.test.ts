/**
 * notes-store kind discriminator (s157, 2026-05-10).
 *
 * Pure-logic tests for the `UserNoteKind` runtime guard. Covers the
 * narrow surface that gates whiteboard-mode inputs without requiring the
 * DB fixture (those tests live in notes-api.test.ts and exercise the
 * full create/update path against the real Postgres test instance).
 */

import { describe, it, expect } from "vitest";
import { isUserNoteKind, USER_NOTE_KINDS } from "./notes-store.js";

describe("isUserNoteKind (s157)", () => {
  it("accepts the two canonical kinds", () => {
    expect(isUserNoteKind("markdown")).toBe(true);
    expect(isUserNoteKind("whiteboard")).toBe(true);
  });

  it("rejects unknown strings", () => {
    expect(isUserNoteKind("notepad")).toBe(false);
    expect(isUserNoteKind("Markdown")).toBe(false); // case-sensitive
    expect(isUserNoteKind("")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isUserNoteKind(undefined)).toBe(false);
    expect(isUserNoteKind(null)).toBe(false);
    expect(isUserNoteKind(0)).toBe(false);
    expect(isUserNoteKind({ kind: "markdown" })).toBe(false);
  });

  it("USER_NOTE_KINDS includes both modes in stable order", () => {
    expect([...USER_NOTE_KINDS]).toEqual(["markdown", "whiteboard"]);
  });
});
