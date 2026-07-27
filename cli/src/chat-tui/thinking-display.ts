/**
 * thinking-display — pure helpers for rendering Aion's reasoning ("thinking")
 * blocks in the Chat TUI.
 *
 * Reasoning reaches the transcript two ways: a persisted `thought`-role history
 * message, and (defensively) any message whose content still carries literal
 * `<thinking>…</thinking>` / `<think>…</think>` tags the server's splitThinking
 * pass didn't strip. Both are noisy shown raw (the user saw exposed
 * `<thinking>` tags), so the TUI renders them as COLLAPSIBLE blocks: a one-line
 * summary by default, full text when expanded (toggled globally by a key —
 * NOT a focusable Accordion, which would steal input focus and freeze the TUI,
 * the bug hit twice already).
 */

/** Matches a `<thinking>`/`<think>` opening tag, with or without a close — an unclosed tag is how a whole reasoning block leaks in. */
const THINKING_TAG_RE = /<\/?think(?:ing)?>/i;

/** True if `content` is reasoning: an explicit thinking flag OR literal thinking tags. */
export function isThinkingContent(content: string, flagged: boolean): boolean {
  return flagged || THINKING_TAG_RE.test(content);
}

/** Strip `<thinking>`/`<think>` tags (and their closers) and trim — the readable reasoning text. */
export function stripThinkingTags(content: string): string {
  return content.replace(/<\/?think(?:ing)?>/gi, "").replace(/\s+\n/g, "\n").trim();
}

/**
 * A one-line collapsed summary for a thinking block: line count + a short
 * preview of the first line, so the user can tell what Aion was chewing on
 * without expanding.
 */
export function thinkingSummary(content: string): string {
  const stripped = stripThinkingTags(content);
  const lines = stripped.split("\n").filter((l) => l.trim().length > 0);
  const first = lines[0] ?? "";
  const preview = first.length > 60 ? `${first.slice(0, 60)}…` : first;
  const count = lines.length;
  const lineLabel = count === 1 ? "1 line" : `${String(count)} lines`;
  return preview.length > 0 ? `💭 thinking · ${lineLabel} · ${preview}` : `💭 thinking · ${lineLabel}`;
}
