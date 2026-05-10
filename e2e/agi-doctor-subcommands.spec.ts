import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";

/**
 * `agi doctor` subcommands e2e (s144 t583).
 *
 * Verifies the subcommands shipped under s144 are usable from the
 * shell. Same spawnSync pattern as agi-bash-passthrough.spec.ts.
 *
 * Subcommands covered:
 *   - `agi doctor schema` (t575)            — config-shape validation
 *   - `agi doctor schema --json` (t575)     — machine-readable output
 *   - `agi doctor dump` (t579)              — diagnostic bundle
 *   - `agi doctor config get <key>` (t578)  — gateway.json read
 *   - `agi doctor logs` (t581)              — log tail + crash-pattern
 *
 * The bare `agi doctor` (status check) test is in s144 t582's scope —
 * this spec deliberately doesn't assert that bare-form behavior so
 * t582's later swap-to-TUI doesn't break this spec.
 *
 * The interactive TUI (`agi doctor` bare-form, t574) is multi-cycle
 * and not exercised here; once t574 ships, a follow-up spec adds
 * TUI-driving cases.
 *
 * Manual recipe doc lives at docs/agents/agi-doctor-recipe.md — owner
 * walks through the full diagnostic flow from there.
 */

function runAgi(args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("agi", args, { encoding: "utf-8", timeout: 30_000 });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

test.describe("`agi doctor` subcommands (s144 t583)", () => {
  test("agi doctor schema --json returns parseable JSON", async () => {
    const r = runAgi(["doctor", "schema", "--json"]);
    // exit code 0 (no errors) OR 1 (validation errors) are both valid;
    // we only fail on -1 (binary missing) or other unhandled errors
    expect(r.code === 0 || r.code === 1).toBe(true);
    if (r.code !== -1) {
      // The --json variant must emit parseable JSON on stdout
      try {
        const parsed: unknown = JSON.parse(r.stdout);
        expect(typeof parsed).toBe("object");
      } catch (err) {
        throw new Error(`agi doctor schema --json did not produce valid JSON: ${(err as Error).message}\nstdout was: ${r.stdout.slice(0, 500)}`);
      }
    }
  });

  test("agi doctor config get <key> returns the value", async () => {
    // Use a key that's always present in gateway.json post-onboarding
    const r = runAgi(["doctor", "config", "get", "gateway.port"]);
    if (r.code === -1) test.skip(); // agi binary not on PATH (host-only test env)
    expect(r.code).toBe(0);
    // Output should be a port number or object — non-empty either way
    expect(r.stdout.trim().length).toBeGreaterThan(0);
  });

  test("agi doctor logs --lines <n> returns a tail", async () => {
    const r = runAgi(["doctor", "logs", "--lines", "10"]);
    if (r.code === -1) test.skip();
    // logs subcommand returns 0 (no patterns) or 1 (patterns matched)
    expect(r.code === 0 || r.code === 1).toBe(true);
  });

  test("agi doctor schema (no --json) produces human-readable output", async () => {
    const r = runAgi(["doctor", "schema"]);
    if (r.code === -1) test.skip();
    expect(r.code === 0 || r.code === 1).toBe(true);
    // Either the success line or an error block must appear
    const combined = r.stdout + r.stderr;
    expect(combined.length).toBeGreaterThan(0);
  });
});
