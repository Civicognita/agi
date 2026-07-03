/**
 * browser_session navigation unit tests.
 *
 * Regression: `navigateWithSettle` must NOT use `waitUntil: "networkidle"`.
 * networkidle resolves only after 500 ms of zero network activity, which never
 * happens for client-rendered / realtime apps (WhisperChat — issues i-001/i-002),
 * so `goto` hung the full NAV_TIMEOUT and threw on healthy pages. It must wait on
 * `domcontentloaded` and then a bounded, non-throwing `load` settle.
 *
 * Uses a fake page (no real Chromium) — no VM/browser required.
 */

import { describe, it, expect } from "vitest";
import { navigateWithSettle } from "./browser-session.js";

type FakePage = Parameters<typeof navigateWithSettle>[0];

function makeFakePage(opts: { loadStateBehavior: "resolve" | "reject" }): {
  page: FakePage;
  calls: { gotoOpts?: { timeout?: number; waitUntil?: string }; loadStateArgs?: [string?, { timeout?: number }?] };
} {
  const calls: { gotoOpts?: { timeout?: number; waitUntil?: string }; loadStateArgs?: [string?, { timeout?: number }?] } = {};
  const page = {
    goto: async (_url: string, o?: { timeout?: number; waitUntil?: string }) => {
      calls.gotoOpts = o;
    },
    waitForLoadState: async (state?: string, o?: { timeout?: number }) => {
      calls.loadStateArgs = [state, o];
      if (opts.loadStateBehavior === "reject") throw new Error("load never fired (simulated never-idle)");
    },
  } as unknown as FakePage;
  return { page, calls };
}

describe("navigateWithSettle", () => {
  it("navigates with waitUntil:'domcontentloaded', NEVER 'networkidle'", async () => {
    const { page, calls } = makeFakePage({ loadStateBehavior: "resolve" });
    await navigateWithSettle(page, "http://example.test:8647/");
    expect(calls.gotoOpts?.waitUntil).toBe("domcontentloaded");
    expect(calls.gotoOpts?.waitUntil).not.toBe("networkidle");
    expect(calls.gotoOpts?.timeout).toBeGreaterThan(0);
  });

  it("does a bounded 'load' settle after DOM is parsed", async () => {
    const { page, calls } = makeFakePage({ loadStateBehavior: "resolve" });
    await navigateWithSettle(page, "http://example.test:8647/");
    expect(calls.loadStateArgs?.[0]).toBe("load");
    expect(calls.loadStateArgs?.[1]?.timeout).toBeGreaterThan(0); // capped, can't hang
  });

  it("does NOT throw when the load settle times out (the i-002 regression)", async () => {
    // A page that never reaches 'load' (open socket / streaming) must still
    // resolve navigation — the page is already usable.
    const { page } = makeFakePage({ loadStateBehavior: "reject" });
    await expect(navigateWithSettle(page, "http://example.test:8647/")).resolves.toBeUndefined();
  });
});
