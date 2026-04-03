/**
 * FlyoutPanel — reusable slide-in panel with backdrop and CSS transitions.
 * Compound sub-components: FlyoutHeader, FlyoutBody, FlyoutFooter.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@particle-academy/react-fancy";

export type FlyoutPosition = "left" | "right" | "top" | "bottom";

export interface FlyoutPanelProps {
  open: boolean;
  onClose: () => void;
  position?: FlyoutPosition;
  width?: string;
  height?: string;
  backdrop?: boolean;
  className?: string;
  children: ReactNode;
}

const translateHidden: Record<FlyoutPosition, string> = {
  left: "-translate-x-full",
  right: "translate-x-full",
  top: "-translate-y-full",
  bottom: "translate-y-full",
};

const positionClasses: Record<FlyoutPosition, string> = {
  left: "left-0 top-0 h-full",
  right: "right-0 top-0 h-full",
  top: "top-0 left-0 w-full",
  bottom: "bottom-0 left-0 w-full",
};

export function FlyoutPanel({
  open,
  onClose,
  position = "right",
  width = "33vw",
  height = "50vh",
  backdrop = true,
  className,
  children,
}: FlyoutPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Next frame: start transition
      timerRef.current = setTimeout(() => setVisible(true), 10);
    } else {
      setVisible(false);
      timerRef.current = setTimeout(() => setMounted(false), 300);
    }
    return () => clearTimeout(timerRef.current);
  }, [open]);

  const handleBackdropClick = useCallback(() => {
    if (backdrop) onClose();
  }, [backdrop, onClose]);

  if (!mounted) return null;

  const isHorizontal = position === "left" || position === "right";
  const sizeStyle = isHorizontal ? { width } : { height };

  return (
    <div className="fixed inset-0 z-[150]" data-testid="flyout-overlay">
      {/* Backdrop */}
      {backdrop && (
        <div
          className={cn(
            "absolute inset-0 bg-black/30 transition-opacity duration-300",
            visible ? "opacity-100" : "opacity-0",
          )}
          onClick={handleBackdropClick}
          data-testid="flyout-backdrop"
        />
      )}

      {/* Panel */}
      <div
        className={cn(
          "absolute bg-card border-border flex flex-col transition-transform duration-300 ease-in-out",
          positionClasses[position],
          visible ? "translate-x-0 translate-y-0" : translateHidden[position],
          isHorizontal
            ? position === "left" ? "border-r" : "border-l"
            : position === "top" ? "border-b" : "border-t",
          className,
        )}
        style={sizeStyle}
        data-testid="flyout-panel"
      >
        {children}
      </div>
    </div>
  );
}

export function FlyoutHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between px-4 py-3 border-b border-border shrink-0", className)}>
      {children}
    </div>
  );
}

export function FlyoutBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex-1 overflow-y-auto p-4", className)}>
      {children}
    </div>
  );
}

export function FlyoutFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("px-4 py-3 border-t border-border shrink-0", className)}>
      {children}
    </div>
  );
}
