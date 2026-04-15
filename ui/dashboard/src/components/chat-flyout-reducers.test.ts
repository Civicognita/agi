/**
 * Unit tests for the ChatFlyout state reducers.
 *
 * These cover the non-trivial state transitions the component relies on
 * without needing a DOM or testing-library. The component imports and
 * uses the same reducers, so any divergence between these tests and the
 * on-screen behavior is a test failure at the reducer level.
 */

import { describe, it, expect } from "vitest";
import {
  applyInjectionConsumed,
  applyStallTimeout,
  shouldShowLivePill,
  groupByThoughtBoundary,
} from "./chat-flyout-reducers.js";
import type { ChatSessionShape, ChatMessageShape } from "./chat-flyout-reducers.js";

function makeSession(overrides: Partial<ChatSessionShape> = {}): ChatSessionShape {
  return {
    id: "sess-1",
    context: "general",
    contextLabel: "General",
    messages: [],
    thinking: false,
    pendingMessages: 0,
    suggestions: [],
    toolActivity: [],
    activePlan: null,
    queuedMessages: [],
    ...overrides,
  };
}

describe("applyInjectionConsumed", () => {
  it("returns the session unchanged when count is zero or negative", () => {
    const s = makeSession({
      queuedMessages: [{ text: "pending", timestamp: "2026-04-13T00:00:00Z" }],
      pendingMessages: 1,
    });
    expect(applyInjectionConsumed(s, 0)).toBe(s);
    expect(applyInjectionConsumed(s, -5)).toBe(s);
  });

  it("returns the session unchanged when no queued messages exist", () => {
    const s = makeSession();
    expect(applyInjectionConsumed(s, 2)).toBe(s);
  });

  it("moves the first N queued messages into messages as role:user", () => {
    const s = makeSession({
      activeRunId: "run-A",
      pendingMessages: 3,
      queuedMessages: [
        { text: "one", timestamp: "t1" },
        { text: "two", timestamp: "t2" },
        { text: "three", timestamp: "t3" },
      ],
    });
    const next = applyInjectionConsumed(s, 2);
    expect(next.queuedMessages).toEqual([{ text: "three", timestamp: "t3" }]);
    expect(next.messages).toEqual([
      { role: "user", content: "one", timestamp: "t1", runId: "run-A" },
      { role: "user", content: "two", timestamp: "t2", runId: "run-A" },
    ]);
    expect(next.pendingMessages).toBe(1);
  });

  it("clamps count to the queue length and never drives pendingMessages below zero", () => {
    const s = makeSession({
      pendingMessages: 1,
      queuedMessages: [{ text: "only", timestamp: "t1" }],
    });
    const next = applyInjectionConsumed(s, 999);
    expect(next.queuedMessages).toEqual([]);
    expect(next.pendingMessages).toBe(0);
    expect(next.messages).toHaveLength(1);
  });
});

describe("shouldShowLivePill", () => {
  it("returns false when not thinking", () => {
    expect(shouldShowLivePill(makeSession({ thinking: false }))).toBe(false);
  });

  it("returns true when thinking with no active run messages", () => {
    expect(shouldShowLivePill(makeSession({ thinking: true }))).toBe(true);
    expect(
      shouldShowLivePill(makeSession({
        thinking: true,
        activeRunId: "run-A",
      })),
    ).toBe(true);
  });

  it("returns false once the active run has at least one thought", () => {
    const s = makeSession({
      thinking: true,
      activeRunId: "run-A",
      messages: [
        { role: "user", content: "hi", timestamp: "t1", runId: "run-A" },
        { role: "thought", content: "considering", timestamp: "t2", runId: "run-A" },
      ],
    });
    expect(shouldShowLivePill(s)).toBe(false);
  });

  it("returns false once the active run has at least one tool message", () => {
    const s = makeSession({
      thinking: true,
      activeRunId: "run-A",
      messages: [
        { role: "tool", content: "file_read", timestamp: "t1", runId: "run-A" },
      ],
    });
    expect(shouldShowLivePill(s)).toBe(false);
  });

  it("ignores thoughts and tools belonging to a different run", () => {
    // This is the scenario the user hit: a post-run injection follow-up starts
    // a NEW run, but old-run messages are still in the messages array. The pill
    // should show because the NEW run has no activity yet.
    const s = makeSession({
      thinking: true,
      activeRunId: "run-B",
      messages: [
        { role: "thought", content: "old-run thinking", timestamp: "t1", runId: "run-A" },
        { role: "tool", content: "old-run tool", timestamp: "t2", runId: "run-A" },
      ],
    });
    expect(shouldShowLivePill(s)).toBe(true);
  });
});

describe("groupByThoughtBoundary", () => {
  const mkMsg = (role: ChatMessageShape["role"], content: string, runId?: string): ChatMessageShape => ({
    role,
    content,
    timestamp: content,
    runId,
  });

  it("empty input returns empty sections", () => {
    expect(groupByThoughtBoundary([])).toEqual([]);
  });

  it("groups a thought followed by tools into one section", () => {
    const messages: ChatMessageShape[] = [
      mkMsg("thought", "thinking about things"),
      mkMsg("tool", "tool-1"),
      mkMsg("tool", "tool-2"),
    ];
    const sections = groupByThoughtBoundary(messages);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.lead?.role).toBe("thought");
    expect(sections[0]!.lead?.content).toBe("thinking about things");
    expect(sections[0]!.trail).toHaveLength(2);
    expect(sections[0]!.trail.map((m) => m.content)).toEqual(["tool-1", "tool-2"]);
  });

  it("multiple thoughts start separate sections, each with their own tool trail", () => {
    const messages: ChatMessageShape[] = [
      mkMsg("thought", "plan-1"),
      mkMsg("tool", "t1"),
      mkMsg("tool", "t2"),
      mkMsg("thought", "plan-2"),
      mkMsg("tool", "t3"),
    ];
    const sections = groupByThoughtBoundary(messages);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.lead?.content).toBe("plan-1");
    expect(sections[0]!.trail.map((m) => m.content)).toEqual(["t1", "t2"]);
    expect(sections[1]!.lead?.content).toBe("plan-2");
    expect(sections[1]!.trail.map((m) => m.content)).toEqual(["t3"]);
  });

  it("user and assistant messages each start their own section", () => {
    const messages: ChatMessageShape[] = [
      mkMsg("user", "hello"),
      mkMsg("thought", "replying"),
      mkMsg("tool", "t1"),
      mkMsg("assistant", "hi"),
    ];
    const sections = groupByThoughtBoundary(messages);
    expect(sections).toHaveLength(3);
    expect(sections[0]!.lead?.role).toBe("user");
    expect(sections[0]!.trail).toEqual([]);
    expect(sections[1]!.lead?.role).toBe("thought");
    expect(sections[1]!.trail.map((m) => m.content)).toEqual(["t1"]);
    expect(sections[2]!.lead?.role).toBe("assistant");
  });

  it("a tool without a preceding thought gets a section with no lead (safety)", () => {
    const messages: ChatMessageShape[] = [
      mkMsg("tool", "orphan-tool"),
      mkMsg("thought", "thinking"),
      mkMsg("tool", "child-tool"),
    ];
    const sections = groupByThoughtBoundary(messages);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.lead).toBeNull();
    expect(sections[0]!.trail.map((m) => m.content)).toEqual(["orphan-tool"]);
    expect(sections[1]!.lead?.role).toBe("thought");
    expect(sections[1]!.trail.map((m) => m.content)).toEqual(["child-tool"]);
  });

  it("a lone thought (no tools) still produces a section", () => {
    const messages: ChatMessageShape[] = [
      mkMsg("thought", "solo-thought"),
    ];
    const sections = groupByThoughtBoundary(messages);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.lead?.content).toBe("solo-thought");
    expect(sections[0]!.trail).toEqual([]);
  });
});

describe("applyStallTimeout", () => {
  it("returns the session unchanged when not thinking", () => {
    const s = makeSession({ thinking: false });
    expect(applyStallTimeout(s, "timeout", "now")).toBe(s);
  });

  it("clears thinking state and appends a timeout message", () => {
    const s = makeSession({
      thinking: true,
      activeRunId: "run-A",
      progressText: "working...",
      toolActivity: [
        {
          id: "t-1",
          toolName: "shell_exec",
          status: "running",
          loopIteration: 1,
          toolIndex: 0,
          timestamp: "t1",
        },
      ],
    });
    const next = applyStallTimeout(s, "Response timed out.", "2026-04-13T12:34:56Z");
    expect(next.thinking).toBe(false);
    expect(next.toolActivity).toEqual([]);
    expect(next.progressText).toBeUndefined();
    expect(next.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Response timed out.",
      timestamp: "2026-04-13T12:34:56Z",
      runId: "run-A",
    });
  });
});
