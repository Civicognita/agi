import { useEffect, useRef, useState } from "react";
import type { DesktopWindow } from "../types.js";

/**
 * Bottom taskbar — shows all open windows (including minimized).
 * Click to focus + restore. X to close. Right-click for context menu
 * with Restore / Minimize / Close (s140 t599 phase 4 cycle 193).
 */

interface TaskbarProps {
  windows: DesktopWindow[];
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  /** s140 t599 phase 4 — minimize from taskbar context menu. */
  onMinimize: (id: string) => void;
}

interface MenuState {
  windowId: string;
  x: number;
  y: number;
}

export function Taskbar({ windows, onFocus, onClose, onMinimize }: TaskbarProps): React.ReactElement {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside dismisses the context menu. Mount + unmount listener
  // only while menu is open to avoid stealing every click event.
  useEffect(() => {
    if (menu === null) return;
    function onDocClick(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    }
    function onEsc(e: KeyboardEvent): void {
      if (e.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menu]);

  function handleContextMenu(e: React.MouseEvent, windowId: string): void {
    e.preventDefault();
    setMenu({ windowId, x: e.clientX, y: e.clientY });
  }

  const menuTarget = menu !== null ? windows.find((w) => w.id === menu.windowId) : undefined;

  return (
    <>
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
              onContextMenu={(e) => handleContextMenu(e, w.id)}
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

      {/* Context menu (s140 t599 phase 4). Bottom-anchored: position the
          menu's BOTTOM edge at the click Y so it pops upward from the
          taskbar instead of off-screen below. */}
      {menu !== null && menuTarget !== undefined && (
        <div
          ref={menuRef}
          data-testid={`taskbar-menu-${menuTarget.id}`}
          className="fixed bg-card border border-border rounded-md shadow-2xl py-1 z-[1000] min-w-[140px]"
          style={{ left: menu.x, bottom: typeof window !== "undefined" ? window.innerHeight - menu.y : 0 }}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-card-hover"
            onClick={() => { onFocus(menuTarget.id); setMenu(null); }}
            data-testid={`taskbar-menu-restore-${menuTarget.id}`}
          >
            {menuTarget.minimized ? "Restore" : "Bring to front"}
          </button>
          {!menuTarget.minimized && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-card-hover"
              onClick={() => { onMinimize(menuTarget.id); setMenu(null); }}
              data-testid={`taskbar-menu-minimize-${menuTarget.id}`}
            >
              Minimize
            </button>
          )}
          <div className="border-t border-border my-1"></div>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-[12px] text-red hover:bg-card-hover"
            onClick={() => { onClose(menuTarget.id); setMenu(null); }}
            data-testid={`taskbar-menu-close-${menuTarget.id}`}
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}
