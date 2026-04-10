/**
 * visual_inspect tool — take screenshots of web pages using Playwright.
 *
 * Launches headless Chromium, navigates to a URL, captures a screenshot,
 * and saves it to the ImageBlobStore as a "screengrab" type image.
 * The screenshot reference is returned so the dashboard can render a thumbnail.
 *
 * Playwright is dynamically imported — if not installed, the tool returns
 * a helpful error instead of crashing.
 *
 * Requires state ONLINE, tier verified/sealed.
 */

import { ulid } from "ulid";
import type { ToolHandler } from "../tool-registry.js";
import type { ImageBlobStore } from "../image-blob-store.js";

export interface VisualInspectConfig {
  imageBlobStore: ImageBlobStore;
}

const ALLOWED_URL = /^https?:\/\//i;
const LOCALHOST_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i;
const NAV_TIMEOUT_MS = 30_000;
const SELECTOR_TIMEOUT_MS = 10_000;

export function createVisualInspectHandler(config: VisualInspectConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const url = String(input.url ?? "").trim();
    if (url.length === 0) {
      return JSON.stringify({ error: "url is required" });
    }

    // Validate URL — allow http(s) and localhost
    if (!ALLOWED_URL.test(url) && !LOCALHOST_URL.test(url)) {
      return JSON.stringify({ error: "Invalid URL. Must start with http:// or https://" });
    }

    const selector = input.selector ? String(input.selector).trim() : undefined;
    const viewportWidth = (input.viewport as { width?: number } | undefined)?.width ?? 1280;
    const viewportHeight = (input.viewport as { height?: number } | undefined)?.height ?? 720;
    const fullPage = input.fullPage === true;

    // Dynamic import — Playwright may not be installed at runtime
    let chromium: { launch(opts: { headless: boolean }): Promise<PlaywrightBrowser> };
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pw = await (Function('return import("playwright")')() as Promise<{ chromium: typeof chromium }>);
      chromium = pw.chromium;
    } catch {
      return JSON.stringify({
        error: "Playwright is not installed. Install it with: npx playwright install chromium",
      });
    }

    let browser: PlaywrightBrowser | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.setViewportSize({ width: viewportWidth, height: viewportHeight });
      await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: "networkidle" });

      let screenshotBuffer: Buffer;

      if (selector) {
        // Wait for the selector and screenshot that element
        const element = await page.waitForSelector(selector, { timeout: SELECTOR_TIMEOUT_MS });
        if (!element) {
          return JSON.stringify({ error: `Selector "${selector}" not found on page` });
        }
        screenshotBuffer = await element.screenshot({ type: "png" }) as Buffer;
      } else {
        // Full page or viewport screenshot
        screenshotBuffer = await page.screenshot({ type: "png", fullPage }) as Buffer;
      }

      const base64 = screenshotBuffer.toString("base64");
      const imageId = ulid();

      // Use a dedicated session key for screengrabs (not tied to a chat session)
      const sessionId = "_screengrabs";

      config.imageBlobStore.save(sessionId, imageId, "image/png", base64, "screengrab");

      return JSON.stringify({
        screenshotId: imageId,
        imageType: "screengrab",
        sessionId,
        url,
        viewport: { width: viewportWidth, height: viewportHeight },
        fullPage,
        selector: selector ?? null,
        timestamp: new Date().toISOString(),
        sizeBytes: screenshotBuffer.length,
      });
    } catch (err) {
      return JSON.stringify({
        error: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
        url,
      });
    } finally {
      if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
      }
    }
  };
}

// Minimal Playwright type stubs for dynamic import
interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightPage {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  goto(url: string, opts: { timeout: number; waitUntil: string }): Promise<void>;
  screenshot(opts: { type: string; fullPage?: boolean }): Promise<Buffer>;
  waitForSelector(selector: string, opts: { timeout: number }): Promise<PlaywrightElement | null>;
}

interface PlaywrightElement {
  screenshot(opts: { type: string }): Promise<Buffer>;
}

export const VISUAL_INSPECT_MANIFEST = {
  name: "visual_inspect",
  description:
    "Take a screenshot of a web page or local dev server using Playwright. " +
    "Returns a screenshot reference that appears as a thumbnail in chat. " +
    "Supports CSS selector targeting and custom viewports.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const VISUAL_INSPECT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description: "URL to screenshot (http://, https://, or localhost)",
    },
    selector: {
      type: "string",
      description: "CSS selector to screenshot a specific element (optional)",
    },
    viewport: {
      type: "object",
      properties: {
        width: { type: "number", description: "Viewport width in pixels (default: 1280)" },
        height: { type: "number", description: "Viewport height in pixels (default: 720)" },
      },
      description: "Custom viewport dimensions",
    },
    fullPage: {
      type: "boolean",
      description: "Capture the full scrollable page instead of just the viewport (default: false)",
    },
  },
  required: ["url"],
};
