import { useCallback, useRef, useState } from "react";
import type { DesktopWindow } from "../types.js";

/**
 * A draggable, focusable window. Phase 1: header drag (mouse), close +
 * minimize buttons, focus on click anywhere. Body is a placeholder
 * until phase 2 lands the iframe MApp loader.
 */

interface WindowProps {
  window: DesktopWindow;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  onClose: () => void;
  onMinimize: () => void;
}

export function Window({ window: w, onFocus, onMove, onClose, onMinimize }: WindowProps): React.ReactElement {
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [, force] = useState(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    onFocus();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: w.x, origY: w.y };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      onMove(d.origX + ev.clientX - d.startX, d.origY + ev.clientY - d.startY);
      force((n) => n + 1);
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [onFocus, onMove, w.x, w.y]);

  return (
    <div
      data-testid={`window-${w.id}`}
      className="absolute bg-card border border-border rounded-lg overflow-hidden flex flex-col shadow-2xl"
      style={{
        left: `${String(w.x)}px`,
        top: `${String(w.y)}px`,
        width: `${String(w.w)}px`,
        height: `${String(w.h)}px`,
        zIndex: w.z,
      }}
      onMouseDown={onFocus}
    >
      {/* Title bar — drag handle */}
      <header
        className="flex items-center gap-2 px-3 py-2 bg-bg border-b border-border cursor-move select-none"
        onMouseDown={onMouseDown}
        data-testid={`window-titlebar-${w.id}`}
      >
        <span className="text-base">{w.icon}</span>
        <span className="text-[12px] font-medium flex-1 truncate">{w.title}</span>
        <button
          type="button"
          className="text-[14px] text-muted hover:text-fg w-6 h-6 flex items-center justify-center rounded hover:bg-card-hover"
          onClick={(e) => { e.stopPropagation(); onMinimize(); }}
          data-testid={`window-minimize-${w.id}`}
          title="Minimize"
        >
          –
        </button>
        <button
          type="button"
          className="text-[14px] text-muted hover:text-fg w-6 h-6 flex items-center justify-center rounded hover:bg-card-hover"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          data-testid={`window-close-${w.id}`}
          title="Close"
        >
          ×
        </button>
      </header>

      {/* Body — phase-1 placeholder. Phase 2: <iframe src={panelUrl} /> */}
      <div className="flex-1 flex items-center justify-center text-muted text-sm">
        <div className="text-center">
          <div className="text-[48px] mb-2">{w.icon}</div>
          <div className="text-[14px] font-medium text-fg mb-1">{w.title}</div>
          <div className="text-[11px]">MApp content loads in phase 2 (iframe + IPC)</div>
        </div>
      </div>
    </div>
  );
}
