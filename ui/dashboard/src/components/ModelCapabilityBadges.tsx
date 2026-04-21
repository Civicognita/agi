/**
 * ModelCapabilityBadges — compact row of capability indicators for a model.
 *
 * Surfaces context window + tool support from the static capability registry
 * (`@agi/model-runtime/model-capabilities.ts`). Used in HF Marketplace cards
 * and Providers UI rows so users can pick a model with eyes open.
 */

import { cn } from "@/lib/utils";
import type { ModelCapabilityInfo } from "@/types.js";

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

export interface ModelCapabilityBadgesProps {
  capability: ModelCapabilityInfo | null;
  className?: string;
  /** Compact variant shrinks padding and typography for dense rows. */
  compact?: boolean;
}

export function ModelCapabilityBadges({ capability, className, compact }: ModelCapabilityBadgesProps) {
  if (capability === null) return null;

  const sizeClass = compact ? "text-[10px] px-1.5 py-0.5" : "text-[11px] px-2 py-0.5";
  const baseClass = "inline-flex items-center gap-1 rounded border font-medium";
  const sourceLabel =
    capability.source === "family"
      ? "Matched model family"
      : capability.source === "provider-default"
        ? "Provider default (no family match)"
        : "Unknown";

  return (
    <div
      className={cn("flex items-center gap-1 flex-wrap", className)}
      data-testid="model-capability-badges"
      title={sourceLabel}
    >
      <span
        className={cn(
          baseClass,
          sizeClass,
          "bg-muted/40 border-border text-foreground",
        )}
        data-testid="capability-context-window"
      >
        <span className="text-muted-foreground">ctx</span>
        <span>{formatContextWindow(capability.contextWindow)}</span>
      </span>
      <span
        className={cn(
          baseClass,
          sizeClass,
          capability.toolSupport
            ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400"
            : "bg-muted/40 border-border text-muted-foreground",
        )}
        data-testid="capability-tool-support"
      >
        <span>{capability.toolSupport ? "tools" : "no tools"}</span>
      </span>
    </div>
  );
}
