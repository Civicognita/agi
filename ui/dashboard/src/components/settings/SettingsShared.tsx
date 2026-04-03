/**
 * Shared settings primitives used across settings sub-pages.
 */

import { cn } from "@/lib/utils";

export function SectionHeading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("text-base font-semibold text-card-foreground mb-4 pb-2 border-b border-border", className)}>
      {children}
    </div>
  );
}

export function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-[13px] text-muted-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}
