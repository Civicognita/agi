/**
 * PanelTrigger — trigger button for FlyoutPanel (button or pulltab variant).
 */

import type { ReactNode } from "react";
import { cn } from "@particle-academy/react-fancy";
import { Button } from "./button";

export type PanelTriggerPosition = "left" | "right" | "top" | "bottom";

export interface PanelTriggerProps {
  variant?: "button" | "pulltab";
  position?: PanelTriggerPosition;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}

const pulltabPosition: Record<PanelTriggerPosition, string> = {
  left: "fixed left-0 top-1/2 -translate-y-1/2 rounded-r-lg rounded-l-none border-l-0",
  right: "fixed right-0 top-1/2 -translate-y-1/2 rounded-l-lg rounded-r-none border-r-0",
  top: "fixed top-0 left-1/2 -translate-x-1/2 rounded-b-lg rounded-t-none border-t-0",
  bottom: "fixed bottom-0 left-1/2 -translate-x-1/2 rounded-t-lg rounded-b-none border-b-0",
};

const textRotation: Record<PanelTriggerPosition, string> = {
  left: "[writing-mode:vertical-lr] rotate-180",
  right: "[writing-mode:vertical-lr]",
  top: "",
  bottom: "",
};

export function PanelTrigger({
  variant = "button",
  position = "right",
  onClick,
  className,
  children,
}: PanelTriggerProps) {
  if (variant === "button") {
    return (
      <Button variant="outline" onClick={onClick} className={className} data-testid="panel-trigger-button">
        {children}
      </Button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "z-[140] px-1.5 py-3 bg-card border border-border text-muted-foreground text-xs font-medium",
        "hover:bg-secondary hover:text-foreground transition-colors cursor-pointer",
        pulltabPosition[position],
        textRotation[position],
        className,
      )}
      data-testid="panel-trigger-pulltab"
    >
      {children}
    </button>
  );
}
