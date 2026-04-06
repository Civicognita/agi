/**
 * MagicAppModal — floating/docked window for running a MagicApp.
 *
 * Modes:
 *   floating  — draggable window with resize
 *   docked    — left panel (like chat flyout)
 *   minimized — hidden, shown in footer tray
 */

import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button.js";
import { WidgetRenderer } from "./WidgetRenderer.js";
import type { MagicAppInfo, MagicAppInstance } from "@/types.js";

export interface MagicAppModalProps {
  app: MagicAppInfo;
  instance: MagicAppInstance;
  onMinimize: () => void;
  onDock: () => void;
  onFloat: () => void;
  onClose: () => void;
  onToolExecute?: (projectPath: string, toolId: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
  widgets?: Array<Record<string, unknown>>;
}

export function MagicAppModal({
  app,
  instance,
  onMinimize,
  onDock,
  onFloat,
  onClose,
  onToolExecute,
  widgets,
}: MagicAppModalProps) {
  if (instance.mode === "minimized") return null;

  const isDocked = instance.mode === "docked";

  return (
    <div
      className={cn(
        "flex flex-col bg-card border border-border rounded-xl shadow-2xl overflow-hidden",
        isDocked
          ? "fixed left-0 top-12 bottom-0 w-[400px] z-[140] rounded-none border-l-0 border-t-0 border-b-0"
          : "fixed z-[160] w-[600px] h-[500px]",
      )}
      style={
        !isDocked && instance.position
          ? { left: instance.position.x, top: instance.position.y, width: instance.position.width, height: instance.position.height }
          : !isDocked ? { left: "calc(50% - 300px)", top: "calc(50% - 250px)" } : undefined
      }
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-mantle cursor-move select-none">
        <div className="flex items-center gap-2">
          <span className="text-sm">{app.icon ?? "\u2728"}</span>
          <span className="text-[12px] font-semibold text-foreground">{app.name}</span>
        </div>
        <div className="flex items-center gap-1">
          {isDocked ? (
            <button onClick={onFloat} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-surface1 text-muted-foreground" title="Float">
              {"\u2197\uFE0F"}
            </button>
          ) : (
            <button onClick={onDock} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-surface1 text-muted-foreground" title="Dock left">
              {"\u2B05\uFE0F"}
            </button>
          )}
          <button onClick={onMinimize} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-surface1 text-muted-foreground" title="Minimize">
            {"\u2796"}
          </button>
          <button onClick={onClose} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-red/20 text-red" title="Close">
            {"\u2715"}
          </button>
        </div>
      </div>

      {/* Body — Canvas area for widgets */}
      <div className="flex-1 overflow-auto p-3">
        {widgets && widgets.length > 0 ? (
          <WidgetRenderer
            widgets={widgets as import("@/types.js").PanelWidget[]}
            projectPath={instance.projectPath}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <div className="text-center">
              <div className="text-3xl mb-2">{app.icon ?? "\u2728"}</div>
              <div>{app.name}</div>
              <div className="text-xs mt-1">{app.description}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
