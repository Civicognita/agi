import { useCallback, useRef, useState } from "react";
import type { DesktopWindow } from "../types.js";

/**
 * A draggable, focusable window. Phase 1: header drag, close +
 * minimize, focus on click. Phase 2: iframe MApp loader with sandbox
 * attribute + postMessage IPC. Body is the iframe when the MApp
 * carries a panelUrl; otherwise a placeholder for missing/uninstalled
 * MApps.
 */

/**
 * Iframe sandbox flags — restrictive by default. MApps run in a
 * sandboxed origin with no parent access. Specific capabilities the
 * MApp needs get re-granted via opt-in flags below:
 *   - allow-scripts: required for any interactive MApp
 *   - allow-same-origin: required for MApps that fetch from /api/...
 *     under the runtime's hostname (project-scoped storage endpoints
 *     in phase 3). Without it the iframe gets a null origin and
 *     CORS-blocks all credentialed fetches.
 *   - allow-forms: needed for MApps that submit forms (e.g. an editor
 *     POST on save).
 *   - allow-popups: opens links in new tabs without breaking targeted
 *     anchor clicks.
 *
 * Deliberately omitted (would break the security model):
 *   - allow-top-navigation: MApp should NOT be able to redirect the
 *     parent runtime away.
 *   - allow-modals: prevents alert()/confirm() dialogs that block the
 *     parent.
 */
const IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups";

interface WindowProps {
  window: DesktopWindow;
  panelUrl?: string;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  onClose: () => void;
  onMinimize: () => void;
}

export function Window({ window: w, panelUrl, onFocus, onMove, onClose, onMinimize }: WindowProps): React.ReactElement {
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

      {/* Body — phase 2: iframe when panelUrl present, placeholder
          when MApp has no panel (uninstalled / missing bundle). */}
      {panelUrl ? (
        <iframe
          src={panelUrl}
          title={w.title}
          sandbox={IFRAME_SANDBOX}
          className="flex-1 w-full bg-bg border-0"
          data-testid={`window-iframe-${w.id}`}
          data-mapp-id={w.mappId}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          <div className="text-center">
            <div className="text-[48px] mb-2">{w.icon}</div>
            <div className="text-[14px] font-medium text-fg mb-1">{w.title}</div>
            <div className="text-[11px]">No panel URL — MApp not installed yet</div>
          </div>
        </div>
      )}
    </div>
  );
}
