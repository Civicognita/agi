/**
 * thinking-text — split a model's inline reasoning from its user-visible answer.
 *
 * Some models (and our own think-in-tags prompting) emit chain-of-thought as
 * literal `<thinking>…</thinking>` / `<think>…</think>` tags INSIDE the text
 * content — distinct from providers that expose it via a separate
 * `reasoning_content` field (handled in openai-provider.ts). Without this,
 * the raw reasoning block leaks into channel replies (the Discord bug where
 * Aion posted its whole <thinking> block above the actual response).
 *
 * This is a framework primitive: every channel that surfaces an agent reply
 * wants the thinking separated, so the agent-invoker uses it centrally and
 * channels (e.g. Discord) can render the reasoning separately if they choose.
 */

export interface SplitThinking {
  /** The reply with all reasoning blocks removed, trimmed + de-gapped. */
  visibleText: string;
  /** The concatenated reasoning (blocks joined by a blank line); "" if none. */
  thinking: string;
}

// Matches a complete <thinking>…</thinking> or <think>…</think> block,
// case-insensitive, across newlines, non-greedy so adjacent blocks stay separate.
const CLOSED_BLOCK = /<(thinking|think)>([\s\S]*?)<\/\1>/gi;
// Matches an UNCLOSED opener and everything after it (truncated thinking-only
// output where the model spent its budget before closing the tag / answering).
const OPEN_REMAINDER = /<(thinking|think)>([\s\S]*)$/i;

/**
 * Separate inline reasoning from the visible response.
 *
 * @param text Raw model text, possibly containing thinking tags.
 * @returns visibleText (reasoning stripped) + thinking (reasoning concatenated).
 */
export function splitThinking(text: string): SplitThinking {
  if (text === "") return { visibleText: "", thinking: "" };

  const thoughts: string[] = [];

  // 1) Pull out every fully-closed block.
  let visible = text.replace(CLOSED_BLOCK, (_m, _tag: string, body: string) => {
    const t = body.trim();
    if (t.length > 0) thoughts.push(t);
    return "";
  });

  // 2) A leftover unclosed opener means the model never closed the tag — treat
  //    the remainder as thinking rather than dumping a raw "<thinking>" to chat.
  const open = OPEN_REMAINDER.exec(visible);
  if (open !== null) {
    const t = (open[2] ?? "").trim();
    if (t.length > 0) thoughts.push(t);
    visible = visible.slice(0, open.index);
  }

  // 3) Collapse the blank lines the removed blocks left behind, then trim.
  const visibleText = visible.replace(/\n{3,}/g, "\n\n").trim();

  return { visibleText, thinking: thoughts.join("\n\n") };
}
