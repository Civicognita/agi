/**
 * hosting-manager — container resilience (Phase 1) tests.
 *
 * Validates the wrapResilientCmd helper that wraps a start command so the
 * container's PID 1 outlives a failure in user code.
 */

import { describe, it, expect } from "vitest";
import { wrapResilientCmd, resolveContainerStartCommand } from "./hosting-manager.js";

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

describe("resolveContainerStartCommand — precedence ladder", () => {
  it("user override wins over stack.command and devCommands", () => {
    const res = resolveContainerStartCommand({
      userStartCommand: "node server.js",
      stackCommand: ["sh", "-c", "npm run build && npm start"],
      stackId: "stack-nextjs",
      devCommands: { dev: "npm run dev", start: "npm start" },
      mode: "production",
    });
    expect(res.source).toBe("override");
    expect(res.tokens).toEqual(["sh", "-c", "node server.js"]);
    expect(res.sourceLabel).toContain("override");
  });

  it("empty override falls through to stack.command", () => {
    const res = resolveContainerStartCommand({
      userStartCommand: "",
      stackCommand: ["sh", "-c", "stack-cmd"],
      stackId: "stack-foo",
      devCommands: { start: "devcmd" },
      mode: "production",
    });
    expect(res.source).toBe("stack");
    expect(res.tokens).toEqual(["sh", "-c", "stack-cmd"]);
    expect(res.sourceLabel).toContain("stack-foo.command");
  });

  it("undefined override falls through to stack.command", () => {
    const res = resolveContainerStartCommand({
      userStartCommand: undefined,
      stackCommand: ["sh", "-c", "stack-cmd"],
      mode: "production",
    });
    expect(res.source).toBe("stack");
  });

  it("whitespace-only override is treated as empty (no-op footgun guard)", () => {
    const res = resolveContainerStartCommand({
      userStartCommand: "   \t  ",
      stackCommand: ["sh", "-c", "stack-cmd"],
      mode: "production",
    });
    expect(res.source).toBe("stack");
    expect(res.tokens).toEqual(["sh", "-c", "stack-cmd"]);
  });

  it("trims whitespace around a non-empty override", () => {
    const res = resolveContainerStartCommand({
      userStartCommand: "  node server.js  ",
      stackCommand: null,
      mode: "production",
    });
    expect(res.source).toBe("override");
    expect(res.tokens).toEqual(["sh", "-c", "node server.js"]);
  });

  it("devCommands.start fallback when no override and stack has no command()", () => {
    const res = resolveContainerStartCommand({
      stackCommand: null,
      stackId: "stack-foo",
      devCommands: { dev: "npm run dev", start: "npm start" },
      mode: "production",
    });
    expect(res.source).toBe("devCommands");
    expect(res.tokens).toEqual(["sh", "-c", "npm start"]);
    expect(res.sourceLabel).toContain("devCommands.start");
    expect(res.sourceLabel).toContain("stack-foo");
  });

  it("devCommands.dev fallback in development mode", () => {
    const res = resolveContainerStartCommand({
      stackCommand: null,
      stackId: "stack-foo",
      devCommands: { dev: "npm run dev", start: "npm start" },
      mode: "development",
    });
    expect(res.source).toBe("devCommands");
    expect(res.tokens).toEqual(["sh", "-c", "npm run dev"]);
    expect(res.sourceLabel).toContain("devCommands.dev");
  });

  it("falls through to image-default when nothing is provided", () => {
    const res = resolveContainerStartCommand({
      stackCommand: null,
      mode: "production",
    });
    expect(res.source).toBe("image-default");
    expect(res.tokens).toBeNull();
    expect(res.sourceLabel).toContain("image default");
  });

  it("empty stackCommand array falls through to devCommands", () => {
    const res = resolveContainerStartCommand({
      stackCommand: [],
      devCommands: { start: "fallback" },
      mode: "production",
    });
    expect(res.source).toBe("devCommands");
    expect(res.tokens).toEqual(["sh", "-c", "fallback"]);
  });

  it("override + resilience wrapper: the wrap is applied on top of the override tokens", () => {
    const res = resolveContainerStartCommand({
      userStartCommand: "node .next/standalone/server.js",
      stackCommand: ["sh", "-c", "never-runs"],
      mode: "production",
    });
    expect(res.source).toBe("override");
    const wrapped = wrapResilientCmd(res.tokens);
    expect(wrapped).not.toBeNull();
    const script = wrapped![2]!;
    // The override command ends up INSIDE the wrap, and the stack command never appears.
    expect(script).toContain("node .next/standalone/server.js");
    expect(script).toContain("|| true");
    expect(script).toContain("exec sleep infinity");
    expect(script).not.toContain("never-runs");
  });
});
