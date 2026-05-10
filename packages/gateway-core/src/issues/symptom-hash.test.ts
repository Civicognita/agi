import { describe, it, expect } from "vitest";

import { hashSymptom, normalizeSymptom } from "./symptom-hash.js";

describe("normalizeSymptom (Wish #21)", () => {
  it("strips ISO timestamps", () => {
    const a = normalizeSymptom("Failed at 2026-05-09T18:30:09.123Z to connect");
    const b = normalizeSymptom("Failed at 2025-01-01T00:00:00Z to connect");
    expect(a).toBe(b);
  });

  it("strips absolute paths", () => {
    const a = normalizeSymptom("ENOENT: /home/wishborn/.agi/foo.json missing");
    const b = normalizeSymptom("ENOENT: /opt/agi/runtime/foo.json missing");
    expect(a).toBe(b);
  });

  it("strips long numeric IDs", () => {
    const a = normalizeSymptom("entity 12345 not found");
    const b = normalizeSymptom("entity 99999 not found");
    expect(a).toBe(b);
  });

  it("strips hex hashes", () => {
    const a = normalizeSymptom("commit abc123def456 missing");
    const b = normalizeSymptom("commit deadbeefcafe9000 missing");
    expect(a).toBe(b);
  });

  it("collapses whitespace + lowercases", () => {
    expect(normalizeSymptom("  HELLO\n\nworld  "))
      .toBe("hello world");
  });
});

describe("hashSymptom (Wish #21)", () => {
  it("is deterministic for the same input", () => {
    expect(hashSymptom("oops", "tool", 1)).toBe(hashSymptom("oops", "tool", 1));
  });

  it("collapses across timestamp / path / id noise", () => {
    const a = hashSymptom("ENOENT: /tmp/abc123/file.json @ 2026-05-09T00:00:00Z (id=12345)", "fs.readFileSync", 1);
    const b = hashSymptom("ENOENT: /tmp/xyz789/file.json @ 2025-01-01T00:00:00Z (id=99999)", "fs.readFileSync", 1);
    expect(a).toBe(b);
  });

  it("differs when tool differs", () => {
    expect(hashSymptom("oops", "fs.readFileSync", 1))
      .not.toBe(hashSymptom("oops", "fs.writeFileSync", 1));
  });

  it("differs when exit_code differs", () => {
    expect(hashSymptom("oops", "tool", 1))
      .not.toBe(hashSymptom("oops", "tool", 2));
  });

  it("handles missing tool/exit gracefully", () => {
    const h = hashSymptom("oops");
    expect(h).toMatch(/^[a-f0-9]{40}$/);
  });

  it("produces a 40-char sha1 hex", () => {
    expect(hashSymptom("any", "tool", 0)).toMatch(/^[a-f0-9]{40}$/);
  });
});
