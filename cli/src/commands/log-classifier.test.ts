/**
 * classifyLogLine — crash-pattern classifier (s144 t581).
 *
 * The classifier maps a log line to a known pattern id (or null). Order
 * matters: earlier patterns win on ambiguous lines (e.g. a ZodError mention
 * inside an unhandled rejection log line classifies as `schema-error`,
 * which is the more actionable category).
 */

import { describe, it, expect } from "vitest";
import { classifyLogLine, LOG_PATTERNS } from "./doctor.js";

describe("classifyLogLine (s144 t581)", () => {
  it("returns null for non-matching lines", () => {
    expect(classifyLogLine("[INFO] gateway listening on 127.0.0.1:3100")).toBe(null);
    expect(classifyLogLine("")).toBe(null);
    expect(classifyLogLine("regular debug output")).toBe(null);
  });

  it("classifies ZodError as schema-error", () => {
    expect(classifyLogLine("ZodError: [{...}]")).toBe("schema-error");
    expect(classifyLogLine("Error: ZodError at validateConfig")).toBe("schema-error");
  });

  it("classifies ZodIssue as schema-error", () => {
    expect(classifyLogLine("Failed: ZodIssue: invalid_type")).toBe("schema-error");
  });

  it("classifies 'schema validation rejected' as schema-error", () => {
    expect(classifyLogLine("project.json schema validation rejected")).toBe("schema-error");
  });

  it("classifies EADDRINUSE as port-conflict", () => {
    expect(classifyLogLine("Error: listen EADDRINUSE: address already in use 127.0.0.1:3100")).toBe("port-conflict");
  });

  it("classifies segfault / SIGSEGV as segfault", () => {
    expect(classifyLogLine("node[123]: segfault at 0x0")).toBe("segfault");
    expect(classifyLogLine("Process killed with signal: SIGSEGV (core dumped)")).toBe("segfault");
  });

  it("classifies unhandled rejection in multiple shapes", () => {
    expect(classifyLogLine("(node:123) UnhandledPromiseRejectionWarning: Error: ...")).toBe("unhandled-rejection");
    expect(classifyLogLine("unhandledRejection at line 42")).toBe("unhandled-rejection");
    expect(classifyLogLine("unhandled rejection: TypeError")).toBe("unhandled-rejection");
  });

  it("classifies non-zero container exit codes", () => {
    expect(classifyLogLine("container 'agi-postgres' exited with code 137")).toBe("container-exit-nonzero");
    expect(classifyLogLine("podman: container exit code 1")).toBe("container-exit-nonzero");
  });

  it("does NOT classify exit code 0 as container-exit-nonzero", () => {
    expect(classifyLogLine("container 'foo' exited with code 0")).not.toBe("container-exit-nonzero");
  });

  it("classifies restart loop / fuse popped", () => {
    expect(classifyLogLine("[hosting] restart loop detected for project 'web'")).toBe("restart-loop");
    expect(classifyLogLine("podman: fuse popped after 5 restarts")).toBe("restart-loop");
    expect(classifyLogLine("Container has restart count: 12 (threshold 3)")).toBe("restart-loop");
  });

  it("classifies OOM signals", () => {
    expect(classifyLogLine("Out of memory: Killed process 12345")).toBe("oom");
    expect(classifyLogLine("OOMKiller: terminated agi-gateway")).toBe("oom");
    expect(classifyLogLine("ERROR: killed by OOM at runtime")).toBe("oom");
  });

  it("schema-error wins when both schema + unhandled-rejection match (load-bearing order)", () => {
    // First-match-wins by LOG_PATTERNS order. schema-error is listed first.
    const line = "UnhandledPromiseRejectionWarning: ZodError: invalid input";
    expect(classifyLogLine(line)).toBe("schema-error");
  });

  it("each pattern in LOG_PATTERNS has a repair pointer", () => {
    // Diagnostic patterns without repair pointers leave the operator
    // stranded. Lock in the contract: every pattern must have one.
    for (const p of LOG_PATTERNS) {
      expect(p.repair, `pattern ${p.id} should have a repair pointer`).toMatch(/.+/);
      expect(p.label.length, `pattern ${p.id} should have a label`).toBeGreaterThan(0);
    }
  });
});
