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
  /** Routing metadata from the Intelligent Agent Router. Only present on assistant messages. */
  routingMeta?: {
    provider: string;
    model: string;
    costMode: string;
    escalated: boolean;
    estimatedCostUsd: number;
  };
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
 * Thought-boundary grouping — inside a single agent run, split the message
 * list into sections where each section is led by a `thought` message and
 * the trailing messages are the tools that came out of that thought.
 *
 * Why: Anthropic's API returns a single `thinking` block per assistant
 * response, followed by multiple `tool_use` blocks. So for a response with
 * 6 tool calls, the emit order is `[thought, tool, tool, tool, tool, tool, tool]`.
 * We render each thought + its tools as a visually-chained "Step" so users
 * can tell which tools came from which reasoning step.
 *
 * Rules:
 *   - Each `thought` starts a new section.
 *   - A `user` or `assistant` message NOT preceded by a thought starts a
 *     section with no lead (the message itself is the sole content).
 *   - Tool messages are always trailing content of the preceding section.
 */
export interface ThoughtSection {
  /** Lead message of the section (thought OR a user/assistant message without a thought). */
  lead: ChatMessageShape | null;
  /** Tool/progress messages that came after the lead and belong to this section. */
  trail: ChatMessageShape[];
  /** Messages in this section that are NOT the lead and NOT tools (shouldn't happen in well-formed input; preserved for safety). */
  other: ChatMessageShape[];
}

export function groupByThoughtBoundary(messages: ChatMessageShape[]): ThoughtSection[] {
  const sections: ThoughtSection[] = [];
  let current: ThoughtSection | null = null;

  const flush = () => {
    if (current !== null) sections.push(current);
    current = null;
  };

  for (const msg of messages) {
    if (msg.role === "thought") {
      flush();
      current = { lead: msg, trail: [], other: [] };
    } else if (msg.role === "tool") {
      if (current === null) {
        // Tool without a preceding thought (rare) — put it in its own section
        // with no lead so it still renders.
        current = { lead: null, trail: [msg], other: [] };
      } else {
        current.trail.push(msg);
      }
    } else {
      // user / assistant — always its own section
      flush();
      current = { lead: msg, trail: [], other: [] };
    }
  }
  flush();
  return sections;
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
