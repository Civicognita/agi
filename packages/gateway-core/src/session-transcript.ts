/**
 * JSONL Transcript Persistence — Task #232
 *
 * Persist conversation history as JSONL files (one message per line).
 * Hash content to detect tampering.
 * Support per-turn history limits.
 * Repair malformed sequences on load (skip corrupted lines).
 * Survive bot restarts.
 *
 * @see openclaw/src/memory/session-files.ts
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single line in a JSONL transcript. */
export interface TranscriptLine {
  /** Sequence number (monotonic within transcript). */
  seq: number;
  /** Message role. */
  role: "user" | "assistant" | "system";
  /** Message content. */
  content: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** SHA-256 hash of (seq + role + content). */
  hash: string;
  /** Hash of the previous line (chain integrity). */
  prevHash: string;
  /** Optional metadata. */
  metadata?: Record<string, unknown>;
}

/** Transcript file metadata (stored in first line). */
export interface TranscriptHeader {
  type: "transcript_header";
  sessionKey: string;
  entityId: string;
  channel: string;
  createdAt: string;
  version: 1;
}

/** Result of loading and repairing a transcript. */
export interface TranscriptLoadResult {
  lines: TranscriptLine[];
  /** Lines that were skipped due to corruption. */
  skipped: number;
  /** Whether the hash chain was intact. */
  chainIntact: boolean;
  /** Total lines in file (before repair). */
  totalRaw: number;
}

/** Transcript configuration. */
export interface TranscriptConfig {
  /** Base directory for transcript files. */
  baseDir: string;
  /** Maximum turns to keep in memory (default: 200). */
  maxTurnsInMemory: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: TranscriptConfig = {
  baseDir: "",
  maxTurnsInMemory: 200,
};

const GENESIS_HASH = "0".repeat(64);

// ---------------------------------------------------------------------------
// TranscriptManager
// ---------------------------------------------------------------------------

export class TranscriptManager {
  private readonly config: TranscriptConfig;
  /** In-memory buffers keyed by session key. */
  private readonly buffers = new Map<string, TranscriptLine[]>();
  /** Current sequence numbers keyed by session key. */
  private readonly sequences = new Map<string, number>();
  /** Last hash keyed by session key. */
  private readonly lastHashes = new Map<string, string>();

  constructor(config: Partial<TranscriptConfig> & Pick<TranscriptConfig, "baseDir">) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (!existsSync(this.config.baseDir)) {
      mkdirSync(this.config.baseDir, { recursive: true });
    }
  }

  // ---------------------------------------------------------------------------
  // File path
  // ---------------------------------------------------------------------------

  /** Get the transcript file path for a session. */
  filePath(sessionKey: string): string {
    // Sanitize key for filesystem (colons are invalid on Windows)
    const safe = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.config.baseDir, `${safe}.jsonl`);
  }

  // ---------------------------------------------------------------------------
  // Initialize
  // ---------------------------------------------------------------------------

  /**
   * Initialize a transcript for a session.
   * Creates the file with a header if it doesn't exist.
   * Loads existing transcript and repairs if needed.
   */
  initialize(
    sessionKey: string,
    entityId: string,
    channel: string,
  ): TranscriptLoadResult {
    const path = this.filePath(sessionKey);

    if (existsSync(path)) {
      // Load and repair existing transcript
      const result = this.loadAndRepair(sessionKey);
      return result;
    }

    // Create new transcript with header
    const header: TranscriptHeader = {
      type: "transcript_header",
      sessionKey,
      entityId,
      channel,
      createdAt: new Date().toISOString(),
      version: 1,
    };

    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(path, JSON.stringify(header) + "\n", "utf-8");
    this.buffers.set(sessionKey, []);
    this.sequences.set(sessionKey, 0);
    this.lastHashes.set(sessionKey, GENESIS_HASH);

    return { lines: [], skipped: 0, chainIntact: true, totalRaw: 0 };
  }

  // ---------------------------------------------------------------------------
  // Append
  // ---------------------------------------------------------------------------

  /**
   * Append a message to a transcript.
   * Writes to file immediately and updates in-memory buffer.
   */
  append(
    sessionKey: string,
    role: "user" | "assistant" | "system",
    content: string,
    metadata?: Record<string, unknown>,
  ): TranscriptLine {
    const seq = (this.sequences.get(sessionKey) ?? 0) + 1;
    const prevHash = this.lastHashes.get(sessionKey) ?? GENESIS_HASH;
    const timestamp = new Date().toISOString();

    const hash = computeHash(seq, role, content, prevHash);

    const line: TranscriptLine = {
      seq,
      role,
      content,
      timestamp,
      hash,
      prevHash,
      metadata,
    };

    // Write to file
    const path = this.filePath(sessionKey);
    appendFileSync(path, JSON.stringify(line) + "\n", "utf-8");

    // Update state
    this.sequences.set(sessionKey, seq);
    this.lastHashes.set(sessionKey, hash);

    // Update in-memory buffer
    let buffer = this.buffers.get(sessionKey);
    if (buffer === undefined) {
      buffer = [];
      this.buffers.set(sessionKey, buffer);
    }
    buffer.push(line);

    // Trim buffer to max turns
    if (buffer.length > this.config.maxTurnsInMemory) {
      const excess = buffer.length - this.config.maxTurnsInMemory;
      buffer.splice(0, excess);
    }

    return line;
  }

  // ---------------------------------------------------------------------------
  // Load and repair
  // ---------------------------------------------------------------------------

  /**
   * Load a transcript from file, repairing any corrupted lines.
   * Skips:
   * - Lines that fail JSON.parse
   * - Lines with broken hash chains
   * - The header line (not a TranscriptLine)
   */
  loadAndRepair(sessionKey: string): TranscriptLoadResult {
    const path = this.filePath(sessionKey);
    if (!existsSync(path)) {
      return { lines: [], skipped: 0, chainIntact: true, totalRaw: 0 };
    }

    const raw = readFileSync(path, "utf-8");
    const rawLines = raw.split("\n").filter((l) => l.trim().length > 0);

    const lines: TranscriptLine[] = [];
    let skipped = 0;
    let chainIntact = true;
    let expectedPrevHash = GENESIS_HASH;

    for (const rawLine of rawLines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawLine);
      } catch {
        skipped++;
        chainIntact = false;
        continue;
      }

      // Skip header
      if (isHeader(parsed)) continue;

      // Validate as TranscriptLine
      if (!isTranscriptLine(parsed)) {
        skipped++;
        chainIntact = false;
        continue;
      }

      // Verify hash chain
      if (parsed.prevHash !== expectedPrevHash) {
        // Chain broken — accept the line but mark chain as broken
        chainIntact = false;
      }

      // Verify content hash
      const expectedHash = computeHash(parsed.seq, parsed.role, parsed.content, parsed.prevHash);
      if (parsed.hash !== expectedHash) {
        skipped++;
        chainIntact = false;
        continue;
      }

      lines.push(parsed);
      expectedPrevHash = parsed.hash;
    }

    // Update state from loaded lines
    const lastLine = lines.at(-1);
    this.sequences.set(sessionKey, lastLine?.seq ?? 0);
    this.lastHashes.set(sessionKey, lastLine?.hash ?? GENESIS_HASH);

    // Trim buffer to max turns
    const bufferLines = lines.slice(-this.config.maxTurnsInMemory);
    this.buffers.set(sessionKey, bufferLines);

    return {
      lines: bufferLines,
      skipped,
      chainIntact,
      totalRaw: rawLines.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Buffer access
  // ---------------------------------------------------------------------------

  /** Get the in-memory buffer for a session. */
  getBuffer(sessionKey: string): TranscriptLine[] {
    return this.buffers.get(sessionKey) ?? [];
  }

  /** Get the most recent N lines. */
  getRecent(sessionKey: string, count: number): TranscriptLine[] {
    const buffer = this.buffers.get(sessionKey) ?? [];
    return buffer.slice(-count);
  }

  /** Check if a transcript exists for a session. */
  exists(sessionKey: string): boolean {
    return existsSync(this.filePath(sessionKey));
  }

  // ---------------------------------------------------------------------------
  // Integrity verification
  // ---------------------------------------------------------------------------

  /**
   * Verify the integrity of a stored transcript.
   * Returns true if the hash chain is intact.
   */
  verify(sessionKey: string): { intact: boolean; lines: number; errors: number } {
    const result = this.loadAndRepair(sessionKey);
    return {
      intact: result.chainIntact,
      lines: result.lines.length,
      errors: result.skipped,
    };
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /** Clear in-memory buffers (files remain on disk). */
  clearBuffers(): void {
    this.buffers.clear();
    this.sequences.clear();
    this.lastHashes.clear();
  }

  /** Destroy manager state. */
  destroy(): void {
    this.clearBuffers();
  }
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function computeHash(
  seq: number,
  role: string,
  content: string,
  prevHash: string,
): string {
  return createHash("sha256")
    .update(`${String(seq)}:${role}:${content}:${prevHash}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isHeader(val: unknown): val is TranscriptHeader {
  return (
    typeof val === "object" &&
    val !== null &&
    "type" in val &&
    (val as Record<string, unknown>)["type"] === "transcript_header"
  );
}

function isTranscriptLine(val: unknown): val is TranscriptLine {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj["seq"] === "number" &&
    typeof obj["role"] === "string" &&
    typeof obj["content"] === "string" &&
    typeof obj["hash"] === "string" &&
    typeof obj["prevHash"] === "string"
  );
}
