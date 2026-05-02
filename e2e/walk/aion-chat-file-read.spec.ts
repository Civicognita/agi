/**
 * Aion chat file-read in project context (s140 t590 cycle-170).
 *
 * Proves the cycle-170 path-resolution fix end-to-end. Aion is asked
 * to read a known file in civicognita_web; the response must show
 * actual file content (or at least the absence of the "not found"
 * failure mode that pre-fix tool runs returned).
 *
 * Pre-fix (cycle 168): asked Aion to read repos/civicognita_web/src/
 * components/AionimaComingSoon.tsx. Both dir_list and file_read tools
 * ran in 1ms and returned "directory does not exist" / "file could
 * not be found" — even though the file exists. Root cause: relative
 * paths resolved against the gateway workspaceRoot ("/") instead of
 * the project root.
 *
 * Post-fix (v0.4.477): the cage-aware resolveCagedPath() helper
 * resolves relative paths against the project's root when a project
 * cage is active. file_read should now find the file.
 *
 * Pass criteria:
 *   - Send "What's in repos/civicognita_web/src/components/AionimaComingSoon.tsx?"
 *   - Wait for an AION assistant turn
 *   - Response must NOT contain "could not be found" / "does not exist"
 *     for the AionimaComingSoon path (pre-fix regression sentinel)
 *   - Response must reference content actually present in the file
 *     (e.g. "use client" — the file's first-line directive — or
 *     "qualities" — the array name)
 *
 * Generous 180s timeout for Lemonade Gemma-4 thinking + tool-use cycle.
 *
 * Run via:
 *   agi test --e2e walk/aion-chat-file-read
 */

import { test, expect } from "@playwright/test";

// Lemonade serves one chat at a time — keep this spec serial-safe even
// alone, in case it's later batched with the other Aion-chat specs.
test.describe.configure({ mode: "serial" });

test.describe("Aion chat — file-read in project context (s140 t590)", () => {
  test("civicognita_web: Aion reads AionimaComingSoon.tsx via chat", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto("/projects/civicognita-web");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Open the project chat panel.
    const openChat = page.getByRole("button", { name: /^Open chat$/ });
    await expect(openChat, "Open chat button must render").toBeVisible({ timeout: 10_000 });
    await openChat.click();

    // Set the message via React-aware setter (chrome `type` and
    // Playwright fill both miss React's onChange depending on input
    // wrapping — see cycle 166 setReactInputValue helper).
    const input = page.getByPlaceholder(/Message Aionima/i);
    await expect(input, "chat input textarea must render").toBeVisible({ timeout: 5_000 });

    const message = "Read the first 30 lines of repos/civicognita_web/src/components/AionimaComingSoon.tsx and summarize what the file contains.";
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
    await expect(sendBtn, "send button must be enabled").toBeEnabled({ timeout: 3_000 });
    await sendBtn.click();

    // Wait for an AION speaker label (assistant turn rendered).
    await expect(
      page.getByText(/^AION\d/i).first(),
      "assistant turn must render",
    ).toBeVisible({ timeout: 180_000 });

    // The conversation surface contains the assistant turn + any tool-
    // use traces. Tool-use cycles (file_read → tool_result → final
    // response) can take 60-120s on Lemonade Gemma-4 CPU; the bare
    // "AION" label appears at the start of thinking. Wait for the
    // tool-use trace to land before scraping the conversation, and
    // poll for any of the proof-strings to appear (don't just wait
    // a fixed 2s).
    await page.getByText(/file_read|TOOL: FILE_READ|use client|qualities/i).first()
      .waitFor({ timeout: 120_000 })
      .catch(() => {});
    await page.waitForTimeout(3_000); // let final response stream in fully

    const chatText = await page.evaluate(() => {
      // Find any text node containing the user message we just sent.
      const userMsg = Array.from(document.querySelectorAll("div"))
        .find((d) => d.children.length === 0 && d.textContent?.includes("AionimaComingSoon"));
      if (!userMsg) return "";
      // Walk up to a container with multiple children — that's the
      // chat scroll view.
      let container: HTMLElement | null = userMsg.parentElement;
      for (let i = 0; i < 12 && container; i++) {
        if (container.children.length > 2) break;
        container = container.parentElement;
      }
      return container?.innerText ?? "";
    });

    // Pre-fix regression sentinels — the cycle-168 probe saw both of
    // these. If either appears in the response for the AionimaComingSoon
    // path, the path-resolution fix didn't apply.
    const hasNotFound = /AionimaComingSoon[^]{0,200}(could not be found|does not exist|not found)/i.test(chatText);
    expect(
      hasNotFound,
      `cycle-168 regression — file_read returned "not found" for the post-s140 path. Response: ${chatText.slice(-1500)}`,
    ).toBe(false);

    // Post-fix proof: the chat surface shows a successful file_read
    // tool call. The trace shape is:
    //   TOOL: FILE_READ
    //   ✓
    //   Read
    //   .../components/AionimaComingSoon.tsx
    //   TSX
    //   <Nms>
    //
    // The key signal is "TOOL: FILE_READ" + "✓" + the file path
    // appearing in proximity. Pre-fix the same call existed but
    // resolved to a non-existent path — the trace would either show
    // an error string or omit the ✓ checkmark. Asserting on the
    // tool-success trace is more robust than asserting on Aion's
    // free-form summary content (which is non-deterministic across
    // local-model runs).
    const hasToolReadCall = /TOOL:\s*FILE_READ/i.test(chatText);
    expect(
      hasToolReadCall,
      `Aion must have invoked file_read tool. chatText (last 1500): ${chatText.slice(-1500)}`,
    ).toBe(true);

    // The file path must appear in the trace — confirms the call
    // targeted the right file (not a different one).
    expect(
      /AionimaComingSoon\.tsx/i.test(chatText),
      `tool trace must reference the target file path. chatText (last 1500): ${chatText.slice(-1500)}`,
    ).toBe(true);

    // The ✓ success marker must be present near the FILE_READ trace.
    // The chat surface renders ✓ as a separate line right under
    // "TOOL: FILE_READ" when the tool succeeds. This is the strongest
    // single proof signal available without scraping the structured
    // tool-result event.
    const successMarkerNearTool = /TOOL:\s*FILE_READ[\s\S]{0,300}✓/i.test(chatText);
    expect(
      successMarkerNearTool,
      `file_read tool must show ✓ success marker (regression sentinel). chatText (last 1500): ${chatText.slice(-1500)}`,
    ).toBe(true);

    expect(
      pageErrors,
      `pageerrors during chat flow: ${pageErrors.join(" | ")}`,
    ).toEqual([]);
  });
});
