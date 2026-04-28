import { describe, it, expect } from "vitest";
import { classifyRequest } from "./request-classifier.js";
import type { LLMInvokeParams, LLMToolDefinition } from "./types.js";

function makeParams(overrides: Partial<LLMInvokeParams> = {}): LLMInvokeParams {
  return {
    system: "You are a test assistant.",
    messages: [{ role: "user", content: "Hello" }],
    entityId: "#E0",
    ...overrides,
  };
}

function makeTools(count: number): LLMToolDefinition[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `tool_${i}`,
    description: `Test tool ${i}`,
    input_schema: { type: "object", properties: {} },
  }));
}

const defaults = { simple: 500, complex: 2000 };

describe("classifyRequest", () => {
  describe("simple classification", () => {
    it("classifies short message with no tools as simple", () => {
      const result = classifyRequest(makeParams(), defaults);
      expect(result.complexity).toBe("simple");
      expect(result.hasTools).toBe(false);
      expect(result.hasThinking).toBe(false);
    });

    it("classifies short message with shallow history as simple", () => {
      const result = classifyRequest(makeParams({
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello" },
          { role: "user", content: "Thanks" },
        ],
      }), defaults);
      expect(result.complexity).toBe("simple");
      expect(result.historyDepth).toBe(3);
    });
  });

  describe("moderate classification", () => {
    it("classifies request with a few tools as moderate", () => {
      const result = classifyRequest(makeParams({
        tools: makeTools(3),
      }), defaults);
      expect(result.complexity).toBe("moderate");
      expect(result.hasTools).toBe(true);
    });

    it("classifies request with >3 history turns as moderate", () => {
      const result = classifyRequest(makeParams({
        messages: [
          { role: "user", content: "A" },
          { role: "assistant", content: "B" },
          { role: "user", content: "C" },
          { role: "assistant", content: "D" },
        ],
      }), defaults);
      expect(result.complexity).toBe("moderate");
      expect(result.historyDepth).toBe(4);
    });
  });

  describe("complex classification", () => {
    it("classifies long message as complex", () => {
      const longContent = "x".repeat(10000);
      const result = classifyRequest(makeParams({
        messages: [{ role: "user", content: longContent }],
      }), defaults);
      expect(result.complexity).toBe("complex");
      expect(result.estimatedTokens).toBeGreaterThan(2000);
    });

    it("classifies request with >10 tools as complex", () => {
      const result = classifyRequest(makeParams({
        tools: makeTools(12),
      }), defaults);
      expect(result.complexity).toBe("complex");
    });

    it("classifies request with thinking enabled as complex", () => {
      const result = classifyRequest(makeParams({
        thinking: { type: "enabled", budget_tokens: 5000 },
      }), defaults);
      expect(result.complexity).toBe("complex");
      expect(result.hasThinking).toBe(true);
    });
  });

  describe("token estimation", () => {
    it("estimates tokens from character count", () => {
      const result = classifyRequest(makeParams({
        messages: [{ role: "user", content: "a".repeat(400) }],
      }), defaults);
      expect(result.estimatedTokens).toBeGreaterThan(0);
      expect(result.estimatedTokens).toBeLessThanOrEqual(200);
    });

    it("includes system prompt in token count", () => {
      const result = classifyRequest(makeParams({
        system: "a".repeat(4000),
        messages: [{ role: "user", content: "Hi" }],
      }), defaults);
      expect(result.estimatedTokens).toBeGreaterThan(1000);
    });
  });

  describe("edge cases", () => {
    it("handles empty messages array", () => {
      const result = classifyRequest(makeParams({ messages: [] }), defaults);
      expect(result.complexity).toBeDefined();
      expect(result.historyDepth).toBe(0);
    });

    it("handles content block arrays", () => {
      const result = classifyRequest(makeParams({
        messages: [{
          role: "user",
          content: [
            { type: "text" as const, text: "Hello world" },
            { type: "text" as const, text: "More text here" },
          ],
        }],
      }), defaults);
      expect(result.estimatedTokens).toBeGreaterThan(0);
    });

    it("respects custom thresholds", () => {
      // 600 chars of content = 150 tokens + system ~7 tokens = ~157 tokens total.
      // With {simple:50, complex:100}: 157 > 100 → complex.
      // With {simple:500, complex:5000}: 157 < 500 and no tools and historyDepth=1 → simple (not complex).
      const content = "x".repeat(600);
      const resultLow = classifyRequest(
        makeParams({ messages: [{ role: "user", content }] }),
        { simple: 50, complex: 100 },
      );
      expect(resultLow.complexity).toBe("complex");

      const resultHigh = classifyRequest(
        makeParams({ messages: [{ role: "user", content }] }),
        { simple: 500, complex: 5000 },
      );
      expect(resultHigh.complexity).not.toBe("complex");
    });
  });
});
