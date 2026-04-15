/**
 * PageScroll — default scroll wrapper for content pages.
 * Provides padding and vertical scrolling. Full-height pages (docs, knowledge,
 * project editor) do NOT use this — they manage their own layout.
 */
import type { ReactNode } from "react";

export function PageScroll({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-6">
      {children}
    </div>
  );
}
