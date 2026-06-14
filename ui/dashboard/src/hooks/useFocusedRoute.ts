/**
 * useFocusedRoute — returns true when the current route should render in
 * Hearth focused-canvas mode (38% chat pane left, 62% canvas right).
 *
 * Matches /projects/:slug (not the /projects list) and /comms/*.
 *
 * s198 — Focused canvas state.
 */

import { useLocation } from "react-router";

const FOCUSED_PATTERNS = [
  /^\/projects\/[^/]+/,  // /projects/:slug — not the bare /projects list
  /^\/comms\//,          // /comms/* — all comms sub-routes
];

export function useFocusedRoute(): boolean {
  const { pathname } = useLocation();
  return FOCUSED_PATTERNS.some((p) => p.test(pathname));
}
