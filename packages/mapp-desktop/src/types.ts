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
  /** Where the MApp's UI lives. Phase 2 will load this in an iframe. */
  panelUrl?: string;
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
