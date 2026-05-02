/**
 * MApp Desktop runtime types.
 *
 * The runtime gets its project context from the request hostname (the
 * Caddy reverse_proxy injects an X-Project-Slug header, OR the page
 * is loaded at <project>.ai.on/ which the runtime parses on boot).
 * Each MApp opens in its own Window — multiple windows simultaneously,
 * focus/blur via z-index, drag to reposition.
 */

export type MAppCategory = "viewer" | "production" | "tool" | "game" | "custom";

export interface MAppEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: MAppCategory;
  /** Where the MApp's UI lives. Loaded into a sandboxed iframe by the
   *  Window component. When undefined, Window renders the phase-1
   *  placeholder body so a missing/uninstalled MApp still opens
   *  cleanly with a useful "not installed" message instead of a
   *  broken iframe. */
  panelUrl?: string;
}

/**
 * Inter-app message envelope passed via window.postMessage. The runtime
 * is the trusted parent; MApp iframes are untrusted children. Each
 * message carries its origin mappId so the runtime can route per-MApp
 * state correctly.
 */
export interface DesktopMessage {
  /** Identifies this as a MApp Desktop message (vs other postMessage
   *  traffic that may share the channel). */
  protocol: "mapp-desktop/1";
  /** Originating MApp id. Set by the iframe child; runtime trusts the
   *  iframe's bound mappId rather than this value for security
   *  decisions, but echoes it for symmetry. */
  mappId: string;
  type: string;
  payload?: unknown;
}

export interface DesktopWindow {
  /** Unique window id (separate from MApp id — same MApp may open
   *  multiple windows in future phases). */
  id: string;
  mappId: string;
  title: string;
  icon: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
}
