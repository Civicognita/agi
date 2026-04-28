import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/**
 * agi bash passthrough enforcement (story #105 — caller migration + e2e).
 *
 * Two tiers of assertion:
 *
 *   1. STATIC (always runnable, fast): grep-verifies that the chat-agent
 *      shell tool source code routes through `agi bash` with the right
 *      AGI_CALLER. This is the "no caller silently bypasses" guard — if a
 *      future change reverts the migration, this test fails immediately
 *      without needing the gateway, an LLM, or the test VM.
 *
 *   2. BEHAVIORAL (skipped until v0.4.149 deploys to the test VM): triggers
 *      a real agent shell invocation through the dashboard chat UI and
 *      asserts the agi-bash JSONL log surface shows the record with
 *      caller=chat-agent. The behavioral path needs a live LLM in the test
 *      VM and the deployed agi binary to expose `agi bash` — so it stays
 *      `test.skip` until those preconditions are met. See feedback memory
 *      `feedback_playwright_is_done`: the behavioral test is the strict
 *      DONE signal once the prereqs are in place.
 *
 * Mutation check (manual until automated):
 *   Revert shell-exec.ts to drop the AGI_BASH_AVAILABLE branch — the
 *   static tests below MUST start failing. That confirms the test catches
 *   the regression.
 */

const REPO_ROOT = join(__dirname, "..");
const SHELL_EXEC_PATH = join(REPO_ROOT, "packages/gateway-core/src/tools/shell-exec.ts");
const AGENT_TOOLS_PATH = join(REPO_ROOT, "packages/gateway-core/src/tools/agent-tools.ts");

test.describe("agi bash passthrough — caller migration enforcement", () => {
  test.describe("static source-level assertions", () => {
    test("shell-exec.ts routes through agi bash with caller=chat-agent", () => {
      const src = readFileSync(SHELL_EXEC_PATH, "utf-8");

      // The migration must declare detection of the agi bash subcommand…
      expect(src).toContain("detectAgiBashSupport");
      // …gate the primary path on detection…
      expect(src).toContain("if (AGI_BASH_AVAILABLE)");
      // …spawn the agi binary with the bash subcommand…
      expect(src).toMatch(/spawnSync\(\s*"agi",\s*\[\s*"bash"\s*,\s*"-c"\s*,\s*command/);
      // …attribute the caller as chat-agent.
      expect(src).toContain('AGI_CALLER: "chat-agent"');
    });

    test("agent-tools.ts disk-stats probe routes through agi bash", () => {
      const src = readFileSync(AGENT_TOOLS_PATH, "utf-8");
      expect(src).toMatch(/spawnSync\(\s*"agi",\s*\[\s*"bash"\s*,\s*"-c"\s*,\s*"df -B1 \/"\s*\]/);
      expect(src).toContain('AGI_CALLER: "chat-agent"');
    });

    test("agent-tools.ts no longer imports the shell-form variant", () => {
      // Imports must be argv-form only (spawn / spawnSync).
      const src = readFileSync(AGENT_TOOLS_PATH, "utf-8");
      expect(src).toMatch(/import\s*\{\s*spawn,\s*spawnSync\s*\}\s*from\s*"node:child_process"/);
    });
  });

  test.describe("behavioral (deploy-dependent — skipped until v0.4.149 ships)", () => {
    test.skip(
      true,
      "needs the test VM to expose `agi bash` (v0.4.149+) and a running local LLM. Unskip after `agi upgrade` deploys the lockdown surface to the test VM.",
    );

    test("agent shell exec via chat UI lands in JSONL with caller=chat-agent", async ({ page }) => {
      // Sentinel command — unique enough that the cmd_hash is unambiguous.
      const sentinel = `echo agi-bash-passthrough-sentinel-${Date.now()}`;

      await page.goto("/");
      await page.getByTestId("header-chat-button").click();
      await expect(page.getByTestId("chat-flyout")).toBeVisible();

      const input = page.getByTestId("chat-input");
      await input.fill(`Run \`${sentinel}\` via the shell_exec tool and report the output.`);
      await page.getByTestId("chat-send").click();

      // Wait for the agent's response to settle (model-dependent — adjust on tuning).
      await page.waitForTimeout(120_000);

      // Read the JSONL log from the test VM via multipass exec.
      const today = new Date().toISOString().slice(0, 10);
      const logRead = spawnSync(
        "multipass",
        [
          "exec",
          "agi-test",
          "--",
          "cat",
          `/home/ubuntu/.agi/logs/agi-bash-${today}.jsonl`,
        ],
        { encoding: "utf-8", timeout: 5000 },
      );

      const records = (logRead.stdout ?? "")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { caller: string; cmd_hash: string });

      const chatAgentRecords = records.filter((r) => r.caller === "chat-agent");
      expect(chatAgentRecords.length).toBeGreaterThan(0);
    });
  });
});
