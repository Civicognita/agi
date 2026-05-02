/**
 * Aion chat in project context walk (s140 t587).
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
 * to Aion produces a project-aware response ("Active Project Path:
 * /home/wishborn/_projects/civicognita_ops", "active project category
 * is ops", references to Civicognita + Impactivism). This spec exercises
 * the same flow headlessly and asserts:
 *
 *   - The project page renders + the project chat panel is reachable
 *   - Sending a message triggers an assistant turn (any non-empty text
 *     after the user message is sufficient — content is non-deterministic
 *     across local-model runs, so we don't assert specific words)
 *   - No `pageerror` events
 *   - No `Cannot read properties of undefined` console errors (cycle-160's
 *     key fix promise)
 *
 * Generous 90s timeout for the assistant turn — Lemonade Gemma-4 on
 * CPU runs ~30-60s for a short reply, with thinking tokens emitting
 * over a longer span. Per `feedback_local_provider_relaxed_timeouts`
 * this is expected.
 *
 * Run via:
 *   agi test --e2e walk/aion-chat-project-context
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const walkDir = path.dirname(fileURLToPath(import.meta.url));
const snapshotsDir = path.join(walkDir, "snapshots");
fs.mkdirSync(snapshotsDir, { recursive: true });

test.describe("Aion chat — project context (s140 t587)", () => {
  test("civicognita-ops chat sends + assistant turn renders without errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto("/projects/civicognita-ops");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // The project page renders a chat aside with an "Open chat" button
    // when collapsed. Click it to expose the message input.
    const openChat = page.getByRole("button", { name: /^Open chat$/ });
    await expect(openChat, "project chat 'Open chat' affordance must render").toBeVisible({ timeout: 10_000 });
    await openChat.click();

    // The message textarea has placeholder "Message Aionima..." once open.
    const input = page.getByPlaceholder(/Message Aionima/i);
    await expect(input, "chat input textarea must render after Open chat click").toBeVisible({ timeout: 5_000 });

    // Use React-aware value setter — chrome's `type` action and
    // Playwright's locator.fill may both miss React's onChange depending
    // on how the input wraps. Setting via the prototype's value setter +
    // dispatching `input` + `change` events is the durable cross-pattern
    // approach.
    const message = "What is this project about?";
    await input.evaluate((el, msg) => {
      const proto = el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      desc?.set?.call(el, msg);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, message);

    const sendBtn = page.getByRole("button", { name: /^Send$/ });
    await expect(sendBtn, "send button must be enabled after typing").toBeEnabled({ timeout: 3_000 });
    await sendBtn.click();

    // The user's message must render in the conversation.
    await expect(
      page.getByText(message, { exact: true }).first(),
      "user message must echo into the conversation",
    ).toBeVisible({ timeout: 5_000 });

    // Wait for an "AION" speaker label to appear — that's how the chat
    // surface marks an assistant turn. The label text is concatenated
    // with the timestamp in a single text node (e.g. "AION11:29:55 PM"),
    // so we use a starts-with regex without end-anchor. We don't assert
    // specific reply content — local-model output is non-deterministic.
    // 120s timeout for Lemonade Gemma-4 on CPU (first request after
    // boot can need a model warm-up; per `feedback_local_provider_relaxed_timeouts`).
    await expect(
      page.getByText(/^AION\d/i).first(),
      "assistant turn must render (AION speaker label)",
    ).toBeVisible({ timeout: 120_000 });

    await page.screenshot({
      path: path.join(snapshotsDir, "aion-chat-civicognita-ops.png"),
      fullPage: true,
    });

    // Cycle-160's key promise: no "Cannot read properties of undefined"
    // error. That was the symptom owner saw before the layered fix.
    const cycle160Regression = consoleErrors.some((e) =>
      /Cannot read properties of undefined.*reading.*0/i.test(e),
    );
    expect(
      cycle160Regression,
      `cycle-160 regression — "Cannot read properties of undefined (reading '0')" found in console: ${consoleErrors.join(" | ")}`,
    ).toBe(false);

    // Hard JS errors are also a fail. Console.error warnings without a
    // pageerror are tolerated (some non-fatal warnings are expected).
    expect(
      pageErrors,
      `pageerrors during chat flow: ${pageErrors.join(" | ")}`,
    ).toEqual([]);
  });
});
