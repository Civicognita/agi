import { describe, it, expect } from "vitest";
import { isCompactByAge, FULL_PREVIEW_TTL_MS } from "./notification-lifecycle.js";

/**
 * notification-lifecycle — render-mode policy tests (s124 t473).
 *
 * Pure-logic tests for `isCompactByAge` — the policy that decides
 * whether an iterative-work notification renders in full-preview mode
 * (with thumbnail + summary + version/task chips) or compact mode (title
 * + project + age only).
 */

const NOW = Date.parse("2026-04-28T12:00:00.000Z");

function isoOffset(now: number, deltaMs: number): string {
  return new Date(now + deltaMs).toISOString();
}

describe("notification-lifecycle.isCompactByAge — s124 t473 render policy", () => {
  it("returns false for non-iterative-work types regardless of age", () => {
    expect(
      isCompactByAge(
        { type: "error", createdAt: isoOffset(NOW, -10 * 24 * 60 * 60 * 1000) },
        NOW,
      ),
    ).toBe(false);
    expect(
      isCompactByAge(
        { type: "system:upgrade", createdAt: isoOffset(NOW, -100 * 24 * 60 * 60 * 1000) },
        NOW,
      ),
    ).toBe(false);
  });

  it("returns false for fresh iterative-work (created seconds ago)", () => {
    expect(
      isCompactByAge(
        { type: "iterative-work", createdAt: isoOffset(NOW, -10_000) },
        NOW,
      ),
    ).toBe(false);
  });

  it("returns false for iterative-work just under the TTL", () => {
    expect(
      isCompactByAge(
        { type: "iterative-work", createdAt: isoOffset(NOW, -(FULL_PREVIEW_TTL_MS - 1)) },
        NOW,
      ),
    ).toBe(false);
  });

  it("returns true for iterative-work just over the TTL", () => {
    expect(
      isCompactByAge(
        { type: "iterative-work", createdAt: isoOffset(NOW, -(FULL_PREVIEW_TTL_MS + 1)) },
        NOW,
      ),
    ).toBe(true);
  });

  it("returns true for iterative-work created days ago", () => {
    expect(
      isCompactByAge(
        { type: "iterative-work", createdAt: isoOffset(NOW, -7 * 24 * 60 * 60 * 1000) },
        NOW,
      ),
    ).toBe(true);
  });

  it("FULL_PREVIEW_TTL_MS is 24 hours (the default contract)", () => {
    expect(FULL_PREVIEW_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("uses the supplied `now` argument over Date.now() for deterministic testing", () => {
    // Sanity check: an iterative-work notification created at NOW with
    // an evaluation point exactly at NOW is not compact (age == 0).
    expect(
      isCompactByAge(
        { type: "iterative-work", createdAt: isoOffset(NOW, 0) },
        NOW,
      ),
    ).toBe(false);
  });
});
