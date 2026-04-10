/**
 * ImageBlobStore — file-backed storage for chat image blobs.
 *
 * Stores base64-encoded images at ~/.agi/chat-images/{sessionId}/{imageId}.b64
 * with the mediaType on the first line and base64 data on the second.
 * Keeps image data out of session JSON (which would bloat 1-4MB per image).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ImageBlob {
  mediaType: string;
  data: string;
}

export class ImageBlobStore {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), ".agi", "chat-images");
  }

  /** Save an image blob to disk. */
  save(sessionId: string, imageId: string, mediaType: string, base64Data: string): void {
    const dir = join(this.baseDir, sessionId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    // Format: line 1 = mediaType, line 2 = base64 data
    writeFileSync(join(dir, `${imageId}.b64`), `${mediaType}\n${base64Data}`, "utf-8");
  }

  /** Load an image blob from disk. Returns null if the file is missing or corrupt. */
  load(sessionId: string, imageId: string): ImageBlob | null {
    const filePath = join(this.baseDir, sessionId, `${imageId}.b64`);
    if (!existsSync(filePath)) return null;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const newlineIdx = raw.indexOf("\n");
      if (newlineIdx === -1) return null;
      return {
        mediaType: raw.slice(0, newlineIdx),
        data: raw.slice(newlineIdx + 1),
      };
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
      // Non-fatal — orphaned images will be cleaned up eventually.
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
}
