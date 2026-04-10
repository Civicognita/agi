/**
 * get_web_page tool — fetch and sanitize web page content for the agent.
 *
 * Strips HTML, extracts title/meta, scans for prompt injection and
 * malicious payloads before returning content to the agent.
 *
 * Requires state ONLINE, tier verified/sealed.
 */

import { scanWebContent, capToolResult } from "../sanitizer.js";
import type { ToolHandler } from "../tool-registry.js";

const FETCH_TIMEOUT_MS = 15_000;
const RAW_LIMIT_BYTES = 512 * 1024; // 512KB max raw fetch
const OUTPUT_CAP_BYTES = 32_768; // 32KB output cap

const ALLOWED_SCHEMES = /^https?:\/\//i;
const BLOCKED_SCHEMES = /^(?:file|javascript|data|ftp|blob):/i;

export function createGetWebPageHandler(): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const url = String(input.url ?? "").trim();
    if (url.length === 0) {
      return JSON.stringify({ error: "url is required" });
    }

    // Validate URL scheme
    if (BLOCKED_SCHEMES.test(url)) {
      return JSON.stringify({ error: `Blocked URL scheme. Only http:// and https:// are allowed.` });
    }
    if (!ALLOWED_SCHEMES.test(url)) {
      return JSON.stringify({ error: `Invalid URL. Must start with http:// or https://` });
    }

    // Fetch with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let rawHtml: string;
    let statusCode: number;
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Aionima/1.0 (AGI Gateway)",
          "Accept": "text/html, application/xhtml+xml, text/plain",
        },
        redirect: "follow",
      });
      statusCode = response.status;

      if (!response.ok) {
        return JSON.stringify({ error: `HTTP ${statusCode}: ${response.statusText}`, url });
      }

      // Check content length before reading
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > RAW_LIMIT_BYTES) {
        return JSON.stringify({ error: `Response too large (${contentLength} bytes). Limit: ${RAW_LIMIT_BYTES} bytes.`, url });
      }

      rawHtml = await response.text();

      // Enforce raw limit after reading (in case content-length header was missing)
      if (new TextEncoder().encode(rawHtml).length > RAW_LIMIT_BYTES) {
        rawHtml = rawHtml.slice(0, RAW_LIMIT_BYTES);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return JSON.stringify({ error: `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`, url });
      }
      return JSON.stringify({ error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`, url });
    } finally {
      clearTimeout(timeout);
    }

    // Strip HTML, sanitize, scan for injection
    const { title, metaDescription, content, wasInjectionBlocked } = scanWebContent(rawHtml);

    // Cap output size
    const { content: cappedContent, wasTruncated } = capToolResult(content, OUTPUT_CAP_BYTES);

    return JSON.stringify({
      url,
      title,
      metaDescription,
      content: cappedContent,
      truncated: wasTruncated,
      wasInjectionBlocked,
    });
  };
}

export const GET_WEB_PAGE_MANIFEST = {
  name: "get_web_page",
  description:
    "Fetch and read web page content. Strips HTML, scripts, and styles. " +
    "Scans for prompt injection and malicious payloads. " +
    "Returns sanitized text, page title, and meta description.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
  sizeCapBytes: OUTPUT_CAP_BYTES,
};

export const GET_WEB_PAGE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description: "URL to fetch (http:// or https:// only)",
    },
  },
  required: ["url"],
};
