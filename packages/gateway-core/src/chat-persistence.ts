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

  /** Save a session to disk. */
  save(session: PersistedChatSession): void {
    const safeId = sanitizeId(session.id);
    if (safeId.length === 0) return;
    const filePath = join(this.dir, `${safeId}.json`);
    writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
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

  /** List all saved sessions, sorted by updatedAt descending. */
  list(): ChatSessionSummary[] {
    try {
      const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
      const summaries: ChatSessionSummary[] = [];

      for (const file of files) {
        try {
          const raw = readFileSync(join(this.dir, file), "utf-8");
          const session = JSON.parse(raw) as PersistedChatSession;
          summaries.push({
            id: session.id,
            context: session.context,
            contextLabel: session.contextLabel,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messageCount: session.messages.length,
            lastPreview: session.lastPreview,
          });
        } catch {
          // Skip corrupt files
        }
      }

      summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return summaries;
    } catch {
      return [];
    }
  }

  /** Delete a session file. Returns true if deleted, false otherwise. */
  delete(sessionId: string): boolean {
    const safeId = sanitizeId(sessionId);
    if (safeId.length === 0) return false;
    const filePath = join(this.dir, `${safeId}.json`);
    try {
      unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
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
