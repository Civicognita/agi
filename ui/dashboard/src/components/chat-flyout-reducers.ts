/**
 * ChatFlyout state reducers — extracted as pure functions so the behaviors
 * the UI component relies on can be unit-tested without a DOM / testing-library.
 *
 * These mirror the inline setSessions(...) callbacks in ChatFlyout.tsx.
 * Any divergence between these and the component is a test failure.
 */

import type { ToolCard } from "./ToolCards.js";

export interface ChatMessageShape {
  role: "user" | "assistant" | "tool" | "thought";
  content: string;
  timestamp: string;
  runId?: string;
  images?: string[];
  toolCards?: ToolCard[];
  toolCard?: ToolCard;
}

export interface ChatSessionShape {
  id: string;
  context: string;
  contextLabel: string;
  messages: ChatMessageShape[];
  thinking: boolean;
  pendingMessages: number;
  suggestions: string[];
  toolActivity: ToolCard[];
  activePlan: unknown;
  progressText?: string;
  activeRunId?: string;
  queuedMessages: Array<{ text: string; timestamp: string }>;
}

/**
 * Reducer for `chat:injection_consumed` (Phase 3e).
 *
 * Moves the first N queued messages into the main messages array as
 * role:"user" stamped with the current activeRunId, and decrements
 * pendingMessages accordingly.
 */
export function applyInjectionConsumed(
  session: ChatSessionShape,
  count: number,
): ChatSessionShape {
  if (count <= 0) return session;
  const n = Math.min(count, session.queuedMessages.length);
  if (n === 0) return session;
  const consumed = session.queuedMessages.slice(0, n);
  const rest = session.queuedMessages.slice(n);
  const consumedMsgs: ChatMessageShape[] = consumed.map((q) => ({
    role: "user" as const,
    content: q.text,
    timestamp: q.timestamp,
    runId: session.activeRunId,
  }));
  return {
    ...session,
    queuedMessages: rest,
    pendingMessages: Math.max(0, session.pendingMessages - n),
    messages: [...session.messages, ...consumedMsgs],
  };
}

/**
 * Computes whether the live "Thinking..." pill should be shown for a session.
 * Returns false once the current run has produced at least one thought or tool
 * message — those discrete bubbles become the authoritative activity signal.
 *
 * Mirrors the logic in the ChatFlyout pill render (Phase 1a).
 */
export function shouldShowLivePill(session: ChatSessionShape): boolean {
  if (!session.thinking) return false;
  if (session.activeRunId === undefined) return true;
  const hasActivity = session.messages.some(
    (m) => (m.role === "thought" || m.role === "tool") && m.runId === session.activeRunId,
  );
  return !hasActivity;
}

/**
 * Stall-timer expiry reducer: clears the thinking state, drops transient
 * progress/tool-activity state, and appends a timeout message to the session.
 * (Phase 4c.)
 */
export function applyStallTimeout(session: ChatSessionShape, timeoutMessage: string, now: string): ChatSessionShape {
  if (!session.thinking) return session;
  return {
    ...session,
    thinking: false,
    toolActivity: [],
    progressText: undefined,
    messages: [...session.messages, {
      role: "assistant" as const,
      content: timeoutMessage,
      timestamp: now,
      runId: session.activeRunId,
    }],
  };
}
