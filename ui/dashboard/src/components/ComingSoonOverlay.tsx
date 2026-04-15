/**
 * ComingSoonOverlay — wrap any content with a diagonal watermark + subtle
 * blur to mark it as a preview-only surface. Pointer events pass through the
 * watermark layer so underlying content stays interactive (useful when the
 * UI is wired but the data is stubbed).
 *
 * Used on the Overview dashboard's Impactinomics tab until 0PRIME / MINT
 * comes online.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ComingSoonOverlayProps {
  children: ReactNode;
  label?: string;
  /** Extra explanation shown under the watermark. */
  caption?: string;
  className?: string;
}

export function ComingSoonOverlay({ children, label = "COMING SOON", caption, className }: ComingSoonOverlayProps) {
  return (
    <div className={cn("relative", className)}>
      {/* Muted content underneath */}
      <div className="opacity-40 pointer-events-none select-none">
        {children}
      </div>

      {/* Watermark layer — centered, diagonal, pointer-events-none so clicks
          in any future interactive state still pass through. */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex flex-col items-center gap-2 px-6 py-4 rounded-lg bg-background/70 backdrop-blur-sm border border-border shadow-lg">
          <span
            className="text-2xl md:text-4xl font-bold uppercase tracking-[0.25em] text-foreground/70"
            style={{ transform: "rotate(-6deg)" }}
          >
            {label}
          </span>
          {caption && (
            <span className="text-[11px] text-muted-foreground max-w-md text-center">
              {caption}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
