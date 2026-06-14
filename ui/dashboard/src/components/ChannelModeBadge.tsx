/**
 * ChannelModeBadge — colored mode chip for the 6-state channel mode system.
 *
 * Modes: off · monitor · respond · auto · escalate · approval
 * Colors mirror the Aionima design system: sky=monitor, violet=respond,
 * emerald=auto, amber=escalate, rose=approval, zinc=off.
 */

import { cn } from "@/lib/utils";

export type DiscordChannelMode = "off" | "monitor" | "respond" | "auto" | "escalate" | "approval";

export const CHANNEL_MODES: DiscordChannelMode[] = [
  "off", "monitor", "respond", "auto", "escalate", "approval",
];

export const CHANNEL_MODE_META: Record<
  DiscordChannelMode,
  { label: string; dot: string; badge: string; description: string }
> = {
  off: {
    label: "Off",
    dot: "bg-zinc-500 opacity-50",
    badge: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20 dark:text-zinc-400",
    description: "Ignored — Aion never reads or responds",
  },
  monitor: {
    label: "Monitor",
    dot: "bg-sky-400",
    badge: "bg-sky-500/10 text-sky-600 border-sky-500/25 dark:text-sky-300",
    description: "Reads all messages for context, never responds",
  },
  respond: {
    label: "Respond",
    dot: "bg-violet-400",
    badge: "bg-violet-500/10 text-violet-600 border-violet-500/25 dark:text-violet-300",
    description: "Full AI routing — responds when triggered",
  },
  auto: {
    label: "Auto",
    dot: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:text-emerald-400",
    description: "Autonomous — Aion acts without human prompting",
  },
  escalate: {
    label: "Escalate",
    dot: "bg-amber-500",
    badge: "bg-amber-500/10 text-amber-600 border-amber-500/25 dark:text-amber-300",
    description: "Escalation only — routes flagged messages to operators",
  },
  approval: {
    label: "Approval",
    dot: "bg-rose-500",
    badge: "bg-rose-500/10 text-rose-600 border-rose-500/25 dark:text-rose-300",
    description: "Human approval required before Aion sends any reply",
  },
};

interface ChannelModeBadgeProps {
  mode: DiscordChannelMode;
  size?: "xs" | "sm" | "md";
  showDot?: boolean;
  className?: string;
}

export function ChannelModeBadge({ mode, size = "md", showDot = true, className }: ChannelModeBadgeProps) {
  const meta = CHANNEL_MODE_META[mode];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-semibold tracking-wide shrink-0",
        size === "xs" && "h-[18px] px-1.5 text-[9.5px]",
        size === "sm" && "h-[20px] px-2 text-[10.5px]",
        size === "md" && "h-[22px] px-2.5 text-[11px]",
        meta.badge,
        className,
      )}
    >
      {showDot && <span className={cn("inline-block w-1.5 h-1.5 rounded-full shrink-0", meta.dot)} />}
      {meta.label}
    </span>
  );
}
