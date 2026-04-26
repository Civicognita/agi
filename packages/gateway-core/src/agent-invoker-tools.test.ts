import { describe, expect, it } from "vitest";
import { shouldOfferTools } from "./agent-invoker.js";

/**
 * Unit coverage for shouldOfferTools — the gating function that decides whether
 * the upcoming LLM call gets the tool list. Tracked in tynn s101 t361.
 *
 * Pre-2026-04-25: an early `if (requestType === "chat") return false` short-
 * circuited the function, so action-verb chats ("list files in /tmp") silently
 * dropped tools. After the reorder, TOOL_KEYWORDS is checked before the
 * chat short-circuit. These tests pin that contract.
 */

describe("shouldOfferTools — system + project always get tools", () => {
  it("system requests get tools regardless of content", () => {
    expect(shouldOfferTools("hi", "system")).toBe(true);
    expect(shouldOfferTools("just chatting", "system")).toBe(true);
    expect(shouldOfferTools("anything", "system")).toBe(true);
  });

  it("project requests get tools regardless of content", () => {
    expect(shouldOfferTools("hello", "project")).toBe(true);
    expect(shouldOfferTools("how are you", "project")).toBe(true);
  });
});

describe("shouldOfferTools — action-verb chats reach tools (s101 t361 fix)", () => {
  it.each([
    "list the files in /tmp",
    "search the docs for impactivism",
    "find all python files in the project",
    "create a new MApp called Notes",
    "delete the bliss_chronicles dist folder",
    "install the screensaver plugin",
    "uninstall the deprecated reader-literature plugin",
    "manage the discord channel",
    "run the test suite",
    "build the dashboard bundle",
    "start the lemonade backend",
    "stop the ollama daemon",
  ])("chat with action verb returns true: %s", (content) => {
    expect(shouldOfferTools(content, "chat")).toBe(true);
  });

  it("case-insensitive — Search, FIND, Delete all match", () => {
    expect(shouldOfferTools("Search the codebase", "chat")).toBe(true);
    expect(shouldOfferTools("FIND all matches", "chat")).toBe(true);
    expect(shouldOfferTools("DELETE the file", "chat")).toBe(true);
  });

  it("action-verb chat trumps the chat short-circuit (the actual t361 fix)", () => {
    // Pre-fix: this returned false because of `if (requestType === "chat") return false`.
    // Post-fix: returns true because TOOL_KEYWORDS check comes first.
    expect(shouldOfferTools("list the files in /tmp", "chat")).toBe(true);
  });
});

describe("shouldOfferTools — chat without action verbs stays tool-free", () => {
  it.each([
    "hi",
    "hello",
    "how are you",
    "what's up",
    "tell me a joke",
    "thanks",
    "ok cool",
    "I appreciate that",
    "what do you think about impactivism",
    "explain how COA<>COI works",
  ])("plain chat returns false: %s", (content) => {
    expect(shouldOfferTools(content, "chat")).toBe(false);
  });

  it("knowledge requests without action verbs return false", () => {
    expect(shouldOfferTools("what is impactivism", "knowledge")).toBe(false);
  });

  it("worker + taskmaster requests without action verbs return false", () => {
    expect(shouldOfferTools("done", "worker")).toBe(false);
    expect(shouldOfferTools("status update", "taskmaster")).toBe(false);
  });

  it("entity requests without action verbs return false", () => {
    expect(shouldOfferTools("greetings", "entity")).toBe(false);
  });

  it("knowledge request with action verb still gets tools", () => {
    // Action verbs override category — search-the-knowledge-base is a tool intent.
    expect(shouldOfferTools("search the knowledge base", "knowledge")).toBe(true);
  });
});
