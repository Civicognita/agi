/**
 * AccordionFlyout — chat + agent canvas as a horizontal AccordionPanel.
 *
 * **Layout per owner mockups (debug folder, 2026-04-28):**
 *   - Two sections side-by-side: CANVAS on the left, CHAT on the right.
 *   - Each section has a vertical rail on its trailing edge with a rotated
 *     text label ("CANVAS" / "CHAT") that doubles as the collapse trigger.
 *   - Either or both sections can collapse to just the rail, surfacing only
 *     the trigger label as a thin strip.
 *
 * **z-index policy:**
 *   The flyout's overlay positioning sits at `z-[200]`. Header-triggered
 *   overlays (notifications dropdown, upgrade list, dev notes opened from
 *   the header, settings menu, etc.) MUST use `z-[300]+` so they remain on
 *   top of this panel — per owner directive: "if it triggered from the
 *   header it should be on z-top of everything else."
 *
 * **Mobile:** AccordionPanel orientation flips to vertical so the two
 *   surfaces stack rather than fight for narrow viewport width. Canvas
 *   defaults closed on mobile (chat is the primary surface).
 *
 * **ADF status:** dashboard-local. Lift to particle-academy (or `./ui/*`)
 *   when a plugin/MApp wants the same chat+canvas pattern. The composition
 *   is generic — it doesn't know about chat or canvas internals; it just
 *   provides the rail-trigger chrome around two slots.
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  AccordionPanel,
  type AccordionPanelProps,
  type SectionRenderState,
} from "@particle-academy/react-fancy";
import { cn } from "@/lib/utils";

export type AccordionFlyoutSectionId = "canvas" | "chat";

interface AccordionFlyoutProps {
  /** Chat panel content — typically the existing chat-flyout body
   *  (header + message list + composer). */
  chat: ReactNode;
  /** Canvas panel content — typically `<AgentCanvas surface={...} />`. */
  canvas: ReactNode;
  /** Which sections are open. Defaults to `["canvas", "chat"]` (both open)
   *  on desktop; `["chat"]` on mobile. */
  defaultOpen?: AccordionFlyoutSectionId[];
  /** Mobile flag — flips orientation to vertical and defaults canvas closed. */
  isMobile?: boolean;
  /** Outer chrome class — used for fixed overlay vs docked inline switch. */
  className?: string;
  /** Called when the user toggles a section open/closed. Useful for
   *  callers that want to react (e.g. lazy-load canvas content). */
  onOpenChange?: (open: AccordionFlyoutSectionId[]) => void;
}

/** Custom trigger render-prop. When the section is OPEN, renders a thin
 *  vertical rail on its trailing edge. When CLOSED, the rail expands to
 *  fill the section and shows only the rotated label as the click target. */
function RailTrigger({ label, state }: { label: string; state: SectionRenderState }) {
  const { open, toggle, orientation } = state;

  // Vertical orientation rail (desktop default). The rotated text label
  // sits along the long edge of the rail. Hover state hints at toggle.
  if (orientation === "horizontal") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
        aria-expanded={open}
        className={cn(
          "h-full flex items-center justify-center cursor-pointer",
          "transition-colors border-x border-border/50",
          open
            ? "w-3 bg-background hover:bg-secondary/50"
            : "w-8 bg-secondary/30 hover:bg-secondary/60",
        )}
        data-testid={`flyout-rail-${label.toLowerCase()}`}
      >
        <span
          className={cn(
            "text-[10px] tracking-[0.2em] uppercase font-semibold",
            "text-muted-foreground/60",
            // Rotate the text 90° so it reads bottom-to-top along the rail.
            "[writing-mode:vertical-rl] [transform:rotate(180deg)]",
          )}
        >
          {label}
        </span>
      </button>
    );
  }

  // Horizontal orientation rail (mobile/stacked). The label sits along the
  // top edge as a normal-flow row.
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
      aria-expanded={open}
      className={cn(
        "w-full flex items-center justify-center cursor-pointer",
        "transition-colors border-y border-border/50",
        open ? "h-3 bg-background hover:bg-secondary/50" : "h-8 bg-secondary/30 hover:bg-secondary/60",
      )}
      data-testid={`flyout-rail-${label.toLowerCase()}`}
    >
      <span className="text-[10px] tracking-[0.2em] uppercase font-semibold text-muted-foreground/60">
        {label}
      </span>
    </button>
  );
}

export function AccordionFlyout({
  chat,
  canvas,
  defaultOpen,
  isMobile = false,
  className,
  onOpenChange,
}: AccordionFlyoutProps) {
  // Owner directive cycle 130: "the chat UI ... sized to scale". Default
  // both desktop AND mobile to chat-only — canvas opens on-demand via
  // its rail trigger. Previously desktop defaulted to ["canvas", "chat"]
  // which gave each panel 50% of the flyout width, squeezing chat into
  // ~33vw in overlay mode. Now chat dominates; canvas is opt-in.
  const initialOpen: AccordionFlyoutSectionId[] = defaultOpen ?? ["chat"];

  const [openSections, setOpenSections] = useState<AccordionFlyoutSectionId[]>(initialOpen);

  // If the mobile flag changes mid-session (window resize), keep chat-only
  // as the safe default unless the caller passed an explicit defaultOpen.
  useEffect(() => {
    if (defaultOpen) return;
    setOpenSections(["chat"]);
  }, [isMobile, defaultOpen]);

  const handleValueChange: AccordionPanelProps["onValueChange"] = (next) => {
    const typed = next.filter((id): id is AccordionFlyoutSectionId =>
      id === "canvas" || id === "chat",
    );
    setOpenSections(typed);
    onOpenChange?.(typed);
  };

  return (
    <AccordionPanel
      orientation={isMobile ? "vertical" : "horizontal"}
      value={openSections}
      onValueChange={handleValueChange}
      className={cn(
        "h-full w-full bg-background",
        // Horizontal layout fills width; vertical layout stacks.
        isMobile ? "flex flex-col" : "flex flex-row",
        className,
      )}
    >
      {/* Canvas section — leading edge. Pinned=false so users can collapse
          it when they want chat-only mode. */}
      <AccordionPanel.Section
        id="canvas"
        unstyled
        className={cn(
          "min-w-0 min-h-0 flex",
          // Open: take half the width; closed: collapse to rail width only.
          openSections.includes("canvas")
            ? (isMobile ? "flex-row h-1/2 w-full" : "flex-row flex-1")
            : (isMobile ? "flex-row h-8 w-full" : "flex-row w-8"),
        )}
        openClassName="data-canvas-open"
        closedClassName="data-canvas-closed"
      >
        <AccordionPanel.Content unstyled className="flex-1 min-w-0 min-h-0">
          {canvas}
        </AccordionPanel.Content>
        <AccordionPanel.Trigger>
          {(state) => <RailTrigger label="Canvas" state={state} />}
        </AccordionPanel.Trigger>
      </AccordionPanel.Section>

      {/* Chat section — trailing edge. Same pattern as canvas: trigger rail
          on the leading edge so when both are open, you get
          [canvas | rail | rail | chat]. When chat is closed, the rail sits
          flush against the right edge as a thin "CHAT" strip. */}
      <AccordionPanel.Section
        id="chat"
        unstyled
        className={cn(
          "min-w-0 min-h-0 flex",
          openSections.includes("chat")
            ? (isMobile ? "flex-row h-1/2 w-full" : "flex-row flex-1")
            : (isMobile ? "flex-row h-8 w-full" : "flex-row w-8"),
        )}
        openClassName="data-chat-open"
        closedClassName="data-chat-closed"
      >
        <AccordionPanel.Trigger>
          {(state) => <RailTrigger label="Chat" state={state} />}
        </AccordionPanel.Trigger>
        <AccordionPanel.Content unstyled className="flex-1 min-w-0 min-h-0">
          {chat}
        </AccordionPanel.Content>
      </AccordionPanel.Section>
    </AccordionPanel>
  );
}
