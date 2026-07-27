/**
 * `chatSessionReducer` — pure event→state mapping for the Chat TUI, tested
 * directly with no React rendering (mirrors this codebase's convention of
 * testing pure logic separately from framework glue — see
 * `doctor-menu.ts`'s state-machine tests, `chat-client.test.ts`).
 */

import { describe, it, expect } from "vitest";
import {
  chatSessionReducer,
  initialChatSessionState,
  toolCallId,
  type ChatSessionState,
} from "./useChatSession.js";
import type { ChatHistoryMessage, ChatToolStartEvent, ChatToolResultEvent } from "../chat-client.js";

const T = "2026-01-01T00:00:00.000Z";

function toolStart(overrides: Partial<ChatToolStartEvent> = {}): ChatToolStartEvent {
  return { toolName: "grep_search", toolIndex: 0, loopIteration: 0, ...overrides };
}

function toolResult(overrides: Partial<ChatToolResultEvent> = {}): ChatToolResultEvent {
  return { toolName: "grep_search", toolIndex: 0, loopIteration: 0, success: true, summary: "found 3 matches", ...overrides };
}

describe("toolCallId", () => {
  it("correlates start and result events from the same loopIteration/toolIndex", () => {
    expect(toolCallId(toolStart({ loopIteration: 2, toolIndex: 1 }))).toBe(
      toolCallId(toolResult({ loopIteration: 2, toolIndex: 1 })),
    );
  });

  it("distinguishes different tool calls", () => {
    expect(toolCallId(toolStart({ loopIteration: 0, toolIndex: 0 }))).not.toBe(
      toolCallId(toolStart({ loopIteration: 0, toolIndex: 1 })),
    );
  });
});

describe("chatSessionReducer — userSent / agentResponded", () => {
  it("appends a user message with a monotonically increasing id", () => {
    const s1 = chatSessionReducer(initialChatSessionState, { type: "userSent", text: "hello", timestamp: T });
    expect(s1.messages).toEqual([{ id: "m1", role: "user", content: "hello", name: undefined, timestamp: T }]);
    expect(s1.nextMessageSeq).toBe(2);

    const s2 = chatSessionReducer(s1, { type: "userSent", text: "again", timestamp: T });
    expect(s2.messages[1]?.id).toBe("m2");
  });

  it("carries terminal attachments on a user message", () => {
    const s = chatSessionReducer(initialChatSessionState, {
      type: "userSent",
      text: "check this out",
      timestamp: T,
      attachments: [{ raw: ":(TEST(0R 00 0RAW)):", output: "TEST(0R 00 0RAW)" }],
    });
    expect(s.messages[0]?.attachments).toEqual([{ raw: ":(TEST(0R 00 0RAW)):", output: "TEST(0R 00 0RAW)" }]);
  });

  it("agentResponded appends an agent message and clears thinking/statusText", () => {
    const thinking = chatSessionReducer(initialChatSessionState, { type: "thinking" });
    expect(thinking.thinking).toBe(true);
    expect(thinking.statusText).toBe("Aion is thinking…");

    const responded = chatSessionReducer(thinking, { type: "agentResponded", text: "hi there", timestamp: T });
    expect(responded.thinking).toBe(false);
    expect(responded.statusText).toBeNull();
    expect(responded.messages).toEqual([{ id: "m1", role: "agent", content: "hi there", name: undefined, timestamp: T }]);
  });
});

describe("chatSessionReducer — tool calls", () => {
  it("toolStart adds a pending live tool call", () => {
    const s = chatSessionReducer(initialChatSessionState, { type: "toolStart", event: toolStart() });
    expect(s.liveToolCalls).toEqual([{ id: "0-0", name: "grep_search", status: "pending" }]);
    expect(s.messages).toEqual([]);
  });

  it("toolResult removes the live entry and folds it into messages as role:tool", () => {
    const started = chatSessionReducer(initialChatSessionState, { type: "toolStart", event: toolStart() });
    const finished = chatSessionReducer(started, { type: "toolResult", event: toolResult(), timestamp: T });

    expect(finished.liveToolCalls).toEqual([]);
    expect(finished.messages).toEqual([
      { id: "m1", role: "tool", content: "grep_search: found 3 matches", name: "grep_search", timestamp: T },
    ]);
  });

  it("tracks multiple concurrent tool calls independently by loopIteration/toolIndex", () => {
    let s: ChatSessionState = initialChatSessionState;
    s = chatSessionReducer(s, { type: "toolStart", event: toolStart({ toolIndex: 0 }) });
    s = chatSessionReducer(s, { type: "toolStart", event: toolStart({ toolIndex: 1, toolName: "file_read" }) });
    expect(s.liveToolCalls).toHaveLength(2);

    s = chatSessionReducer(s, { type: "toolResult", event: toolResult({ toolIndex: 0 }), timestamp: T });
    expect(s.liveToolCalls).toEqual([{ id: "0-1", name: "file_read", status: "pending" }]);
    expect(s.messages).toHaveLength(1);
  });

  it("a failed tool result still folds into messages, tagged via its summary", () => {
    const started = chatSessionReducer(initialChatSessionState, { type: "toolStart", event: toolStart() });
    const failed = chatSessionReducer(started, {
      type: "toolResult",
      event: toolResult({ success: false, summary: "permission denied" }),
      timestamp: T,
    });
    expect(failed.messages[0]?.content).toBe("grep_search: permission denied");
  });
});

describe("chatSessionReducer — progress / thought", () => {
  it("progress and thought events update statusText without touching messages", () => {
    const s1 = chatSessionReducer(initialChatSessionState, { type: "progress", text: "reading files…" });
    expect(s1.statusText).toBe("reading files…");
    expect(s1.messages).toEqual([]);

    const s2 = chatSessionReducer(s1, { type: "thought", content: "considering the options" });
    expect(s2.statusText).toBe("considering the options");
  });
});

describe("chatSessionReducer — turnFailed", () => {
  it("appends a role:error message and clears thinking/statusText/liveToolCalls", () => {
    let s: ChatSessionState = chatSessionReducer(initialChatSessionState, { type: "thinking" });
    s = chatSessionReducer(s, { type: "toolStart", event: toolStart() });
    s = chatSessionReducer(s, { type: "turnFailed", message: "Timed out: no response after 120000ms", timestamp: T });

    expect(s.thinking).toBe(false);
    expect(s.statusText).toBeNull();
    expect(s.liveToolCalls).toEqual([]);
    expect(s.messages).toEqual([
      { id: "m1", role: "error", content: "Timed out: no response after 120000ms", name: undefined, timestamp: T },
    ]);
  });
});

describe("chatSessionReducer — historyLoaded", () => {
  function historyMsg(overrides: Partial<ChatHistoryMessage> = {}): ChatHistoryMessage {
    return { role: "user", content: "hi", timestamp: T, ...overrides };
  }

  it("maps each history role onto the fancy-tui MessageRole it renders as", () => {
    const s = chatSessionReducer(initialChatSessionState, {
      type: "historyLoaded",
      messages: [
        historyMsg({ role: "user", content: "hello" }),
        historyMsg({ role: "assistant", content: "hi there" }),
        historyMsg({ role: "tool", content: "grep_search: 3 matches" }),
        historyMsg({ role: "thought", content: "considering options" }),
      ],
    });

    expect(s.messages.map((m) => m.role)).toEqual(["user", "agent", "tool", "system"]);
    expect(s.messages.map((m) => m.content)).toEqual(["hello", "hi there", "grep_search: 3 matches", "considering options"]);
  });

  it("assigns monotonically increasing ids continuing from the current sequence", () => {
    const withPrior = chatSessionReducer(initialChatSessionState, { type: "userSent", text: "already here", timestamp: T });
    const s = chatSessionReducer(withPrior, { type: "historyLoaded", messages: [historyMsg()] });
    expect(s.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("is a no-op on empty history", () => {
    const s = chatSessionReducer(initialChatSessionState, { type: "historyLoaded", messages: [] });
    expect(s).toEqual(initialChatSessionState);
  });
});

describe("chatSessionReducer — systemMessage", () => {
  it("appends a local role:system message", () => {
    const s = chatSessionReducer(initialChatSessionState, { type: "systemMessage", text: "/quit — exit agi chat", timestamp: T });
    expect(s.messages).toEqual([
      { id: "m1", role: "system", content: "/quit — exit agi chat", name: undefined, timestamp: T },
    ]);
  });
});

describe("chatSessionReducer — cleared", () => {
  it("empties messages without resetting thinking/statusText/liveToolCalls/nextMessageSeq", () => {
    let s: ChatSessionState = chatSessionReducer(initialChatSessionState, { type: "userSent", text: "hi", timestamp: T });
    s = chatSessionReducer(s, { type: "toolStart", event: toolStart() });
    const cleared = chatSessionReducer(s, { type: "cleared" });

    expect(cleared.messages).toEqual([]);
    expect(cleared.liveToolCalls).toEqual(s.liveToolCalls);
    expect(cleared.nextMessageSeq).toBe(s.nextMessageSeq);
  });
});
