/**
 * Aion chat in project context walk (s140 t587 + t588).
 *
 * Locks in the cycle-160 layered chat fix that owner explicitly named
 * in the cycle-156 directive: "v0.4.451 tynn-provider fix needs e2e
 * verification: open Aion chat in civicognita_ops, ask about the
 * project, no 'Cannot read properties of undefined (reading 0)'".
 *
 * Cycle 160 shipped five fixes that compound here:
 *   - openai-provider choices?.[0] guard (v0.4.453)
 *   - agent-invoker result.model.startsWith guard (v0.4.454)
 *   - reasoning_content parsing fallback (v0.4.455)
 *   - Lemonade ctx_size 4096 → 32768 (eliminates context-overflow 400)
 *   - STALL_MS 120s → 600s (per `feedback_local_provider_relaxed_timeouts`)
 *
 * Verified manually in cycle 165: a "What is this project about?" message
 * to Aion produces a project-aware response (Aion's thinking trace named
 * the active project path, ops category, Civicognita+Impactivism context).
 * This spec exercises the same flow headlessly across BOTH proofing
 * projects (civicognita_ops + civicognita_web — t587 + t588) and asserts:
 *
 *   - The project page renders + the project chat panel is reachable
 *   - Sending a message triggers an assistant turn (any non-empty text
 *     after the user message is sufficient — content is non-deterministic
 *     across local-model runs, so we don't assert specific words)
 *   - No `pageerror` events
 *   - No `Cannot read properties of undefined` console errors (cycle-160's
 *     key fix promise)
 *
 * Generous 120s timeout for the assistant turn — Lemonade Gemma-4 on
 * CPU runs ~30-60s for a short reply, with thinking tokens emitting
 * over a longer span. Per `feedback_local_provider_relaxed_timeouts`
 * this is expected.
 *
 * Run via:
 *   agi test --e2e walk/aion-chat-project-context
 */

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const walkDir = path.dirname(fileURLToPath(import.meta.url));
const snapshotsDir = path.join(walkDir, "snapshots");
fs.mkdirSync(snapshotsDir, { recursive: true });

interface ProofProject {
  slug: string;
  taskRef: string;
}

const PROOF_PROJECTS: readonly ProofProject[] = [
  { slug: "civicognita-ops", taskRef: "t587" },
  { slug: "civicognita-web", taskRef: "t588" },
];

async function setReactInputValue(page: Page, placeholder: RegExp, value: string): Promise<void> {
  // Programmatic input via three different paths can all miss React's
  // onChange depending on input wrapping (controlled / uncontrolled-with-
  // ref / custom-hook): chrome's `type` action types characters but
  // sometimes skips the synthetic event; Playwright's locator.fill()
  // sets value + fires input but not always change; a naive `.value =
  // "..."` assignment fires nothing. The durable cross-pattern is the
  // prototype value setter + dispatching both `input` AND `change`. This
  // helper is shared so future specs that interact with React inputs
  // can drop this trap once.
  const input = page.getByPlaceholder(placeholder);
  await expect(input, `input matching ${placeholder}`).toBeVisible({ timeout: 5_000 });
  await input.evaluate((el, v) => {
    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    desc?.set?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

// Force sequential execution within this file — Lemonade serves one
// chat at a time, so parallel parametric tests deadlock the second
// behind the first and trip the 120s assistant-turn timeout. This is
// the right shape for any spec that hits a single-tenant local backend
// (Lemonade, CPU-bound Ollama, model-serving plugin).
test.describe.configure({ mode: "serial" });

test.describe("Aion chat — project context (s140 t587 + t588)", () => {
  for (const proj of PROOF_PROJECTS) {
    test(`${proj.slug} chat sends + assistant turn renders without errors (${proj.taskRef})`, async ({ page }) => {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
      page.on("pageerror", (e) => pageErrors.push(e.message));

      await page.goto(`/projects/${proj.slug}`);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      // The project page renders a chat aside with an "Open chat" button
      // when collapsed. Click it to expose the message input.
      const openChat = page.getByRole("button", { name: /^Open chat$/ });
      await expect(openChat, `${proj.slug} project chat 'Open chat' affordance must render`)
        .toBeVisible({ timeout: 10_000 });
      await openChat.click();

      // Set the message via React-aware helper.
      const message = "What is this project about?";
      await setReactInputValue(page, /Message Aionima/i, message);

      const sendBtn = page.getByRole("button", { name: /^Send$/ });
      await expect(sendBtn, `${proj.slug} send button must be enabled after typing`)
        .toBeEnabled({ timeout: 3_000 });
      await sendBtn.click();

      // The user's message must echo into the conversation.
      await expect(
        page.getByText(message, { exact: true }).first(),
        `${proj.slug} user message must echo into the conversation`,
      ).toBeVisible({ timeout: 5_000 });

      // Wait for an assistant speaker label to appear — that's how the
      // chat surface marks an assistant turn. s140 cycle-173 t595: the
      // chat surface now wraps the speaker label in
      // data-testid="chat-message-speaker-assistant", so we target by
      // testid (durable across timestamp format / locale changes) rather
      // than the brittle "AION<digit>" regex. 120s timeout for Lemonade
      // Gemma-4 on CPU (first request after boot needs model warm-up).
      await expect(
        page.getByTestId("chat-message-speaker-assistant").first(),
        `${proj.slug} assistant turn must render (chat-message-speaker-assistant testid)`,
      ).toBeVisible({ timeout: 120_000 });

      await page.screenshot({
        path: path.join(snapshotsDir, `aion-chat-${proj.slug}.png`),
        fullPage: true,
      });

      // Cycle-160's key promise: no "Cannot read properties of undefined"
      // error. That was the symptom owner saw before the layered fix.
      const cycle160Regression = consoleErrors.some((e) =>
        /Cannot read properties of undefined.*reading.*0/i.test(e),
      );
      expect(
        cycle160Regression,
        `${proj.slug} cycle-160 regression — "Cannot read properties of undefined (reading '0')" found: ${consoleErrors.join(" | ")}`,
      ).toBe(false);

      // Hard JS errors are also a fail. Console.error warnings without a
      // pageerror are tolerated (some non-fatal warnings are expected).
      expect(
        pageErrors,
        `${proj.slug} pageerrors during chat flow: ${pageErrors.join(" | ")}`,
      ).toEqual([]);
    });
  }
});
