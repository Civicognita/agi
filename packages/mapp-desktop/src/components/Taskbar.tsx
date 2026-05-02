import type { DesktopWindow } from "../types.js";

/**
 * Bottom taskbar — shows all open windows (including minimized).
 * Click to focus + restore. X to close. Phase 1 visual + interactions
 * sufficient; phase 2+ adds right-click menu, close-all, etc.
 */

interface TaskbarProps {
  windows: DesktopWindow[];
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
}

export function Taskbar({ windows, onFocus, onClose }: TaskbarProps): React.ReactElement {
  return (
    <footer
      className="absolute bottom-0 left-0 right-0 h-12 bg-card border-t border-border flex items-center px-3 gap-1 overflow-x-auto"
      data-testid="taskbar"
    >
      {windows.length === 0 ? (
        <span className="text-[11px] text-muted px-2">No open MApps</span>
      ) : (
        windows.map((w) => (
          <div
            key={w.id}
            className="flex items-center gap-1 bg-bg border border-border rounded px-2 py-1 hover:bg-card-hover transition-colors"
            data-testid={`taskbar-window-${w.id}`}
          >
            <button
              type="button"
              onClick={() => onFocus(w.id)}
              className="flex items-center gap-1.5 text-[11px]"
            >
              <span>{w.icon}</span>
              <span className={w.minimized ? "text-muted" : "text-fg"}>{w.title}</span>
            </button>
            <button
              type="button"
              onClick={() => onClose(w.id)}
              className="text-[11px] text-muted hover:text-fg ml-1"
              data-testid={`taskbar-close-${w.id}`}
              title="Close"
            >
              ×
            </button>
          </div>
        ))
      )}
    </footer>
  );
}
