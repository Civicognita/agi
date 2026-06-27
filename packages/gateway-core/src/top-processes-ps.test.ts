import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guard for the getTopProcesses `ps` invocation (story #221).
 *
 * `ps aux` (BSD personality) combined with `-o` errors with
 * "conflicting format options", which silently broke the Resources page
 * top-processes widget. This test (a) asserts the source no longer combines
 * those flags, and (b) runs the canonical arg form to prove it's accepted by
 * the host `ps`.
 */

const RUNTIME_STATE = fileURLToPath(
  new URL("./server-runtime-state.ts", import.meta.url),
);

const PS_ARGS = ["-eo", "pid,user,%cpu,%mem,rss,comm", "--sort=-%mem", "--no-headers", "-ww"];

describe("getTopProcesses ps invocation (s221)", () => {
  it("does not combine BSD `aux` with `-o` in any ps execFileSync call", () => {
    const src = readFileSync(RUNTIME_STATE, "utf-8");
    // Find the execFileSync("ps", [ ... ]) argument arrays.
    for (const m of src.matchAll(/execFileSync\(\s*"ps"\s*,\s*\[([^\]]*)\]/g)) {
      const args = m[1]!;
      const hasAux = /"aux"/.test(args);
      const hasDashO = /"-o"/.test(args);
      expect(hasAux && hasDashO, `conflicting ps flags (aux + -o) in: [${args.trim()}]`).toBe(false);
    }
  });

  it("the canonical arg form is accepted by the host ps and yields parseable rows", () => {
    const out = execFileSync("ps", PS_ARGS, { timeout: 5000 }).toString().trim();
    expect(out.length).toBeGreaterThan(0);
    const first = out.split("\n")[0]!.trim().split(/\s+/);
    // pid, user, %cpu, %mem, rss, comm…
    expect(Number.isInteger(parseInt(first[0]!, 10))).toBe(true);
    expect(first.length).toBeGreaterThanOrEqual(6);
  });
});
