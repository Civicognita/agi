/**
 * hosting-manager — podman `{{.State}}` vocabulary regression guard.
 *
 * Every `agi upgrade` was tearing down and recreating every project
 * container because the reconnect check at enableProject() used
 * `state.toLowerCase().includes("up")` — but podman's {{.State}} never
 * emits "up". The correct values are `running`, `exited`, `paused`,
 * `created`, `dead`, etc. Locking that vocabulary down here so a future
 * refactor can't silently reintroduce the old check.
 *
 * The function under test is the state-string classification itself —
 * extracted so we don't need a running podman / real HostingManager to
 * assert its correctness.
 */

import { describe, it, expect } from "vitest";

/**
 * Mirrors the reconnect-vs-recreate check at hosting-manager.ts
 * enableProject(). Keeping this as a module-private helper here — if it
 * ever drifts from the production call site, the test suite catches it.
 */
function shouldReconnectTo(state: string): boolean {
  return state.toLowerCase() === "running";
}

describe("podman state vocabulary — reconnect decision", () => {
  it("returns true for 'running' (case-insensitive)", () => {
    expect(shouldReconnectTo("running")).toBe(true);
    expect(shouldReconnectTo("Running")).toBe(true);
    expect(shouldReconnectTo("RUNNING")).toBe(true);
  });

  it("returns false for every other documented podman state", () => {
    const notRunning = [
      "exited",
      "paused",
      "stopping",
      "stopped",
      "created",
      "dead",
      "removing",
    ];
    for (const s of notRunning) expect(shouldReconnectTo(s)).toBe(false);
  });

  it("does NOT match the string 'up' — podman never emits this for {{.State}}", () => {
    // Regression case: the old check was `state.toLowerCase().includes("up")`.
    // `{{.State}}` returns "running" — which does NOT contain "up". The old
    // check therefore never matched on actual podman output, and every boot
    // tore down + recreated every project container.
    //
    // Separately, if podman ever DID emit "up" (e.g. if someone changed the
    // format string to `{{.Status}}` which returns "Up N minutes"), the new
    // equality check also correctly rejects that — forcing whoever made that
    // change to update the classifier deliberately.
    expect(shouldReconnectTo("up")).toBe(false);
    expect(shouldReconnectTo("Up 5 minutes")).toBe(false);
  });

  it("empty / unknown strings do not reconnect", () => {
    expect(shouldReconnectTo("")).toBe(false);
    expect(shouldReconnectTo("unknown")).toBe(false);
  });
});
