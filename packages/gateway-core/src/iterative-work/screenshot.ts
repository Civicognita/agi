/**
 * iterative-work/screenshot — Playwright-driven artifact capture (s124 t469).
 *
 * After every successful iterative-work iteration, capture a full-page
 * screenshot of the project's deployed URL via headless Chromium (using
 * Playwright, already in deps for e2e — no new package). Saved to
 * ~/.agi/thumbs/iter-<id>.png. The thumbnail path lands on the
 * IterativeWorkArtifact.thumbnailPath field, which flows through the
 * notification → IterativeWorkArtifactCard render path.
 *
 * Failure modes (no thumbnail produced; iteration still completes):
 *   - Project has no hosting URL configured (no domain to navigate to)
 *   - Headless launch fails (OOM, missing chromium binary, etc)
 *   - Page error / 4xx / 5xx / network timeout
 *   - Filesystem write fails
 *
 * All failures degrade to `null` return; the caller treats null as "no
 * thumbnail this iteration" and the artifact's thumbnailPath stays
 * undefined. The IterativeWorkArtifactCard handles missing thumbnails
 * gracefully (no image element rendered).
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { ulid } from "ulid";

export interface CaptureOptions {
  /** Absolute URL to capture. The hosting layer provides
   *  `https://<hostname>.<baseDomain>` per project config. */
  hostingUrl: string;
  /** Override the thumbs dir (testing). Defaults to ~/.agi/thumbs. */
  thumbsDir?: string;
  /** Browser viewport — controls the captured surface size. */
  viewport?: { width: number; height: number };
  /** Page-load timeout in ms. Default 10s — short enough to not block
   *  the next iteration's fire if the deployed URL is slow. */
  timeoutMs?: number;
  /** Logger for failure diagnostics. Caller passes the gateway's log.warn. */
  log?: (msg: string) => void;
}

/**
 * Capture the project's deployed URL via headless Chromium. Returns the
 * absolute path of the saved PNG, or null when capture failed.
 */
export async function captureProjectScreenshot(opts: CaptureOptions): Promise<string | null> {
  const thumbsDir = opts.thumbsDir ?? join(homedir(), ".agi", "thumbs");
  const viewport = opts.viewport ?? { width: 1280, height: 720 };
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const log = opts.log ?? ((): void => {});

  try {
    await mkdir(thumbsDir, { recursive: true });
  } catch (err) {
    log(`thumbs dir create failed (${thumbsDir}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const id = ulid();
  const filePath = join(thumbsDir, `iter-${id}.png`);

  // Dynamic import keeps Playwright out of the boot path — only loaded
  // when an iteration actually wants to capture. Avoids extending boot
  // time on installs where playwright deps are missing.
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    log(`playwright import failed (likely missing browser binary): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  let browser: import("playwright").Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(opts.hostingUrl, { waitUntil: "networkidle", timeout: timeoutMs });
    await page.screenshot({ path: filePath, fullPage: false });
    return filePath;
  } catch (err) {
    log(`screenshot capture failed for ${opts.hostingUrl}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    if (browser !== undefined) {
      await browser.close().catch(() => {
        // Best-effort cleanup; orphaned browsers will be reaped by Chromium itself eventually.
      });
    }
  }
}
