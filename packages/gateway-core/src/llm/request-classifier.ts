import type { LLMInvokeParams } from "./types.js";

export type RequestComplexity = "simple" | "moderate" | "complex";

export interface ClassificationResult {
  complexity: RequestComplexity;
  estimatedTokens: number;
  hasTools: boolean;
  hasThinking: boolean;
  historyDepth: number;
}

function estimateTokensFromContent(content: string | unknown[]): number {
  if (typeof content === "string") return Math.ceil(content.length / 4);
  let chars = 0;
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (typeof b.text === "string") chars += b.text.length;
    if (typeof b.content === "string") chars += b.content.length;
    if (typeof b.thinking === "string") chars += b.thinking.length;
  }
  return Math.ceil(chars / 4);
}

export function classifyRequest(
  params: LLMInvokeParams,
  thresholds: { simple: number; complex: number },
): ClassificationResult {
  let totalTokens = 0;

  if (params.system) {
    totalTokens += Math.ceil(params.system.length / 4);
  }

  for (const msg of params.messages) {
    totalTokens += estimateTokensFromContent(msg.content);
  }

  const hasTools = (params.tools?.length ?? 0) > 0;
  const toolCount = params.tools?.length ?? 0;
  const hasThinking = params.thinking?.type === "enabled";
  const historyDepth = params.messages.length;

  let complexity: RequestComplexity;

  if (totalTokens > thresholds.complex || toolCount > 10 || hasThinking) {
    complexity = "complex";
  } else if (totalTokens < thresholds.simple && !hasTools && historyDepth <= 3) {
    complexity = "simple";
  } else {
    complexity = "moderate";
  }

  return {
    complexity,
    estimatedTokens: totalTokens,
    hasTools,
    hasThinking,
    historyDepth,
  };
}
