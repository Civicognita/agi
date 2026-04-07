/**
 * MagicAppModal — floating/docked/maximized window for running a MagicApp.
 *
 * Modes:
 *   floating   — draggable window with resize
 *   docked     — left panel (like chat flyout)
 *   maximized  — fullscreen overlay
 *   minimized  — hidden, shown in footer tray
 */

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button.js";
import { WidgetRenderer } from "./WidgetRenderer.js";
import { MAppFormRenderer } from "./MAppFormRenderer.js";
import type { MagicAppInfo, MagicAppInstance } from "@/types.js";

export interface MagicAppModalProps {
  app: MagicAppInfo;
  instance: MagicAppInstance;
  onMinimize: () => void;
  onDock: () => void;
  onFloat: () => void;
  onMaximize?: () => void;
  onClose: () => void;
  onToolExecute?: (projectPath: string, toolId: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
  widgets?: Array<Record<string, unknown>>;
  pages?: Array<Record<string, unknown>>;
  constants?: Array<Record<string, unknown>>;
}

export function MagicAppModal({
  app,
  instance,
  onMinimize,
  onDock,
  onFloat,
  onMaximize,
  onClose,
  onToolExecute,
  widgets,
  pages,
  constants,
}: MagicAppModalProps) {
  const [formResult, setFormResult] = useState<{ values: Record<string, unknown>; formulas: Record<string, unknown> } | null>(null);
  const hasPages = pages && pages.length > 0;
  if (instance.mode === "minimized") return null;

  const isDocked = instance.mode === "docked";
  const isMaximized = instance.mode === "maximized";

  return (
    <div
      data-testid="magic-app-modal"
      className={cn(
        "flex flex-col bg-card border border-border shadow-2xl overflow-hidden",
        isMaximized
          ? "fixed inset-0 z-[180] rounded-none"
          : isDocked
            ? "fixed left-0 top-12 bottom-0 w-[400px] z-[140] rounded-none border-l-0 border-t-0 border-b-0"
            : "fixed z-[160] w-[600px] h-[500px] rounded-xl",
      )}
      style={
        !isDocked && !isMaximized && instance.position
          ? { left: instance.position.x, top: instance.position.y, width: instance.position.width, height: instance.position.height }
          : !isDocked && !isMaximized ? { left: "calc(50% - 300px)", top: "calc(50% - 250px)" } : undefined
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
          ) : isMaximized ? (
            <button onClick={onFloat} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-surface1 text-muted-foreground" title="Restore">
              {"\uD83D\uDDD7\uFE0F"}
            </button>
          ) : (
            <>
              <button onClick={onDock} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-surface1 text-muted-foreground" title="Dock left">
                {"\u2B05\uFE0F"}
              </button>
              <button
                data-testid="mapp-maximize-btn"
                onClick={onMaximize}
                className="text-[10px] px-1.5 py-0.5 rounded hover:bg-surface1 text-muted-foreground"
                title="Maximize"
              >
                {"\u2B1C"}
              </button>
            </>
          )}
          <button onClick={onMinimize} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-surface1 text-muted-foreground" title="Minimize">
            {"\u2796"}
          </button>
          <button data-testid="mapp-close-btn" onClick={onClose} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-red/20 text-red" title="Close">
            {"\u2715"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-3">
        {/* Form mode — MApp has pages */}
        {hasPages && !formResult ? (
          <MAppFormRenderer
            pages={pages as import("./MAppFormRenderer.js").MAppFormRendererProps["pages"]}
            constants={constants as import("./MAppFormRenderer.js").MAppFormRendererProps["constants"]}
            projectPath={instance.projectPath}
            onSubmit={(values, formulas) => setFormResult({ values, formulas })}
          />
        ) : formResult ? (
          /* Form submitted — show results */
          <div className="space-y-3">
            <div className="text-[12px] font-semibold text-green mb-2">Form submitted</div>
            <div className="p-3 rounded-lg bg-mantle border border-border">
              <div className="text-[11px] font-semibold text-muted-foreground mb-2">Collected Values</div>
              {Object.entries(formResult.values).filter(([, v]) => v !== "" && v !== undefined).map(([k, v]) => (
                <div key={k} className="flex justify-between text-[12px] py-0.5">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="text-foreground font-medium">{String(v)}</span>
                </div>
              ))}
            </div>
            {Object.keys(formResult.formulas).length > 0 && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                <div className="text-[11px] font-semibold text-muted-foreground mb-2">Calculated Values</div>
                {Object.entries(formResult.formulas).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[12px] py-0.5">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="text-primary font-bold">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => setFormResult(null)}>Run Again</Button>
          </div>
        ) : widgets && widgets.length > 0 ? (
          /* Widget mode — viewer/dashboard MApps */
          <WidgetRenderer
            widgets={widgets as import("@/types.js").PanelWidget[]}
            projectPath={instance.projectPath}
          />
        ) : (
          /* Empty state */
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
