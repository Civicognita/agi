/**
 * DayNavigator — ← Prev | [date] | Next → date picker for session views.
 */

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button.js";

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  if (iso === todayIso) return "Today";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function shiftDay(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export interface DayNavigatorProps {
  date: string;
  onChange: (d: string) => void;
  className?: string;
}

export function DayNavigator({ date, onChange, className }: DayNavigatorProps) {
  const today = new Date().toISOString().slice(0, 10);
  const isToday = date === today;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button
        variant="ghost"
        size="sm"
        className="text-[12px] h-7 px-2"
        onClick={() => onChange(shiftDay(date, -1))}
      >
        ← Prev
      </Button>
      <span className="text-[13px] font-medium text-foreground min-w-[100px] text-center">
        {formatDate(date)}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="text-[12px] h-7 px-2"
        disabled={isToday}
        onClick={() => onChange(shiftDay(date, 1))}
      >
        Next →
      </Button>
      {!isToday && (
        <Button
          variant="outline"
          size="sm"
          className="text-[11px] h-7 px-2 ml-1"
          onClick={() => onChange(today)}
        >
          Today
        </Button>
      )}
    </div>
  );
}
