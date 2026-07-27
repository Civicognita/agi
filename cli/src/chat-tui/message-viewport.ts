/**
 * Pure windowing logic for the Chat TUI's scrollable message pane (i-006).
 *
 * The alt-screen takeover (full-terminal look) suppresses the terminal's own
 * scrollback, so history has to be scrolled in-app. Rather than measure every
 * wrapped markdown line (fancy-tui has no scrollable-viewport primitive yet —
 * tracked as fancy-tui#3), we window by MESSAGE and let a bottom-anchored,
 * overflow-clipped Ink Box handle the rest: the newest visible message sits at
 * the bottom, older messages fill upward and clip at the top edge.
 *
 * Scroll model: `scrollUp` = how many messages back from the latest the
 * *newest visible* message is (0 = following the latest). PageUp increases it,
 * PageDown decreases it, Escape resets to 0.
 */

export interface ViewportWindow {
  /** First message index to render (inclusive). */
  startIndex: number;
  /** One past the last message index to render (exclusive) — the newest visible. */
  endIndex: number;
  /** True when the latest message is visible (following). */
  atBottom: boolean;
  /** Messages older than the window (above the top edge). */
  hiddenAbove: number;
  /** Messages newer than the window (below — i.e. scrolled past). */
  hiddenBelow: number;
}

/** Clamp a raw scroll value to the valid range for `total` messages. */
export function clampScroll(scrollUp: number, total: number): number {
  const max = Math.max(0, total - 1);
  if (Number.isNaN(scrollUp)) return 0;
  return Math.max(0, Math.min(Math.floor(scrollUp), max));
}

/**
 * Compute which contiguous slice of messages to render.
 *
 * @param total    total message count
 * @param capacity how many messages to render above the newest-visible one
 *                 (a generous render budget — overshoot is fine, the Box clips
 *                 the top; undershoot just leaves blank space)
 * @param scrollUp messages back from the latest that the newest-visible is
 */
export function computeViewportWindow(total: number, capacity: number, scrollUp: number): ViewportWindow {
  if (total <= 0) {
    return { startIndex: 0, endIndex: 0, atBottom: true, hiddenAbove: 0, hiddenBelow: 0 };
  }
  const s = clampScroll(scrollUp, total);
  const endIndex = total - s;
  const startIndex = Math.max(0, endIndex - Math.max(1, Math.floor(capacity)));
  return {
    startIndex,
    endIndex,
    atBottom: s === 0,
    hiddenAbove: startIndex,
    hiddenBelow: total - endIndex,
  };
}
