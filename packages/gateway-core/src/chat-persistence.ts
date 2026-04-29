/**
 * ChatPersistence — file-based JSON storage for chat sessions.
 *
 * Stores persisted sessions in `~/.agi/chat-history/<session-id>.json`.
 * Each file is a self-contained JSON document with messages, context, and metadata.
 */

import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersistedToolCard {
  id: string;
  toolName: string;
  loopIteration: number;
  toolIndex: number;
  status: "running" | "complete" | "error";
  summary?: string;
  toolInput?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  timestamp: string;
  completedAt?: string;
}

export interface PersistedChatMessage {
  role: "user" | "assistant" | "tool" | "thought";
  content: string;
  timestamp: string;
  runId?: string;
  images?: string[];
  /** Legacy: frozen tool cards array on assistant messages (pre-runId sessions). */
  toolCards?: PersistedToolCard[];
  /** Single tool card data (for role: "tool" messages). */
  toolCard?: PersistedToolCard;
  /**
   * Next-step suggestions generated for this assistant response. Persisted
   * so they survive page reloads — previously these lived only in ephemeral
   * component state and vanished on refresh. Only meaningful on assistant
   * messages.
   */
  suggestions?: string[];
  /**
   * Routing metadata from the Intelligent Agent Router. Persisted so the
   * model/cost chip is visible when reloading a prior session. Only
   * meaningful on assistant messages.
   */
  routingMeta?: {
    provider: string;
    model: string;
    costMode: string;
    escalated: boolean;
    estimatedCostUsd: number;
    /** Dynamic-context request type. */
    requestType?: string;
    /** How the request type was determined. */
    classifierUsed?: string;
    /** Context layers included in the assembled system prompt. */
    contextLayers?: string[];
    /** Per-section token breakdown. Populated from v0.4.53 onwards. */
    tokenBreakdown?: {
      identity: number;
      context: number;
      memory: number;
      skills: number;
      history: number;
      response: number;
    };
  };
}

export interface PersistedChatSession {
  id: string;
  context: string;
  contextLabel: string;
  createdAt: string;
  updatedAt: string;
  messages: PersistedChatMessage[];
  lastPreview: string;
}

export interface ChatSessionSummary {
  id: string;
  context: string;
  contextLabel: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastPreview: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitize sessionId to prevent path traversal. */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * Resolve the per-project chat dir `<projectPath>/k/chat/` when the
 * session's context is a valid s130-migrated project (has `.agi/`).
 * Returns null when:
 * - context is empty/falsy (global session)
 * - context is not a directory
 * - context has no `.agi/` (project not yet migrated to s130 layout)
 *
 * The s130 migration is detected by the presence of `<context>/.agi/`
 * (created by scaffoldProjectFolders / migrateProjectConfig). This
 * means non-migrated projects continue to use the global dir
 * exclusively until they're touched by the migration helper.
 */
function resolveProjectChatDir(context: string | undefined | null): string | null {
  if (typeof context !== "string" || context.length === 0) return null;
  if (!existsSync(join(context, ".agi"))) return null;
  return join(context, "k", "chat");
}

function truncatePreview(text: string, maxLen = 100): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

// ---------------------------------------------------------------------------
// ChatPersistence
// ---------------------------------------------------------------------------

export class ChatPersistence {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? join(homedir(), ".agi", "chat-history");
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  /** Save a session to disk.
   *
   * **s130 t518 slice 2 (2026-04-29):** dual-write — always write to
   * the global dir (current readers consume from there), and ALSO
   * write to `<projectPath>/k/chat/<id>.json` when the session has a
   * project context AND that project has been migrated to s130 layout
   * (`<projectPath>/.agi/` exists). Slice 3 will flip readers to the
   * per-project location + drop the global write. Until then,
   * dual-write keeps the per-project copy eventually consistent for
   * future readers.
   */
  save(session: PersistedChatSession): void {
    const safeId = sanitizeId(session.id);
    if (safeId.length === 0) return;
    const data = JSON.stringify(session, null, 2);

    // Primary write: global dir. This is what current readers see.
    const globalPath = join(this.dir, `${safeId}.json`);
    writeFileSync(globalPath, data, "utf-8");

    // Secondary write: per-project location when applicable. Failures
    // here are non-fatal — global write succeeded, so the session is
    // discoverable through the current code path.
    const projectChatDir = resolveProjectChatDir(session.context);
    if (projectChatDir !== null) {
      try {
        if (!existsSync(projectChatDir)) {
          mkdirSync(projectChatDir, { recursive: true });
        }
        writeFileSync(join(projectChatDir, `${safeId}.json`), data, "utf-8");
      } catch {
        // Per-project write failed (read-only fs, permissions). Silent
        // skip — primary write covers functionality.
      }
    }
  }

  /** Load a session from disk. Returns null if not found or corrupt. */
  load(sessionId: string): PersistedChatSession | null {
    const safeId = sanitizeId(sessionId);
    if (safeId.length === 0) return null;
    const filePath = join(this.dir, `${safeId}.json`);
    try {
      const raw = readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as PersistedChatSession;
    } catch {
      return null;
    }
  }

  /** List all saved sessions, sorted by updatedAt descending.
   *
   * **s130 t521 slice (2026-04-29):** accepts optional `additionalDirs`
   * — per-project chat dirs (e.g. `<projectPath>/k/chat/`) the caller
   * wants to combine with the global dir. Sessions found in multiple
   * locations are deduplicated by id, preferring the entry with the
   * most recent `updatedAt`. Until production wiring lands all dirs,
   * the global dir remains the primary source.
   */
  list(additionalDirs: string[] = []): ChatSessionSummary[] {
    const allDirs = [this.dir, ...additionalDirs];
    const byId = new Map<string, ChatSessionSummary>();

    for (const dir of allDirs) {
      let files: string[];
      try {
        files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      } catch {
        // Dir doesn't exist or unreadable — skip it (additionalDirs
        // for projects with no chat history yet).
        continue;
      }

      for (const file of files) {
        try {
          const raw = readFileSync(join(dir, file), "utf-8");
          const session = JSON.parse(raw) as PersistedChatSession;
          const summary: ChatSessionSummary = {
            id: session.id,
            context: session.context,
            contextLabel: session.contextLabel,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messageCount: session.messages.length,
            lastPreview: session.lastPreview,
          };
          // Dedupe by id, prefer more-recent updatedAt
          const existing = byId.get(summary.id);
          if (existing === undefined || summary.updatedAt > existing.updatedAt) {
            byId.set(summary.id, summary);
          }
        } catch {
          // Skip corrupt files
        }
      }
    }

    return Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Delete a session file. Returns true if deleted, false otherwise.
   *
   * **s130 t518 slice 2 (2026-04-29):** dual-delete. To avoid the
   * "session resurrects on slice 3 reader-flip" bug, we read the
   * session first to get its project context, then delete from BOTH
   * the global location AND the per-project location (if applicable).
   * Returns true when at least one location was successfully deleted.
   */
  delete(sessionId: string): boolean {
    const safeId = sanitizeId(sessionId);
    if (safeId.length === 0) return false;

    // Read the session first to know its context (so we can delete
    // from the per-project location too). We read from the global dir
    // because that's the canonical source today.
    const globalPath = join(this.dir, `${safeId}.json`);
    let context: string | undefined;
    try {
      const raw = readFileSync(globalPath, "utf-8");
      const session = JSON.parse(raw) as PersistedChatSession;
      context = session.context;
    } catch {
      // Couldn't read the global session — possibly already deleted
      // from global but not from per-project. Skip the context lookup
      // and just attempt both deletions blindly.
    }

    let deletedAny = false;

    // Delete from global.
    try {
      unlinkSync(globalPath);
      deletedAny = true;
    } catch {
      // Already gone — ok.
    }

    // Delete from per-project location if applicable.
    const projectChatDir = resolveProjectChatDir(context);
    if (projectChatDir !== null) {
      const projectPath = join(projectChatDir, `${safeId}.json`);
      try {
        unlinkSync(projectPath);
        deletedAny = true;
      } catch {
        // Already gone — ok.
      }
    }

    return deletedAny;
  }

  // -------------------------------------------------------------------------
  // Convenience: create or update in-flight session data
  // -------------------------------------------------------------------------

  /** Create a new PersistedChatSession object (not yet saved). */
  static createSession(
    id: string,
    context: string,
    contextLabel: string,
  ): PersistedChatSession {
    const now = new Date().toISOString();
    return {
      id,
      context,
      contextLabel,
      createdAt: now,
      updatedAt: now,
      messages: [],
      lastPreview: "",
    };
  }

  /** Append a message and update metadata. Returns the updated session. */
  static appendMessage(
    session: PersistedChatSession,
    message: PersistedChatMessage,
  ): PersistedChatSession {
    return {
      ...session,
      updatedAt: new Date().toISOString(),
      messages: [...session.messages, message],
      // Skip lastPreview update for tool/thought messages — keep the last user/assistant preview.
      lastPreview: message.role === "tool" || message.role === "thought" ? session.lastPreview : truncatePreview(message.content),
    };
  }
}
