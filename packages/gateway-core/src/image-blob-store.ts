/**
 * ImageBlobStore — file-backed storage for chat image blobs.
 *
 * Stores base64-encoded images at ~/.agi/chat-images/{sessionId}/{imageId}.b64
 * with the mediaType (and optional imageType) on the first line and base64 data
 * on the second. Keeps image data out of session JSON (which would bloat 1-4MB
 * per image).
 *
 * Image types:
 *   - "chat"      — user-pasted images in conversation (default)
 *   - "screengrab" — screenshots from visual-inspect / Playwright
 *   - "test"      — test result images
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type ImageType = "chat" | "screengrab" | "test";

const KNOWN_IMAGE_TYPES = new Set<string>(["chat", "screengrab", "test"]);

export interface ImageBlob {
  mediaType: string;
  data: string;
  imageType: ImageType;
}

export class ImageBlobStore {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), ".agi", "chat-images");
  }

  /** Get the base directory path. */
  getBaseDir(): string {
    return this.baseDir;
  }

  /** Save an image blob to disk. */
  save(sessionId: string, imageId: string, mediaType: string, base64Data: string, imageType?: ImageType): void {
    const dir = join(this.baseDir, sessionId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    // Format: line 1 = mediaType[:imageType], line 2 = base64 data
    // Backward compatible: entries without :imageType default to "chat" on load
    const header = imageType && imageType !== "chat" ? `${mediaType}:${imageType}` : mediaType;
    writeFileSync(join(dir, `${imageId}.b64`), `${header}\n${base64Data}`, "utf-8");
  }

  /** Load an image blob from disk. Returns null if the file is missing or corrupt. */
  load(sessionId: string, imageId: string): ImageBlob | null {
    const filePath = join(this.baseDir, sessionId, `${imageId}.b64`);
    if (!existsSync(filePath)) return null;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const newlineIdx = raw.indexOf("\n");
      if (newlineIdx === -1) return null;

      const header = raw.slice(0, newlineIdx);
      const data = raw.slice(newlineIdx + 1);

      // Parse header: "image/png" or "image/png:screengrab"
      const lastColon = header.lastIndexOf(":");
      let mediaType: string;
      let imageType: ImageType = "chat";

      if (lastColon > 0) {
        const suffix = header.slice(lastColon + 1);
        if (KNOWN_IMAGE_TYPES.has(suffix)) {
          mediaType = header.slice(0, lastColon);
          imageType = suffix as ImageType;
        } else {
          // Colon is part of the mediaType (e.g., shouldn't happen for images but be safe)
          mediaType = header;
        }
      } else {
        mediaType = header;
      }

      return { mediaType, data, imageType };
    } catch {
      return null;
    }
  }

  /** Delete all image blobs for a session. */
  deleteSession(sessionId: string): void {
    const dir = join(this.baseDir, sessionId);
    if (!existsSync(dir)) return;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Non-fatal — orphaned images will be cleaned up by the garbage collector.
    }
  }

  /** List all image IDs stored for a session. */
  listImages(sessionId: string): string[] {
    const dir = join(this.baseDir, sessionId);
    if (!existsSync(dir)) return [];
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith(".b64"))
        .map((f) => f.replace(/\.b64$/, ""));
    } catch {
      return [];
    }
  }

  /** List image IDs filtered by type. */
  listByType(sessionId: string, imageType: ImageType): string[] {
    return this.listImages(sessionId).filter((id) => {
      const blob = this.load(sessionId, id);
      return blob !== null && blob.imageType === imageType;
    });
  }

  /** List all session IDs that have image directories (for GC orphan detection). */
  listSessionDirs(): string[] {
    if (!existsSync(this.baseDir)) return [];
    try {
      return readdirSync(this.baseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [];
    }
  }
}
