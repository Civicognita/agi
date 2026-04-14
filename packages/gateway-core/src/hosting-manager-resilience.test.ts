/**
 * hosting-manager — container resilience (Phase 1) tests.
 *
 * Validates the wrapResilientCmd helper that wraps a start command so the
 * container's PID 1 outlives a failure in user code.
 */

import { describe, it, expect } from "vitest";
import { wrapResilientCmd } from "./hosting-manager.js";

describe("wrapResilientCmd", () => {
  it("returns null for null/undefined/empty — caller falls back to image CMD", () => {
    expect(wrapResilientCmd(null)).toBeNull();
    expect(wrapResilientCmd(undefined)).toBeNull();
    expect(wrapResilientCmd([])).toBeNull();
  });

  it("wraps a plain tokens array into a sh -c expression that survives failure", () => {
    const wrapped = wrapResilientCmd(["npm", "run", "start"]);
    expect(wrapped).not.toBeNull();
    expect(wrapped).toHaveLength(3);
    expect(wrapped![0]).toBe("sh");
    expect(wrapped![1]).toBe("-c");
    const script = wrapped![2]!;
    // User command embedded
    expect(script).toContain("npm");
    expect(script).toContain("run");
    expect(script).toContain("start");
    // Failure swallowed
    expect(script).toContain("|| true");
    // Container survives via exec sleep infinity
    expect(script).toContain("exec sleep infinity");
  });

  it("preserves an already-wrapped `sh -c <cmd>` form without double-escaping", () => {
    const wrapped = wrapResilientCmd(["sh", "-c", "pnpm dev && echo done"]);
    expect(wrapped).not.toBeNull();
    const script = wrapped![2]!;
    // Inner script is the original `sh -c` payload, embedded raw
    expect(script).toContain("pnpm dev && echo done");
    // No over-quoting
    expect(script).not.toContain("'sh'");
    expect(script).not.toContain("'pnpm dev && echo done'");
  });

  it("shell-escapes single quotes in user tokens", () => {
    const wrapped = wrapResilientCmd(["echo", "it's alive"]);
    expect(wrapped).not.toBeNull();
    const script = wrapped![2]!;
    // Single-quote escape produces `it'\''s alive` inside single-quoted token.
    expect(script).toContain(`'it'\\''s alive'`);
  });

  it("a command that exits non-zero still lets the shell reach sleep infinity", () => {
    // We can't run sleep infinity in a test, but we CAN sanity-check the shell
    // structure: a failing command inside (...) || true must not propagate exit.
    const wrapped = wrapResilientCmd(["false"]);
    expect(wrapped).not.toBeNull();
    const script = wrapped![2]!;
    // `('false') || true` or `(false) || true` — either form is acceptable
    // depending on quoting. What matters is the `|| true` ← failure swallow.
    expect(script).toMatch(/\|\| true/);
    expect(script).toContain("false");
    expect(script).toContain("exec sleep infinity");
  });
});
