/**
 * HfHubClient — HuggingFace Hub REST API client
 *
 * Wraps the HuggingFace Hub HTTP API using native fetch() — NO npm dependency.
 * Supports model search, metadata lookup, file listing, streaming downloads
 * (with resume), and access/auth checks.
 *
 * Base URL: https://huggingface.co
 */

import { createWriteStream, existsSync, statSync, renameSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  HfModelInfo,
  HfSearchParams,
  HfFileSibling,
  DownloadProgress,
  HfDatasetInfo,
  HfDatasetSearchParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// Local interface (not in shared types.ts)
// ---------------------------------------------------------------------------

export interface DownloadFileOptions {
  modelId: string;
  revision?: string;
  filename: string;
  destPath: string;
  onProgress?: (progress: DownloadProgress) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://huggingface.co";
const USER_AGENT = "aionima/0.1.0";
const PROGRESS_THROTTLE_MS = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// HfHubClient
// ---------------------------------------------------------------------------

export class HfHubClient {
  private readonly baseUrl: string;
  private readonly apiToken: string | undefined;

  constructor(options?: { apiToken?: string; baseUrl?: string }) {
    this.baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
    this.apiToken = options?.apiToken;
  }

  // ---------------------------------------------------------------------------
  // Private: fetchWithRetry
  // ---------------------------------------------------------------------------

  /**
   * Wraps native fetch with:
   * - Authorization header injection (when token is set)
   * - User-Agent header
   * - 429 rate-limit handling (retry-after header respected)
   * - 5xx exponential backoff
   * - Immediate throw on 4xx (except 429)
   */
  private async fetchWithRetry(
    url: string,
    init?: RequestInit,
    retries = 3,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (this.apiToken) {
      headers["Authorization"] = `Bearer ${this.apiToken}`;
    }

    const mergedInit: RequestInit = { ...init, headers };

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let resp: Response;
      try {
        resp = await fetch(url, mergedInit);
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }

      // Rate limited — respect Retry-After, then retry
      if (resp.status === 429) {
        if (attempt >= retries) {
          throw new Error(`HuggingFace Hub rate limit exceeded after ${String(retries)} retries: ${url}`);
        }
        const retryAfter = resp.headers.get("Retry-After");
        const waitMs = retryAfter ? Number(retryAfter) * 1000 : 1000 * Math.pow(2, attempt);
        await sleep(waitMs);
        continue;
      }

      // Server error — exponential backoff
      if (resp.status >= 500) {
        lastError = new Error(`HuggingFace Hub server error: HTTP ${String(resp.status)} for ${url}`);
        if (attempt < retries) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        throw lastError;
      }

      // Client error (4xx, not 429) — fail immediately
      if (resp.status >= 400) {
        throw new Error(`HuggingFace Hub error: HTTP ${String(resp.status)} for ${url}`);
      }

      return resp;
    }

    throw lastError ?? new Error(`HuggingFace Hub request failed after ${String(retries)} retries: ${url}`);
  }

  // ---------------------------------------------------------------------------
  // searchModels
  // ---------------------------------------------------------------------------

  /**
   * Search the HuggingFace Hub model catalog.
   *
   * Maps HfSearchParams to query string parameters and returns parsed results.
   */
  async searchModels(params: HfSearchParams): Promise<HfModelInfo[]> {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.pipeline_tag) qs.set("pipeline_tag", params.pipeline_tag);
    if (params.library) qs.set("library", params.library);
    if (params.sort) qs.set("sort", params.sort);
    if (params.direction) qs.set("direction", params.direction);
    if (params.filter) qs.set("filter", params.filter);
    qs.set("limit", String(params.limit ?? 20));
    qs.set("offset", String(params.offset ?? 0));

    const url = `${this.baseUrl}/api/models?${qs.toString()}`;
    const resp = await this.fetchWithRetry(url);
    return (await resp.json()) as HfModelInfo[];
  }

  // ---------------------------------------------------------------------------
  // getModelInfo
  // ---------------------------------------------------------------------------

  /**
   * Fetch full model metadata including file siblings.
   *
   * modelId contains slashes (e.g. "meta-llama/Llama-3.1-8B-Instruct") and
   * must be URL-encoded to avoid the path being split by the slash.
   */
  async getModelInfo(modelId: string): Promise<HfModelInfo> {
    // HuggingFace API accepts the slash in the path — encode only the parts,
    // not the separator, since the API route is /api/models/{org}/{name}.
    const encodedId = modelId.split("/").map(encodeURIComponent).join("/");
    const url = `${this.baseUrl}/api/models/${encodedId}`;
    const resp = await this.fetchWithRetry(url);
    return (await resp.json()) as HfModelInfo;
  }

  // ---------------------------------------------------------------------------
  // getModelFiles
  // ---------------------------------------------------------------------------

  /**
   * Return the full file listing for a model repository.
   *
   * The tree endpoint is paginated. This method follows Link headers to collect
   * all pages before returning.
   */
  async getModelFiles(modelId: string, revision?: string): Promise<HfFileSibling[]> {
    const encodedId = modelId.split("/").map(encodeURIComponent).join("/");
    const rev = revision ?? "main";
    const startUrl = `${this.baseUrl}/api/models/${encodedId}/tree/${encodeURIComponent(rev)}`;

    const files: HfFileSibling[] = [];
    let nextUrl: string | null = startUrl;

    while (nextUrl !== null) {
      const resp = await this.fetchWithRetry(nextUrl);
      // Tree API returns { path, size, type, ... } — map `path` to `rfilename`
      const raw = (await resp.json()) as Array<{ path?: string; rfilename?: string; size?: number; blobId?: string; lfs?: { sha256: string; size: number; pointerSize: number } }>;
      const page: HfFileSibling[] = raw.map((f) => ({
        rfilename: f.rfilename ?? f.path ?? "",
        size: f.size ?? f.lfs?.size,
        blobId: f.blobId,
        lfs: f.lfs,
      }));
      files.push(...page);

      // Follow pagination via Link header: <url>; rel="next"
      const linkHeader = resp.headers.get("Link");
      nextUrl = parseLinkNext(linkHeader);
    }

    return files;
  }

  // ---------------------------------------------------------------------------
  // downloadFile
  // ---------------------------------------------------------------------------

  /**
   * Stream a single model file to disk with progress reporting.
   *
   * Features:
   * - Resumable: if a .part file already exists, sends a Range header to
   *   continue from the last byte.
   * - Progress: calls onProgress at most once every PROGRESS_THROTTLE_MS ms
   *   with bytes downloaded, speed, and ETA.
   * - Verification: confirms final file size matches Content-Length.
   * - Atomic: writes to <destPath>.part, renames to destPath on completion.
   * - Redirects: native fetch follows redirects automatically (CDN URLs).
   */
  async downloadFile(options: DownloadFileOptions): Promise<void> {
    const { modelId, filename, destPath, onProgress } = options;
    const revision = options.revision ?? "main";

    const encodedId = modelId.split("/").map(encodeURIComponent).join("/");
    const encodedFilename = filename.split("/").map(encodeURIComponent).join("/");
    const url = `${this.baseUrl}/${encodedId}/resolve/${encodeURIComponent(revision)}/${encodedFilename}`;

    const partPath = `${destPath}.part`;

    // Ensure destination directory exists
    await mkdir(dirname(destPath), { recursive: true });

    // Check for existing partial download
    let resumeFrom = 0;
    if (existsSync(partPath)) {
      resumeFrom = statSync(partPath).size;
    }

    const extraHeaders: Record<string, string> = {};
    if (resumeFrom > 0) {
      extraHeaders["Range"] = `bytes=${String(resumeFrom)}-`;
    }

    const resp = await this.fetchWithRetry(url, { headers: extraHeaders });

    if (!resp.body) {
      throw new Error(`HuggingFace Hub: no response body for ${url}`);
    }

    // Determine total file size from headers
    const contentLength = resp.headers.get("Content-Length");
    const contentRange = resp.headers.get("Content-Range");

    let totalBytes = 0;
    if (contentRange) {
      // Content-Range: bytes 1024-2047/4096
      const match = /\/(\d+)$/.exec(contentRange);
      if (match?.[1]) totalBytes = Number(match[1]);
    } else if (contentLength) {
      totalBytes = resumeFrom + Number(contentLength);
    }

    const startedAt = new Date().toISOString();
    let downloadedBytes = resumeFrom;
    let lastProgressAt = 0;
    let lastBytesSnapshot = resumeFrom;
    let lastSnapshotTime = Date.now();

    const writeStream = createWriteStream(partPath, {
      flags: resumeFrom > 0 ? "a" : "w",
    });

    const reader = resp.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Write chunk synchronously via promise wrapper
        await new Promise<void>((resolve, reject) => {
          writeStream.write(value, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        downloadedBytes += value.byteLength;

        // Throttled progress reporting
        if (onProgress) {
          const now = Date.now();
          if (now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
            const elapsedMs = now - lastSnapshotTime;
            const bytesSinceSnapshot = downloadedBytes - lastBytesSnapshot;
            const speedBps = elapsedMs > 0 ? (bytesSinceSnapshot / elapsedMs) * 1000 : 0;
            const remaining = totalBytes > 0 ? totalBytes - downloadedBytes : 0;
            const etaSeconds = speedBps > 0 ? remaining / speedBps : 0;

            onProgress({
              modelId,
              filename,
              totalBytes,
              downloadedBytes,
              speedBps,
              etaSeconds,
              startedAt,
            });

            lastProgressAt = now;
            lastBytesSnapshot = downloadedBytes;
            lastSnapshotTime = now;
          }
        }
      }
    } finally {
      // Always close the write stream
      await new Promise<void>((resolve, reject) => {
        writeStream.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    // Verify final size when Content-Length was provided
    if (totalBytes > 0) {
      const actualSize = statSync(partPath).size;
      if (actualSize !== totalBytes) {
        throw new Error(
          `HuggingFace Hub: download size mismatch for ${filename}: ` +
          `expected ${String(totalBytes)} bytes, got ${String(actualSize)} bytes`,
        );
      }
    }

    // Atomic rename: .part -> final path
    renameSync(partPath, destPath);

    // Final progress call at 100%
    if (onProgress) {
      onProgress({
        modelId,
        filename,
        totalBytes,
        downloadedBytes,
        speedBps: 0,
        etaSeconds: 0,
        startedAt,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // searchDatasets
  // ---------------------------------------------------------------------------

  /**
   * Search the HuggingFace Hub dataset catalog.
   *
   * Maps HfDatasetSearchParams to query string parameters and returns parsed results.
   */
  async searchDatasets(params: HfDatasetSearchParams): Promise<HfDatasetInfo[]> {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.sort) qs.set("sort", params.sort);
    if (params.direction) qs.set("direction", params.direction);
    if (params.filter) qs.set("filter", params.filter);
    qs.set("limit", String(params.limit ?? 20));
    qs.set("offset", String(params.offset ?? 0));

    const url = `${this.baseUrl}/api/datasets?${qs.toString()}`;
    const resp = await this.fetchWithRetry(url);
    return (await resp.json()) as HfDatasetInfo[];
  }

  // ---------------------------------------------------------------------------
  // getDatasetInfo
  // ---------------------------------------------------------------------------

  /**
   * Fetch full dataset metadata including file siblings.
   *
   * datasetId contains slashes (e.g. "HuggingFaceH4/ultrachat_200k") and
   * must be URL-encoded to avoid the path being split by the slash.
   */
  async getDatasetInfo(datasetId: string): Promise<HfDatasetInfo> {
    const encodedId = datasetId.split("/").map(encodeURIComponent).join("/");
    const url = `${this.baseUrl}/api/datasets/${encodedId}`;
    const resp = await this.fetchWithRetry(url);
    return (await resp.json()) as HfDatasetInfo;
  }

  // ---------------------------------------------------------------------------
  // getDatasetFiles
  // ---------------------------------------------------------------------------

  /**
   * Return the full file listing for a dataset repository.
   *
   * The tree endpoint is paginated. This method follows Link headers to collect
   * all pages before returning. Same tree API as models but /api/datasets/ prefix.
   */
  async getDatasetFiles(datasetId: string, revision?: string): Promise<HfFileSibling[]> {
    const encodedId = datasetId.split("/").map(encodeURIComponent).join("/");
    const rev = revision ?? "main";
    const startUrl = `${this.baseUrl}/api/datasets/${encodedId}/tree/${encodeURIComponent(rev)}`;

    const files: HfFileSibling[] = [];
    let nextUrl: string | null = startUrl;

    while (nextUrl !== null) {
      const resp = await this.fetchWithRetry(nextUrl);
      // Tree API returns { path, size, type, ... } — map `path` to `rfilename`
      const raw = (await resp.json()) as Array<{ path?: string; rfilename?: string; size?: number; blobId?: string; lfs?: { sha256: string; size: number; pointerSize: number } }>;
      const page: HfFileSibling[] = raw.map((f) => ({
        rfilename: f.rfilename ?? f.path ?? "",
        size: f.size ?? f.lfs?.size,
        blobId: f.blobId,
        lfs: f.lfs,
      }));
      files.push(...page);

      // Follow pagination via Link header: <url>; rel="next"
      const linkHeader = resp.headers.get("Link");
      nextUrl = parseLinkNext(linkHeader);
    }

    return files;
  }

  // ---------------------------------------------------------------------------
  // checkModelAccess
  // ---------------------------------------------------------------------------

  /**
   * Probe whether the current token can access a model's files.
   *
   * Uses HEAD to avoid downloading the file. Returns:
   * - accessible=true  when HTTP 200 (or 206 partial)
   * - accessible=false when HTTP 401/403
   * - gated=true       when model info reports gating
   */
  async checkModelAccess(
    modelId: string,
  ): Promise<{ accessible: boolean; gated: boolean; reason?: string }> {
    const encodedId = modelId.split("/").map(encodeURIComponent).join("/");
    const url = `${this.baseUrl}/${encodedId}/resolve/main/config.json`;

    let accessible = false;
    let reason: string | undefined;

    try {
      // Use fetch directly here — fetchWithRetry throws on 4xx
      const headers: Record<string, string> = { "User-Agent": USER_AGENT };
      if (this.apiToken) headers["Authorization"] = `Bearer ${this.apiToken}`;

      const resp = await fetch(url, { method: "HEAD", headers });

      if (resp.status === 200 || resp.status === 206) {
        accessible = true;
      } else if (resp.status === 401) {
        reason = "Authentication required — provide an API token";
      } else if (resp.status === 403) {
        reason = "Access denied — model may require approval (gated)";
      } else {
        reason = `Unexpected status: HTTP ${String(resp.status)}`;
      }
    } catch (err) {
      reason = err instanceof Error ? err.message : "Network error";
    }

    // Check gating from model info (best-effort — don't fail on error)
    let gated = false;
    try {
      const info = await this.getModelInfo(modelId);
      gated = info.gated === true || info.gated === "manual" || info.gated === "auto";
    } catch {
      // Ignore — we may not have access to model info either
    }

    return { accessible, gated, reason };
  }

  // ---------------------------------------------------------------------------
  // getAuthStatus
  // ---------------------------------------------------------------------------

  /**
   * Verify the stored API token against the HuggingFace whoami endpoint.
   *
   * Returns authenticated=false if no token is configured or the token is
   * invalid (401/403).
   */
  async getAuthStatus(): Promise<{ authenticated: boolean; username?: string }> {
    if (!this.apiToken) {
      return { authenticated: false };
    }

    const url = `${this.baseUrl}/api/whoami-v2`;

    try {
      const resp = await this.fetchWithRetry(url);
      const data = (await resp.json()) as { name?: string; fullname?: string };
      return { authenticated: true, username: data.name ?? data.fullname };
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("HTTP 401") || err.message.includes("HTTP 403"))
      ) {
        return { authenticated: false };
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

/**
 * Parse the "next" URL from an HTTP Link header.
 *
 * Link header format: <https://...>; rel="next", <https://...>; rel="prev"
 *
 * Returns null if no next page is indicated.
 */
function parseLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  // Split on comma, but be careful about commas inside angle brackets
  const parts = linkHeader.split(/,\s*(?=<)/);
  for (const part of parts) {
    const match = /^<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (match?.[1]) return match[1];
  }

  return null;
}
