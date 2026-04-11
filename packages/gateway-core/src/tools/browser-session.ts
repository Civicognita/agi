/**
 * browser_session tool — persistent Playwright browser session for the agent.
 *
 * Provides full browser interaction: navigate, click, type, fill forms, read
 * content, take screenshots, and evaluate JavaScript. The browser session
 * persists across multiple tool calls within the same conversation, enabling
 * multi-step workflows (e.g., navigate → fill form → click submit → screenshot).
 *
 * IMPORTANT: Playwright always runs on the HOST machine (in the gateway process),
 * never inside project containers. It reaches hosted projects via their local URLs
 * (e.g., https://myproject.ai.on). This is by design — the agent is not restricted
 * to the container context when working with projects.
 *
 * Sessions auto-close after 5 minutes of inactivity or when explicitly closed.
 * Playwright is installed automatically by install.sh / upgrade.sh.
 *
 * Requires state ONLINE, tier verified/sealed.
 */

import { ulid } from "ulid";
import type { ToolHandler, ToolExecutionContext } from "../tool-registry.js";
import type { ImageBlobStore } from "../image-blob-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserSessionConfig {
  imageBlobStore: ImageBlobStore;
}

type BrowserAction =
  | "open"        // Launch browser + navigate to URL
  | "navigate"    // Navigate to a new URL
  | "click"       // Click an element by selector
  | "type"        // Type text into a focused element
  | "fill"        // Fill an input by selector
  | "select"      // Select an option from a dropdown
  | "screenshot"  // Capture current page state
  | "read_text"   // Read visible text content (optionally from a selector)
  | "read_html"   // Read HTML of an element
  | "evaluate"    // Run JavaScript in the page context
  | "wait"        // Wait for a selector or timeout
  | "close"       // Close the browser session

// Minimal Playwright type stubs for dynamic import
interface PwBrowser { newPage(): Promise<PwPage>; close(): Promise<void>; isConnected(): boolean }
interface PwPage {
  setViewportSize(s: { width: number; height: number }): Promise<void>;
  goto(url: string, opts?: { timeout?: number; waitUntil?: string }): Promise<void>;
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  type(selector: string, text: string, opts?: { delay?: number }): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  selectOption(selector: string, values: string | string[]): Promise<string[]>;
  screenshot(opts?: { type?: string; fullPage?: boolean }): Promise<Buffer>;
  textContent(selector: string): Promise<string | null>;
  innerText(selector: string): Promise<string>;
  innerHTML(selector: string): Promise<string>;
  evaluate<T>(fn: string | (() => T)): Promise<T>;
  waitForSelector(selector: string, opts?: { timeout?: number; state?: string }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  title(): Promise<string>;
  url(): string;
  content(): Promise<string>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Session manager — tracks active browser sessions per entity
// ---------------------------------------------------------------------------

interface ActiveSession {
  browser: PwBrowser;
  page: PwPage;
  lastActivity: number;
  sessionId: string;
}

const sessions = new Map<string, ActiveSession>();
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 min idle timeout

// Sweep stale sessions every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      session.browser.close().catch(() => {});
      sessions.delete(key);
    }
  }
}, 60_000);

function getSessionKey(ctx?: ToolExecutionContext): string {
  return ctx?.entityId ?? "default";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const NAV_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 10_000;

export function createBrowserSessionHandler(config: BrowserSessionConfig): ToolHandler {
  return async (input: Record<string, unknown>, ctx?: ToolExecutionContext): Promise<string> => {
    const action = String(input.action ?? "").trim() as BrowserAction;
    if (!action) {
      return JSON.stringify({ error: 'action is required. Valid: open, navigate, click, type, fill, select, screenshot, read_text, read_html, evaluate, wait, close' });
    }

    const sessionKey = getSessionKey(ctx);
    const url = input.url ? String(input.url).trim() : "";
    const selector = input.selector ? String(input.selector).trim() : "";
    const text = input.text ? String(input.text) : "";
    const value = input.value ? String(input.value) : "";
    const script = input.script ? String(input.script) : "";
    const timeout = typeof input.timeout === "number" ? input.timeout : ACTION_TIMEOUT;
    const fullPage = input.fullPage === true;
    const includeScreenshot = input.includeScreenshot !== false; // default true for most actions

    // -----------------------------------------------------------------------
    // OPEN — launch browser and navigate
    // -----------------------------------------------------------------------
    if (action === "open") {
      if (!url) return JSON.stringify({ error: "url is required for open action" });
      if (!/^https?:\/\//i.test(url)) return JSON.stringify({ error: "URL must start with http:// or https://" });

      // Close existing session if any
      const existing = sessions.get(sessionKey);
      if (existing) {
        try { await existing.browser.close(); } catch {}
        sessions.delete(sessionKey);
      }

      let chromium: { launch(opts: { headless: boolean }): Promise<PwBrowser> };
      try {
        const pw = await (Function('return import("playwright")')() as Promise<{ chromium: typeof chromium }>);
        chromium = pw.chromium;
      } catch {
        return JSON.stringify({ error: "Playwright is not available. This is a server-side issue — the install/upgrade script should have run 'npx playwright install chromium'. Do NOT attempt to install it yourself." });
      }

      try {
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        const vw = (input.viewport as { width?: number } | undefined)?.width ?? 1280;
        const vh = (input.viewport as { height?: number } | undefined)?.height ?? 720;
        await page.setViewportSize({ width: vw, height: vh });
        await page.goto(url, { timeout: NAV_TIMEOUT, waitUntil: "networkidle" });

        const sid = ulid();
        sessions.set(sessionKey, { browser, page, lastActivity: Date.now(), sessionId: sid });

        const title = await page.title();
        const result: Record<string, unknown> = { ok: true, action: "open", url: page.url(), title, browserSessionId: sid };

        if (includeScreenshot) {
          const shot = await captureScreenshot(page, config, fullPage);
          Object.assign(result, shot);
        }

        return JSON.stringify(result);
      } catch (err) {
        return JSON.stringify({ error: `Failed to open browser: ${errMsg(err)}` });
      }
    }

    // -----------------------------------------------------------------------
    // All other actions require an active session
    // -----------------------------------------------------------------------
    const session = sessions.get(sessionKey);
    if (!session || !session.browser.isConnected()) {
      sessions.delete(sessionKey);
      return JSON.stringify({ error: 'No active browser session. Use action "open" first.' });
    }
    session.lastActivity = Date.now();
    const { page } = session;

    try {
      switch (action) {
        // -------------------------------------------------------------------
        case "navigate": {
          if (!url) return JSON.stringify({ error: "url is required for navigate" });
          if (!/^https?:\/\//i.test(url)) return JSON.stringify({ error: "URL must start with http:// or https://" });
          await page.goto(url, { timeout: NAV_TIMEOUT, waitUntil: "networkidle" });
          const title = await page.title();
          const result: Record<string, unknown> = { ok: true, action: "navigate", url: page.url(), title };
          if (includeScreenshot) Object.assign(result, await captureScreenshot(page, config, fullPage));
          return JSON.stringify(result);
        }

        // -------------------------------------------------------------------
        case "click": {
          if (!selector) return JSON.stringify({ error: "selector is required for click" });
          await page.click(selector, { timeout });
          await page.waitForTimeout(500); // Brief settle after click
          const result: Record<string, unknown> = { ok: true, action: "click", selector, url: page.url() };
          if (includeScreenshot) Object.assign(result, await captureScreenshot(page, config, fullPage));
          return JSON.stringify(result);
        }

        // -------------------------------------------------------------------
        case "type": {
          if (!text) return JSON.stringify({ error: "text is required for type" });
          if (selector) {
            await page.type(selector, text, { delay: 50 });
          } else {
            // Type into currently focused element via keyboard
            await page.evaluate(`document.activeElement?.dispatchEvent(new Event('input', {bubbles:true}))`);
            await page.type("body", text, { delay: 50 });
          }
          const result: Record<string, unknown> = { ok: true, action: "type", selector: selector || "(focused)", text: text.slice(0, 100) };
          if (includeScreenshot) Object.assign(result, await captureScreenshot(page, config, fullPage));
          return JSON.stringify(result);
        }

        // -------------------------------------------------------------------
        case "fill": {
          if (!selector) return JSON.stringify({ error: "selector is required for fill" });
          await page.fill(selector, value);
          const result: Record<string, unknown> = { ok: true, action: "fill", selector, value: value.slice(0, 100) };
          if (includeScreenshot) Object.assign(result, await captureScreenshot(page, config, fullPage));
          return JSON.stringify(result);
        }

        // -------------------------------------------------------------------
        case "select": {
          if (!selector) return JSON.stringify({ error: "selector is required for select" });
          if (!value) return JSON.stringify({ error: "value is required for select" });
          const selected = await page.selectOption(selector, value);
          const result: Record<string, unknown> = { ok: true, action: "select", selector, selected };
          if (includeScreenshot) Object.assign(result, await captureScreenshot(page, config, fullPage));
          return JSON.stringify(result);
        }

        // -------------------------------------------------------------------
        case "screenshot": {
          const shot = await captureScreenshot(page, config, fullPage);
          return JSON.stringify({ ok: true, action: "screenshot", url: page.url(), ...shot });
        }

        // -------------------------------------------------------------------
        case "read_text": {
          let content: string;
          if (selector) {
            content = await page.innerText(selector);
          } else {
            content = await page.innerText("body");
          }
          // Cap at 32KB
          if (content.length > 32_768) content = content.slice(0, 32_768) + "\n[Truncated]";
          return JSON.stringify({ ok: true, action: "read_text", selector: selector || "body", content, url: page.url() });
        }

        // -------------------------------------------------------------------
        case "read_html": {
          if (!selector) return JSON.stringify({ error: "selector is required for read_html" });
          const html = await page.innerHTML(selector);
          const capped = html.length > 32_768 ? html.slice(0, 32_768) + "\n<!-- Truncated -->" : html;
          return JSON.stringify({ ok: true, action: "read_html", selector, html: capped });
        }

        // -------------------------------------------------------------------
        case "evaluate": {
          if (!script) return JSON.stringify({ error: "script is required for evaluate" });
          const evalResult = await page.evaluate(script);
          return JSON.stringify({ ok: true, action: "evaluate", result: evalResult });
        }

        // -------------------------------------------------------------------
        case "wait": {
          if (selector) {
            await page.waitForSelector(selector, { timeout, state: "visible" });
            return JSON.stringify({ ok: true, action: "wait", selector, found: true });
          }
          const ms = typeof input.ms === "number" ? Math.min(input.ms, 30_000) : 1000;
          await page.waitForTimeout(ms);
          return JSON.stringify({ ok: true, action: "wait", ms });
        }

        // -------------------------------------------------------------------
        case "close": {
          try { await session.browser.close(); } catch {}
          sessions.delete(sessionKey);
          return JSON.stringify({ ok: true, action: "close" });
        }

        default:
          return JSON.stringify({ error: `Unknown action: ${action}. Valid: open, navigate, click, type, fill, select, screenshot, read_text, read_html, evaluate, wait, close` });
      }
    } catch (err) {
      const result: Record<string, unknown> = { error: `${action} failed: ${errMsg(err)}`, action };
      // Try to capture screenshot on error for debugging
      try {
        if (includeScreenshot) Object.assign(result, await captureScreenshot(page, config, fullPage));
      } catch {}
      return JSON.stringify(result);
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function captureScreenshot(
  page: PwPage,
  config: BrowserSessionConfig,
  fullPage: boolean,
): Promise<{ screenshotId: string; imageSessionId: string; imageType: string; sizeBytes: number }> {
  const buffer = await page.screenshot({ type: "png", fullPage });
  const base64 = buffer.toString("base64");
  const imageId = ulid();
  const imageSessionId = "_screengrabs";
  config.imageBlobStore.save(imageSessionId, imageId, "image/png", base64, "screengrab");
  return { screenshotId: imageId, imageSessionId, imageType: "screengrab", sizeBytes: buffer.length };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Manifest + Schema
// ---------------------------------------------------------------------------

export const BROWSER_SESSION_MANIFEST = {
  name: "browser_session",
  description:
    "Persistent browser session for web interaction. Actions: " +
    "open (launch + navigate), navigate, click, type, fill, select, " +
    "screenshot, read_text, read_html, evaluate (run JS), wait, close. " +
    "Session stays open across tool calls. Screenshots auto-captured on most actions.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const BROWSER_SESSION_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["open", "navigate", "click", "type", "fill", "select", "screenshot", "read_text", "read_html", "evaluate", "wait", "close"],
      description: "Browser action to perform",
    },
    url: {
      type: "string",
      description: "URL for open/navigate actions (http:// or https://)",
    },
    selector: {
      type: "string",
      description: "CSS selector for click, fill, select, read_text, read_html, wait actions",
    },
    text: {
      type: "string",
      description: "Text to type (for type action)",
    },
    value: {
      type: "string",
      description: "Value for fill or select actions",
    },
    script: {
      type: "string",
      description: "JavaScript to evaluate in page context (for evaluate action)",
    },
    viewport: {
      type: "object",
      properties: {
        width: { type: "number", description: "Viewport width (default: 1280)" },
        height: { type: "number", description: "Viewport height (default: 720)" },
      },
      description: "Viewport size (for open action)",
    },
    fullPage: {
      type: "boolean",
      description: "Capture full scrollable page in screenshots (default: false)",
    },
    includeScreenshot: {
      type: "boolean",
      description: "Include screenshot with action result (default: true)",
    },
    timeout: {
      type: "number",
      description: "Timeout in ms for actions like click, wait (default: 10000)",
    },
    ms: {
      type: "number",
      description: "Milliseconds to wait (for wait action without selector, max 30000)",
    },
  },
  required: ["action"],
};
