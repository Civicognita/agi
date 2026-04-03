/**
 * ActivityDot — small animated indicator that pulses when Aionima is actively working.
 */

import { cn } from "@/lib/utils";

interface ActivityDotProps {
  active: boolean;
  title?: string;
}

export function ActivityDot({ active, title }: ActivityDotProps) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full transition-colors",
        active
          ? "bg-green animate-[pulse-green_1.5s_ease-in-out_infinite]"
          : "bg-surface2",
      )}
      title={title ?? (active ? "Aionima is working..." : "Idle")}
    />
  );
}
