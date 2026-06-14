import { test, expect } from "@playwright/test";

// These tests run serially — parallel workers send simultaneous chat messages to
// the local Ollama model, saturating the CPU on the test VM and causing timeouts.
test.describe.configure({ mode: "serial" });

test.describe("MagicApp Admin", () => {
  test("admin page renders", async ({ page }) => {
    await page.goto("/magic-apps/admin");
    await expect(page.getByRole("heading", { name: "MagicApps", level: 1 })).toBeVisible({ timeout: 10_000 });
  });

  test("Create with AI button opens chat flyout and auto-sends builder message", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/magic-apps/admin");
    await expect(page.getByRole("heading", { name: "MagicApps", level: 1 })).toBeVisible({ timeout: 10_000 });

    // Click "Create with AI" — triggers onOpenChatWithMessage("builder:create", ...)
    await page.getByRole("button", { name: "Create with AI" }).click();

    // Chat flyout must open (data-testid="chat-flyout" on the panel root)
    const flyout = page.locator('[data-testid="chat-flyout"]');
    await expect(flyout).toBeVisible({ timeout: 10_000 });

    // The openWithMessage is stored in pendingMessageRef and auto-sent once the
    // server ACKs the chat:open WS event. Appearance of user-0 confirms the WS
    // round-trip succeeded.
    const userMsg0 = page.locator('[data-testid="chat-message-user-0"]');
    await expect(userMsg0).toBeVisible({ timeout: 15_000 });
    await expect(userMsg0).toContainText("MagicApp");

    // Chat input is accessible (can type a follow-up)
    const chatInput = page.getByPlaceholder("Message Aionima…");
    await expect(chatInput).toBeVisible({ timeout: 5_000 });
  });

  // Full AI response round-trip — only practical with a cloud provider or fast
  // local model. With qwen2.5:3b on a 4-core CPU the builder system prompt is
  // large enough that inference takes 3–5 minutes, far beyond a CI-friendly
  // budget. The test is kept here for targeted manual runs (agi test --e2e
  // magic-app-modal --headed) but is skipped in the automated suite.
  // Enable: FULL_AI_ROUNDTRIP=1 agi test --e2e magic-app-modal
  test("Create with AI: full round-trip produces assistant response", async ({ page }) => {
    test.skip(!process.env.FULL_AI_ROUNDTRIP, "Slow: requires cloud provider or FULL_AI_ROUNDTRIP=1");

    const BASE_URL = process.env.BASE_URL ?? "";
    const isRemote = BASE_URL.includes("test.ai.on");

    // 10 min budget: up to 350 s × 2 turns + overhead for slow CPU model
    test.setTimeout(600_000);

    await page.goto("/magic-apps/admin");
    await expect(page.getByRole("heading", { name: "MagicApps", level: 1 })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Create with AI" }).click();
    await expect(page.locator('[data-testid="chat-flyout"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="chat-message-user-0"]')).toBeVisible({ timeout: 15_000 });

    // Allow up to 350 s for local model cold-start + inference.
    // qwen2.5:3b on a 4-core CPU takes ~280 s for the full builder prompt;
    // cloud providers respond in ~5 s. Keep headroom before the 300 s test timeout.
    const assistantMsg0 = page.locator('[data-testid="chat-message-assistant-0"]');
    await expect(assistantMsg0).toBeVisible({ timeout: 350_000 });
    await expect(assistantMsg0).not.toBeEmpty();

    // Verify chat input is still available for follow-up
    const chatInput = page.getByPlaceholder("Message Aionima…");
    await expect(chatInput).toBeVisible({ timeout: 5_000 });

    // Send a minimal MApp spec so the builder can call create_magic_app
    await chatInput.fill(
      'Create a minimal tool MApp: id "quick-note-e2e", name "Quick Note E2E", ' +
      'author "e2e-test", one textarea field for markdown content. No permissions needed.',
    );
    await chatInput.press("Enter");

    await expect(page.locator('[data-testid="chat-message-user-1"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="chat-message-assistant-1"]')).toBeVisible({ timeout: 280_000 });

    if (isRemote) {
      // When running against the test VM (qwen2.5:3b), just verify the response
      // arrived — don't assert on specific content (non-deterministic small model).
      await expect(page.locator('[data-testid="chat-message-assistant-1"]')).not.toBeEmpty();
    }
  });
});
