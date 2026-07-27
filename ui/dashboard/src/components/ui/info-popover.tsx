/**
 * InfoPopover — a small (i) icon that opens a popover explaining a control
 * (Wave 3). Reusable wherever a dial/toggle/field needs a "what does this do?"
 * hint, so owners aren't guessing at auto-moderation / tool-access / memory-scope
 * settings. Built on the PAx Popover.
 */
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover.js";
import { cn } from "@/lib/utils";

export function InfoPopover({
  children,
  title,
  className,
  label = "More info",
}: {
  /** Explanatory content shown in the popover. */
  children: ReactNode;
  /** Optional bold heading above the content. */
  title?: string;
  /** Extra classes on the trigger. */
  className?: string;
  /** Accessible label for the icon button. */
  label?: string;
}) {
  return (
    <Popover>
      {/* react-fancy's PopoverTriggerProps only accepts {children, className} —
          aria-label/data-testid passed directly to it are silently dropped, so
          they go on this inner span instead (children render through fine). */}
      <PopoverTrigger
        className={cn(
          "inline-flex items-center justify-center align-middle text-muted-foreground/50 hover:text-foreground transition-colors cursor-help",
          className,
        )}
      >
        <span aria-label={label} data-testid="info-popover-trigger" className="inline-flex">
          <Info className="w-3.5 h-3.5" />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 bg-popover border border-border rounded-lg shadow-lg z-[300] text-[11px] text-muted-foreground leading-relaxed">
        <div data-testid="info-popover-content">
          {title !== undefined && <p className="text-[11px] font-semibold text-foreground mb-1">{title}</p>}
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
